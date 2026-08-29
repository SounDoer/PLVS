/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useObservedCanvasSize } from "./useObservedCanvasSize.js";

describe("useObservedCanvasSize", () => {
  let notifyResize;
  let disconnect;

  beforeEach(() => {
    disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function (callback) {
        notifyResize = callback;
        return { observe: vi.fn(), disconnect };
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("measures once on mount and updates the backing store only after a resize notification", () => {
    let cssWidth = 200;
    let cssHeight = 120;
    const canvas = document.createElement("canvas");
    const widthRead = vi.fn(() => cssWidth);
    const heightRead = vi.fn(() => cssHeight);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, get: widthRead });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, get: heightRead });
    const canvasRef = { current: canvas };

    const { result, rerender, unmount } = renderHook(() => useObservedCanvasSize(canvasRef, true));
    expect(result.current).toEqual({ dpr: 1, width: 200, height: 120 });
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(120);
    expect(widthRead).toHaveBeenCalledOnce();
    expect(heightRead).toHaveBeenCalledOnce();

    rerender();
    expect(widthRead).toHaveBeenCalledOnce();
    expect(heightRead).toHaveBeenCalledOnce();

    cssWidth = 260;
    cssHeight = 140;
    act(() => notifyResize());
    expect(result.current).toEqual({ dpr: 1, width: 260, height: 140 });
    expect(canvas.width).toBe(260);
    expect(canvas.height).toBe(140);

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
