/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAccessoryKeyboardShortcuts } from "./useAccessoryKeyboardShortcuts.js";

it("routes Settings and configured shortcuts through their existing owners", () => {
  const action = vi.fn();
  renderHook(() =>
    useAccessoryKeyboardShortcuts(
      {
        running: true,
        showClock: false,
        bindings: { toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: false } },
      },
      action
    )
  );
  const settings = new KeyboardEvent("keydown", {
    key: ",",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(settings);
  expect(action).toHaveBeenLastCalledWith("open-settings");
  const transport = new KeyboardEvent("keydown", {
    key: "1",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(transport);
  expect(action).toHaveBeenLastCalledWith("keyboard-shortcut", { actionId: "toggleLiveCapture" });
  expect(settings.defaultPrevented).toBe(true);
});

describe("shortcut capture in an accessory", () => {
  it("does not dispatch a configured shortcut while its binding is being captured", () => {
    const action = vi.fn();
    renderHook(() =>
      useAccessoryKeyboardShortcuts(
        { capturing: true, bindings: { clear: { accelerator: "CmdOrCtrl+3", global: false } } },
        action
      )
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", ctrlKey: true, bubbles: true }));
    expect(action).not.toHaveBeenCalled();
  });
});
