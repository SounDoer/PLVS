import { describe, expect, it } from "vitest";
import {
  buildDockDescription,
  buildDockPanelDescription,
  buildDockSnapshot,
  compileDockLayout,
  planDockFormMutation,
  planDockPanelPatch,
  planDockPanelReset,
} from "./dockControl.js";

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
    expect(
      result.modules.find(({ moduleId }) => moduleId === "levelMeter").controls
    ).toHaveProperty("readout");
    expect(result.modules.find(({ moduleId }) => moduleId === "levelMeter").controls).toMatchObject(
      {
        mode: { type: "string", options: ["peak", "rms", "momentary", "shortTerm"] },
        readout: { type: "string", options: ["live", "truePeakMax"] },
        showLabels: { type: "boolean" },
      }
    );
    expect(result.modules.find(({ moduleId }) => moduleId === "spectrum").controls).toMatchObject({
      speedPercent: { type: "integer", unit: "%" },
      frequencyRangeHz: { type: "object", unit: "Hz" },
    });
    expect(
      result.modules.find(({ moduleId }) => moduleId === "spectrum").controls
    ).not.toHaveProperty("peakLabels");
  });

  it("strictly plans Dock-only panel controls", () => {
    const planned = planDockPanelPatch(
      dock,
      "level",
      { mode: "rms", readout: "playbackMax", showLabels: true },
      {}
    );
    expect(planned.issues).toEqual([]);
    expect(planned.changed).toEqual([
      "dock.panels.level.controls.mode",
      "dock.panels.level.controls.readout",
      "dock.panels.level.controls.showLabels",
    ]);
    expect(buildDockSnapshot(planned.dock).panels[1].controls).toEqual({
      mode: "rms",
      readout: "playbackMax",
      showLabels: true,
    });
    expect(planDockPanelPatch(dock, "level", { playbackMax: true }).issues).toEqual([
      expect.objectContaining({ code: "unknownControl" }),
    ]);
    expect(planDockPanelReset(planned.dock, "level").changed.length).toBeGreaterThan(0);
    expect(buildDockPanelDescription(dock, "level").schema).toMatchObject({
      mode: { type: "string", current: "peak" },
      readout: { type: "string", current: "truePeakMax", options: ["live", "truePeakMax"] },
      showLabels: { type: "boolean", current: false },
    });
    expect(buildDockPanelDescription(dock, "transport").issue.code).toBe("controlsUnavailable");
    expect(planDockPanelPatch(dock, "level", { mode: "rms" }).issues).toEqual([
      expect.objectContaining({ code: "incompatibleControl", path: "$.readout" }),
    ]);
  });

  it("leaves a Dock-only control the patch did not name alone", () => {
    // The fixture is non-default on both: readout truePeakMax, showLabels false. A patch naming one
    // of them used to reset the other, because the Dock-only controls are absent from the planned
    // core controls and normalization then fell back to their defaults.
    const labels = planDockPanelPatch(dock, "level", { showLabels: true }, {});
    expect(labels.issues).toEqual([]);
    expect(labels.changed).toEqual(["dock.panels.level.controls.showLabels"]);
    expect(buildDockSnapshot(labels.dock).panels[1].controls).toEqual({
      mode: "peak",
      readout: "truePeakMax",
      showLabels: true,
    });

    const readout = planDockPanelPatch(dock, "level", { readout: "live" }, {});
    expect(readout.changed).toEqual(["dock.panels.level.controls.readout"]);
    expect(buildDockSnapshot(readout.dock).panels[1].controls).toEqual({
      mode: "peak",
      readout: "live",
      showLabels: false,
    });
  });

  it("compiles an atomic ordered layout with retained and generated panel ids", () => {
    const compiled = compileDockLayout(
      dock,
      {
        panels: [
          {
            panelId: "level",
            customTitle: null,
            width: 240,
            controls: { mode: "rms", readout: "playbackMax" },
          },
          { key: "scope", moduleId: "vectorscope", width: 220, controls: {} },
        ],
      },
      { channelCount: 2 }
    );
    expect(compiled.issues).toEqual([]);
    expect(compiled.createdPanels.scope).toBe("vectorscope");
    expect(compiled.dock.panelOrder).toEqual(["level", "vectorscope"]);
    expect(compiled.dock.panelSizesById).toEqual({ level: 240, vectorscope: 220 });
    expect(compileDockLayout(dock, { panels: [{ key: "bad", moduleId: "level" }] }).issues).toEqual(
      [expect.objectContaining({ code: "unknownModule" })]
    );
    expect(
      compileDockLayout(dock, { panels: [{ panelId: "level", controls: null }] }).issues
    ).toEqual([expect.objectContaining({ code: "invalidType" })]);
    expect(
      compileDockLayout(dock, {
        panels: [{ panelId: "transport", controls: {} }],
      }).issues
    ).toEqual([]);
  });

  it("preserves panel warnings in an atomic layout plan", () => {
    const compiled = compileDockLayout(dock, {
      panels: [
        {
          key: "wave",
          moduleId: "waveform",
          controls: { frequencyBandsHz: { lowMid: 300, midHigh: 3000 } },
        },
      ],
    });
    expect(compiled.issues).toEqual([]);
    expect(compiled.warnings).toEqual([
      expect.objectContaining({
        code: "currentlyInactive",
        path: "$.panels[0].controls.frequencyBandsHz",
      }),
    ]);
  });

  it("rejects extra frequency-range fields and a known-empty monitor inventory", () => {
    const spectrumDock = {
      ...dock,
      panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
      panelOrder: ["spectrum"],
      controlsByPanelId: {},
    };
    expect(
      planDockPanelPatch(spectrumDock, "spectrum", {
        frequencyRangeHz: { min: 20, max: 20000, extra: true },
      }).issues
    ).toEqual([expect.objectContaining({ code: "unknownControl" })]);
    expect(
      planDockFormMutation(
        { ...dock, enabled: false },
        "dock.enter",
        { monitor: "missing" },
        {
          platform: "windows",
          monitors: [],
          monitorInventoryReady: true,
        }
      ).issues
    ).toEqual([expect.objectContaining({ code: "monitorNotFound" })]);
  });

  it("previews and reports fallback from a stale saved monitor", () => {
    const stale = { ...dock, enabled: false, monitor: "missing-monitor" };
    const planned = planDockFormMutation(
      stale,
      "dock.enter",
      {},
      {
        platform: "windows",
        monitors: [{ id: "monitor-2", name: "Display 2" }],
        fallbackMonitor: "monitor-2",
      }
    );
    expect(planned.issues).toEqual([]);
    expect(planned.dock.monitor).toBe("monitor-2");
    expect(planned.warnings).toEqual([
      {
        code: "monitorFallback",
        requested: "missing-monitor",
        effective: "monitor-2",
      },
    ]);
  });
});
