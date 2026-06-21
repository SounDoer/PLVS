// src/persistence/index.test.js
import { afterEach, describe, expect, it } from "vitest";
import {
  settingsStore,
  workspaceStore,
  presetsStore,
  themesStore,
  exportAll,
  resetAll,
} from "./index.js";

describe("persistence index", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("settingsStore persists under plvs:settings", () => {
    settingsStore.patch({ referenceLufs: -23 });
    expect(JSON.parse(localStorage.getItem("plvs:settings"))).toEqual({ referenceLufs: -23 });
  });

  it("workspaceStore persists under plvs:workspace", () => {
    workspaceStore.patch({ visibleModules: ["levelMeter"] });
    expect(JSON.parse(localStorage.getItem("plvs:workspace"))).toEqual({
      visibleModules: ["levelMeter"],
    });
  });

  it("presetsStore persists under plvs:presets", () => {
    presetsStore.patch({ list: [], activeId: null });
    expect(JSON.parse(localStorage.getItem("plvs:presets"))).toEqual({
      list: [],
      activeId: null,
    });
  });

  it("themesStore persists under plvs:themes", () => {
    themesStore.patch({ themes: {}, order: [] });
    expect(JSON.parse(localStorage.getItem("plvs:themes"))).toEqual({
      themes: {},
      order: [],
    });
  });

  it("workspaceStore strips old preset fields", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        visibleModules: ["levelMeter"],
        activePresetId: "lls",
        customPresets: [{ id: "x" }],
      })
    );
    expect(workspaceStore.export()).toEqual({ visibleModules: ["levelMeter"] });
  });

  it("exportAll returns all domains keyed by name", () => {
    settingsStore.patch({ referenceLufs: -23 });
    workspaceStore.patch({ visibleModules: ["levelMeter"] });
    presetsStore.patch({ list: [], activeId: null });
    themesStore.patch({ themes: {}, order: [] });
    expect(exportAll()).toEqual({
      settings: { referenceLufs: -23 },
      workspace: { visibleModules: ["levelMeter"] },
      presets: { list: [], activeId: null },
      themes: { themes: {}, order: [] },
    });
  });

  it("resetAll clears all domains", () => {
    settingsStore.patch({ referenceLufs: -23 });
    workspaceStore.patch({ visibleModules: ["levelMeter"] });
    presetsStore.patch({ list: [], activeId: null });
    themesStore.patch({ themes: {}, order: [] });
    resetAll();
    expect(localStorage.getItem("plvs:settings")).toBeNull();
    expect(localStorage.getItem("plvs:workspace")).toBeNull();
    expect(localStorage.getItem("plvs:presets")).toBeNull();
    expect(localStorage.getItem("plvs:themes")).toBeNull();
  });
});
