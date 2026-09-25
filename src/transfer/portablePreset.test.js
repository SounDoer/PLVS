import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { MAX_LAYOUT_DEPTH, MAX_LAYOUT_PANELS } from "../agentControl/workspaceLayout.js";
import { createDefaultPanelControls } from "../workspace/panelControlInstances.js";
import { normalizeAxisViewportsState } from "../workspace/axisViewports.js";
import {
  PortablePresetError,
  assessPortablePresetCommunityPublication,
  hashPortablePreset,
  portableToStoredPreset,
  presetToPortable,
  serializePortablePreset,
  validatePortablePreset,
} from "./portablePreset.js";

function storedPreset(overrides = {}) {
  return {
    id: "local-preset",
    name: "Mixing",
    ...structuredClone(DEFAULT_WORKSPACE_STATE),
    windowBounds: { x: 100, y: 200, width: 900, height: 700, isMaximized: false },
    windowPinned: true,
    focusView: { autoHideControls: true, compactPanels: false, borderless: true },
    surfaceOpacity: 78,
    glassEnabled: true,
    dock: { enabled: false },
    loudnessProfileActive: "off",
    ...overrides,
  };
}

describe("Portable Preset V1", () => {
  it("exports public semantic content without local identities or host geometry", () => {
    const portable = presetToPortable(storedPreset());
    expect(portable).toMatchObject({
      kind: "plvs-preset",
      formatVersion: 1,
      semanticsVersion: 1,
      name: "Mixing",
      presentation: {
        alwaysOnTop: true,
        focusView: { autoHideControls: true, compactPanels: false, borderless: true },
        panelOpacityPercent: 78,
        glassEnabled: true,
      },
      dock: { enabled: false },
      loudnessProfile: { dependencyId: null },
    });
    expect(portable.workspace.panels).toHaveLength(DEFAULT_WORKSPACE_STATE.panelOrder.length);
    expect(portable.workspace.panels[0]).toHaveProperty("key", "panel-1");
    expect(portable.workspace.panels[0]).not.toHaveProperty("id");
    expect(JSON.stringify(portable)).not.toContain("local-preset");
    expect(portable).not.toHaveProperty("windowBounds");
  });

  it("allocates fresh panel identities and resets transient history offsets on import", () => {
    const source = storedPreset();
    source.panelControlsById.loudness.historyOffsetSec = 12;
    source.panelControlsById.loudness.linkTimeViewport = false;
    const portable = presetToPortable(source);
    const stored = portableToStoredPreset(portable, "imported-preset");

    expect(stored.id).toBe("imported-preset");
    expect(stored.panelOrder).toHaveLength(source.panelOrder.length);
    expect(stored.panelOrder).not.toEqual(source.panelOrder);
    expect(
      stored.panelControlsById[
        stored.panelOrder.find((id) => stored.panelsById[id].moduleId === "loudness")
      ].historyOffsetSec
    ).toBe(0);
    expect(stored).not.toHaveProperty("windowBounds");
    expect(stored.loudnessProfileActive).toBe("off");
  });

  it("round-trips an empty Workspace", () => {
    const portable = presetToPortable(
      storedPreset({
        tree: null,
        panelsById: {},
        panelOrder: [],
        panelControlsById: {},
        pinnedPanelsById: {},
        axisViewports: normalizeAxisViewportsState(),
      })
    );
    expect(portable.workspace).toEqual({ layout: null, panels: [] });
    expect(portableToStoredPreset(portable, "empty")).toMatchObject({
      tree: null,
      panelsById: {},
      panelOrder: [],
    });
  });

  it("preserves tabs and weighted splits", () => {
    const portable = presetToPortable(storedPreset());
    expect(portable.workspace.layout).toMatchObject({
      type: "split",
      direction: "horizontal",
      weights: expect.any(Array),
    });

    const first = portable.workspace.panels[0];
    const second = portable.workspace.panels[1];
    portable.workspace.layout = {
      type: "tabs",
      active: second.key,
      children: [
        { type: "panel", key: first.key },
        { type: "panel", key: second.key },
      ],
    };
    portable.workspace.panels = [first, second];
    const imported = portableToStoredPreset(portable, "tabs");
    expect(imported.tree).toMatchObject({
      type: "leaf",
      tabs: imported.panelOrder,
      activeTab: imported.panelOrder[1],
    });
  });

  it("never carries an author's custom panel identity into the portable or imported Preset", () => {
    const privateId = "author-machine-spectrum-99";
    const portable = presetToPortable(
      storedPreset({
        tree: { type: "leaf", tabs: [privateId], activeTab: privateId },
        panelsById: { [privateId]: { id: privateId, moduleId: "spectrum" } },
        panelOrder: [privateId],
        panelControlsById: { [privateId]: createDefaultPanelControls() },
        pinnedPanelsById: {},
        axisViewports: normalizeAxisViewportsState(),
      })
    );
    expect(JSON.stringify(portable)).not.toContain(privateId);
    const imported = portableToStoredPreset(portable, "imported");
    expect(imported.panelOrder).toHaveLength(1);
    expect(imported.panelOrder[0]).not.toBe(privateId);
    expect(imported.tree.tabs).toEqual([imported.panelOrder[0]]);
  });

  it("requires and remaps the bundled Loudness Profile dependency", () => {
    const profile = { id: "broadcast", name: "Broadcast", referenceLufs: -23, rules: [] };
    const portable = presetToPortable(
      storedPreset({ loudnessProfileActive: "profile:broadcast" }),
      { loudnessProfiles: [profile] }
    );
    expect(portable.loudnessProfile.dependencyId).toBe("broadcast");
    expect(
      portableToStoredPreset(portable, "imported", {
        resolveDependencyId: (id) => (id === "broadcast" ? "local-copy" : null),
      }).loudnessProfileActive
    ).toBe("profile:local-copy");
    expect(() =>
      portableToStoredPreset(portable, "imported", { resolveDependencyId: () => null })
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "missingDependency" })],
      })
    );
  });

  it("retains multichannel selections for Apply-time adaptation", () => {
    const portable = presetToPortable(storedPreset());
    const vectorscope = portable.workspace.panels.find(
      ({ moduleId }) => moduleId === "vectorscope"
    );
    vectorscope.controls.channelPair = { x: 4, y: 5 };

    const imported = portableToStoredPreset(portable, "surround");
    const panelId = imported.panelOrder.find(
      (id) => imported.panelsById[id].moduleId === "vectorscope"
    );
    expect(imported.panelControlsById[panelId].vectorscopePair).toEqual({ x: 4, y: 5 });
  });

  it("round-trips an enabled Dock through semantic controls", () => {
    const source = storedPreset({
      dock: {
        enabled: true,
        edge: "top",
        monitor: "host-monitor",
        reserveSpace: true,
        height: 84,
        panelsById: { meter: { id: "meter", moduleId: "levelMeter", customTitle: "Peaks" } },
        panelOrder: ["meter"],
        panelSizesById: { meter: 180 },
        controlsByPanelId: {
          meter: { levelMeterMode: "peak", readout: "truePeakMax", showLabels: false },
        },
      },
    });
    const portable = presetToPortable(source);
    expect(portable.dock).toEqual({
      enabled: true,
      edge: "top",
      reserveSpace: true,
      heightCssPx: 84,
      panels: [
        {
          key: "dock-1",
          moduleId: "levelMeter",
          title: "Peaks",
          preferredWidthCssPx: 180,
          controls: { mode: "peak", readout: "truePeakMax", showLabels: false },
        },
      ],
    });
    const stored = portableToStoredPreset(portable, "imported");
    expect(stored.dock).toMatchObject({
      enabled: true,
      edge: "top",
      monitor: null,
      reserveSpace: true,
      height: 84,
    });
    expect(stored.dock.panelOrder).toHaveLength(1);
  });

  it("keeps repeated Dock module instances distinct", () => {
    const source = storedPreset({
      dock: {
        enabled: true,
        edge: "bottom",
        monitor: null,
        reserveSpace: false,
        height: 72,
        panelsById: {
          first: { id: "first", moduleId: "levelMeter" },
          second: { id: "second", moduleId: "levelMeter" },
        },
        panelOrder: ["first", "second"],
        panelSizesById: { first: 120, second: 240 },
        controlsByPanelId: {},
      },
    });
    const portable = presetToPortable(source);
    expect(portable.dock.panels.map(({ moduleId }) => moduleId)).toEqual([
      "levelMeter",
      "levelMeter",
    ]);
    const imported = portableToStoredPreset(portable, "repeated-dock");
    expect(new Set(imported.dock.panelOrder).size).toBe(2);
    expect(imported.dock.panelOrder.map((id) => imported.dock.panelsById[id].moduleId)).toEqual([
      "levelMeter",
      "levelMeter",
    ]);
  });

  it("enforces Workspace panel and depth limits", () => {
    const portable = presetToPortable(storedPreset());
    const template = portable.workspace.panels[0];
    portable.workspace.panels = Array.from({ length: MAX_LAYOUT_PANELS + 1 }, (_, index) => ({
      ...structuredClone(template),
      key: `limit-${index}`,
    }));
    portable.workspace.layout = {
      type: "tabs",
      active: "limit-0",
      children: portable.workspace.panels.map(({ key }) => ({ type: "panel", key })),
    };
    expect(() => validatePortablePreset(portable)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: "too_many_panels" })]),
      })
    );

    const deep = presetToPortable(storedPreset());
    deep.workspace.panels = Array.from({ length: MAX_LAYOUT_DEPTH + 2 }, (_, index) => ({
      ...structuredClone(template),
      key: `deep-${index}`,
    }));
    let layout = { type: "panel", key: "deep-0" };
    for (let index = 1; index < MAX_LAYOUT_DEPTH + 2; index += 1) {
      layout = {
        type: "split",
        direction: "horizontal",
        children: [layout, { type: "panel", key: `deep-${index}` }],
      };
    }
    deep.workspace.layout = layout;
    expect(() => validatePortablePreset(deep)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: "layout_too_deep" })]),
      })
    );
  });

  it("strictly rejects unknown modules and fields", () => {
    const portable = presetToPortable(storedPreset());
    portable.extra = true;
    portable.workspace.panels[0].moduleId = "unknown";
    expect(() => validatePortablePreset(portable)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "unknownField", path: "$.extra" }),
          expect.objectContaining({ code: "unknownModule" }),
        ]),
      })
    );
  });

  it("rejects inconsistent linked axes", () => {
    const portable = presetToPortable(storedPreset());
    const linked = portable.workspace.panels.filter((panel) => panel.axes.frequency?.linked);
    linked[1].axes.frequency.minHz += 10;
    expect(() => validatePortablePreset(portable)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "inconsistentLinkedAxis" }),
        ]),
      })
    );
  });

  it("has stable canonical serialization", () => {
    const portable = presetToPortable(storedPreset());
    const reordered = Object.fromEntries(Object.entries(portable).reverse());
    expect(serializePortablePreset(reordered)).toBe(serializePortablePreset(portable));
    expect(() => portableToStoredPreset(portable, "bad id")).toThrow(PortablePresetError);
  });

  it("derives Community compatibility facets and a stable content hash", async () => {
    const portable = presetToPortable(storedPreset());
    const assessment = assessPortablePresetCommunityPublication(portable);
    expect(assessment).toMatchObject({
      compatibility: {
        moduleIds: expect.arrayContaining(["levelMeter", "spectrum"]),
        dependencyIds: [],
        optionalCapabilities: ["glass"],
      },
      communityPublication: { eligible: true, blockers: [] },
    });
    expect(await hashPortablePreset(portable)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
