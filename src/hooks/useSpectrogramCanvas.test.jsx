/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useMemo, useRef } from "react";

import { paintSpectrogramImageData, useSpectrogramCanvas } from "./useSpectrogramCanvas.js";
import { SPECTROGRAM_DB_MIN } from "../config/scales.js";

const BANDS = [{ fCenter: 1000 }];

function Harness({ snaps, colormapLut }) {
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

  it("repaints when a stable spectrum view advances version without changing length", () => {
    const snaps = viewOf({ timestampMs: 0, bands: BANDS, dbList: [-20] });
    const colormapLut = new Uint8Array(256 * 3);
    colormapLut.fill(255);
    render(<Harness snaps={snaps} colormapLut={colormapLut} />);

    rafCallback();
    expect(putImageData).toHaveBeenCalledTimes(1);

    snaps.version = 2;
    rafCallback();

    expect(putImageData).toHaveBeenCalledTimes(2);
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
