import { describe, expect, it } from "vitest";
import { listMissingPreferredMetrics, planShowMissing } from "./loudnessProfileMissing.js";
import { BUILTIN_LOUDNESS_PROFILES } from "./loudnessProfileCatalog.js";

const byId = (id) => BUILTIN_LOUDNESS_PROFILES.find((p) => p.id === id);

const DEFAULT_VISIBLE = [
  "momentary",
  "shortTerm",
  "integrated",
  "momentaryMax",
  "shortTermMax",
  "lra",
  "psr",
  "plr",
];

describe("listMissingPreferredMetrics", () => {
  it("reports nothing when the profile is Off", () => {
    expect(listMissingPreferredMetrics(null, [])).toEqual([]);
  });

  it("reports nothing when every preferred metric is already shown", () => {
    expect(listMissingPreferredMetrics(byId("ebu-r128"), [...DEFAULT_VISIBLE, "truePeak"])).toEqual(
      []
    );
  });

  it("reports True Peak as missing under the default Stats rows", () => {
    expect(listMissingPreferredMetrics(byId("ebu-r128"), DEFAULT_VISIBLE)).toEqual(["truePeak"]);
  });

  it("includes the dialogue rows ATSC needs", () => {
    // These are only "dialogue" rows incidentally; the caller must not say so in copy.
    expect(listMissingPreferredMetrics(byId("atsc-a85"), DEFAULT_VISIBLE)).toEqual([
      "dialogueIntegrated",
      "dialogueCoverage",
      "truePeak",
    ]);
  });

  it("demands a metric the profile only describes when it is preferred", () => {
    // ATSC describes dialogue coverage rather than judging it, and still needs the row on screen:
    // without coverage there is no way to read the dialogue-anchored rule.
    expect(byId("atsc-a85").metrics.dialogueCoverage.role).toBe("descriptor");
    expect(listMissingPreferredMetrics(byId("atsc-a85"), [])).toContain("dialogueCoverage");
  });

  it("leaves a described metric alone when the profile does not prefer it", () => {
    // Programme describes LRA but never lists it, and preference is the only thing that demands
    // a row. S1 marks the same metric n/a, likewise unlisted.
    expect(listMissingPreferredMetrics(byId("ebu-r128"), [])).not.toContain("lra");
    expect(listMissingPreferredMetrics(byId("ebu-r128-s1"), [])).not.toContain("lra");
  });

  it("treats an empty Stats panel as missing everything it prefers", () => {
    expect(listMissingPreferredMetrics(byId("ebu-r128"), [])).toEqual(["integrated", "truePeak"]);
  });
});

describe("empty rules are not required", () => {
  it("does not demand a Stats row for a rule with no numbers", () => {
    const document = {
      id: "u1",
      name: "Mine",
      kind: "user",
      referenceLufs: null,
      metrics: {
        integrated: { role: "target", target: -23, tolerance: { minus: 1, plus: 1 } },
        correlation: { role: "limit", severity: "warn" },
      },
      preferredMetricIds: ["integrated", "correlation"],
    };

    // Show missing must not push a row on screen for a metric the profile is not yet judging.
    expect(listMissingPreferredMetrics(document, [])).toEqual(["integrated"]);
  });

  it("demands it once a bound is filled", () => {
    const document = {
      id: "u1",
      name: "Mine",
      kind: "user",
      referenceLufs: null,
      metrics: { correlation: { role: "limit", min: 0, severity: "warn" } },
      preferredMetricIds: ["correlation"],
    };
    expect(listMissingPreferredMetrics(document, [])).toEqual(["correlation"]);
  });
});

describe("planShowMissing", () => {
  it("appends missing ids without reordering what the user already arranged", () => {
    const arranged = ["truePeak", "integrated", "momentary"];
    expect(planShowMissing(arranged, ["dialogueCoverage"])).toEqual([
      "truePeak",
      "integrated",
      "momentary",
      "dialogueCoverage",
    ]);
  });

  it("never removes a visible row", () => {
    const next = planShowMissing(DEFAULT_VISIBLE, ["truePeak"]);
    for (const id of DEFAULT_VISIBLE) expect(next).toContain(id);
  });

  it("returns the list unchanged when there is nothing to add", () => {
    expect(planShowMissing(DEFAULT_VISIBLE, [])).toBe(DEFAULT_VISIBLE);
  });

  it("does not duplicate an id that is already visible", () => {
    expect(planShowMissing(["integrated"], ["integrated", "truePeak"])).toEqual([
      "integrated",
      "truePeak",
    ]);
  });

  it("de-duplicates repeats within the missing list", () => {
    expect(planShowMissing([], ["truePeak", "truePeak"])).toEqual(["truePeak"]);
  });

  it("survives absent arguments", () => {
    expect(planShowMissing(undefined, undefined)).toEqual([]);
  });

  it("fulfills exactly what was reported missing", () => {
    const profile = byId("atsc-a85");
    const missing = listMissingPreferredMetrics(profile, DEFAULT_VISIBLE);
    const next = planShowMissing(DEFAULT_VISIBLE, missing);
    expect(listMissingPreferredMetrics(profile, next)).toEqual([]);
  });
});
