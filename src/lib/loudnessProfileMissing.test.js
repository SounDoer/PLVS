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

  it("does not require metrics the profile merely describes", () => {
    // S1 marks LRA n/a and Programme only describes it: neither should ever be demanded.
    expect(listMissingPreferredMetrics(byId("ebu-r128-s1"), [])).not.toContain("lra");
    expect(listMissingPreferredMetrics(byId("ebu-r128"), [])).not.toContain("lra");
  });

  it("treats an empty Stats panel as missing everything it prefers", () => {
    expect(listMissingPreferredMetrics(byId("ebu-r128"), [])).toEqual(["integrated", "truePeak"]);
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
