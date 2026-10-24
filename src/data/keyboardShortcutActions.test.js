import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  KEYBOARD_SHORTCUT_ACTIONS,
  configuredShortcutConflict,
  normalizeKeyboardShortcuts,
} from "./keyboardShortcutActions.js";

describe("KEYBOARD_SHORTCUT_ACTIONS", () => {
  it("owns the configurable action order and defaults", () => {
    expect(KEYBOARD_SHORTCUT_ACTIONS).toEqual([
      {
        id: "toggleLiveCapture",
        label: "Start / Stop",
        defaultAccelerator: "CmdOrCtrl+1",
      },
      {
        id: "toggleLiveSnapshot",
        label: "Live / Snapshot",
        defaultAccelerator: "CmdOrCtrl+2",
      },
      { id: "clear", label: "Clear", defaultAccelerator: "CmdOrCtrl+3" },
    ]);
    expect(DEFAULT_KEYBOARD_SHORTCUTS).toEqual({
      toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: false },
      toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
      clear: { accelerator: "CmdOrCtrl+3", global: false },
    });
  });
});

describe("normalizeKeyboardShortcuts", () => {
  it("fills missing actions, drops unknown actions, and clones defaults", () => {
    const normalized = normalizeKeyboardShortcuts({
      clear: { accelerator: "CmdOrCtrl+Alt+K", global: true },
      futureAction: { accelerator: "CmdOrCtrl+J", global: true },
    });

    expect(normalized).toEqual({
      toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: false },
      toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
      clear: { accelerator: "CmdOrCtrl+Alt+K", global: true },
    });
    expect(normalized).not.toBe(DEFAULT_KEYBOARD_SHORTCUTS);
  });

  it("uses defaults for malformed chords and forces global off for null", () => {
    expect(
      normalizeKeyboardShortcuts({
        toggleLiveCapture: { accelerator: "Space", global: true },
        toggleLiveSnapshot: { accelerator: null, global: true },
        clear: "CmdOrCtrl+J",
      })
    ).toEqual({
      toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: false },
      toggleLiveSnapshot: { accelerator: null, global: false },
      clear: { accelerator: "CmdOrCtrl+3", global: false },
    });
  });

  it("migrates the legacy Clear values when no new object exists", () => {
    expect(
      normalizeKeyboardShortcuts(undefined, {
        clearShortcut: "CmdOrCtrl+Alt+K",
        clearGlobal: true,
      })
    ).toEqual({
      toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: false },
      toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
      clear: { accelerator: "CmdOrCtrl+Alt+K", global: true },
    });
  });

  it("replaces a duplicate configured accelerator with that action's default", () => {
    expect(
      normalizeKeyboardShortcuts({
        toggleLiveCapture: { accelerator: "CmdOrCtrl+Alt+K", global: false },
        toggleLiveSnapshot: { accelerator: "CmdOrCtrl+Alt+K", global: true },
        clear: { accelerator: "CmdOrCtrl+3", global: false },
      }).toggleLiveSnapshot
    ).toEqual({ accelerator: "CmdOrCtrl+2", global: false });
  });

  it("moves the unreleased previous defaults to the numbered defaults", () => {
    expect(
      normalizeKeyboardShortcuts({
        toggleLiveCapture: { accelerator: "CmdOrCtrl+Shift+Space", global: true },
        toggleLiveSnapshot: { accelerator: "CmdOrCtrl+Shift+L", global: false },
        clear: { accelerator: "CmdOrCtrl+K", global: false },
      })
    ).toEqual({
      toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: true },
      toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
      clear: { accelerator: "CmdOrCtrl+3", global: false },
    });
  });
});

describe("configuredShortcutConflict", () => {
  it("reports another configurable action with the same non-null accelerator", () => {
    expect(
      configuredShortcutConflict(DEFAULT_KEYBOARD_SHORTCUTS, "toggleLiveSnapshot", "CmdOrCtrl+3")
    ).toBe("Clear");
  });

  it("ignores the current action and a null accelerator", () => {
    expect(
      configuredShortcutConflict(DEFAULT_KEYBOARD_SHORTCUTS, "clear", "CmdOrCtrl+3")
    ).toBeNull();
    expect(configuredShortcutConflict(DEFAULT_KEYBOARD_SHORTCUTS, "clear", null)).toBeNull();
  });
});
