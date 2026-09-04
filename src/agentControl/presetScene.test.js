import { describe, expect, it } from "vitest";
import { planPresetSave, planPresetUpdate } from "./presetScene.js";

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
});
