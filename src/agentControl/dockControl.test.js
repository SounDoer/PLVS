import { describe, expect, it } from "vitest";
import {
  buildDockDescription,
  buildDockPanelDescription,
  buildDockSnapshot,
  compileDockLayout,
  planDockFormMutation,
  planDockPanelPatch,
  planDockPanelReset,
  reconcileDockExecution,
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
  },
  panelOrder: ["level"],
  panelSizesById: { level: 220 },
  controlsByPanelId: {
    level: { levelMeterMode: "peak", readout: "truePeakMax", showLabels: false },
  },
};

describe("Dock Control", () => {
  it("describes Level growth from its orientation and preserves width preferences", () => {
    const context = { channelCount: 8 };
    expect(buildDockPanelDescription(dock, "level", context).width.min).toBeGreaterThan(400);
    const horizontal = planDockPanelPatch(dock, "level", { orientation: "left-to-right" }, context);
    expect(horizontal.issues).toEqual([]);
    expect(buildDockPanelDescription(horizontal.dock, "level", context).width).toMatchObject({
      min: 180,
      growth: "flexible",
      preferredMin: 1,
    });
    expect(buildDockSnapshot(horizontal.dock).panels[0]).toMatchObject({
      width: 220,
      widthMode: "preferred",
    });
  });

  it("distinguishes automatic widths and accepts wide preferences beyond the old caps", () => {
    const manual = compileDockLayout(dock, { panels: [{ panelId: "level", width: 1400 }] });
    expect(manual.issues).toEqual([]);
    expect(buildDockSnapshot(manual.dock).panels[0]).toMatchObject({
      width: 1400,
      widthMode: "preferred",
    });
    const automatic = compileDockLayout(manual.dock, { panels: [{ panelId: "level" }] });
    expect(automatic.issues).toEqual([]);
    expect(buildDockSnapshot(automatic.dock).panels[0].widthMode).toBe("automatic");
  });

  it("round-trips Stereo Map Grid through schema, patch, and read", () => {
    const current = {
      ...dock,
      panelsById: { map: { id: "map", moduleId: "stereo-map" } },
      panelOrder: ["map"],
      controlsByPanelId: {},
    };
    const patched = planDockPanelPatch(current, "map", { grid: true });
    expect(patched.issues).toEqual([]);
    expect(buildDockSnapshot(patched.dock).panels[0].controls.grid).toBe(true);
    expect(buildDockPanelDescription(current, "map").schema.grid).toMatchObject({
      type: "boolean",
    });
  });

  it("treats readout as an alias of one switch and leaves Floating Value alone", () => {
    const momentary = {
      ...dock,
      controlsByPanelId: {
        level: { levelMeterMode: "momentary", levelMeterValueMarker: true },
      },
    };
    const live = planDockPanelPatch(momentary, "level", { readout: "live" });
    expect(live.issues).toEqual([]);
    expect(buildDockSnapshot(live.dock).panels[0].controls).toMatchObject({
      readout: "live",
      floatingValue: true,
    });

    const both = planDockPanelPatch(momentary, "level", {
      readout: "playbackMax",
      floatingValue: false,
    });
    expect(both.issues).toEqual([]);
    expect(buildDockSnapshot(both.dock).panels[0].controls).toMatchObject({
      readout: "playbackMax",
      playbackMax: true,
      floatingValue: false,
    });

    expect(
      planDockPanelPatch(dock, "level", { readout: "truePeakMax", tpMaxMarker: false }).issues
    ).toEqual([expect.objectContaining({ code: "conflictingControls", path: "$.readout" })]);
  });

  it("round-trips Spectrum grid and peak labels through the public controls", () => {
    const current = {
      ...dock,
      panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
      panelOrder: ["spectrum"],
      controlsByPanelId: {},
    };
    const patched = planDockPanelPatch(current, "spectrum", { grid: true, peakLabels: true });
    expect(patched.issues).toEqual([]);
    expect(buildDockSnapshot(patched.dock).panels[0].controls).toMatchObject({
      grid: true,
      peakLabels: true,
    });
    expect(buildDockPanelDescription(current, "spectrum").schema).toMatchObject({
      grid: { type: "boolean" },
      peakLabels: { type: "boolean" },
    });
  });

  it("allows macOS overlay entry and explicit opt-in reservation", () => {
    const current = { ...dock, enabled: false, reserveSpace: false };
    const context = { platform: "macos", sourceMode: "live" };
    const entered = planDockFormMutation(current, "dock.enter", { edge: "bottom" }, context);
    expect(entered.refusal).toBeNull();
    expect(entered.issues).toEqual([]);
    expect(entered.dock).toMatchObject({ enabled: true, edge: "bottom", reserveSpace: false });
    expect(buildDockDescription(current, context).reserveSpace).toMatchObject({
      writable: true,
      reason: null,
    });
    const reserved = planDockFormMutation(current, "dock.enter", { reserveSpace: true }, context);
    expect(reserved.issues).toEqual([]);
    expect(reserved.dock.reserveSpace).toBe(true);
  });

  it("serializes the form and ordered public panels", () => {
    expect(buildDockSnapshot(dock)).toMatchObject({
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
          id: "level",
          moduleId: "levelMeter",
          title: "Main",
          customTitle: "Main",
          width: 220,
          controls: {
            mode: "peak",
            readout: "truePeakMax",
            barColors: "gradient",
            peakThresholdsDbfs: { warning: -6, critical: -1 },
            rmsThresholdsDbfs: { warning: -18, critical: -9 },
          },
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
      height: { min: 56, max: 4294967295 },
      monitors: [{ id: "monitor-1", name: "Display 1" }],
    });
    expect(result.modules.find(({ moduleId }) => moduleId === "spectrum").width).toEqual({
      min: 180,
      default: 360,
      maxPreferred: 4294967295,
      preferredMin: 1,
      growth: "flexible",
    });
    expect(
      result.modules.find(({ moduleId }) => moduleId === "levelMeter").controls
    ).toHaveProperty("readout");
    expect(result.modules.find(({ moduleId }) => moduleId === "levelMeter").controls).toMatchObject(
      {
        mode: { type: "string", options: ["peak", "rms", "momentary", "shortTerm"] },
        readout: { type: "string", options: ["live", "truePeakMax"] },
        orientation: {
          type: "string",
          options: ["left-to-right", "right-to-left", "top-to-bottom", "bottom-to-top"],
        },
      }
    );
    expect(result.modules.find(({ moduleId }) => moduleId === "spectrum").controls).toMatchObject({
      speedPercent: { type: "integer", unit: "%" },
      frequencyRangeHz: { type: "object", unit: "Hz" },
    });
    expect(
      result.modules.find(({ moduleId }) => moduleId === "vectorscope").controls
    ).toMatchObject({
      persistenceMs: { type: "integer", unit: "ms", default: 400 },
    });
    expect(result.modules.find(({ moduleId }) => moduleId === "stereo-map").controls).toMatchObject(
      {
        energyFadePercent: { type: "integer", unit: "%", default: 75 },
        colorBlendPercent: { type: "integer", unit: "%", default: 50 },
      }
    );
    expect(result.modules.find(({ moduleId }) => moduleId === "spectrum").controls).toHaveProperty(
      "peakLabels"
    );
  });

  it("plans shared Level controls and resets them", () => {
    const planned = planDockPanelPatch(dock, "level", {
      mode: "rms",
      orientation: "left-to-right",
      playbackMax: true,
    });
    expect(planned.issues).toEqual([]);
    expect(buildDockSnapshot(planned.dock).panels[0].controls).toMatchObject({
      mode: "rms",
      orientation: "left-to-right",
      playbackMax: true,
    });
    expect(planDockPanelReset(planned.dock, "level").changed.length).toBeGreaterThan(0);
    expect(buildDockPanelDescription(dock, "level").schema.orientation).toMatchObject({
      type: "string",
      current: "bottom-to-top",
    });
    expect(planDockPanelPatch(dock, "level", { showLabels: true }).issues[0].code).toBe(
      "unknownControl"
    );
  });

  it("plans Dock level thresholds through the panel's own rules", () => {
    const planned = planDockPanelPatch(
      dock,
      "level",
      { peakThresholdsDbfs: { warning: -10, critical: -2 } },
      {}
    );
    expect(planned.issues).toEqual([]);
    expect(buildDockSnapshot(planned.dock).panels[0].controls.peakThresholdsDbfs).toEqual({
      warning: -10,
      critical: -2,
    });
  });

  it("plans Dock Bar Colors through the panel's own rules", () => {
    const planned = planDockPanelPatch(dock, "level", { barColors: "levelZones" }, {});
    expect(planned.issues).toEqual([]);
    expect(buildDockSnapshot(planned.dock).panels[0].controls.barColors).toBe("levelZones");
  });

  it("keeps other meter settings when orientation changes", () => {
    const planned = planDockPanelPatch(dock, "level", { orientation: "left-to-right" });
    expect(planned.issues).toEqual([]);
    expect(planned.changed).toEqual(["dock.panels.level.controls.orientation"]);
    expect(buildDockSnapshot(planned.dock).panels[0].controls.tpMaxMarker).toBe(true);
  });

  it("accepts the fractional widths that inspection reports", () => {
    // Resizing the strip stores fractional CSS pixels, so a document taken straight from
    // `dock.inspect` carries them; rejecting non-integers broke that round trip.
    const fractional = compileDockLayout(
      dock,
      { panels: [{ panelId: "level", width: 227.20004272460935 }] },
      {}
    );
    expect(fractional.issues).toEqual([]);
    expect(fractional.dock.panelSizesById.level).toBe(227.20004272460935);

    // Out of range is still out of range.
    expect(
      compileDockLayout(dock, { panels: [{ panelId: "level", width: 0 }] }, {}).issues
    ).toEqual([expect.objectContaining({ code: "outOfRange", path: "$.panels[0].width" })]);
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
        panels: [{ key: "removed", moduleId: "transport", controls: {} }],
      }).issues
    ).toEqual([expect.objectContaining({ code: "unknownModule" })]);
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

  it("reports the applied height when native geometry fits a large request", () => {
    const planned = planDockFormMutation(
      dock,
      "dock.enter",
      { height: 2000 },
      { platform: "windows" }
    );
    const resolved = reconcileDockExecution(planned, { ...planned.dock, height: 700 });
    expect(resolved.dock.height).toBe(700);
    expect(resolved.warnings).toContainEqual({
      code: "dockHeightFitted",
      requested: 2000,
      effective: 700,
    });
  });

  it("reports a reservation conflict as a successful overlay fallback", () => {
    const planned = planDockFormMutation(
      { ...dock, enabled: false, reserveSpace: true },
      "dock.enter",
      { edge: "top", reserveSpace: true },
      { platform: "windows" }
    );

    const resolved = reconcileDockExecution(planned, {
      ...planned.dock,
      reserveSpace: false,
    });

    expect(resolved.dock).toMatchObject({ enabled: true, edge: "top", reserveSpace: false });
    expect(resolved.warnings).toEqual([
      {
        code: "dockReservationConflict",
        requested: true,
        effective: false,
      },
    ]);
  });
});

it("round-trips Dock frequency membership and preserves the visible range on unlink", () => {
  const current = {
    ...dock,
    panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
    panelOrder: ["spectrum"],
    controlsByPanelId: {},
  };
  const context = { sharedFrequencyViewport: { min: 80, max: 8000 } };
  const result = planDockPanelPatch(current, "spectrum", { linkFrequency: false }, context);
  expect(result.issues).toEqual([]);
  expect(buildDockSnapshot(result.dock, context).panels[0]).toMatchObject({
    controls: { linkFrequency: false, frequencyRangeHz: { min: 80, max: 8000 } },
    axes: { frequency: { linked: false, range: { min: 80, max: 8000 } } },
  });
  const unrelated = planDockPanelPatch(result.dock, "spectrum", { grid: false }, context);
  expect(buildDockSnapshot(unrelated.dock, context).panels[0].controls.linkFrequency).toBe(false);
  const invalid = planDockPanelPatch(
    current,
    "spectrum",
    { linkFrequency: "false", grid: false },
    context
  );
  expect(invalid.issues[0].code).toBe("invalidType");
  expect(invalid.dock).toBe(current);
});
