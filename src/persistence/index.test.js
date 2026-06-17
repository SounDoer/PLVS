// src/persistence/index.test.js
import { afterEach, describe, expect, it } from "vitest";
import { settingsStore, workspaceStore, exportAll, resetAll } from "./index.js";

describe("persistence index", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("settingsStore persists under plvs:settings", () => {
    settingsStore.patch({ referenceLufs: -23 });
    expect(JSON.parse(localStorage.getItem("plvs:settings"))).toEqual({ referenceLufs: -23 });
  });

  it("workspaceStore persists under plvs:workspace", () => {
    workspaceStore.patch({ activePresetId: "lls" });
    expect(JSON.parse(localStorage.getItem("plvs:workspace"))).toEqual({ activePresetId: "lls" });
  });

  it("exportAll returns both domains keyed by name", () => {
    settingsStore.patch({ referenceLufs: -23 });
    workspaceStore.patch({ activePresetId: "lls" });
    expect(exportAll()).toEqual({
      settings: { referenceLufs: -23 },
      workspace: { activePresetId: "lls" },
    });
  });

  it("resetAll clears both domains", () => {
    settingsStore.patch({ referenceLufs: -23 });
    workspaceStore.patch({ activePresetId: "lls" });
    resetAll();
    expect(localStorage.getItem("plvs:settings")).toBeNull();
    expect(localStorage.getItem("plvs:workspace")).toBeNull();
  });
});
