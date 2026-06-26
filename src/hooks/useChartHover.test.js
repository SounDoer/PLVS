/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChartHover } from "./useChartHover.js";

const rect = {
  left: 10,
  top: 20,
  width: 100,
  height: 200,
};

let rafCallbacks;
let rafId;

function flushRaf() {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  callbacks.forEach((cb) => cb());
}

describe("useChartHover", () => {
  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
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

  it("computes clamped hover fractions and clears them on leave", () => {
    const computeFn = vi.fn((x, y) => ({ x, y }));
    const { result } = renderHook(() => useChartHover(computeFn));

    act(() => result.current.onMove(60, 70, rect));
    expect(result.current.hover).toBeNull();
    act(() => flushRaf());
    expect(result.current.hover).toEqual({ x: 0.5, y: 0.25 });

    act(() => result.current.onMove(500, -20, rect));
    act(() => flushRaf());
    expect(result.current.hover).toEqual({ x: 1, y: 0 });

    act(() => result.current.onLeave());
    expect(result.current.hover).toBeNull();
  });

  it("uses the latest compute function after rerender", () => {
    const firstCompute = vi.fn(() => "first");
    const secondCompute = vi.fn(() => "second");
    const { result, rerender } = renderHook(({ computeFn }) => useChartHover(computeFn), {
      initialProps: { computeFn: firstCompute },
    });

    act(() => result.current.onMove(10, 20, rect));
    act(() => flushRaf());
    expect(result.current.hover).toBe("first");

    rerender({ computeFn: secondCompute });

    act(() => result.current.onMove(10, 20, rect));
    act(() => flushRaf());
    expect(result.current.hover).toBe("second");
    expect(secondCompute).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple pointer moves into one hover update per animation frame", () => {
    const computeFn = vi.fn((x, y) => ({ x, y }));
    const { result } = renderHook(() => useChartHover(computeFn));

    act(() => {
      result.current.onMove(20, 40, rect);
      result.current.onMove(60, 70, rect);
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(computeFn).not.toHaveBeenCalled();

    act(() => flushRaf());

    expect(computeFn).toHaveBeenCalledTimes(1);
    expect(result.current.hover).toEqual({ x: 0.5, y: 0.25 });
  });
});
