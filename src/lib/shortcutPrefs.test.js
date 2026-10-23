import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../data/keyboardShortcutActions.js";
import { loadKeyboardShortcutPrefs, saveKeyboardShortcutPrefs } from "./shortcutPrefs.js";

describe("shortcutPrefs (non-Tauri)", () => {
  it("loads a cloned complete default map", async () => {
    const loaded = await loadKeyboardShortcutPrefs();
    expect(loaded).toEqual(DEFAULT_KEYBOARD_SHORTCUTS);
    expect(loaded).not.toBe(DEFAULT_KEYBOARD_SHORTCUTS);
    expect(loaded.clear).not.toBe(DEFAULT_KEYBOARD_SHORTCUTS.clear);
  });

  it("save is a no-op outside Tauri", async () => {
    await expect(saveKeyboardShortcutPrefs(DEFAULT_KEYBOARD_SHORTCUTS)).resolves.toBeUndefined();
  });
});
