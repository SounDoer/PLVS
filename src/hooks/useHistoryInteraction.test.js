/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryInteraction } from "./useHistoryInteraction";

function renderHistoryInteraction(overrides = {}) {
  return renderHook(() =>
    useHistoryInteraction({
      enabled: true,
      sampleSec: 1,
      minWindowSec: 10,
      maxWindowSec: 100,
      defaultWindowSec: 60,
      totalSamples: 100,
      visibleSamples: 50,
      maxOffsetSamples: 50,
      effectiveOffsetSamples: 10,
      effectiveOffsetSec: 10,
      setSelectedOffset: vi.fn(),
      setHistoryOffsetSec: vi.fn(),
      setHistoryWindowSec: vi.fn(),
      setHistoryHudUntilTs: vi.fn(),
      setHistoryHudHold: vi.fn(),
      ...overrides,
    })
  );
}

describe("useHistoryInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
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
});
