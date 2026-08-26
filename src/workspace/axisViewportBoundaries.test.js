import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { workspaceReducer } from "./reducer";
import { DEFAULT_WORKSPACE_STATE } from "./constants";
import { AXIS_VIEWPORTS } from "./axisViewports";
import { normalizePanelControls, DEFAULT_PANEL_CONTROLS } from "../lib/panelControls";
import { spectrumRequestKeyFromControls } from "../analysis/analysisRequests.js";
import { stereoMapRequestKeyFromControls } from "../analysis/analysisRequests.js";

describe("SET_VIEW carries the shared viewport", () => {
  it("restores what a preset captured", () => {
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_VIEW",
      payload: {
        ...DEFAULT_WORKSPACE_STATE,
        axisViewports: { frequency: { min: 200, max: 5000 } },
      },
    });

    expect(next.axisViewports.frequency).toEqual({ min: 200, max: 5000 });
  });

  it("repairs a preset written before the feature rather than leaving a hole", () => {
    const next = workspaceReducer(
      { ...DEFAULT_WORKSPACE_STATE, axisViewports: { frequency: { min: 200, max: 5000 } } },
      { type: "SET_VIEW", payload: { ...DEFAULT_WORKSPACE_STATE, axisViewports: undefined } }
    );

    expect(next.axisViewports.frequency).toEqual({ min: 20, max: 20000 });
  });

  it("lands membership and the shared value in the same commit", () => {
    // A preset holding linked members must never render one frame where a panel says it is linked
    // while the group range it should be drawing is still the previous one.
    const linked = normalizePanelControls({
      ...DEFAULT_PANEL_CONTROLS,
      linkFrequencyViewport: true,
    });
    const next = workspaceReducer(DEFAULT_WORKSPACE_STATE, {
      type: "SET_VIEW",
      payload: {
        tree: DEFAULT_WORKSPACE_STATE.tree,
        panelsById: { p: { id: "p", moduleId: "spectrum" } },
        panelOrder: ["p"],
        panelControlsById: { p: linked },
        pinnedPanelsById: {},
        axisViewports: { frequency: { min: 200, max: 5000 } },
      },
    });

    expect(next.panelControlsById.p.linkFrequencyViewport).toBe(true);
    expect(next.axisViewports.frequency).toEqual({ min: 200, max: 5000 });
  });
});

describe("the viewport is display-only", () => {
  it("stays out of the spectrum analysis request key", () => {
    const wide = spectrumRequestKeyFromControls(DEFAULT_PANEL_CONTROLS);
    const zoomed = spectrumRequestKeyFromControls({
      ...DEFAULT_PANEL_CONTROLS,
      spectrumXMinFreq: 200,
      spectrumXMaxFreq: 5000,
    });

    expect(zoomed).toBe(wide);
  });

  it("stays out of the stereo map analysis request key", () => {
    const wide = stereoMapRequestKeyFromControls(DEFAULT_PANEL_CONTROLS);
    const zoomed = stereoMapRequestKeyFromControls({
      ...DEFAULT_PANEL_CONTROLS,
      stereoMapXMinFreq: 200,
      stereoMapXMaxFreq: 5000,
    });

    expect(zoomed).toBe(wide);
  });

  it("does not change a request key when membership changes", () => {
    const linked = spectrumRequestKeyFromControls({
      ...DEFAULT_PANEL_CONTROLS,
      linkFrequencyViewport: true,
    });
    const unlinked = spectrumRequestKeyFromControls({
      ...DEFAULT_PANEL_CONTROLS,
      linkFrequencyViewport: false,
    });

    expect(unlinked).toBe(linked);
  });
});

describe("the dock keeps its own viewports", () => {
  it("has no module in common with an axis kind by accident", () => {
    // Dock renders its own components against dock-owned ranges. The guard is that no dock source
    // file reaches the workspace viewport at all -- if one ever does, this is where it shows up.
    const dockSources = [
      "src/dock/registry.jsx",
      "src/dock/editors/DockModuleSettings.jsx",
      "src/dock/useDockHistoryViewport.js",
    ];

    for (const path of dockSources) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("axisViewport");
      expect(source).not.toContain("linkFrequencyViewport");
    }
  });

  it("names only workspace modules as axis members", () => {
    for (const kind of Object.values(AXIS_VIEWPORTS)) {
      for (const moduleId of Object.keys(kind.members)) {
        expect(moduleId.startsWith("dock")).toBe(false);
      }
    }
  });
});
