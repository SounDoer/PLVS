import { describe, it, expect } from "vitest";
import { DEFAULT_PANELS_BY_ID, DEFAULT_WORKSPACE_STATE, ALL_MODULE_IDS } from "./constants.js";
import { MODULE_REGISTRY } from "./registry.jsx";

describe("digit keyboard shortcuts (keys 1–N map to ALL_MODULE_IDS)", () => {
  it("covers all modules: one digit key per module", () => {
    expect(ALL_MODULE_IDS).toHaveLength(7);
  });

  it("digit 7 maps to waveform", () => {
    expect(ALL_MODULE_IDS[6]).toBe("waveform");
  });
});

describe("workspace state shape", () => {
  it("DEFAULT_WORKSPACE_STATE has the lean persisted shape", () => {
    expect(Object.keys(DEFAULT_WORKSPACE_STATE).sort()).toEqual(
      ["fullscreenId", "panelControls", "panelOrder", "panelsById", "tree"].sort()
    );
    expect(DEFAULT_WORKSPACE_STATE).not.toHaveProperty("visibleModules");
    expect(DEFAULT_PANELS_BY_ID.peak).toEqual({ id: "peak", moduleId: "peak" });
  });
});

describe("panel minimum sizes (drag clamp floor)", () => {
  it("every module uses the shared minimum", () => {
    for (const id of ALL_MODULE_IDS) {
      const def = MODULE_REGISTRY[id];
      expect(def.minWidth).toBe(32);
      expect(def.minHeight).toBe(36);
    }
  });
});

describe("module registry labels", () => {
  it("keeps the peak module id but labels it as Level Meter", () => {
    expect(MODULE_REGISTRY.peak.id).toBe("peak");
    expect(MODULE_REGISTRY.peak.title).toBe("Level Meter");
  });
});
