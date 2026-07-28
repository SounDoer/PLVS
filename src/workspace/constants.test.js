import { describe, it, expect } from "vitest";
import { DEFAULT_PANELS_BY_ID, DEFAULT_WORKSPACE_STATE, ALL_MODULE_IDS } from "./constants.js";
import { MODULE_REGISTRY } from "./registry.jsx";

describe("workspace module ids", () => {
  it("covers all default modules", () => {
    expect(ALL_MODULE_IDS).toHaveLength(7);
  });

  it("keeps waveform last in the default module order", () => {
    expect(ALL_MODULE_IDS[6]).toBe("waveform");
  });
});

describe("workspace state shape", () => {
  it("DEFAULT_WORKSPACE_STATE has the lean persisted shape", () => {
    expect(Object.keys(DEFAULT_WORKSPACE_STATE).sort()).toEqual(
      [
        "fullscreenId",
        "panelControlsById",
        "panelOrder",
        "panelsById",
        "pinnedPanelsById",
        "tree",
      ].sort()
    );
    expect(DEFAULT_WORKSPACE_STATE).not.toHaveProperty("visibleModules");
    expect(DEFAULT_PANELS_BY_ID.levelMeter).toEqual({ id: "levelMeter", moduleId: "levelMeter" });
    expect(DEFAULT_WORKSPACE_STATE.panelControlsById.levelMeter.levelMeterMode).toBe("peak");
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
  it("keeps the levelMeter module id and labels it as Level Meter", () => {
    expect(MODULE_REGISTRY.levelMeter.id).toBe("levelMeter");
    expect(MODULE_REGISTRY.levelMeter.title).toBe("Level Meter");
  });
});

describe("stereo map registration", () => {
  it("is addable, immediately after waveform in the registry", () => {
    const ids = Object.keys(MODULE_REGISTRY);
    expect(ids.indexOf("stereo-map")).toBe(ids.indexOf("waveform") + 1);
    expect(MODULE_REGISTRY["stereo-map"].title).toBe("Stereo Map");
  });

  it("does not join the default module set or the default workspace", () => {
    expect(ALL_MODULE_IDS).not.toContain("stereo-map");
    expect(ALL_MODULE_IDS).toHaveLength(7);
    expect(DEFAULT_PANELS_BY_ID).not.toHaveProperty("stereo-map");
    expect(DEFAULT_WORKSPACE_STATE.panelOrder).not.toContain("stereo-map");
  });
});
