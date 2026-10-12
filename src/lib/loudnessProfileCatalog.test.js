import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOUDNESS_PROFILE,
  LOUDNESS_PROFILE_OFF,
  RULEABLE_METRIC_IDS,
  createEmptyRule,
  createProfileDraft,
  createStarterProfile,
  isKnownMetricId,
  isRuleEmpty,
  isUsableThreshold,
  parseSelection,
  profileSelectionId,
  resolveActiveDocument,
  watchedMetricIds,
  withReferenceLufs,
} from "./loudnessProfileCatalog.js";
import { STATS_CANONICAL_ORDER, STATS_META } from "./statsCatalog.js";

describe("createStarterProfile", () => {
  const canonical = {
    id: "default",
    name: "Default",
    referenceLufs: -23,
    rules: [
      { metricId: "momentary", op: ">", value: -6, severity: "warn" },
      { metricId: "shortTerm", op: ">", value: -12, severity: "warn" },
      { metricId: "integrated", op: ">", value: -16, severity: "warn" },
      { metricId: "integrated", op: "<", value: -30, severity: "warn" },
      { metricId: "lra", op: ">", value: 18, severity: "warn" },
      { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
    ],
  };

  it("keeps one frozen canonical built-in definition", () => {
    expect(DEFAULT_LOUDNESS_PROFILE).toEqual(canonical);
    expect(Object.isFrozen(DEFAULT_LOUDNESS_PROFILE)).toBe(true);
    expect(DEFAULT_LOUDNESS_PROFILE.rules.every(Object.isFrozen)).toBe(true);
  });

  it("creates an editable starter copy with an injected local id", () => {
    const starter = createStarterProfile(() => "starter-id");
    expect(starter).toEqual({
      ...canonical,
      id: "starter-id",
    });
    starter.rules[0].value = -5;
    expect(DEFAULT_LOUDNESS_PROFILE.rules[0].value).toBe(-6);
  });
});

describe("RULEABLE_METRIC_IDS", () => {
  it("addresses only metrics Stats can show", () => {
    for (const id of RULEABLE_METRIC_IDS) expect(STATS_META[id]).toBeTruthy();
  });

  // The dropdown reads in the Stats panel's default order, and a new metric inherits its place from
  // STATS_CANONICAL_ORDER. Nothing is excluded today, so the two are identical; if a metric ever
  // becomes non-ruleable this locks the survivors to still be in canonical order.
  it("keeps the Stats panel's default order", () => {
    const expected = STATS_CANONICAL_ORDER.filter((id) => RULEABLE_METRIC_IDS.includes(id));
    expect(RULEABLE_METRIC_IDS).toEqual(expected);
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
  it("creates an empty untitled draft", () => {
    expect(createProfileDraft()).toEqual({
      id: "draft",
      name: "Untitled",
      referenceLufs: null,
      rules: [],
    });
  });

  it("returns an independent object each call", () => {
    const a = createProfileDraft();
    const b = createProfileDraft();
    a.name = "Changed";
    a.rules.push({ metricId: "truePeak", op: ">", value: -1, severity: "fail" });
    expect(b).toEqual({
      id: "draft",
      name: "Untitled",
      referenceLufs: null,
      rules: [],
    });
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
  it("round-trips a generic profile selection id", () => {
    expect(profileSelectionId("abc")).toBe("profile:abc");
    expect(parseSelection(profileSelectionId("abc"))).toEqual({ kind: "profile", id: "abc" });
  });

  it("treats Off, empty profile ids, legacy prefixes and unknown values as Off", () => {
    expect(parseSelection(LOUDNESS_PROFILE_OFF)).toEqual({ kind: "off", id: null });
    expect(parseSelection("profile:")).toEqual({ kind: "off", id: null });
    expect(parseSelection("builtin:ebu-r128")).toEqual({ kind: "off", id: null });
    expect(parseSelection("user:abc")).toEqual({ kind: "off", id: null });
    expect(parseSelection("other")).toEqual({ kind: "off", id: null });
  });

  it("resolves only flat profile selections from state.profiles", () => {
    const mine = { id: "abc", name: "Mine", referenceLufs: null, rules: [] };
    expect(resolveActiveDocument({ active: profileSelectionId("abc"), profiles: [mine] })).toBe(
      mine
    );
    expect(resolveActiveDocument({ active: LOUDNESS_PROFILE_OFF })).toBeNull();
    expect(
      resolveActiveDocument({ active: profileSelectionId("missing"), profiles: [mine] })
    ).toBeNull();
    expect(resolveActiveDocument({ active: "user:abc", profiles: [mine] })).toBeNull();
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
