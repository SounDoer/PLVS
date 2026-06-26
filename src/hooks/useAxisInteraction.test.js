/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAxisInteraction } from "./useAxisInteraction";

describe("useAxisInteraction", () => {
  beforeEach(() => {
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverStub;
    globalThis.ResizeObserver = ResizeObserverStub;
  });

  afterEach(() => {
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

  it("ignores wheel without ctrl", () => {
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
    act(() => {
      result.current.axisHandlers.onWheel({ ctrlKey: false, preventDefault: vi.fn() });
    });
    expect(onRangeChange).not.toHaveBeenCalled();
  });
});
