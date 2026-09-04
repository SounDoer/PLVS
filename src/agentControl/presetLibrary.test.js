import { describe, expect, it } from "vitest";
import { planPresetDelete, planPresetRename, planPresetReorder } from "./presetLibrary.js";

const state = {
  list: [
    { id: "preset-1", name: "Mixing", snapshot: 1 },
    { id: "preset-2", name: "Mastering", snapshot: 2 },
  ],
  activeId: "preset-1",
  dirty: true,
};

describe("Preset library planning", () => {
  it("trims rename labels, allows duplicates, and detects no-ops", () => {
    const renamed = planPresetRename(state, "preset-1", "  Mastering  ");
    expect(renamed).toMatchObject({
      issues: [],
      changed: ["presets.preset-1.name"],
      preset: { id: "preset-1", name: "Mastering" },
    });
    expect(renamed.presets.list[0]).toMatchObject({ name: "Mastering", snapshot: 1 });

    const noOp = planPresetRename(state, "preset-1", " Mixing ");
    expect(noOp.changed).toEqual([]);
    expect(noOp.presets).toBe(state);
  });

  it("rejects invalid names and missing immutable IDs", () => {
    expect(planPresetRename(state, "preset-1", "   ").issues).toEqual([
      expect.objectContaining({ code: "invalidName", path: "$.name" }),
    ]);
    expect(planPresetRename(state, "missing", "Name").issues).toEqual([
      expect.objectContaining({ code: "presetNotFound", path: "$.presetId" }),
    ]);
  });

  it("deletes only the record and clears an active relationship including dirty", () => {
    const planned = planPresetDelete(state, "preset-1");

    expect(planned.deletedPreset).toEqual({ id: "preset-1", name: "Mixing" });
    expect(planned.presets).toEqual({
      list: [state.list[1]],
      activeId: null,
      dirty: false,
    });
    expect(planned.changed).toEqual(["presets.library", "presets.activeId", "presets.dirty"]);
  });

  it("validates reorder as a full permutation and detects current order", () => {
    const reordered = planPresetReorder(state, ["preset-2", "preset-1"]);
    expect(reordered.issues).toEqual([]);
    expect(reordered.changed).toEqual(["presets.order"]);
    expect(reordered.presets.list.map(({ id }) => id)).toEqual(["preset-2", "preset-1"]);

    const noOp = planPresetReorder(state, ["preset-1", "preset-2"]);
    expect(noOp.presets).toBe(state);
    expect(noOp.changed).toEqual([]);

    for (const invalid of [["preset-1"], ["preset-1", "preset-1"], ["preset-1", "missing"]]) {
      expect(planPresetReorder(state, invalid).issues).toEqual([
        expect.objectContaining({ code: "invalidPermutation", path: "$.presetIds" }),
      ]);
    }
  });
});
