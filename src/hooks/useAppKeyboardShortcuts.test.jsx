/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppKeyboardShortcuts } from "./useAppKeyboardShortcuts.js";

const keyboardShortcuts = {
  toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: false },
  toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
  clear: { accelerator: "CmdOrCtrl+3", global: false },
};

function keyDown(init) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}

describe("useAppKeyboardShortcuts", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("runs clear only when capture or clock state is active", () => {
    const dispatchShortcutAction = vi.fn();
    const { rerender } = renderHook(
      ({ running, showClock }) =>
        useAppKeyboardShortcuts({
          dispatchShortcutAction,
          running,
          showClock,
          setSettingsOpen: vi.fn(),
          keyboardShortcuts,
          shortcutCapturing: false,
          autoHideControls: false,
          toggleFocusControls: vi.fn(),
        }),
      { initialProps: { running: false, showClock: false } }
    );

    keyDown({ key: "3", ctrlKey: true });
    expect(dispatchShortcutAction).not.toHaveBeenCalled();

    rerender({ running: true, showClock: false });
    const event = keyDown({ key: "3", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(dispatchShortcutAction).toHaveBeenCalledWith("clear");
  });

  it.each([
    [{ key: "1", ctrlKey: true }, "toggleLiveCapture"],
    [{ key: "2", ctrlKey: true }, "toggleLiveSnapshot"],
  ])("dispatches a configured toggle", (eventInit, actionId) => {
    const dispatchShortcutAction = vi.fn();
    renderHook(() =>
      useAppKeyboardShortcuts({
        dispatchShortcutAction,
        running: true,
        showClock: true,
        setSettingsOpen: vi.fn(),
        keyboardShortcuts,
        shortcutCapturing: false,
        autoHideControls: false,
        toggleFocusControls: vi.fn(),
      })
    );

    const event = keyDown(eventInit);
    expect(event.defaultPrevented).toBe(true);
    expect(dispatchShortcutAction).toHaveBeenCalledWith(actionId);
  });

  it("suppresses configurable actions while capturing and ignores key repeats", () => {
    const dispatchShortcutAction = vi.fn();
    const { rerender } = renderHook(
      ({ shortcutCapturing }) =>
        useAppKeyboardShortcuts({
          dispatchShortcutAction,
          running: true,
          showClock: true,
          setSettingsOpen: vi.fn(),
          keyboardShortcuts,
          shortcutCapturing,
          autoHideControls: false,
          toggleFocusControls: vi.fn(),
        }),
      { initialProps: { shortcutCapturing: true } }
    );

    keyDown({ key: "2", ctrlKey: true });
    expect(dispatchShortcutAction).not.toHaveBeenCalled();

    rerender({ shortcutCapturing: false });
    keyDown({ key: "2", ctrlKey: true, repeat: true });
    expect(dispatchShortcutAction).not.toHaveBeenCalled();
  });

  it("reveals Focus View controls with Escape outside editable fields", () => {
    const toggleFocusControls = vi.fn();
    renderHook(() =>
      useAppKeyboardShortcuts({
        dispatchShortcutAction: vi.fn(),
        running: false,
        showClock: false,
        setSettingsOpen: vi.fn(),
        keyboardShortcuts,
        shortcutCapturing: false,
        autoHideControls: true,
        toggleFocusControls,
      })
    );

    const event = keyDown({ key: "Escape" });

    expect(event.defaultPrevented).toBe(true);
    expect(toggleFocusControls).toHaveBeenCalledTimes(1);
  });

  it("does not intercept Escape from editable fields", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const toggleFocusControls = vi.fn();
    renderHook(() =>
      useAppKeyboardShortcuts({
        dispatchShortcutAction: vi.fn(),
        running: false,
        showClock: false,
        setSettingsOpen: vi.fn(),
        keyboardShortcuts,
        shortcutCapturing: false,
        autoHideControls: true,
        toggleFocusControls,
      })
    );

    keyDown({ key: "Escape" });

    expect(toggleFocusControls).not.toHaveBeenCalled();
  });

  it("opens settings with the platform settings shortcut", () => {
    const setSettingsOpen = vi.fn();
    renderHook(() =>
      useAppKeyboardShortcuts({
        dispatchShortcutAction: vi.fn(),
        running: false,
        showClock: false,
        setSettingsOpen,
        keyboardShortcuts,
        shortcutCapturing: false,
        autoHideControls: false,
        toggleFocusControls: vi.fn(),
      })
    );

    const event = keyDown({ key: ",", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(setSettingsOpen).toHaveBeenCalledWith(true);
  });
});
