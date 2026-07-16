import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import {
  createDefaultPanelControls,
  getPanelControls,
  isDefaultPanelControls,
  normalizePanelControlsById,
  updatePanelControlsById,
} from "./panelControlInstances.js";

describe("panelControlInstances", () => {
  it("creates isolated default panel controls", () => {
    const controls = createDefaultPanelControls();
    expect(controls).toEqual(DEFAULT_PANEL_CONTROLS);
    expect(controls).not.toBe(DEFAULT_PANEL_CONTROLS);
  });

  it("detects whether normalized controls match the product defaults", () => {
    expect(isDefaultPanelControls(createDefaultPanelControls())).toBe(true);
    expect(
      isDefaultPanelControls({
        ...createDefaultPanelControls(),
        levelMeterMode: "rms",
      })
    ).toBe(false);
  });

  it("normalizes controls only for existing panel ids", () => {
    const panelsById = {
      levelMeter: { id: "levelMeter", moduleId: "levelMeter" },
      "levelMeter-2": { id: "levelMeter-2", moduleId: "levelMeter" },
    };

    const controlsById = normalizePanelControlsById(panelsById, {
      levelMeter: { levelMeterMode: "momentary" },
      stale: { levelMeterMode: "shortTerm" },
    });

    expect(Object.keys(controlsById).sort()).toEqual(["levelMeter", "levelMeter-2"]);
    expect(controlsById.levelMeter.levelMeterMode).toBe("momentary");
    expect(controlsById["levelMeter-2"].levelMeterMode).toBe("peak");
  });

  it("reads and updates controls by panel id", () => {
    const state = {
      panelControlsById: {
        levelMeter: createDefaultPanelControls(),
      },
    };
    const next = updatePanelControlsById(state.panelControlsById, "levelMeter", {
      levelMeterMode: "shortTerm",
    });

    expect(getPanelControls({ panelControlsById: next }, "levelMeter").levelMeterMode).toBe(
      "shortTerm"
    );
    expect(state.panelControlsById.levelMeter.levelMeterMode).toBe("peak");
  });
});
