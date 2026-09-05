import { describe, expect, it } from "vitest";
import { planMerge, planPackImport } from "./mergeIntoLibrary.js";
import { normalizeRuleDocument } from "../lib/loudnessProfileNormalize.js";

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

const A = { id: "a", name: "Alpha", referenceLufs: -23, rules: [] };

describe("planMerge", () => {
  it("adds an item whose id is absent", () => {
    const { additions, plan } = planMerge([], [A], { makeId: counter() });
    expect(additions).toEqual([A]);
    expect(plan).toEqual([{ sourceId: "a", finalId: "a", name: "Alpha", disposition: "added" }]);
  });

  it("skips an identical item", () => {
    const { additions, plan } = planMerge([A], [{ ...A }], { makeId: counter() });
    expect(additions).toEqual([]);
    expect(plan[0].disposition).toBe("skipped");
    expect(plan[0].finalId).toBe("a");
  });

  it("compares by value, not key order", () => {
    const reordered = { rules: [], referenceLufs: -23, name: "Alpha", id: "a" };
    const { plan } = planMerge([A], [reordered], { makeId: counter() });
    expect(plan[0].disposition).toBe("skipped");
  });

  it("duplicates an item whose id matches but whose content differs", () => {
    const changed = { ...A, referenceLufs: -16 };
    const { additions, plan } = planMerge([A], [changed], { makeId: counter() });
    expect(additions).toEqual([{ ...changed, id: "new-1", name: "Alpha (2)" }]);
    expect(plan).toEqual([
      { sourceId: "a", finalId: "new-1", name: "Alpha (2)", disposition: "duplicated" },
    ]);
  });

  it("suffixes a new id's name when it collides with a local name", () => {
    const { additions } = planMerge([A], [{ ...A, id: "b" }], { makeId: counter() });
    expect(additions).toEqual([{ ...A, id: "b", name: "Alpha (2)" }]);
  });

  it("increments the suffix past names already taken", () => {
    const existing = [A, { ...A, id: "a2", name: "Alpha (2)" }];
    const { additions } = planMerge(existing, [{ ...A, id: "b" }], { makeId: counter() });
    expect(additions[0].name).toBe("Alpha (3)");
  });

  it("does not let two incoming items claim the same suffixed name", () => {
    const incoming = [
      { ...A, id: "b" },
      { ...A, id: "c" },
    ];
    const { additions } = planMerge([A], incoming, { makeId: counter() });
    expect(additions.map((item) => item.name)).toEqual(["Alpha (2)", "Alpha (3)"]);
  });

  it("never changes a local entry", () => {
    const existing = [A];
    planMerge(existing, [{ ...A, referenceLufs: -16 }], { makeId: counter() });
    expect(existing).toEqual([{ id: "a", name: "Alpha", referenceLufs: -23, rules: [] }]);
  });

  it("compares nested arrays and Float32-exact numbers", () => {
    const withRules = {
      ...A,
      rules: [{ metricId: "truePeak", op: ">", value: -0.5, severity: "fail" }],
    };
    const same = {
      ...A,
      rules: [{ metricId: "truePeak", op: ">", value: -0.5, severity: "fail" }],
    };
    const different = {
      ...A,
      rules: [{ metricId: "truePeak", op: ">", value: -0.25, severity: "fail" }],
    };
    expect(planMerge([withRules], [same], { makeId: counter() }).plan[0].disposition).toBe(
      "skipped"
    );
    expect(planMerge([withRules], [different], { makeId: counter() }).plan[0].disposition).toBe(
      "duplicated"
    );
  });

  it("treats a rule's absent value key as distinct from a present one", () => {
    // normalizeRuleDocument (src/lib/loudnessProfileNormalize.js) omits `rule.value` entirely
    // when isUsableThreshold(raw.value) is false -- here, an unfilled row with no `value` in the
    // raw input at all. So two otherwise-identical rule documents can differ in key set, not just
    // in value.
    const noValueDoc = normalizeRuleDocument({
      id: "x",
      name: "X",
      referenceLufs: -23,
      rules: [{ metricId: "truePeak", op: ">", severity: "fail" }],
    });
    const withValueDoc = normalizeRuleDocument({
      id: "x",
      name: "X",
      referenceLufs: -23,
      rules: [{ metricId: "truePeak", op: ">", severity: "fail", value: -0.5 }],
    });

    expect(noValueDoc.rules[0]).not.toHaveProperty("value");
    expect(withValueDoc.rules[0].value).toBe(-0.5);

    expect(
      planMerge([noValueDoc], [{ ...noValueDoc }], { makeId: counter() }).plan[0].disposition
    ).toBe("skipped");
    expect(planMerge([noValueDoc], [withValueDoc], { makeId: counter() }).plan[0].disposition).toBe(
      "duplicated"
    );
    expect(planMerge([withValueDoc], [noValueDoc], { makeId: counter() }).plan[0].disposition).toBe(
      "duplicated"
    );
  });
});

const P = { id: "pa", name: "Prof A", referenceLufs: -23, rules: [] };

function presetPack(items, loudnessProfiles) {
  return { app: "PLVS", kind: "preset-pack", version: 1, exportedAt: "x", items, loudnessProfiles };
}

describe("planPackImport", () => {
  it("passes a non-preset pack straight through with no profile stage", () => {
    const pack = { app: "PLVS", kind: "theme-pack", version: 1, exportedAt: "x", items: [] };
    const result = planPackImport("themes", pack, { existingItems: [], makeId: counter() });
    expect(result.profileAdditions).toEqual([]);
    expect(result.profilePlan).toEqual([]);
  });

  it("imports a preset with its profile and keeps the reference", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:pa" };
    const result = planPackImport("presets", presetPack([preset], [P]), {
      existingItems: [],
      existingProfiles: [],
      makeId: counter(),
    });
    expect(result.profileAdditions).toEqual([P]);
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("profile:pa");
  });

  it("points the preset at the copy when the profile was duplicated", () => {
    const localProfile = { ...P, referenceLufs: -16 };
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:pa" };
    const result = planPackImport("presets", presetPack([preset], [P]), {
      existingItems: [],
      existingProfiles: [localProfile],
      makeId: counter(),
    });
    expect(result.profileAdditions[0].id).toBe("new-1");
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("profile:new-1");
  });

  it("keeps the reference when the profile was already in the library", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:pa" };
    const result = planPackImport("presets", presetPack([preset], [P]), {
      existingItems: [],
      existingProfiles: [P],
      makeId: counter(),
    });
    expect(result.profileAdditions).toEqual([]);
    expect(result.profilePlan[0].disposition).toBe("skipped");
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("profile:pa");
  });

  it("drops a reference the pack did not carry", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:missing" };
    const result = planPackImport("presets", presetPack([preset], []), {
      existingItems: [],
      existingProfiles: [],
      makeId: counter(),
    });
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("off");
  });

  it("leaves an Off preset alone", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "off" };
    const result = planPackImport("presets", presetPack([preset], []), {
      existingItems: [],
      existingProfiles: [],
      makeId: counter(),
    });
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("off");
  });
});
