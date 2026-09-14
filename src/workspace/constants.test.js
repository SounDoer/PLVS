import { describe, it, expect } from "vitest";
import { DEFAULT_PANELS_BY_ID, DEFAULT_WORKSPACE_STATE, ALL_MODULE_IDS } from "./constants.js";
import { MODULE_REGISTRY } from "./registry.jsx";
import { MODULE_CATALOG } from "./moduleCatalog.js";
import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";

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
        "axisViewports",
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

  it("joins the default workspace but not the default module set", () => {
    expect(ALL_MODULE_IDS).not.toContain("stereo-map");
    expect(ALL_MODULE_IDS).toHaveLength(7);
    expect(DEFAULT_PANELS_BY_ID["stereo-map"]).toEqual({
      id: "stereo-map",
      moduleId: "stereo-map",
    });
    expect(DEFAULT_WORKSPACE_STATE.panelOrder).toEqual([...ALL_MODULE_IDS, "stereo-map"]);
  });
});

describe("first-run workspace", () => {
  it("uses the layout tuned at 1280x800", () => {
    const leaf = (id) => ({ type: "leaf", tabs: [id], activeTab: id });
    expect(DEFAULT_WORKSPACE_STATE.tree).toEqual({
      type: "split",
      direction: "h",
      sizes: [0.132, null, 0.18],
      children: [
        leaf("levelMeter"),
        {
          type: "split",
          direction: "v",
          sizes: [null, null, null, null],
          children: [
            {
              type: "split",
              direction: "h",
              sizes: [null, null],
              children: [leaf("loudness"), leaf("waveform")],
            },
            leaf("spectrogram"),
            leaf("spectrum"),
            leaf("stereo-map"),
          ],
        },
        {
          type: "split",
          direction: "v",
          sizes: [0.623, null],
          children: [leaf("stats"), leaf("vectorscope")],
        },
      ],
    });
  });

  it("gives only the first-run panels the tuned controls", () => {
    const controls = DEFAULT_WORKSPACE_STATE.panelControlsById;
    expect(controls.levelMeter.levelMeterTpMaxMarker).toBe(true);
    expect(controls.loudness.loudnessHistoryVisibleLayerIds).toEqual([
      "momentary",
      "shortTerm",
      "ref",
    ]);
    expect(controls.stats.statsVisibleIds).toEqual(STATS_CANONICAL_ORDER);
    expect(controls.spectrum).toMatchObject({ spectrumView: "lr", spectrumMaxMode: "decay" });
    expect(controls.waveform).toMatchObject({
      waveformFrequencyColor: true,
      waveformCentroid: true,
    });
    const untouched = normalizePanelControls(DEFAULT_PANEL_CONTROLS);
    expect(controls.vectorscope).toEqual(untouched);
    expect(controls.spectrogram).toEqual(untouched);
    expect(controls["stereo-map"]).toEqual(untouched);
    // A panel added later starts from these, not from the first-run values.
    expect(DEFAULT_PANEL_CONTROLS).toMatchObject({
      levelMeterTpMaxMarker: false,
      spectrumView: "combined",
      spectrumMaxMode: "off",
      waveformFrequencyColor: false,
      waveformCentroid: false,
    });
  });
});
