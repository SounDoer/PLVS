/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useMemo, useRef } from "react";

import { useSpectrogram3dCanvas } from "./useSpectrogram3dCanvas.js";

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
