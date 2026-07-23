import { describe, it, expect } from "vitest";
import {
  BUILTIN_LOUDNESS_PROFILES,
  LOUDNESS_PROFILE_OFF,
  RULEABLE_METRIC_IDS,
  builtinSelectionId,
  createEmptyRule,
  createProfileDraft,
  duplicateAsDraft,
  isKnownMetricId,
  isRuleEmpty,
  isUsableThreshold,
  parseSelection,
  resolveActiveDocument,
  userSelectionId,
  watchedMetricIds,
  withReferenceLufs,
} from "./loudnessProfileCatalog.js";
import { STATS_META } from "./statsCatalog.js";

const VALID_OPS = new Set([">", "<"]);
const VALID_SEVERITIES = new Set(["warn", "fail"]);

function ruleFor(profile, metricId, op) {
  return profile.rules.find((r) => r.metricId === metricId && r.op === op);
}

describe("loudnessProfileCatalog built-ins", () => {
  it("gives every built-in an id, name, reference and a rules array", () => {
    for (const p of BUILTIN_LOUDNESS_PROFILES) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(p.kind).toBe("builtin");
      expect(Number.isFinite(p.referenceLufs)).toBe(true);
      expect(Array.isArray(p.rules)).toBe(true);
    }
  });

  it("only writes valid, addressable rules", () => {
    for (const p of BUILTIN_LOUDNESS_PROFILES) {
      for (const rule of p.rules) {
        expect(isKnownMetricId(rule.metricId)).toBe(true);
        expect(VALID_OPS.has(rule.op)).toBe(true);
        expect(Number.isFinite(rule.value)).toBe(true);
        expect(VALID_SEVERITIES.has(rule.severity)).toBe(true);
      }
    }
  });

  it("expresses EBU R128 as a ±0.5 Integrated band and a -1 True Peak ceiling", () => {
    const p = BUILTIN_LOUDNESS_PROFILES.find((x) => x.id === "ebu-r128");
    expect(p.referenceLufs).toBe(-23);
    expect(ruleFor(p, "integrated", ">")).toMatchObject({ value: -22.5, severity: "fail" });
    expect(ruleFor(p, "integrated", "<")).toMatchObject({ value: -23.5, severity: "fail" });
    expect(ruleFor(p, "truePeak", ">")).toMatchObject({ value: -1, severity: "fail" });
  });

  it("only warns on realtime Integrated for R128 Live", () => {
    const p = BUILTIN_LOUDNESS_PROFILES.find((x) => x.id === "ebu-r128-live");
    expect(ruleFor(p, "integrated", ">")).toMatchObject({ value: -22, severity: "warn" });
    expect(ruleFor(p, "integrated", "<")).toMatchObject({ value: -24, severity: "warn" });
    expect(ruleFor(p, "truePeak", ">").severity).toBe("fail");
  });

  it("caps Short-term Max at -18 for S1", () => {
    const p = BUILTIN_LOUDNESS_PROFILES.find((x) => x.id === "ebu-r128-s1");
    expect(ruleFor(p, "shortTermMax", ">")).toMatchObject({ value: -18, severity: "fail" });
  });

  it("anchors ATSC on dialogue with a -2 true peak limit", () => {
    const p = BUILTIN_LOUDNESS_PROFILES.find((x) => x.id === "atsc-a85");
    expect(p.referenceLufs).toBe(-24);
    expect(ruleFor(p, "dialogueIntegrated", ">")).toMatchObject({ value: -22 });
    expect(ruleFor(p, "dialogueIntegrated", "<")).toMatchObject({ value: -26 });
    expect(ruleFor(p, "truePeak", ">").value).toBe(-2);
  });

  it("treats Streaming -14 as a warn-only playback reference", () => {
    const p = BUILTIN_LOUDNESS_PROFILES.find((x) => x.id === "streaming-14");
    expect(p.referenceLufs).toBe(-14);
    for (const rule of p.rules) expect(rule.severity).toBe("warn");
  });
});

describe("RULEABLE_METRIC_IDS", () => {
  it("addresses only metrics Stats can show", () => {
    for (const id of RULEABLE_METRIC_IDS) expect(STATS_META[id]).toBeTruthy();
  });
});

describe("createEmptyRule", () => {
  it("opens a blank ceiling rule on the given metric", () => {
    expect(createEmptyRule("truePeak")).toEqual({
      metricId: "truePeak",
      op: ">",
      value: undefined,
      severity: "fail",
    });
  });

  it("returns null for a metric that cannot carry a rule", () => {
    expect(createEmptyRule("nope")).toBeNull();
  });
});

describe("createProfileDraft", () => {
  it("starts unnamed, at reference -23, watching Integrated and True Peak", () => {
    const draft = createProfileDraft();
    expect(draft.name).toBe("");
    expect(draft.referenceLufs).toBe(-23);
    expect(watchedMetricIds(draft)).toEqual(["integrated", "truePeak"]);
  });

  it("returns an independent object each call", () => {
    const a = createProfileDraft();
    const b = createProfileDraft();
    a.rules[0].value = 999;
    expect(b.rules[0].value).not.toBe(999);
  });
});

describe("duplicateAsDraft", () => {
  it("copies a built-in into an editable draft that remembers its origin", () => {
    const draft = duplicateAsDraft("ebu-r128-s1", () => "new-id");
    expect(draft.id).toBe("new-id");
    expect(draft.kind).toBe("draft");
    expect(draft.basedOn).toBe("ebu-r128-s1");
    expect(draft.name).toBe("EBU R128 S1 (copy)");
    expect(watchedMetricIds(draft)).toContain("shortTermMax");
  });

  it("deep-copies so editing the draft cannot mutate the built-in", () => {
    const draft = duplicateAsDraft("ebu-r128", () => "x");
    draft.rules[0].value = 0;
    const source = BUILTIN_LOUDNESS_PROFILES.find((p) => p.id === "ebu-r128");
    expect(source.rules[0].value).not.toBe(0);
  });

  it("returns null for an unknown built-in", () => {
    expect(duplicateAsDraft("nope")).toBeNull();
  });
});

describe("withReferenceLufs", () => {
  it("sets only the reference, leaving rules untouched", () => {
    const before = createProfileDraft();
    const after = withReferenceLufs(before, -14);
    expect(after.referenceLufs).toBe(-14);
    expect(after.rules).toEqual(before.rules);
  });

  it("accepts null as 'no line'", () => {
    expect(withReferenceLufs(createProfileDraft(), null).referenceLufs).toBeNull();
  });
});

describe("watchedMetricIds", () => {
  it("lists each metric with a filled rule once, in first-seen order", () => {
    const document = {
      rules: [
        { metricId: "integrated", op: ">", value: -14, severity: "fail" },
        { metricId: "integrated", op: "<", value: -40, severity: "fail" },
        { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
      ],
    };
    expect(watchedMetricIds(document)).toEqual(["integrated", "truePeak"]);
  });

  it("counts a metric as watched even when its only rule is unfilled", () => {
    const document = {
      rules: [
        { metricId: "lra", op: ">", severity: "fail" },
        { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
      ],
    };
    expect(watchedMetricIds(document)).toEqual(["lra", "truePeak"]);
  });
});

describe("isRuleEmpty", () => {
  it("is empty without a usable value", () => {
    expect(isRuleEmpty({ metricId: "truePeak", op: ">", severity: "fail" })).toBe(true);
    expect(isRuleEmpty({ metricId: "truePeak", op: ">", value: null, severity: "fail" })).toBe(
      true
    );
  });

  it("is filled once a finite value is set", () => {
    expect(isRuleEmpty({ metricId: "truePeak", op: ">", value: -1, severity: "fail" })).toBe(false);
  });
});

describe("selection helpers", () => {
  it("round-trips built-in and user selection ids", () => {
    expect(parseSelection(builtinSelectionId("ebu-r128"))).toEqual({
      kind: "builtin",
      id: "ebu-r128",
    });
    expect(parseSelection(userSelectionId("abc"))).toEqual({ kind: "user", id: "abc" });
    expect(parseSelection(LOUDNESS_PROFILE_OFF)).toEqual({ kind: "off", id: null });
  });

  it("resolves the active selection to a document or null", () => {
    expect(resolveActiveDocument({ active: LOUDNESS_PROFILE_OFF })).toBeNull();
    expect(resolveActiveDocument({ active: builtinSelectionId("ebu-r128") }).id).toBe("ebu-r128");
    const mine = { id: "abc", name: "Mine", kind: "user", referenceLufs: null, rules: [] };
    expect(resolveActiveDocument({ active: userSelectionId("abc"), userProfiles: [mine] })).toBe(
      mine
    );
  });
});

describe("threshold and metric guards", () => {
  it("accepts only finite numbers as usable thresholds", () => {
    expect(isUsableThreshold(-14)).toBe(true);
    expect(isUsableThreshold("")).toBe(false);
    expect(isUsableThreshold(null)).toBe(false);
    expect(isUsableThreshold(Infinity)).toBe(false);
  });

  it("knows a ruleable metric from an unknown one", () => {
    expect(isKnownMetricId("integrated")).toBe(true);
    expect(isKnownMetricId("nope")).toBe(false);
  });
});
