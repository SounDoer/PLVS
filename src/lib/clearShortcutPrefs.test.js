import { describe, expect, it } from "vitest";
import {
  loadClearShortcutPrefs,
  saveClearShortcutPrefs,
  DEFAULT_CLEAR_SHORTCUT,
} from "./clearShortcutPrefs.js";

describe("clearShortcutPrefs (non-Tauri)", () => {
  it("default shortcut constant is CmdOrCtrl+K", () => {
    expect(DEFAULT_CLEAR_SHORTCUT).toBe("CmdOrCtrl+K");
  });
  it("loads default shortcut + global false when not in Tauri", async () => {
    await expect(loadClearShortcutPrefs()).resolves.toEqual({
      shortcut: "CmdOrCtrl+K",
      global: false,
    });
  });
  it("save is a no-op (resolves) outside Tauri", async () => {
    await expect(
      saveClearShortcutPrefs({ shortcut: "CmdOrCtrl+K", global: true })
    ).resolves.toBeUndefined();
  });
});
