import { describe, expect, it } from "vitest";
import {
  loadGlobalClearPrefs,
  saveGlobalClearPrefs,
  DEFAULT_GLOBAL_CLEAR_SHORTCUT,
} from "./globalClearPrefs.js";

describe("globalClearPrefs (non-Tauri)", () => {
  it("default shortcut constant is CmdOrCtrl+Alt+K", () => {
    expect(DEFAULT_GLOBAL_CLEAR_SHORTCUT).toBe("CmdOrCtrl+Alt+K");
  });
  it("loads disabled + default shortcut when not in Tauri", async () => {
    await expect(loadGlobalClearPrefs()).resolves.toEqual({
      enabled: false,
      shortcut: "CmdOrCtrl+Alt+K",
    });
  });
  it("save is a no-op (resolves) outside Tauri", async () => {
    await expect(
      saveGlobalClearPrefs({ enabled: true, shortcut: "CmdOrCtrl+Alt+K" })
    ).resolves.toBeUndefined();
  });
});
