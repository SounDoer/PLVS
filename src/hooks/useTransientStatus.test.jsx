/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATUS_DISMISS_MS, useTransientStatus } from "./useTransientStatus.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTransientStatus", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useTransientStatus());
    expect(result.current[0]).toBe("");
  });

  it("clears the message after the dismiss window", () => {
    const { result } = renderHook(() => useTransientStatus());

    act(() => result.current[1]("Presets exported"));
    expect(result.current[0]).toBe("Presets exported");

    act(() => vi.advanceTimersByTime(STATUS_DISMISS_MS - 1));
    expect(result.current[0]).toBe("Presets exported");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current[0]).toBe("");
  });

  // A second message must get a full window of its own, not the remainder of the first one's.
  it("restarts the window for a replacement message", () => {
    const { result } = renderHook(() => useTransientStatus());

    act(() => result.current[1]("Presets exported"));
    act(() => vi.advanceTimersByTime(STATUS_DISMISS_MS - 100));
    act(() => result.current[1]("Import failed"));

    act(() => vi.advanceTimersByTime(STATUS_DISMISS_MS - 1));
    expect(result.current[0]).toBe("Import failed");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current[0]).toBe("");
  });

  // Every action blanks the line before it starts work. That must cancel the pending clear, or it
  // would fire mid-action and blank the *next* message a moment after it appears.
  it("cancels the pending clear when reset to empty", () => {
    const { result } = renderHook(() => useTransientStatus());

    act(() => result.current[1]("Presets exported"));
    act(() => vi.advanceTimersByTime(STATUS_DISMISS_MS - 100));
    act(() => result.current[1](""));
    act(() => vi.advanceTimersByTime(200));

    act(() => result.current[1]("Theme imported"));
    act(() => vi.advanceTimersByTime(STATUS_DISMISS_MS - 1));
    expect(result.current[0]).toBe("Theme imported");
  });

  it("takes a custom window", () => {
    const { result } = renderHook(() => useTransientStatus(1000));

    act(() => result.current[1]("Done"));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current[0]).toBe("");
  });

  it("drops its timer on unmount", () => {
    const { result, unmount } = renderHook(() => useTransientStatus());

    act(() => result.current[1]("Presets exported"));
    unmount();

    // Nothing to assert beyond the absence of a "state update on an unmounted component" warning:
    // the point is that the pending callback is gone, not that it ran harmlessly.
    expect(() => vi.advanceTimersByTime(STATUS_DISMISS_MS)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
