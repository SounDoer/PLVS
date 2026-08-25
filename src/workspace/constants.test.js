import { describe, it, expect } from "vitest";
import { DEFAULT_PANELS_BY_ID, DEFAULT_WORKSPACE_STATE, ALL_MODULE_IDS } from "./constants.js";
import { MODULE_REGISTRY } from "./registry.jsx";
import { MODULE_CATALOG } from "./moduleCatalog.js";

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

describe("catalog / registry contract", () => {
  // A module's identity lives in moduleCatalog.js and its React half in registry.jsx, so its id is
  // written twice. Neither omission throws: a catalog-only module renders a titled but empty panel,
  // and a registry-only one spreads `undefined`, losing its id and title so hasKnownModulesOnly
  // silently drops every preset that references it. Fail here instead.
  it("registers exactly the catalog's modules, in the same order", () => {
    expect(Object.keys(MODULE_REGISTRY)).toEqual(Object.keys(MODULE_CATALOG));
  });

  it("carries the catalog fields plus the React pair on every entry", () => {
    for (const [id, entry] of Object.entries(MODULE_REGISTRY)) {
      expect(entry).toMatchObject(MODULE_CATALOG[id]);
      expect(entry.Component).toBeTypeOf("function");
      expect(entry.Icon).toBeDefined();
    }
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
