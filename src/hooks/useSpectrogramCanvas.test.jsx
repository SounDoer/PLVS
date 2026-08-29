/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useMemo, useRef } from "react";

import {
  paintSpectrogramImageData,
  scrollSpectrogramImageData,
  spectrogramScrollPlan,
  useSpectrogramCanvas,
} from "./useSpectrogramCanvas.js";
import { SPECTROGRAM_DB_MIN } from "../config/scales.js";

const BANDS = [{ fCenter: 1000 }];

function Harness({ snaps, colormapLut, enabled = true, canvasSizeRevision = 0 }) {
  const canvasRef = useRef(null);
  const snapRef = useMemo(() => ({ current: snaps }), [snaps]);

  useSpectrogramCanvas({
    canvasRef,
    snapRef,
    oldestMs: 0,
    newestMs: 40,
    sampleMs: 40,
    selectedOffset: -1,
    frozenSnaps: null,
    colormapLut,
    sourceVersion: snaps.version,
    canvasSizeRevision,
    enabled,
  });

  return <canvas ref={canvasRef} width={2} height={1} />;
}

function viewOf(row) {
  return {
    length: 1,
    version: 1,
    timestampAt: () => 0,
    rowAt: () => row,
  };
}

describe("useSpectrogramCanvas", () => {
  let rafCallback;
  let putImageData;

  beforeEach(() => {
    rafCallback = null;
    putImageData = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
      clearRect: vi.fn(),
      putImageData,
    }));
    vi.stubGlobal(
      "ImageData",
      class ImageDataStub {
        constructor(width, height) {
          this.width = width;
          this.height = height;
          this.data = new Uint8ClampedArray(width * height * 4);
        }
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("schedules one paint when a stable spectrum view advances version without polling", () => {
    const snaps = viewOf({ timestampMs: 0, bands: BANDS, dbList: [-20] });
    const colormapLut = new Uint8Array(256 * 3);
    colormapLut.fill(255);
    const { rerender } = render(<Harness snaps={snaps} colormapLut={colormapLut} />);

    rafCallback();
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    snaps.version = 2;
    rerender(<Harness snaps={snaps} colormapLut={colormapLut} />);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    rafCallback();

    expect(putImageData).toHaveBeenCalledTimes(2);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it("stays idle while hidden and paints once when revealed", () => {
    const snaps = viewOf({ timestampMs: 0, bands: BANDS, dbList: [-20] });
    const colormapLut = new Uint8Array(256 * 3);
    colormapLut.fill(255);
    const { rerender } = render(
      <Harness snaps={snaps} colormapLut={colormapLut} enabled={false} />
    );

    expect(requestAnimationFrame).not.toHaveBeenCalled();

    snaps.version = 2;
    rerender(<Harness snaps={snaps} colormapLut={colormapLut} enabled={false} />);
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    rerender(<Harness snaps={snaps} colormapLut={colormapLut} enabled />);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    rafCallback();
    expect(putImageData).toHaveBeenCalledTimes(1);
  });

  it("invalidates once when only the canvas size revision changes", () => {
    const snaps = viewOf({ timestampMs: 0, bands: BANDS, dbList: [-20] });
    const colormapLut = new Uint8Array(256 * 3);
    colormapLut.fill(255);
    const { rerender } = render(
      <Harness snaps={snaps} colormapLut={colormapLut} canvasSizeRevision={0} />
    );
    rafCallback();

    rerender(<Harness snaps={snaps} colormapLut={colormapLut} canvasSizeRevision={1} />);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it("bounds dense long-window painting by canvas width", () => {
    const length = 10_000;
    const rowAt = vi.fn((index) => ({
      timestampMs: index * 40,
      dbList: [-20],
    }));
    const snaps = {
      length,
      timestampAt: (index) => (index >= 0 && index < length ? index * 40 : NaN),
      rowAt,
    };
    const imageData = new ImageData(20, 1);
    const colormapLut = new Uint8Array(256 * 3);
    colormapLut.fill(255);

    paintSpectrogramImageData(
      imageData,
      snaps,
      0,
      length - 1,
      0,
      length * 40,
      40,
      new Int16Array([0]),
      colormapLut,
      SPECTROGRAM_DB_MIN
    );

    expect(rowAt.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it("preserves real timestamp gaps on the dense bounded path", () => {
    const timestamps = [
      ...Array.from({ length: 50 }, (_, index) => index * 40),
      ...Array.from({ length: 50 }, (_, index) => 4000 + index * 40),
    ];
    const snaps = {
      length: timestamps.length,
      timestampAt: (index) => timestamps[index] ?? NaN,
      rowAt: (index) => ({ timestampMs: timestamps[index], dbList: [-20] }),
    };
    const imageData = new ImageData(20, 1);
    const colormapLut = new Uint8Array(256 * 3);
    colormapLut.fill(255);

    paintSpectrogramImageData(
      imageData,
      snaps,
      0,
      timestamps.length - 1,
      0,
      6000,
      40,
      new Int16Array([0]),
      colormapLut,
      SPECTROGRAM_DB_MIN
    );

    const alphas = Array.from({ length: 20 }, (_, index) => imageData.data[index * 4 + 3]);
    expect(alphas.some((alpha) => alpha === 0)).toBe(true);
    expect(alphas.some((alpha) => alpha > 0)).toBe(true);
  });

  // Proves the default dbFloor value (SPECTROGRAM_DB_MIN) reproduces exactly today's 2D output.
  it("maps a fixed dB to the same pixel bytes at the default floor", () => {
    const snaps = {
      length: 1,
      timestampAt: () => 0,
      rowAt: () => ({ timestampMs: 0, dbList: [-40] }),
    };
    // Distinct RGB per LUT stop so the resolved index is recoverable from the painted colour.
    const colormapLut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      colormapLut[i * 3] = i;
      colormapLut[i * 3 + 1] = 255 - i;
      colormapLut[i * 3 + 2] = 0;
    }

    const atDefaultFloor = new ImageData(1, 1);
    paintSpectrogramImageData(
      atDefaultFloor,
      snaps,
      0,
      0,
      0,
      40,
      40,
      new Int16Array([0]),
      colormapLut,
      SPECTROGRAM_DB_MIN
    );
    // -40 dB against the fixed -84..0 range: t = (−40 − (−84)) / 84 ≈ 0.52381, ×255 → lut index 134.
    expect(Array.from(atDefaultFloor.data)).toEqual([134, 121, 0, 134]);
  });

  // Colour is absolute against the fixed dB range, unlike height. A peak above the floor must keep
  // its exact colour bytes no matter where the floor control is set -- raising the floor should only
  // flatten/hide the noise below it, never recolour the peaks above it.
  it("keeps a peak's colour bytes identical when the floor is raised", () => {
    const snaps = {
      length: 1,
      timestampAt: () => 0,
      rowAt: () => ({ timestampMs: 0, dbList: [-40] }),
    };
    const colormapLut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      colormapLut[i * 3] = i;
      colormapLut[i * 3 + 1] = 255 - i;
      colormapLut[i * 3 + 2] = 0;
    }

    const atDefaultFloor = new ImageData(1, 1);
    paintSpectrogramImageData(
      atDefaultFloor,
      snaps,
      0,
      0,
      0,
      40,
      40,
      new Int16Array([0]),
      colormapLut,
      SPECTROGRAM_DB_MIN
    );

    const atRaisedFloor = new ImageData(1, 1);
    paintSpectrogramImageData(
      atRaisedFloor,
      snaps,
      0,
      0,
      0,
      40,
      40,
      new Int16Array([0]),
      colormapLut,
      -60
    );

    expect(Array.from(atRaisedFloor.data)).toEqual(Array.from(atDefaultFloor.data));
  });
});

describe("spectrogramScrollPlan", () => {
  const W = 600;
  const span = 60_000;

  it("holds the newest column when the window has not moved a whole pixel", () => {
    // One 40 ms row over a 60 s window on 600 px is 0.4 px: most frames earn no column at all.
    const plan = spectrogramScrollPlan(0, 40, span, W);
    expect(plan.shiftPx).toBe(0);
    expect(plan.paintedOldestMs).toBe(0);
    expect(plan.xFrom).toBe(W - 1);
  });

  it("keeps the origin on the pixel grid so the remainder cannot accumulate", () => {
    let paintedOldestMs = 0;
    // Three rows earn one column (3 x 0.4 = 1.2 px), and the 0.2 px left over must survive.
    for (const oldestMs of [40, 80, 120]) {
      paintedOldestMs = spectrogramScrollPlan(paintedOldestMs, oldestMs, span, W).paintedOldestMs;
    }
    expect(paintedOldestMs).toBe(100);

    // Ten thousand frames later the image still stands within one column of the true window.
    for (let frame = 4; frame <= 10_000; frame += 1) {
      paintedOldestMs = spectrogramScrollPlan(paintedOldestMs, frame * 40, span, W).paintedOldestMs;
    }
    const lagPx = ((10_000 * 40 - paintedOldestMs) / span) * W;
    expect(lagPx).toBeGreaterThanOrEqual(0);
    expect(lagPx).toBeLessThan(1);
  });

  it("gives up and repaints in full when the window jumps further than the image is wide", () => {
    const plan = spectrogramScrollPlan(0, span * 2, span, W);
    expect(plan.xFrom).toBe(0);
    expect(plan.paintedOldestMs).toBe(span * 2);
  });

  it("gives up when the window moved backwards", () => {
    expect(spectrogramScrollPlan(5000, 0, span, W).xFrom).toBe(0);
  });
});

describe("sliding versus repainting", () => {
  const W = 64;
  const H = 8;
  const SPAN = 6400;
  const ROW_MS = 100;
  const BAND_COUNT = 8;
  const bands = Array.from({ length: BAND_COUNT }, (_, i) => ({ fCenter: 100 * 2 ** i }));
  const lut = (() => {
    const table = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i += 1) {
      table[i * 3] = i;
      table[i * 3 + 1] = 255 - i;
      table[i * 3 + 2] = (i * 7) % 256;
    }
    return table;
  })();
  const yToBand = Int16Array.from({ length: H }, (_, y) => y % BAND_COUNT);

  function makeView(rowCount) {
    const rows = Array.from({ length: rowCount }, (_, i) => ({
      timestampMs: i * ROW_MS,
      bands,
      dbAt: (band) => -20 - ((i * 3 + band * 5) % 60),
    }));
    return {
      length: rowCount,
      version: rowCount,
      timestampAt: (i) => (i >= 0 && i < rowCount ? rows[i].timestampMs : NaN),
      rowAt: (i) => rows[i],
    };
  }

  function image() {
    return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  }

  function paint(target, view, oldestMs, xFrom) {
    const newest = oldestMs + SPAN;
    let startIdx = 0;
    while (startIdx < view.length && view.timestampAt(startIdx) < oldestMs - ROW_MS) startIdx += 1;
    let endIdx = view.length - 1;
    while (endIdx >= 0 && view.timestampAt(endIdx) > newest) endIdx -= 1;
    if (endIdx < startIdx) return;
    paintSpectrogramImageData(
      target,
      view,
      startIdx,
      endIdx,
      oldestMs,
      SPAN,
      ROW_MS,
      yToBand,
      lut,
      SPECTROGRAM_DB_MIN,
      null,
      xFrom,
      W
    );
  }

  it("lands on the same pixels a full repaint would, after many sliding frames", () => {
    const rowCount = 200;
    const view = makeView(rowCount);
    const slid = image();

    // Start from a full paint, then advance one row at a time the way a live window does.
    let paintedOldestMs = 0;
    paint(slid, view, paintedOldestMs, 0);
    for (let frame = 1; frame < rowCount; frame += 1) {
      const oldestMs = frame * ROW_MS;
      const plan = spectrogramScrollPlan(paintedOldestMs, oldestMs, SPAN, W);
      if (plan.xFrom > 0) {
        scrollSpectrogramImageData(slid, plan.shiftPx);
        paintedOldestMs = plan.paintedOldestMs;
      } else {
        paintedOldestMs = plan.paintedOldestMs;
      }
      paint(slid, view, paintedOldestMs, plan.xFrom);
    }

    // The same instant, drawn from scratch. Identical bytes or the optimisation is not one.
    const repainted = image();
    paint(repainted, view, paintedOldestMs, 0);
    expect(Array.from(slid.data)).toEqual(Array.from(repainted.data));
  });

  it("still slides when the window's length jitters by less than half a column", () => {
    // The window's ends are history timestamps: its length moves by milliseconds every update even
    // when nothing changed. Requiring equality here is what kept the slide path from ever running.
    const rowCount = 120;
    const view = makeView(rowCount);
    const slid = image();
    let paintedOldestMs = 0;
    let paintedSpan = SPAN;
    paint(slid, view, paintedOldestMs, 0);

    for (let frame = 1; frame < rowCount; frame += 1) {
      // A millisecond of jitter on a 6.4 s window is far under half of one of 64 columns.
      const liveSpan = SPAN + (frame % 3) - 1;
      const driftPx = (Math.abs(liveSpan - paintedSpan) / liveSpan) * W;
      expect(driftPx).toBeLessThan(0.5);
      const plan = spectrogramScrollPlan(paintedOldestMs, frame * ROW_MS, paintedSpan, W);
      if (plan.xFrom > 0) scrollSpectrogramImageData(slid, plan.shiftPx);
      paintedOldestMs = plan.paintedOldestMs;
      paint(slid, view, paintedOldestMs, plan.xFrom);
    }

    const repainted = image();
    paint(repainted, view, paintedOldestMs, 0);
    expect(Array.from(slid.data)).toEqual(Array.from(repainted.data));
  });

  it("leaves a gap in time transparent instead of smearing the pixels it slid over", () => {
    const view = makeView(40);
    const gapped = {
      ...view,
      // A silent stretch: the rows stop, then resume far to the right.
      timestampAt: (i) => (i < 20 ? i * ROW_MS : i * ROW_MS + SPAN / 2),
      rowAt: (i) => ({
        ...view.rowAt(i),
        timestampMs: view.timestampAt(i) + (i < 20 ? 0 : SPAN / 2),
      }),
    };
    const slid = image();
    let paintedOldestMs = 0;
    paint(slid, gapped, paintedOldestMs, 0);
    for (let frame = 1; frame < 40; frame += 1) {
      const plan = spectrogramScrollPlan(paintedOldestMs, frame * ROW_MS, SPAN, W);
      if (plan.xFrom > 0) scrollSpectrogramImageData(slid, plan.shiftPx);
      paintedOldestMs = plan.paintedOldestMs;
      paint(slid, gapped, paintedOldestMs, plan.xFrom);
    }
    const repainted = image();
    paint(repainted, gapped, paintedOldestMs, 0);
    expect(Array.from(slid.data)).toEqual(Array.from(repainted.data));
  });
});
