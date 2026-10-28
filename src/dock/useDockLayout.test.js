/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { presetsStore, workspaceStore } from "../persistence/index.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";
import { useDockLayout } from "./useDockLayout.js";

const FIRST_RUN_MODULES = [
  "stats",
  "level",
  "loudness",
  "waveform",
  "spectrogram",
  "spectrum",
  "stereoMap",
  "correlation",
];

const FIRST_RUN_SIZES = {
  stats: 400,
  level: 180,
  loudness: 180,
  correlation: 180,
  waveform: 180,
  spectrogram: 180,
  spectrum: 180,
  stereoMap: 180,
};

describe("useDockLayout", () => {
  beforeEach(() => {
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("starts from the tuned first-run strip and persists toggles to workspaceStore", () => {
    const { result } = renderHook(() => useDockLayout());
    expect(result.current.modules).toEqual(FIRST_RUN_MODULES);
    expect(result.current.panelSizesById).toEqual(FIRST_RUN_SIZES);
    expect(Object.keys(result.current.controlsByPanelId)).toEqual(FIRST_RUN_MODULES);
    expect(result.current.controlsByPanelId).toMatchObject({
      level: { levelMeterMode: "peak", readout: "live", showLabels: true },
      loudness: {
        loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
        loudnessYMinDb: -48,
        loudnessYMaxDb: -6,
      },
      stats: { statsVisibleIds: STATS_CANONICAL_ORDER },
      correlation: {
        vectorscopePair: { x: 0, y: 1 },
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelMaxHold: true,
      },
      waveform: {
        waveformFrequencyColor: true,
        waveformLowMidSplitHz: 200,
        waveformMidHighSplitHz: 2000,
        waveformCentroid: true,
      },
      spectrogram: {
        spectrumChannel: { type: "pair", x: 0, y: 1 },
        spectrogramYMinFreq: 20,
        spectrogramYMaxFreq: 20000,
      },
      spectrum: {
        spectrumChannel: { type: "pair", x: 0, y: 1 },
        spectrumView: "ms",
        spectrumSpeedPercent: 25,
        spectrumOctaveSmoothing: "off",
        spectrumTiltDbPerOctave: 3,
        spectrumMaxMode: "decay",
        spectrumXMinFreq: 20,
        spectrumXMaxFreq: 20000,
        spectrumYMinDb: -84,
        spectrumYMaxDb: -12,
      },
      stereoMap: { stereoMapMode: "position", stereoMapPair: { x: 0, y: 1 } },
    });
    act(() => result.current.toggle("spectrum"));
    const withoutSpectrum = FIRST_RUN_MODULES.filter((id) => id !== "spectrum");
    expect(result.current.modules).toEqual(withoutSpectrum);
    expect(workspaceStore.read().dock.panelOrder).toEqual(withoutSpectrum);
    expect(workspaceStore.read().dock.controlsByPanelId.loudness.showReadouts).toBeUndefined();
    expect(workspaceStore.read().dock.modules).toBeUndefined();
  });

  it("reorders and persists", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.reorder(0, 3));
    expect(result.current.modules[3]).toBe("stats");
    expect(workspaceStore.read().dock.panelOrder[3]).toBe("stats");
    expect(workspaceStore.read().dock.modules).toBeUndefined();
  });

  it("setModules replaces the list (used by preset apply)", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setModules(["spectrum"]));
    expect(result.current.modules).toEqual(["spectrum"]);
    expect(workspaceStore.read().dock.panelOrder).toEqual(["spectrum"]);
    expect(workspaceStore.read().dock.modules).toBeUndefined();
  });

  it("resetLayout restores the default modules, order and controls", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.toggle("spectrum"));
    act(() =>
      result.current.setModuleControls("loudness", {
        ...result.current.controlsByModuleId.loudness,
        loudnessHistoryVisibleLayerIds: ["momentary"],
      })
    );

    act(() => result.current.resetLayout());

    expect(result.current.modules).toEqual(FIRST_RUN_MODULES);
    expect(result.current.panelSizesById).toEqual(FIRST_RUN_SIZES);
    expect(result.current.controlsByModuleId.loudness).toMatchObject({
      loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
    });
    expect(workspaceStore.read().dock.controlsByPanelId.stats.statsVisibleIds).toEqual(
      STATS_CANONICAL_ORDER
    );
  });

  it("drops stale legacy dock fields when writing panel order", () => {
    workspaceStore.patch({
      dock: {
        panelsById: {
          loudness: { id: "loudness", moduleId: "loudness" },
          stats: { id: "stats", moduleId: "stats" },
        },
        panelOrder: ["loudness", "stats"],
        controlsByPanelId: {
          stats: {
            statsVisibleIds: ["psr", "lra"],
            statsOrder: ["lra", "psr"],
          },
        },
        modules: ["level", "correlation", "level", "correlation"],
        controlsByModuleId: { level: { readout: "peak" } },
        statsIds: ["integrated"],
      },
    });
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setPanelOrder(["stats", "loudness"]));
    const persisted = workspaceStore.read().dock;
    expect(persisted.panelOrder).toEqual(["stats", "loudness"]);
    expect(Object.keys(persisted.panelsById)).toEqual(["loudness", "stats"]);
    expect(persisted.controlsByPanelId.stats.statsVisibleIds).toEqual(["psr", "lra"]);
    expect(persisted.controlsByPanelId.stats.statsOrder.slice(0, 2)).toEqual(["lra", "psr"]);
    expect(persisted.modules).toBeUndefined();
    expect(persisted.controlsByModuleId).toBeUndefined();
    expect(persisted.statsIds).toBeUndefined();
  });

  it("updates and resets one module without mutating other families", () => {
    const { result } = renderHook(() => useDockLayout());
    const spectrumBefore = result.current.controlsByModuleId.spectrum;
    act(() =>
      result.current.setModuleControls("loudness", {
        ...result.current.controlsByModuleId.loudness,
        loudnessHistoryVisibleLayerIds: ["momentary"],
      })
    );
    expect(result.current.controlsByModuleId.loudness.loudnessHistoryVisibleLayerIds).toEqual([
      "momentary",
    ]);
    expect(result.current.controlsByModuleId.spectrum).toEqual(spectrumBefore);
    act(() => result.current.resetModuleControls("loudness"));
    expect(result.current.controlsByModuleId.loudness.loudnessHistoryVisibleLayerIds).toEqual([
      "momentary",
      "shortTerm",
      "ref",
    ]);
  });

  it("previews and persists an adjacent panel resize", () => {
    const { result } = renderHook(() => useDockLayout());
    const resize = {
      leftPanelId: "level",
      rightPanelId: "loudness",
      leftWidth: 180,
      rightWidth: 200,
      delta: 24,
    };

    act(() => result.current.resizePanelPair({ ...resize, persist: false }));
    expect(result.current.panelSizesById).toMatchObject({ level: 200, loudness: 180 });
    expect(workspaceStore.read().dock).toBeUndefined();

    act(() => result.current.resizePanelPair({ ...resize, persist: true }));
    expect(workspaceStore.read().dock.panelSizesById).toMatchObject({
      level: 200,
      loudness: 180,
    });
  });

  it("setPanels with no stored layout (legacy modules-only preset after preflight) keeps module defaults", () => {
    // A legacy preset that stored only dock.modules builds a dock object with neither panelsById
    // nor a modules array by the time preflightApplySnapshot hands it to setPanels — it must not
    // read as first run.
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setPanels({ enabled: true }));
    expect(result.current.panelSizesById).toEqual({});
    expect(result.current.controlsByPanelId).toMatchObject({
      loudness: { linkTimeViewport: true },
      spectrum: { spectrumMaxMode: "off" },
    });
  });

  it("setModules keeps panelSizesById empty", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setModules(["spectrum", "level"]));
    expect(result.current.panelSizesById).toEqual({});
  });

  it("addPanel on the first-run strip gives the new panel module defaults, not the first-run tuning", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.addPanel("spectrum"));
    expect(result.current.controlsByPanelId.spectrum.spectrumMaxMode).toBe("decay");
    expect(result.current.controlsByPanelId["spectrum-2"].spectrumMaxMode).toBe("off");

    act(() => result.current.addPanel("stereo-map"));
    const newStereoMapPanelId = result.current.panelOrder.find(
      (id) => result.current.panelsById[id]?.moduleId === "stereo-map" && id !== "stereoMap"
    );
    expect(newStereoMapPanelId).toBeTruthy();
    expect(newStereoMapPanelId).not.toBe("stereoMap");
  });

  it("resets the preferred widths for one adjacent pair", () => {
    workspaceStore.patch({
      dock: {
        panelsById: {
          level: { id: "level", moduleId: "levelMeter" },
          loudness: { id: "loudness", moduleId: "loudness" },
        },
        panelOrder: ["level", "loudness"],
        panelSizesById: { level: 220, loudness: 260 },
      },
    });
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.resetPanelPair("level", "loudness"));
    expect(result.current.panelSizesById).toEqual({});
    expect(workspaceStore.read().dock.panelSizesById).toEqual({});
  });
});
