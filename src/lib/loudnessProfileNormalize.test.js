import { describe, it, expect } from "vitest";
import { normalizeLoudnessProfiles, normalizeRuleDocument } from "./loudnessProfileNormalize.js";
import { profileSelectionId } from "./loudnessProfileCatalog.js";

function rawDoc(rules, extra = {}) {
  return { id: "u1", name: "Mine", referenceLufs: -23, rules, ...extra };
}

describe("normalizeRuleDocument", () => {
  it("rejects a document with no id", () => {
    expect(normalizeRuleDocument({ rules: [] })).toBeNull();
    expect(normalizeRuleDocument(null)).toBeNull();
    expect(normalizeRuleDocument([])).toBeNull();
  });

  it("keeps valid rules and drops rules on unknown metrics", () => {
    const doc = normalizeRuleDocument(
      rawDoc([
        { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
        { metricId: "bogus", op: ">", value: 0, severity: "fail" },
      ])
    );
    expect(doc.rules).toEqual([{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }]);
  });

  it("drops a rule with an invalid operator", () => {
    const doc = normalizeRuleDocument(rawDoc([{ metricId: "truePeak", op: "==", value: -1 }]));
    expect(doc.rules).toEqual([]);
  });

  it("treats any severity other than fail as a warning", () => {
    const doc = normalizeRuleDocument(
      rawDoc([{ metricId: "truePeak", op: ">", value: -1, severity: "nonsense" }])
    );
    expect(doc.rules[0].severity).toBe("warn");
  });

  it("keeps a rule with no usable value as an empty (unfilled) rule", () => {
    const doc = normalizeRuleDocument(
      rawDoc([
        { metricId: "truePeak", op: ">", value: "", severity: "fail" },
        { metricId: "integrated", op: "<", value: null, severity: "warn" },
      ])
    );
    expect(doc.rules).toEqual([
      { metricId: "truePeak", op: ">", severity: "fail" },
      { metricId: "integrated", op: "<", severity: "warn" },
    ]);
  });

  it("does not coerce a blank value into a real 0", () => {
    const doc = normalizeRuleDocument(rawDoc([{ metricId: "truePeak", op: ">", value: "" }]));
    expect(doc.rules[0].value).toBeUndefined();
  });

  it("normalizes the reference to the accepted window or null", () => {
    expect(normalizeRuleDocument(rawDoc([], { referenceLufs: -14 })).referenceLufs).toBe(-14);
    expect(normalizeRuleDocument(rawDoc([], { referenceLufs: 5 })).referenceLufs).toBeNull();
    expect(normalizeRuleDocument(rawDoc([], { referenceLufs: "" })).referenceLufs).toBeNull();
  });

  it("returns a flat document without legacy kind or basedOn fields", () => {
    const doc = normalizeRuleDocument(rawDoc([], { kind: "user", basedOn: "ebu-r128" }));
    expect(doc).toEqual({
      id: "u1",
      name: "Mine",
      referenceLufs: -23,
      rules: [],
    });
  });

  it("defaults a missing, empty, or blank name to Untitled", () => {
    expect(normalizeRuleDocument({ id: "u1", rules: [] }).name).toBe("Untitled");
    expect(normalizeRuleDocument({ id: "u1", name: "", rules: [] }).name).toBe("Untitled");
    expect(normalizeRuleDocument({ id: "u1", name: "   ", rules: [] }).name).toBe("Untitled");
  });

  it("allows a document with zero rules", () => {
    const doc = normalizeRuleDocument(rawDoc([]));
    expect(doc.rules).toEqual([]);
  });
});

describe("normalizeLoudnessProfiles", () => {
  it("cold-seeds malformed storage with exactly one injectable starter profile", () => {
    const expected = {
      active: "off",
      profiles: [
        {
          id: "starter-id",
          name: "I −23 ±0.5 · TP ≤ −1",
          referenceLufs: -23,
          rules: [
            { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
            { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
            { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
          ],
        },
      ],
    };
    const options = { makeId: () => "starter-id" };

    expect(normalizeLoudnessProfiles(null, options)).toEqual(expected);
    expect(normalizeLoudnessProfiles(42, options)).toEqual(expected);
    expect(normalizeLoudnessProfiles([], options)).toEqual(expected);
    expect(normalizeLoudnessProfiles({}, options)).toEqual(expected);
    expect(normalizeLoudnessProfiles({ userProfiles: [rawDoc([])] }, options)).toEqual(expected);
  });

  it("preserves an explicitly empty profile library", () => {
    expect(normalizeLoudnessProfiles({ active: "off", profiles: [] })).toEqual({
      active: "off",
      profiles: [],
    });
  });

  it("normalizes profiles and drops invalid entries and duplicate ids in order", () => {
    const result = normalizeLoudnessProfiles({
      profiles: [rawDoc([]), null, rawDoc([]), { id: "u2", name: "", rules: [] }],
    });
    expect(result.profiles.map((p) => p.id)).toEqual(["u1", "u2"]);
    expect(result.profiles[1].name).toBe("Untitled");
    expect(result).not.toHaveProperty("userProfiles");
  });

  it("keeps a valid active selection", () => {
    const active = profileSelectionId("u1");
    const result = normalizeLoudnessProfiles({ active, profiles: [rawDoc([])] });
    expect(result.active).toBe(active);
  });

  it("falls back to Off for dangling and legacy-prefixed selections", () => {
    const profiles = [rawDoc([])];
    expect(normalizeLoudnessProfiles({ active: profileSelectionId("gone"), profiles }).active).toBe(
      "off"
    );
    expect(normalizeLoudnessProfiles({ active: "builtin:ebu-r128", profiles }).active).toBe("off");
    expect(normalizeLoudnessProfiles({ active: "user:u1", profiles }).active).toBe("off");
  });
});
