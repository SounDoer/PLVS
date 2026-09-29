/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useMemo, useRef } from "react";

import { pointCountFor, ridgeCountFor, useSpectrogram3dCanvas } from "./useSpectrogram3dCanvas.js";

const THEME_COLORS = {};

function Harness({ sourceVersion = 0, enabled = true, canvasSizeRevision = 0 }) {
  const canvasRef = useRef(null);
  const projectionRef = useRef(null);
  const snaps = useMemo(
    () => ({ length: 0, version: sourceVersion, rowAt: () => undefined }),
    [sourceVersion]
  );
  const snapRef = useMemo(() => ({ current: snaps }), [snaps]);
  const colormapLut = useMemo(() => new Uint8Array(256 * 3), []);

  useSpectrogram3dCanvas({
    canvasRef,
    snapRef,
    projectionRef,
    oldestMs: 0,
    newestMs: 40,
    sampleMs: 40,
    selectedOffset: -1,
    selectionXFrac: 1,
    frozenSnaps: null,
    colormapLut,
    minHz: 20,
    maxHz: 20000,
    dbFloor: -84,
    azimuthDeg: 0,
    elevationDeg: 30,
    heightGain: 1,
    colorize: true,
    floor: true,
    mode: "lines",
    themeColors: THEME_COLORS,
    sourceVersion,
    canvasSizeRevision,
    enabled,
  });

  return null;
}

describe("useSpectrogram3dCanvas scheduling", () => {
  let callbacks;

  beforeEach(() => {
    callbacks = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses one-shot invalidation instead of a self-rescheduling loop", () => {
    const { rerender } = render(<Harness sourceVersion={1} />);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    callbacks[0]();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    rerender(<Harness sourceVersion={1} />);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    rerender(<Harness sourceVersion={2} />);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it("does not schedule while inactive and schedules once when activated", () => {
    const { rerender } = render(<Harness sourceVersion={1} enabled={false} />);
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    rerender(<Harness sourceVersion={2} enabled={false} canvasSizeRevision={1} />);
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    rerender(<Harness sourceVersion={2} enabled canvasSizeRevision={1} />);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
});

describe("3D grid density", () => {
  // The divisors were tuned against device width on a 125% display. Restated per CSS px, the counts
  // must be unchanged there and must not change with DPR anywhere.
  const legacyDeviceCount = (deviceWidth, divisor, min, max) =>
    Math.round(Math.min(max, Math.max(min, deviceWidth / divisor)));

  it("keeps the tuned ridge and point counts on the 125% display they were tuned on", () => {
    for (const cssWidth of [200, 480, 800, 1106.4, 1536, 2400]) {
      const deviceWidth = cssWidth * 1.25;
      expect(ridgeCountFor(cssWidth)).toBe(legacyDeviceCount(deviceWidth, 14, 24, 140));
      expect(pointCountFor(cssWidth)).toBe(legacyDeviceCount(deviceWidth, 6, 60, 320));
    }
  });

  it("takes CSS width, so the same panel gets the same density at every DPR", () => {
    // 800 CSS px is 800, 1000 or 1600 device px at 100%, 125% and 200%; the count is one number.
    expect(ridgeCountFor(800)).toBe(71);
    expect(pointCountFor(800)).toBe(167);
  });
});
