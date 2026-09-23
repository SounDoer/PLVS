/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const loadStore = vi.fn();

describe("clearShortcutPrefs transactional desktop persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    loadStore.mockReset();
    window.__PLVS_INITIAL_STATE__ = {
      globalPreferences: { clearShortcut: "CmdOrCtrl+L", clearGlobal: true },
      multiInstancePersistence: {
        itemRevisions: {},
        collectionRevisions: {},
        globalPreferenceRevisions: { clearShortcut: 3, clearGlobal: 2 },
      },
    };
    vi.doMock("../ipc/env.js", () => ({ isTauri: () => true }));
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.doMock("@tauri-apps/plugin-store", () => ({ Store: { load: loadStore } }));
  });

  it("loads the identity-wide shortcut from the boot snapshot", async () => {
    const { loadClearShortcutPrefs } = await import("./clearShortcutPrefs.js");

    await expect(loadClearShortcutPrefs()).resolves.toEqual({
      shortcut: "CmdOrCtrl+L",
      global: true,
    });
    expect(loadStore).not.toHaveBeenCalled();
  });

  it("updates the shortcut pair in one compare-and-swap transaction", async () => {
    invoke.mockResolvedValue({ clearShortcut: 4, clearGlobal: 3 });
    const { saveClearShortcutPrefsForControl } = await import("./clearShortcutPrefs.js");

    await saveClearShortcutPrefsForControl({ shortcut: "CmdOrCtrl+M", global: false });

    expect(invoke).toHaveBeenCalledWith("persistence_save_global_preferences", {
      values: { clearShortcut: "CmdOrCtrl+M", clearGlobal: false },
      expectedRevisions: { clearShortcut: 3, clearGlobal: 2 },
    });
    expect(window.__PLVS_INITIAL_STATE__.globalPreferences).toEqual({
      clearShortcut: "CmdOrCtrl+M",
      clearGlobal: false,
    });
    expect(
      window.__PLVS_INITIAL_STATE__.multiInstancePersistence.globalPreferenceRevisions
    ).toEqual({ clearShortcut: 4, clearGlobal: 3 });
    expect(loadStore).not.toHaveBeenCalled();
  });
});
