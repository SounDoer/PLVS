/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewsChromeReveal } from "./useViewsChromeReveal.js";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  startDragging: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: mocks.startDragging,
    toggleMaximize: mocks.toggleMaximize,
  }),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: mocks.isTauri,
}));

describe("useViewsChromeReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.isTauri.mockReturnValue(false);
    mocks.startDragging.mockReset().mockResolvedValue(undefined);
    mocks.toggleMaximize.mockReset().mockResolvedValue(undefined);
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

  it("starts dragging a frameless window on the first primary pointer press", async () => {
    mocks.isTauri.mockReturnValue(true);
    const { result } = renderHook(() =>
      useViewsChromeReveal({ autoHideControls: false, frameless: true })
    );
    const header = document.createElement("header");

    await act(() =>
      result.current.handleWindowDrag({
        button: 0,
        detail: 1,
        target: header,
        currentTarget: header,
      })
    );

    expect(mocks.startDragging).toHaveBeenCalledOnce();
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
  });

  it("toggles maximize for two nearby presses when pointer detail does not count clicks", async () => {
    mocks.isTauri.mockReturnValue(true);
    const { result } = renderHook(() =>
      useViewsChromeReveal({ autoHideControls: false, frameless: true })
    );
    const header = document.createElement("header");

    await act(() =>
      result.current.handleWindowDrag({
        button: 0,
        detail: 0,
        timeStamp: 100,
        clientX: 300,
        clientY: 20,
        target: header,
        currentTarget: header,
      })
    );
    await act(() =>
      result.current.handleWindowDrag({
        button: 0,
        detail: 0,
        timeStamp: 250,
        clientX: 302,
        clientY: 21,
        target: header,
        currentTarget: header,
      })
    );

    expect(mocks.toggleMaximize).toHaveBeenCalledOnce();
    expect(mocks.startDragging).toHaveBeenCalledOnce();
  });
});
