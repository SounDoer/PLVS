import { afterEach, describe, expect, it, vi } from "vitest";

async function importProfileModule({ tauri = false, commandMocks = {} } = {}) {
  vi.resetModules();
  vi.doMock("../ipc/env.js", () => ({ isTauri: () => tauri }));
  vi.doMock("../ipc/commands.js", () => ({
    exportProfileCommand: commandMocks.exportProfileCommand ?? vi.fn(),
    importProfileCommand: commandMocks.importProfileCommand ?? vi.fn(),
    resetProfileCommand: commandMocks.resetProfileCommand ?? vi.fn(),
  }));
  vi.doMock("@tauri-apps/plugin-process", () => ({
    relaunch: commandMocks.relaunch ?? vi.fn(async () => {}),
  }));
  return import("./profile.js");
}

async function importProfileModuleWithPersistenceMocks({ commandMocks = {}, persistenceMocks }) {
  vi.resetModules();
  vi.doMock("../ipc/env.js", () => ({ isTauri: () => true }));
  vi.doMock("../ipc/commands.js", () => ({
    exportProfileCommand: commandMocks.exportProfileCommand ?? vi.fn(),
    importProfileCommand: commandMocks.importProfileCommand ?? vi.fn(),
    resetProfileCommand: commandMocks.resetProfileCommand ?? vi.fn(),
  }));
  vi.doMock("@tauri-apps/plugin-process", () => ({
    relaunch: commandMocks.relaunch ?? vi.fn(async () => {}),
  }));
  vi.doMock("./pluginStoreBackend.js", () => persistenceMocks);
  return import("./profile.js");
}

describe("profile API", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("exports a browser/dev profile from domain stores", async () => {
    const { settingsStore, workspaceStore, presetsStore, themesStore } = await import("./index.js");
    settingsStore.patch({ referenceLufs: -23 });
    workspaceStore.patch({ panelOrder: [] });
    presetsStore.patch({ list: [], activeId: null });
    themesStore.patch({ themes: {}, order: [] });
    localStorage.setItem("plvs.captureDeviceId", "out:4");

    const { exportProfile } = await importProfileModule({ tauri: false });
    const profile = await exportProfile();

    expect(profile).toMatchObject({
      app: "PLVS",
      kind: "configuration-profile",
      version: 1,
      settings: { referenceLufs: -23 },
      workspace: { panelOrder: [] },
      presets: { list: [], activeId: null },
      themes: { themes: {}, order: [] },
      captureDeviceId: "out:4",
    });
  });

  it("imports a browser/dev profile by replacing stores", async () => {
    const { importProfile } = await importProfileModule({ tauri: false });
    await importProfile({
      app: "PLVS",
      kind: "configuration-profile",
      version: 1,
      settings: { referenceLufs: -18 },
      workspace: { panelOrder: ["x"] },
      presets: { list: [], activeId: null },
      themes: { themes: {}, order: [] },
      captureDeviceId: "in:2",
    });
    const { settingsStore, workspaceStore } = await import("./index.js");
    expect(settingsStore.read()).toMatchObject({ referenceLufs: -18 });
    expect(workspaceStore.read()).toEqual({ panelOrder: ["x"] });
    expect(localStorage.getItem("plvs.captureDeviceId")).toBe("in:2");
  });

  it("uses Rust commands under Tauri", async () => {
    const commandMocks = {
      exportProfileCommand: vi.fn(async () => ({ settings: { referenceLufs: -20 } })),
      importProfileCommand: vi.fn(async () => {}),
      resetProfileCommand: vi.fn(async () => {}),
    };
    const { exportProfile, importProfile, resetProfile } = await importProfileModule({
      tauri: true,
      commandMocks,
    });

    expect(await exportProfile()).toMatchObject({ settings: { referenceLufs: -20 } });
    await importProfile({ app: "PLVS", kind: "configuration-profile", version: 1 });
    await resetProfile();

    expect(commandMocks.exportProfileCommand).toHaveBeenCalled();
    expect(commandMocks.importProfileCommand).toHaveBeenCalledWith(
      expect.objectContaining({ app: "PLVS", kind: "configuration-profile" })
    );
    expect(commandMocks.resetProfileCommand).toHaveBeenCalled();
  });

  it("flushes frontend plugin-store writes before Tauri export reads the store file", async () => {
    const commandMocks = {
      exportProfileCommand: vi.fn(async () => ({ presets: { list: [], activeId: null } })),
    };
    const persistenceMocks = {
      createPluginStoreBackend: vi.fn(() => ({
        get: vi.fn(() => null),
        set: vi.fn(),
        remove: vi.fn(),
        subscribe: vi.fn(() => () => {}),
      })),
      flushPluginStorePersistence: vi.fn(async () => {}),
      suspendPluginStorePersistence: vi.fn(),
    };
    const { exportProfile } = await importProfileModuleWithPersistenceMocks({
      commandMocks,
      persistenceMocks,
    });

    await exportProfile();

    expect(persistenceMocks.flushPluginStorePersistence).toHaveBeenCalledBefore(
      commandMocks.exportProfileCommand
    );
  });

  it("restarts the desktop app after profile changes so Rust re-injects fresh state", async () => {
    const relaunch = vi.fn(async () => {});
    const { reloadAfterProfileChange } = await importProfileModule({
      tauri: true,
      commandMocks: { relaunch },
    });

    await reloadAfterProfileChange();

    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("falls back to webview reload outside Tauri", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload },
      writable: true,
      configurable: true,
    });
    const { reloadAfterProfileChange } = await importProfileModule({ tauri: false });

    await reloadAfterProfileChange();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
