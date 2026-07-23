import { describe, it, expect } from "vitest";
import { listMissingPreferredMetrics, planShowMissing } from "./loudnessProfileMissing.js";

function doc(rules) {
  return { id: "t", name: "T", kind: "user", referenceLufs: null, rules };
}

describe("listMissingPreferredMetrics", () => {
  it("returns nothing when the profile is Off", () => {
    expect(listMissingPreferredMetrics(null, [])).toEqual([]);
  });

  it("lists watched metrics that are not currently visible, in the profile's order", () => {
    const document = doc([
      { metricId: "integrated", op: ">", value: -14, severity: "fail" },
      { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
    ]);
    expect(listMissingPreferredMetrics(document, ["integrated"])).toEqual(["truePeak"]);
  });

  it("does not demand a metric whose only rule is unfilled", () => {
    const document = doc([{ metricId: "truePeak", op: ">", severity: "fail" }]);
    expect(listMissingPreferredMetrics(document, [])).toEqual([]);
  });

  it("demands each watched metric once", () => {
    const document = doc([
      { metricId: "integrated", op: ">", value: -14, severity: "fail" },
      { metricId: "integrated", op: "<", value: -40, severity: "fail" },
    ]);
    expect(listMissingPreferredMetrics(document, [])).toEqual(["integrated"]);
  });
});

describe("planShowMissing", () => {
  it("appends missing ids without reordering what is shown", () => {
    expect(planShowMissing(["a", "b"], ["c", "b", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("returns the same list when nothing is missing", () => {
    const visible = ["a", "b"];
    expect(planShowMissing(visible, [])).toBe(visible);
  });
});
