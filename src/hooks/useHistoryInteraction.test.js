/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryInteraction } from "./useHistoryInteraction";

let rafCallbacks;
let rafId;

function flushRaf() {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  callbacks.forEach((cb) => cb());
}

function makeWheelEvent(deltaY = -1) {
  return {
    deltaY,
    clientX: 500,
    preventDefault: vi.fn(),
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, width: 1000 }),
    },
  };
}

function renderHistoryInteraction(overrides = {}) {
  const props = {
    enabled: true,
    sampleSec: 0.1,
    minWindowSec: 5,
    maxWindowSec: 7200,
    defaultWindowSec: 60,
    totalSamples: 72000,
    visibleSamples: 1000,
    maxOffsetSamples: 71000,
    effectiveOffsetSamples: 0,
    effectiveOffsetSec: 0,
    setSelectedOffset: vi.fn(),
    setHistoryOffsetSec: vi.fn(),
    setHistoryWindowSec: vi.fn(),
    setHistoryHudUntilTs: vi.fn(),
    setHistoryHudHold: vi.fn(),
    ...overrides,
  };

  const rendered = renderHook(() => useHistoryInteraction(props));
  return { ...rendered, props };
}

describe("useHistoryInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("zooms time from the time axis wheel without requiring ctrl", () => {
    const setHistoryWindowSec = vi.fn();
    const { result } = renderHistoryInteraction({ setHistoryWindowSec });

    result.current.historyTimeAxisHandlers.onWheel({
      preventDefault: vi.fn(),
      ctrlKey: false,
      deltaY: -100,
      clientX: 50,
      currentTarget: {
        getBoundingClientRect: () => ({ left: 0, width: 100 }),
      },
    });

    expect(setHistoryWindowSec).toHaveBeenCalled();
  });

  it("briefly marks the time axis active when the chart wheel changes time", () => {
    const { result } = renderHistoryInteraction();

    act(() => {
      result.current.onHistoryWheel({
        preventDefault: vi.fn(),
        deltaY: -100,
        clientX: 50,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
      });
    });

    expect(result.current.isTimeAxisActive).toBe(true);
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(result.current.isTimeAxisActive).toBe(false);
  });

  it("coalesces wheel zoom bursts into one viewport update per animation frame", () => {
    const { result, props } = renderHistoryInteraction();

    act(() => {
      result.current.onHistoryWheel(makeWheelEvent(-1));
      result.current.onHistoryWheel(makeWheelEvent(-1));
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(props.setHistoryWindowSec).not.toHaveBeenCalled();
    expect(props.setHistoryOffsetSec).not.toHaveBeenCalled();

    act(() => flushRaf());

    expect(props.setHistoryWindowSec).toHaveBeenCalledTimes(1);
    expect(props.setHistoryWindowSec.mock.calls[0][0]).toBeCloseTo(72.25, 6);
    expect(props.setHistoryOffsetSec).toHaveBeenCalledTimes(1);
  });
});
