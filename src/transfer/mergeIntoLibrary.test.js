import { describe, expect, it } from "vitest";
import { planMerge } from "./mergeIntoLibrary.js";

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
});
