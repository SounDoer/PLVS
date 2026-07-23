/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_PROFILE = {
  id: "test-profile",
  name: "Test profile",
  referenceLufs: -23,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
    { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
  ],
};

const TEST_PRESET = {
  id: "p1",
  name: "Preset",
  tree: { type: "leaf", tabs: ["levelMeter-1"], activeTab: "levelMeter-1" },
  panelsById: { "levelMeter-1": { id: "levelMeter-1", moduleId: "levelMeter" } },
  panelOrder: ["levelMeter-1"],
  panelControlsById: {},
  loudnessProfileActive: "profile:test-profile",
};

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
      settings: {
        referenceLufs: -18,
        loudnessProfiles: { active: "profile:test-profile", profiles: [TEST_PROFILE] },
      },
      workspace: { panelOrder: ["x"] },
      presets: {
        list: [{ ...TEST_PRESET, loudnessProfileActive: "profile:missing" }],
        activeId: "p1",
      },
      themes: { themes: {}, order: [] },
      captureDeviceId: "in:2",
    });
    const { settingsStore, workspaceStore, presetsStore } = await import("./index.js");
    expect(settingsStore.read()).toMatchObject({ referenceLufs: -18 });
    expect(workspaceStore.read()).toEqual({ panelOrder: ["x"] });
    expect(presetsStore.read()).toEqual({
      list: [{ ...TEST_PRESET, loudnessProfileActive: "off" }],
      activeId: "p1",
    });
    expect(localStorage.getItem("plvs.captureDeviceId")).toBe("in:2");
  });

  it("round-trips flat loudness profiles through browser export and import", async () => {
    const { exportProfile, importProfile } = await importProfileModule({ tauri: false });
    const { settingsStore, presetsStore } = await import("./index.js");
    const loudnessProfiles = {
      active: "profile:test-profile",
      profiles: [TEST_PROFILE],
    };
    settingsStore.patch({ loudnessProfiles });
    presetsStore.patch({ list: [TEST_PRESET], activeId: "p1" });

    const exported = await exportProfile();
    settingsStore.reset();
    presetsStore.reset();
    await importProfile(exported);

    expect(settingsStore.read().loudnessProfiles).toEqual(loudnessProfiles);
    expect(presetsStore.read()).toEqual({ list: [TEST_PRESET], activeId: "p1" });
  });

  it("resets every browser persistence domain", async () => {
    const { settingsStore, workspaceStore, presetsStore, themesStore } = await import("./index.js");
    settingsStore.patch({
      loudnessProfiles: {
        active: "profile:test-profile",
        profiles: [TEST_PROFILE],
      },
    });
    workspaceStore.patch({ panelOrder: ["levelMeter-1"] });
    presetsStore.patch({ list: [TEST_PRESET], activeId: "p1" });
    themesStore.patch({
      themes: { custom: { id: "custom", name: "Custom" } },
      order: ["custom"],
    });
    const { resetProfile } = await importProfileModule({ tauri: false });

    await resetProfile();

    expect(settingsStore.read()).toEqual({});
    expect(workspaceStore.read()).toEqual({});
    expect(presetsStore.read()).toEqual({});
    expect(themesStore.read()).toEqual({});
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
