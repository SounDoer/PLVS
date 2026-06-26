/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAxisInteraction } from "./useAxisInteraction";

describe("useAxisInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverStub;
    globalThis.ResizeObserver = ResizeObserverStub;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("zooms on ctrl wheel and resets on double click", () => {
    const onRangeChange = vi.fn();
    const { result } = renderHook(() =>
      useAxisInteraction({
        axis: "y",
        min: -96,
        max: -12,
        absMin: -120,
        absMax: 6,
        defaultMin: -96,
        defaultMax: -12,
        minSpan: 12,
        scale: "linear",
        onRangeChange,
      })
    );
    result.current.axisRef.current = {
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 60, height: 400 }),
    };

    act(() => {
      result.current.axisHandlers.onWheel({
        ctrlKey: true,
        preventDefault: vi.fn(),
        clientY: 200,
        deltaY: -1,
      });
    });
    expect(onRangeChange).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));

    act(() => {
      result.current.axisHandlers.onDoubleClick({ preventDefault: vi.fn() });
    });
    expect(onRangeChange).toHaveBeenLastCalledWith(-96, -12);
  });

  it("zooms on wheel without ctrl", () => {
    const onRangeChange = vi.fn();
    const { result } = renderHook(() =>
      useAxisInteraction({
        axis: "x",
        min: 20,
        max: 20000,
        absMin: 20,
        absMax: 20000,
        defaultMin: 20,
        defaultMax: 20000,
        minSpan: 1,
        scale: "log",
        onRangeChange,
      })
    );
    result.current.axisRef.current = {
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 400, height: 60 }),
    };

    act(() => {
      result.current.axisHandlers.onWheel({
        ctrlKey: false,
        preventDefault: vi.fn(),
        clientX: 200,
        deltaY: 120,
      });
    });
    expect(onRangeChange).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(onRangeChange.mock.calls.at(-1)[0]).toBeGreaterThan(20);
    expect(onRangeChange.mock.calls.at(-1)[1]).toBeLessThan(20000);
  });

  it("briefly marks the axis active when a wheel gesture changes the range", () => {
    const { result } = renderHook(() =>
      useAxisInteraction({
        axis: "y",
        min: -96,
        max: -12,
        absMin: -120,
        absMax: 6,
        defaultMin: -96,
        defaultMax: -12,
        minSpan: 12,
        scale: "linear",
        onRangeChange: vi.fn(),
      })
    );
    result.current.axisRef.current = {
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 60, height: 400 }),
    };

    act(() => {
      result.current.axisHandlers.onWheel({
        preventDefault: vi.fn(),
        clientY: 200,
        deltaY: -1,
      });
    });

    expect(result.current.isActive).toBe(true);
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(result.current.isActive).toBe(false);
  });

  it("pans the y axis toward higher values when dragging down", () => {
    const onRangeChange = vi.fn();
    const { result } = renderHook(() =>
      useAxisInteraction({
        axis: "y",
        min: -96,
        max: -12,
        absMin: -120,
        absMax: 6,
        defaultMin: -96,
        defaultMax: -12,
        minSpan: 12,
        scale: "linear",
        onRangeChange,
      })
    );
    result.current.axisRef.current = {
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 60, height: 400 }),
    };

    act(() => {
      result.current.axisHandlers.onMouseDown({
        button: 0,
        preventDefault: vi.fn(),
        clientY: 100,
      });
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientY: 200 }));
    });
    expect(onRangeChange).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(onRangeChange.mock.calls.at(-1)[0]).toBeGreaterThan(-96);
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });
});
