/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasSize } from "./useCanvasSize";

let triggerResize;
let mockDisconnect;
let rafCallbacks;
let rafId;

function makeRefs(clientWidth = 400, clientHeight = 300) {
  const canvas = document.createElement("canvas");
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: clientHeight, configurable: true });
  return { canvasRef: { current: canvas }, containerRef: { current: container }, canvas };
}

function flushRaf() {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  callbacks.forEach((cb) => cb());
}

describe("useCanvasSize", () => {
  beforeEach(() => {
    mockDisconnect = vi.fn();
    rafCallbacks = [];
    rafId = 0;
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function (cb) {
        triggerResize = cb;
        return { observe: vi.fn(), disconnect: mockDisconnect };
      })
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb) => {
        rafCallbacks.push(cb);
        return ++rafId;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sets canvas dimensions when ResizeObserver fires", () => {
    const { canvasRef, containerRef } = makeRefs(400, 300);
    renderHook(() => useCanvasSize(canvasRef, containerRef));
    triggerResize();
    flushRaf();
    expect(canvasRef.current.width).toBeGreaterThan(0);
    expect(canvasRef.current.height).toBeGreaterThan(0);
  });

  it("sets canvas.width to clientWidth × devicePixelRatio", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { canvasRef, containerRef } = makeRefs(400, 300);
    renderHook(() => useCanvasSize(canvasRef, containerRef));
    triggerResize();
    flushRaf();
    expect(canvasRef.current.width).toBe(800);
  });

  it("sets canvas.height to clientHeight × devicePixelRatio", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { canvasRef, containerRef } = makeRefs(400, 300);
    renderHook(() => useCanvasSize(canvasRef, containerRef));
    triggerResize();
    flushRaf();
    expect(canvasRef.current.height).toBe(600);
  });

  it("falls back to DPR 1 when devicePixelRatio is falsy", () => {
    vi.stubGlobal("devicePixelRatio", 0);
    const { canvasRef, containerRef } = makeRefs(400, 300);
    renderHook(() => useCanvasSize(canvasRef, containerRef));
    triggerResize();
    flushRaf();
    expect(canvasRef.current.width).toBe(400);
    expect(canvasRef.current.height).toBe(300);
  });

  it("caps canvas dimensions with maxDevicePixelRatio", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { canvasRef, containerRef } = makeRefs(400, 300);
    renderHook(() => useCanvasSize(canvasRef, containerRef, undefined, { maxDevicePixelRatio: 1 }));
    triggerResize();
    flushRaf();
    expect(canvasRef.current.width).toBe(400);
    expect(canvasRef.current.height).toBe(300);
  });

  it("caps width only, leaving height at full DPR, with maxDevicePixelRatioX", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { canvasRef, containerRef } = makeRefs(400, 300);
    renderHook(() =>
      useCanvasSize(canvasRef, containerRef, undefined, { maxDevicePixelRatioX: 1 })
    );
    triggerResize();
    flushRaf();
    expect(canvasRef.current.width).toBe(400); // capped at DPR 1
    expect(canvasRef.current.height).toBe(600); // full DPR 2
  });

  it("lets a per-axis override win over maxDevicePixelRatio", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { canvasRef, containerRef } = makeRefs(400, 300);
    renderHook(() =>
      useCanvasSize(canvasRef, containerRef, undefined, {
        maxDevicePixelRatio: 1,
        maxDevicePixelRatioY: 2,
      })
    );
    triggerResize();
    flushRaf();
    expect(canvasRef.current.width).toBe(400); // falls back to shared cap of 1
    expect(canvasRef.current.height).toBe(600); // Y override keeps full DPR
  });

  it("coalesces multiple resize notifications into one animation frame", () => {
    const { canvasRef, containerRef } = makeRefs(400, 300);
    renderHook(() => useCanvasSize(canvasRef, containerRef));

    triggerResize();
    triggerResize();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(canvasRef.current.width).toBe(300);

    flushRaf();

    expect(canvasRef.current.width).toBe(400);
    expect(canvasRef.current.height).toBe(300);
  });

  it("calls disconnect on unmount", () => {
    const { canvasRef, containerRef } = makeRefs();
    const { unmount } = renderHook(() => useCanvasSize(canvasRef, containerRef));
    unmount();
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });
});
