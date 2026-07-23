import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOUDNESS_PROFILES,
  normalizeLoudnessProfiles,
  normalizeRuleDocument,
} from "./loudnessProfileNormalize.js";
import { builtinSelectionId, userSelectionId } from "./loudnessProfileCatalog.js";

function rawDoc(rules, extra = {}) {
  return { id: "u1", name: "Mine", kind: "user", referenceLufs: -23, rules, ...extra };
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

  it("defaults a missing name and carries basedOn through", () => {
    const doc = normalizeRuleDocument({ id: "u1", rules: [], basedOn: "ebu-r128" });
    expect(doc.name).toBe("Untitled");
    expect(doc.basedOn).toBe("ebu-r128");
  });

  it("allows a document with zero rules", () => {
    const doc = normalizeRuleDocument(rawDoc([]));
    expect(doc.rules).toEqual([]);
  });
});

describe("normalizeLoudnessProfiles", () => {
  it("defaults a non-object blob to Off with an empty library", () => {
    expect(normalizeLoudnessProfiles(null)).toEqual(DEFAULT_LOUDNESS_PROFILES);
    expect(normalizeLoudnessProfiles(42)).toEqual(DEFAULT_LOUDNESS_PROFILES);
  });

  it("normalizes user profiles and drops duplicate ids", () => {
    const result = normalizeLoudnessProfiles({
      userProfiles: [rawDoc([]), rawDoc([]), { id: "u2", rules: [] }],
    });
    expect(result.userProfiles.map((p) => p.id)).toEqual(["u1", "u2"]);
  });

  it("keeps a valid active selection", () => {
    const result = normalizeLoudnessProfiles({ active: builtinSelectionId("ebu-r128") });
    expect(result.active).toBe(builtinSelectionId("ebu-r128"));
  });

  it("falls back to Off for an unknown built-in or a deleted user profile", () => {
    expect(normalizeLoudnessProfiles({ active: builtinSelectionId("gone") }).active).toBe("off");
    expect(normalizeLoudnessProfiles({ active: userSelectionId("gone") }).active).toBe("off");
  });
});
