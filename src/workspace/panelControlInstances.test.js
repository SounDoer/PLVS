import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import {
  createDefaultPanelControls,
  getPanelControls,
  normalizePanelControlsById,
  updatePanelControlsById,
} from "./panelControlInstances.js";

describe("panelControlInstances", () => {
  it("creates isolated default panel controls", () => {
    const controls = createDefaultPanelControls();
    expect(controls).toEqual(DEFAULT_PANEL_CONTROLS);
    expect(controls).not.toBe(DEFAULT_PANEL_CONTROLS);
  });

  it("normalizes controls only for existing panel ids", () => {
    const panelsById = {
      peak: { id: "peak", moduleId: "peak" },
      "peak-2": { id: "peak-2", moduleId: "peak" },
    };

    const controlsById = normalizePanelControlsById(panelsById, {
      peak: { levelMeterMode: "momentary" },
      stale: { levelMeterMode: "shortTerm" },
    });

    expect(Object.keys(controlsById).sort()).toEqual(["peak", "peak-2"]);
    expect(controlsById.peak.levelMeterMode).toBe("momentary");
    expect(controlsById["peak-2"].levelMeterMode).toBe("peak");
  });

  it("reads and updates controls by panel id", () => {
    const state = {
      panelControlsById: {
        peak: createDefaultPanelControls(),
      },
    };
    const next = updatePanelControlsById(state.panelControlsById, "peak", {
      levelMeterMode: "shortTerm",
    });

    expect(getPanelControls({ panelControlsById: next }, "peak").levelMeterMode).toBe("shortTerm");
    expect(state.panelControlsById.peak.levelMeterMode).toBe("peak");
  });
});
