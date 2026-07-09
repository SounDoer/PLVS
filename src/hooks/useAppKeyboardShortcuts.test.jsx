/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppKeyboardShortcuts } from "./useAppKeyboardShortcuts.js";

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
    const clearAll = vi.fn();
    const { rerender } = renderHook(
      ({ running, showClock }) =>
        useAppKeyboardShortcuts({
          clearAll,
          running,
          showClock,
          setSettingsOpen: vi.fn(),
          clearShortcut: "CmdOrCtrl+K",
          autoHideControls: false,
          toggleFocusControls: vi.fn(),
        }),
      { initialProps: { running: false, showClock: false } }
    );

    keyDown({ key: "k", ctrlKey: true });
    expect(clearAll).not.toHaveBeenCalled();

    rerender({ running: true, showClock: false });
    const event = keyDown({ key: "k", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it("reveals Focus View controls with Escape outside editable fields", () => {
    const toggleFocusControls = vi.fn();
    renderHook(() =>
      useAppKeyboardShortcuts({
        clearAll: vi.fn(),
        running: false,
        showClock: false,
        setSettingsOpen: vi.fn(),
        clearShortcut: "CmdOrCtrl+K",
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
        clearAll: vi.fn(),
        running: false,
        showClock: false,
        setSettingsOpen: vi.fn(),
        clearShortcut: "CmdOrCtrl+K",
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
        clearAll: vi.fn(),
        running: false,
        showClock: false,
        setSettingsOpen,
        clearShortcut: "CmdOrCtrl+K",
        autoHideControls: false,
        toggleFocusControls: vi.fn(),
      })
    );

    const event = keyDown({ key: ",", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(setSettingsOpen).toHaveBeenCalledWith(true);
  });
});
