/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewsChromeReveal } from "./useViewsChromeReveal.js";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging: vi.fn() }),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => false,
}));

describe("useViewsChromeReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reveals controls and auto-hides them after Escape-style toggle", () => {
    const { result } = renderHook(() =>
      useViewsChromeReveal({ autoHideControls: true, frameless: false })
    );

    expect(result.current.controlsVisible).toBe(false);

    act(() => {
      result.current.toggleControls();
    });

    expect(result.current.controlsVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.controlsVisible).toBe(false);
  });

  it("resets visible and held state when auto-hide is disabled", () => {
    const { result, rerender } = renderHook(
      ({ autoHideControls }) => useViewsChromeReveal({ autoHideControls, frameless: false }),
      { initialProps: { autoHideControls: true } }
    );

    act(() => {
      result.current.holdControls(true);
    });

    expect(result.current.controlsVisible).toBe(true);

    rerender({ autoHideControls: false });

    expect(result.current.controlsVisible).toBe(false);

    act(() => {
      result.current.hideControlsLater();
      vi.advanceTimersByTime(900);
    });

    expect(result.current.controlsVisible).toBe(false);
  });
});
