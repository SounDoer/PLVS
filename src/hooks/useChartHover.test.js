/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChartHover } from "./useChartHover.js";

const rect = {
  left: 10,
  top: 20,
  width: 100,
  height: 200,
};

describe("useChartHover", () => {
  it("computes clamped hover fractions and clears them on leave", () => {
    const computeFn = vi.fn((x, y) => ({ x, y }));
    const { result } = renderHook(() => useChartHover(computeFn));

    act(() => result.current.onMove(60, 70, rect));
    expect(result.current.hover).toEqual({ x: 0.5, y: 0.25 });

    act(() => result.current.onMove(500, -20, rect));
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
    expect(result.current.hover).toBe("first");

    rerender({ computeFn: secondCompute });

    act(() => result.current.onMove(10, 20, rect));
    expect(result.current.hover).toBe("second");
    expect(secondCompute).toHaveBeenCalledTimes(1);
  });
});
