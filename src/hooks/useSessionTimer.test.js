/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatClock, useSessionTimer } from "./useSessionTimer.js";

describe("formatClock", () => {
  it("formats sub-hour durations as HH:MM:SS", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(8_000)).toBe("00:00:08");
    expect(formatClock(12_345)).toBe("00:00:12");
    expect(formatClock(12 * 60_000 + 3_000)).toBe("00:12:03");
  });

  it("formats hour-long durations without changing shape", () => {
    expect(formatClock(3_661_000)).toBe("01:01:01");
  });
});

it("keeps elapsed Live time when the system clock is set backwards", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useSessionTimer());
  try {
    act(() => {
      result.current.startTimer();
      vi.advanceTimersByTime(2_000);
      vi.setSystemTime(new Date(Date.now() - 3_600_000));
      vi.advanceTimersByTime(1_000);
      result.current.stopTimer();
    });
    expect(formatClock(result.current.elapsedMsRef.current)).toBe("00:00:03");
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("derives elapsed time from the start time while animation frames are paused", () => {
  // Hidden windows pause requestAnimationFrame. getElapsedMs() must not depend on it; the
  // rAF-published elapsedMsRef is allowed to lag until frames resume.
  let nowMs = 1_000;
  const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  const { result, unmount } = renderHook(() => useSessionTimer());
  try {
    act(() => result.current.startTimer());
    nowMs += 90_000;
    expect(result.current.getElapsedMs()).toBe(90_000);
    expect(result.current.elapsedMsRef.current).toBe(0);

    act(() => result.current.stopTimer());
    nowMs += 30_000;
    expect(result.current.getElapsedMs()).toBe(90_000);

    act(() => result.current.startTimer());
    nowMs += 10_000;
    expect(result.current.getElapsedMs()).toBe(100_000);

    act(() => result.current.resetTimer());
    expect(result.current.getElapsedMs()).toBe(0);
  } finally {
    unmount();
    nowSpy.mockRestore();
    rafSpy.mockRestore();
  }
});
