import { describe, expect, it } from "vitest";
import {
  planPresetApply,
  planPresetApplyResources,
  planPresetSave,
  planPresetUpdate,
} from "./presetScene.js";

const snapshot = { tree: { type: "leaf" }, windowPinned: false };
const current = {
  list: [{ id: "preset-1", name: "Mixing", ...snapshot }],
  activeId: "preset-1",
  dirty: false,
};

describe("Preset scene capture planning", () => {
  it("validates and trims a save name without allocating during dry-run", () => {
    const planned = planPresetSave(current, "  New Mix  ", snapshot);

    expect(planned.issues).toEqual([]);
    expect(planned.preset).toEqual({ id: null, name: "New Mix" });
    expect(planned.changed).toEqual(["presets.library", "presets.activeId"]);
    expect(planned.presets).toBe(current);
    expect(planPresetSave(current, "   ", snapshot).issues).toEqual([
      expect.objectContaining({ code: "invalidName", path: "$.name" }),
    ]);
  });

  it("builds the allocated saved state only after receiving an identity", () => {
    const planned = planPresetSave(current, "New Mix", snapshot, "preset-2");

    expect(planned.presets).toEqual({
      list: [...current.list, { id: "preset-2", name: "New Mix", ...snapshot }],
      activeId: "preset-2",
      dirty: false,
    });
    expect(planned.preset).toEqual({ id: "preset-2", name: "New Mix" });
  });

  it("detects an identical active clean update as a no-op", () => {
    const planned = planPresetUpdate(current, "preset-1", snapshot);

    expect(planned.issues).toEqual([]);
    expect(planned.changed).toEqual([]);
    expect(planned.presets).toBe(current);
  });

  it("replaces only the snapshot while retaining identity and name", () => {
    const nextSnapshot = { ...snapshot, windowPinned: true };
    const state = { ...current, activeId: null, dirty: false };
    const planned = planPresetUpdate(state, "preset-1", nextSnapshot);

    expect(planned.changed).toEqual(["presets.preset-1.snapshot", "presets.activeId"]);
    expect(planned.presets.list[0]).toEqual({
      id: "preset-1",
      name: "Mixing",
      ...nextSnapshot,
    });
    expect(planned.presets.activeId).toBe("preset-1");
    expect(planned.presets.dirty).toBe(false);
  });

  it("reports a missing update target", () => {
    expect(planPresetUpdate(current, "missing", snapshot).issues).toEqual([
      expect.objectContaining({ code: "presetNotFound", path: "$.presetId" }),
    ]);
  });

  it("recognizes an active clean apply as a no-op", () => {
    expect(planPresetApply(current, "preset-1", snapshot)).toMatchObject({
      issues: [],
      changed: [],
      applyScene: false,
      presetState: { activeId: "preset-1", dirty: false },
    });
  });

  it("associates matching scene content without replacing the scene", () => {
    const state = { ...current, activeId: null };
    expect(planPresetApply(state, "preset-1", snapshot)).toMatchObject({
      issues: [],
      changed: ["presets.activeId"],
      applyScene: false,
      presetState: { activeId: "preset-1", dirty: false },
    });
  });

  it("plans replacement for different scene content and rejects a missing target", () => {
    const state = { ...current, activeId: null, dirty: true };
    expect(
      planPresetApply(state, "preset-1", {
        ...snapshot,
        tree: { type: "leaf", tabs: [] },
        windowPinned: true,
      })
    ).toMatchObject({
      issues: [],
      changed: ["workspace", "window", "presets.activeId", "presets.dirty"],
      applyScene: true,
    });
    expect(planPresetApply(state, "missing", snapshot)).toMatchObject({
      changed: [],
      issues: [{ code: "presetNotFound" }],
    });
  });

  it("preflights unavailable saved resources and adjusted bounds", () => {
    const preset = {
      id: "preset-1",
      name: "Mixing",
      loudnessProfileActive: "profile:deleted",
      dock: { enabled: true, monitor: "missing-monitor" },
      windowBounds: { x: 5000, y: 5000, width: 800, height: 600, isMaximized: false },
    };
    expect(
      planPresetApplyResources(preset, {
        loudnessProfiles: [],
        dockSupported: true,
        monitors: [{ id: "monitor-1" }],
        fallbackMonitor: "monitor-1",
        monitorRects: [{ x: 0, y: 0, width: 1920, height: 1080 }],
      })
    ).toEqual({
      issues: [],
      warnings: [
        { code: "loudnessProfileUnavailable", requested: "deleted", effective: null },
        {
          code: "dockMonitorUnavailable",
          requested: "missing-monitor",
          effective: "monitor-1",
        },
      ],
    });

    expect(
      planPresetApplyResources(
        { ...preset, dock: { enabled: false } },
        {
          loudnessProfiles: [],
          dockSupported: true,
          monitorRects: [{ x: 0, y: 0, width: 1920, height: 1080 }],
        }
      ).warnings
    ).toContainEqual({
      code: "windowBoundsAdjusted",
      requested: preset.windowBounds,
      effective: { ...preset.windowBounds, x: 560, y: 240 },
    });
  });

  it("degrades unsupported Dock and rejects an impossible monitor fallback", () => {
    const preset = { id: "preset-1", dock: { enabled: true, monitor: "missing" } };
    expect(planPresetApplyResources(preset, { dockSupported: false })).toEqual({
      issues: [],
      warnings: [{ code: "dockUnsupported", requested: true, effective: false }],
    });
    expect(
      planPresetApplyResources(preset, {
        dockSupported: true,
        monitors: [],
        fallbackMonitor: null,
        monitorInventoryReady: true,
      }).issues
    ).toEqual([expect.objectContaining({ code: "monitorUnavailable" })]);
  });
});
