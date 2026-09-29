/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canvasBackingSize,
  useCanvasBackingStore,
  useCanvasBackingStoreSize,
} from "./useCanvasBackingStore.js";

const dprWatch = vi.hoisted(() => ({ onChange: null, dispose: null }));
vi.mock("../lib/devicePixelRatioWatch.js", () => ({
  watchDevicePixelRatio: (onChange) => {
    dprWatch.onChange = onChange;
    dprWatch.dispose = vi.fn();
    return dprWatch.dispose;
  },
}));

describe("canvasBackingSize", () => {
  it("uses the device-pixel content box when the browser reports one", () => {
    expect(
      canvasBackingSize(
        { cssWidth: 100.4, cssHeight: 50.2, deviceWidth: 125, deviceHeight: 63 },
        1.25
      )
    ).toEqual({ dpr: 1.25, width: 125, height: 63 });
  });

  it("falls back to the rounded fractional CSS box times DPR", () => {
    expect(canvasBackingSize({ cssWidth: 100.4, cssHeight: 50.2 }, 1.25)).toEqual({
      dpr: 1.25,
      width: 126,
      height: 63,
    });
  });

  it("scales a capped axis by the cap and keeps device pixels on the other", () => {
    expect(
      canvasBackingSize(
        { cssWidth: 100.4, cssHeight: 50.2, deviceWidth: 201, deviceHeight: 100 },
        2,
        { maxDprX: 1 }
      )
    ).toEqual({ dpr: 2, width: 100, height: 100 });
  });

  it("ignores a cap that does not bind", () => {
    expect(
      canvasBackingSize(
        { cssWidth: 100.4, cssHeight: 50.2, deviceWidth: 125, deviceHeight: 63 },
        1.25,
        { maxDprX: 2, maxDprY: 2 }
      )
    ).toEqual({ dpr: 1.25, width: 125, height: 63 });
  });
});

function makeCanvas(clientWidth = 400, clientHeight = 300) {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(canvas, "clientHeight", { value: clientHeight, configurable: true });
  return canvas;
}

function entry(cssWidth, cssHeight, device) {
  return {
    contentRect: { width: cssWidth, height: cssHeight },
    ...(device
      ? { devicePixelContentBoxSize: [{ inlineSize: device[0], blockSize: device[1] }] }
      : {}),
  };
}

describe("useCanvasBackingStore", () => {
  let notify;
  let observe;
  let disconnect;
  let rafCallbacks;

  function flushRaf() {
    const callbacks = rafCallbacks;
    rafCallbacks = [];
    act(() => callbacks.forEach((cb) => cb()));
  }

  beforeEach(() => {
    rafCallbacks = [];
    observe = vi.fn();
    disconnect = vi.fn();
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function (callback) {
        notify = (...entries) => callback(entries);
        return { observe, disconnect };
      })
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb) => rafCallbacks.push(cb))
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("observes the canvas's device-pixel content box", () => {
    const canvas = makeCanvas();
    renderHook(() => useCanvasBackingStore({ current: canvas }));
    expect(observe).toHaveBeenCalledWith(canvas, { box: "device-pixel-content-box" });
  });

  it("observes the plain content box where device-pixel boxes are unsupported", () => {
    observe.mockImplementationOnce(() => {
      throw new TypeError("unsupported box");
    });
    const canvas = makeCanvas();
    renderHook(() => useCanvasBackingStore({ current: canvas }));
    expect(observe).toHaveBeenLastCalledWith(canvas);
  });

  it("sizes the backing store synchronously on mount", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const canvas = makeCanvas(400, 300);
    const onResize = vi.fn();
    renderHook(() => useCanvasBackingStore({ current: canvas }, { onResize }));
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(onResize).toHaveBeenCalledWith({ dpr: 2, width: 800, height: 600 });
  });

  it("adopts the device-pixel size from the observer on the next frame", () => {
    vi.stubGlobal("devicePixelRatio", 1.25);
    const canvas = makeCanvas(400, 300);
    const onResize = vi.fn();
    renderHook(() => useCanvasBackingStore({ current: canvas }, { onResize }));

    notify(entry(400.4, 300.2, [501, 375]));
    expect(canvas.width).toBe(500);
    flushRaf();

    expect(canvas.width).toBe(501);
    expect(canvas.height).toBe(375);
    expect(onResize).toHaveBeenLastCalledWith({ dpr: 1.25, width: 501, height: 375 });
  });

  it("falls back to the fractional CSS box from the observer", () => {
    vi.stubGlobal("devicePixelRatio", 1.25);
    const canvas = makeCanvas(400, 300);
    renderHook(() => useCanvasBackingStore({ current: canvas }));
    notify(entry(400.4, 300.2));
    flushRaf();
    expect(canvas.width).toBe(501);
    expect(canvas.height).toBe(375);
  });

  it("coalesces several notifications into one animation frame", () => {
    const canvas = makeCanvas(400, 300);
    renderHook(() => useCanvasBackingStore({ current: canvas }));
    notify(entry(410, 300, [410, 300]));
    notify(entry(420, 300, [420, 300]));
    dprWatch.onChange();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    flushRaf();
    expect(canvas.width).toBe(420);
  });

  it("caps one axis while the other keeps device pixels", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const canvas = makeCanvas(400, 300);
    renderHook(() => useCanvasBackingStore({ current: canvas }, { maxDevicePixelRatioX: 1 }));
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(600);
    notify(entry(400.4, 300.2, [801, 600]));
    flushRaf();
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(600);
  });

  it("lets a per-axis cap win over the shared cap", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const canvas = makeCanvas(400, 300);
    renderHook(() =>
      useCanvasBackingStore(
        { current: canvas },
        { maxDevicePixelRatio: 1, maxDevicePixelRatioY: 2 }
      )
    );
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(600);
  });

  it("re-measures from the last CSS box when DPR changes and the box does not", () => {
    const canvas = makeCanvas(400, 300);
    const onResize = vi.fn();
    renderHook(() => useCanvasBackingStore({ current: canvas }, { onResize }));
    notify(entry(400.4, 300, [400, 300]));
    flushRaf();

    // Dragged onto a 150% monitor. The stale device-pixel size must not survive the change.
    vi.stubGlobal("devicePixelRatio", 1.5);
    dprWatch.onChange();
    flushRaf();

    expect(canvas.width).toBe(601);
    expect(canvas.height).toBe(450);
    expect(onResize).toHaveBeenLastCalledWith({ dpr: 1.5, width: 601, height: 450 });
  });

  it("reports only changes", () => {
    const canvas = makeCanvas(400, 300);
    const onResize = vi.fn();
    renderHook(() => useCanvasBackingStore({ current: canvas }, { onResize }));
    notify(entry(400, 300, [400, 300]));
    flushRaf();
    expect(onResize).toHaveBeenCalledOnce();
  });

  it("does nothing while disabled", () => {
    const canvas = makeCanvas(400, 300);
    renderHook(() => useCanvasBackingStore({ current: canvas }, { enabled: false }));
    expect(observe).not.toHaveBeenCalled();
    expect(canvas.width).toBe(300);
  });

  it("disconnects and stops watching DPR on unmount", () => {
    const canvas = makeCanvas();
    const { unmount } = renderHook(() => useCanvasBackingStore({ current: canvas }));
    notify(entry(410, 300, [410, 300]));
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(dprWatch.dispose).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
  });

  it("does not read layout on ordinary re-renders", () => {
    const canvas = document.createElement("canvas");
    const widthRead = vi.fn(() => 200);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, get: widthRead });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 100 });
    const canvasRef = { current: canvas };
    const { rerender } = renderHook(() => useCanvasBackingStore(canvasRef));
    rerender();
    rerender();
    expect(widthRead).toHaveBeenCalledOnce();
  });
});

describe("useCanvasBackingStoreSize", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the backing size as state", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    vi.stubGlobal("ResizeObserver", undefined);
    const canvasRef = { current: makeCanvas(200, 120) };
    const { result } = renderHook(() => useCanvasBackingStoreSize(canvasRef));
    expect(result.current).toEqual({ dpr: 2, width: 400, height: 240 });
  });
});
