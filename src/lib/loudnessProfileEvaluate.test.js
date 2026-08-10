import { describe, it, expect } from "vitest";
import { loudnessProfileEvaluate } from "./loudnessProfileEvaluate.js";

function doc(rules) {
  return { id: "t", name: "T", kind: "user", referenceLufs: null, rules };
}

function sample(values, extra = {}) {
  return { values, integratedReady: true, ...extra };
}

describe("loudnessProfileEvaluate", () => {
  it("judges nothing when the profile is Off", () => {
    expect(loudnessProfileEvaluate(null, sample({ integrated: -20 }))).toEqual({});
  });

  it("returns no status for a metric with no rule", () => {
    const statuses = loudnessProfileEvaluate(doc([]), sample({ truePeak: 0 }));
    expect(statuses).toEqual({});
  });

  it("ignores an empty (unfilled) rule", () => {
    const statuses = loudnessProfileEvaluate(
      doc([{ metricId: "truePeak", op: ">", severity: "fail" }]),
      sample({ truePeak: 0 })
    );
    expect(statuses.truePeak).toBeUndefined();
  });

  it("fires a > rule only when the value is above the threshold", () => {
    const rules = [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }];
    expect(loudnessProfileEvaluate(doc(rules), sample({ truePeak: 0 })).truePeak).toBe("fail");
    expect(loudnessProfileEvaluate(doc(rules), sample({ truePeak: -3 })).truePeak).toBe("ok");
  });

  it("fires a < rule only when the value is below the threshold", () => {
    const rules = [{ metricId: "integrated", op: "<", value: -30, severity: "fail" }];
    expect(loudnessProfileEvaluate(doc(rules), sample({ integrated: -40 })).integrated).toBe(
      "fail"
    );
    expect(loudnessProfileEvaluate(doc(rules), sample({ integrated: -20 })).integrated).toBe("ok");
  });

  it("takes the most severe rule that fires", () => {
    const rules = [
      { metricId: "integrated", op: ">", value: -16, severity: "warn" },
      { metricId: "integrated", op: ">", value: -9, severity: "fail" },
    ];
    // Above -16 only: warn. Above both: fail.
    expect(loudnessProfileEvaluate(doc(rules), sample({ integrated: -12 })).integrated).toBe(
      "warn"
    );
    expect(loudnessProfileEvaluate(doc(rules), sample({ integrated: -8 })).integrated).toBe("fail");
    expect(loudnessProfileEvaluate(doc(rules), sample({ integrated: -20 })).integrated).toBe("ok");
  });

  it("judges a two-sided band, breaching above and below", () => {
    const rules = [
      { metricId: "integrated", op: ">", value: -14, severity: "fail" },
      { metricId: "integrated", op: "<", value: -40, severity: "fail" },
    ];
    expect(loudnessProfileEvaluate(doc(rules), sample({ integrated: -10 })).integrated).toBe(
      "fail"
    );
    expect(loudnessProfileEvaluate(doc(rules), sample({ integrated: -50 })).integrated).toBe(
      "fail"
    );
    expect(loudnessProfileEvaluate(doc(rules), sample({ integrated: -25 })).integrated).toBe("ok");
  });

  it("keeps a warn rule at warn, never escalating to fail", () => {
    const rules = [{ metricId: "integrated", op: ">", value: -14, severity: "warn" }];
    expect(loudnessProfileEvaluate(doc(rules), sample({ integrated: -8 })).integrated).toBe("warn");
  });

  it("reads a metric with rules but no value as pending", () => {
    const rules = [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }];
    expect(loudnessProfileEvaluate(doc(rules), sample({})).truePeak).toBe("pending");
  });

  it("holds Integrated at pending until the engine reports it ready", () => {
    const rules = [{ metricId: "integrated", op: ">", value: -14, severity: "fail" }];
    const statuses = loudnessProfileEvaluate(
      doc(rules),
      sample({ integrated: -10 }, { integratedReady: false })
    );
    expect(statuses.integrated).toBe("pending");
  });

  it("judges a dialogue metric as soon as the engine has a value, regardless of coverage", () => {
    const rules = [{ metricId: "dialogueIntegrated", op: ">", value: -20, severity: "fail" }];
    const lowCoverage = loudnessProfileEvaluate(
      doc(rules),
      sample({ dialogueIntegrated: -10 }, { dialogueCoverage: 2 })
    );
    expect(lowCoverage.dialogueIntegrated).toBe("fail");

    const noCoverageField = loudnessProfileEvaluate(
      doc(rules),
      sample({ dialogueIntegrated: -10 })
    );
    expect(noCoverageField.dialogueIntegrated).toBe("fail");
  });
});
