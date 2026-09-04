import { describe, expect, it } from "vitest";
import { buildDockDescription, buildDockSnapshot } from "./dockControl.js";

const dock = {
  supported: true,
  enabled: true,
  edge: "top",
  monitor: "monitor-1",
  reserveSpace: true,
  height: 72,
  suspended: false,
  panelsById: {
    level: { id: "level", moduleId: "levelMeter", customTitle: "Main" },
    transport: { id: "transport", moduleId: "transport" },
  },
  panelOrder: ["transport", "level"],
  panelSizesById: { level: 220 },
  controlsByPanelId: {
    level: { levelMeterMode: "peak", readout: "truePeakMax", showLabels: false },
  },
};

describe("Dock Control", () => {
  it("serializes the form and ordered public panels", () => {
    expect(buildDockSnapshot(dock)).toEqual({
      supported: true,
      enabled: true,
      edge: "top",
      monitor: "monitor-1",
      reserveSpace: true,
      height: 72,
      heightMode: "standard",
      suspended: false,
      panels: [
        {
          id: "transport",
          moduleId: "transport",
          title: "Transport",
          customTitle: null,
          width: 120,
          controls: {},
          analysis: { status: "notApplicable" },
        },
        {
          id: "level",
          moduleId: "levelMeter",
          title: "Main",
          customTitle: "Main",
          width: 220,
          controls: { mode: "peak", readout: "truePeakMax", showLabels: false },
          analysis: { status: "active" },
        },
      ],
    });
  });

  it("describes support, sizing, modules, and dynamic monitor choices", () => {
    const result = buildDockDescription(dock, {
      platform: "windows",
      monitors: [{ id: "monitor-1", name: "Display 1" }],
    });
    expect(result).toMatchObject({
      supported: true,
      reserveSpace: { writable: true },
      height: { min: 56, max: 160 },
      monitors: [{ id: "monitor-1", name: "Display 1" }],
    });
    expect(result.modules.find(({ moduleId }) => moduleId === "spectrum").width).toEqual({
      min: 180,
      default: 360,
      maxPreferred: 960,
      growth: "flexible",
    });
  });
});
