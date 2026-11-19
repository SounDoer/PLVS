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

  it("runs Clear only when the source can be cleared", () => {
    const dispatchShortcutAction = vi.fn();
    const { rerender } = renderHook(
      ({ canClear }) =>
        useAppKeyboardShortcuts({
          dispatchShortcutAction,
          canClear,
          keyboardShortcuts,
          shortcutCapturing: false,
          autoHideControls: false,
          toggleFocusControls: vi.fn(),
        }),
      { initialProps: { canClear: false } }
    );

    keyDown({ key: "3", ctrlKey: true });
    expect(dispatchShortcutAction).not.toHaveBeenCalled();

    rerender({ canClear: true });
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
        canClear: true,
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
          canClear: true,
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
        canClear: false,
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
        canClear: false,
        keyboardShortcuts,
        shortcutCapturing: false,
        autoHideControls: true,
        toggleFocusControls,
      })
    );

    keyDown({ key: "Escape" });

    expect(toggleFocusControls).not.toHaveBeenCalled();
  });

  it("leaves Focus View controls alone if a dialog already handled Escape", () => {
    const toggleFocusControls = vi.fn();
    renderHook(() =>
      useAppKeyboardShortcuts({
        dispatchShortcutAction: vi.fn(),
        canClear: false,
        keyboardShortcuts,
        shortcutCapturing: false,
        autoHideControls: true,
        toggleFocusControls,
      })
    );
    const dialog = document.createElement("div");
    document.body.append(dialog);
    dialog.addEventListener("keydown", (event) => event.preventDefault());

    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );

    expect(toggleFocusControls).not.toHaveBeenCalled();
  });

  it("leaves the comma chord unhandled unless it has a configurable binding", () => {
    const dispatch = vi.fn();
    renderHook(() =>
      useAppKeyboardShortcuts({
        dispatchShortcutAction: dispatch,
        canClear: true,
        keyboardShortcuts,
        shortcutCapturing: false,
        autoHideControls: false,
        toggleFocusControls: vi.fn(),
      })
    );
    expect(keyDown({ key: ",", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
