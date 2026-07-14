import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { presetsStore, workspaceStore } from "../persistence/index.js";
import { useDockLayout } from "./useDockLayout.js";

describe("useDockLayout", () => {
  beforeEach(() => {
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("starts from defaults and persists toggles to workspaceStore", () => {
    const { result } = renderHook(() => useDockLayout());
    expect(result.current.modules).toEqual(["level", "loudness", "spectrum", "correlation"]);
    act(() => result.current.toggle("spectrum"));
    expect(result.current.modules).toEqual(["level", "loudness", "correlation"]);
    expect(workspaceStore.read().dock.panelOrder).toEqual(["level", "loudness", "correlation"]);
    expect(workspaceStore.read().dock.modules).toBeUndefined();
  });

  it("reorders and persists", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.reorder(0, 3));
    expect(result.current.modules[3]).toBe("level");
    expect(workspaceStore.read().dock.panelOrder[3]).toBe("level");
    expect(workspaceStore.read().dock.modules).toBeUndefined();
  });

  it("setModules replaces the list (used by preset apply)", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setModules(["spectrum"]));
    expect(result.current.modules).toEqual(["spectrum"]);
    expect(workspaceStore.read().dock.panelOrder).toEqual(["spectrum"]);
    expect(workspaceStore.read().dock.modules).toBeUndefined();
  });

  it("marks the active preset dirty when the layout changes", () => {
    // Dock layout is part of the preset snapshot, so strip edits must dirty
    // the active preset like every other captured field. Assert on the raw
    // store patch (mirrors useAlwaysOnTop's dirty test).
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1", dirty: false });
    const { result } = renderHook(() => useDockLayout());

    act(() => result.current.toggle("spectrum"));
    expect(presetsStore.read().dirty).toBe(true);

    presetsStore.patch({ dirty: false });
    act(() => result.current.reorder(0, 2));
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("exposes statsIds with defaults and persists toggles", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setModules(["stats"]));
    expect(result.current.statsIds).toEqual(["integrated", "truePeak", "lra"]);
    act(() => result.current.toggleStat("psr"));
    expect(result.current.statsIds).toEqual(["integrated", "truePeak", "lra", "psr"]);
    expect(workspaceStore.read().dock.controlsByPanelId.stats.ids).toEqual([
      "integrated",
      "truePeak",
      "lra",
      "psr",
    ]);
    expect(workspaceStore.read().dock.statsIds).toBeUndefined();
    expect(workspaceStore.read().dock.controlsByModuleId).toBeUndefined();
  });

  it("setStatsIds replaces the selection (used by preset apply)", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setModules(["stats"]));
    act(() => result.current.setStatsIds(["lra"]));
    expect(result.current.statsIds).toEqual(["lra"]);
    expect(workspaceStore.read().dock.controlsByPanelId.stats.ids).toEqual(["lra"]);
  });

  it("drops stale legacy dock fields when writing panel order", () => {
    workspaceStore.patch({
      dock: {
        panelsById: {
          loudness: { id: "loudness", moduleId: "loudness" },
          stats: { id: "stats", moduleId: "stats" },
        },
        panelOrder: ["loudness", "stats"],
        controlsByPanelId: { stats: { ids: ["psr", "lra"] } },
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
    expect(persisted.controlsByPanelId.stats.ids).toEqual(["psr", "lra"]);
    expect(persisted.modules).toBeUndefined();
    expect(persisted.controlsByModuleId).toBeUndefined();
    expect(persisted.statsIds).toBeUndefined();
  });

  it("updates and resets one module without mutating other families", () => {
    const { result } = renderHook(() => useDockLayout());
    const spectrumBefore = result.current.controlsByModuleId.spectrum;
    act(() => result.current.setModuleControls("loudness", { metric: "momentary" }));
    expect(result.current.controlsByModuleId.loudness.metric).toBe("momentary");
    expect(result.current.controlsByModuleId.spectrum).toEqual(spectrumBefore);
    act(() => result.current.resetModuleControls("loudness"));
    expect(result.current.controlsByModuleId.loudness.metric).toBe("shortTerm");
  });

  it("stat toggles dirty the active preset", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1", dirty: false });
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setModules(["stats"]));
    presetsStore.patch({ dirty: false });
    act(() => result.current.toggleStat("psr"));
    expect(presetsStore.read().dirty).toBe(true);
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
    expect(result.current.panelSizesById).toMatchObject({ level: 204, loudness: 176 });
    expect(workspaceStore.read().dock).toBeUndefined();

    act(() => result.current.resizePanelPair({ ...resize, persist: true }));
    expect(workspaceStore.read().dock.panelSizesById).toMatchObject({
      level: 204,
      loudness: 176,
    });
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
