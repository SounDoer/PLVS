/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useMemo, useRef } from "react";

import { useSpectrogramCanvas } from "./useSpectrogramCanvas.js";

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
});
