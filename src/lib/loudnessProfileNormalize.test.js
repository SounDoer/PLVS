import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOUDNESS_PROFILES,
  normalizeLoudnessProfiles,
  normalizeRuleDocument,
} from "./loudnessProfileNormalize.js";
import {
  LOUDNESS_PROFILE_OFF,
  builtinSelectionId,
  createProfileDraft,
  userSelectionId,
} from "./loudnessProfileCatalog.js";

const userProfile = () => ({
  id: "u1",
  name: "Mine",
  kind: "user",
  referenceLufs: -16,
  metrics: { integrated: { role: "target", target: -16, tolerance: { minus: 1, plus: 1 } } },
  preferredMetricIds: ["integrated"],
});

describe("normalizeLoudnessProfiles cold start", () => {
  it("defaults to Off with an empty library", () => {
    expect(normalizeLoudnessProfiles(undefined)).toEqual(DEFAULT_LOUDNESS_PROFILES);
    expect(normalizeLoudnessProfiles({})).toEqual(DEFAULT_LOUDNESS_PROFILES);
  });

  it("rejects non-object blobs rather than throwing", () => {
    for (const raw of [null, 42, "off", []]) {
      expect(normalizeLoudnessProfiles(raw).active).toBe(LOUDNESS_PROFILE_OFF);
    }
  });
});

describe("normalizeLoudnessProfiles active selection", () => {
  it("keeps a known built-in", () => {
    expect(normalizeLoudnessProfiles({ active: builtinSelectionId("atsc-a85") }).active).toBe(
      builtinSelectionId("atsc-a85")
    );
  });

  it("falls back to Off for a built-in this build does not have", () => {
    expect(
      normalizeLoudnessProfiles({ active: builtinSelectionId("from-the-future") }).active
    ).toBe(LOUDNESS_PROFILE_OFF);
  });

  it("falls back to Off for a user profile that is gone", () => {
    expect(
      normalizeLoudnessProfiles({ active: userSelectionId("deleted"), userProfiles: [] }).active
    ).toBe(LOUDNESS_PROFILE_OFF);
  });

  it("keeps a user selection whose profile is still in the library", () => {
    const state = normalizeLoudnessProfiles({
      active: userSelectionId("u1"),
      userProfiles: [userProfile()],
    });
    expect(state.active).toBe(userSelectionId("u1"));
  });
});

describe("the custom slot is gone", () => {
  it("reads a persisted unsaved-custom selection as Off", () => {
    const state = normalizeLoudnessProfiles({
      active: "unsaved-custom",
      customDraft: { id: "custom", name: "Custom", metrics: {}, preferredMetricIds: [] },
    });
    expect(state.active).toBe(LOUDNESS_PROFILE_OFF);
  });

  it("does not carry a customDraft forward", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      customDraft: { id: "custom", name: "Custom", metrics: {}, preferredMetricIds: [] },
    });
    expect(state.customDraft).toBeUndefined();
  });
});

describe("normalizeLoudnessProfiles user library", () => {
  it("drops entries that cannot be repaired", () => {
    const state = normalizeLoudnessProfiles({
      userProfiles: [userProfile(), null, 42, { name: "no id" }],
    });
    expect(state.userProfiles.map((p) => p.id)).toEqual(["u1"]);
  });

  it("drops duplicate ids, keeping the first", () => {
    const state = normalizeLoudnessProfiles({
      userProfiles: [userProfile(), { ...userProfile(), name: "Later" }],
    });
    expect(state.userProfiles).toHaveLength(1);
    expect(state.userProfiles[0].name).toBe("Mine");
  });
});

describe("normalizeRuleDocument", () => {
  it("requires an id", () => {
    expect(normalizeRuleDocument({ name: "x" })).toBe(null);
    expect(normalizeRuleDocument({ id: "" })).toBe(null);
  });

  it("names an unnamed document rather than dropping it", () => {
    expect(normalizeRuleDocument({ id: "u1" }).name).toBe("Untitled");
  });

  it("accepts a null reference, and nulls one outside the usable window", () => {
    expect(normalizeRuleDocument({ id: "u1", referenceLufs: null }).referenceLufs).toBe(null);
    expect(normalizeRuleDocument({ id: "u1", referenceLufs: -23 }).referenceLufs).toBe(-23);
    expect(normalizeRuleDocument({ id: "u1", referenceLufs: 12 }).referenceLufs).toBe(null);
    expect(normalizeRuleDocument({ id: "u1", referenceLufs: "loud" }).referenceLufs).toBe(null);
  });

  it("drops rules addressing metrics this build cannot show", () => {
    const document = normalizeRuleDocument({
      id: "u1",
      metrics: {
        integrated: { role: "target", target: -23, tolerance: { minus: 1, plus: 1 } },
        somethingNew: { role: "limit", max: -1 },
      },
    });
    expect(Object.keys(document.metrics)).toEqual(["integrated"]);
  });

  it("keeps a target with no usable band, but does not invent one", () => {
    const document = normalizeRuleDocument({
      id: "u1",
      metrics: {
        integrated: { role: "target", target: -23 },
        truePeak: { role: "target", target: -1, tolerance: { minus: -1, plus: 1 } },
      },
    });
    // The rule survives so the editor still shows the row; with no band, nothing judges it.
    expect(document.metrics.integrated).toEqual({
      role: "target",
      severity: "warn",
      target: -23,
    });
    // An invalid band degrades to absent rather than to the harshest possible band.
    expect(document.metrics.truePeak).toEqual({
      role: "target",
      severity: "warn",
      target: -1,
    });
  });

  it("keeps a limit rule with neither max nor min", () => {
    const document = normalizeRuleDocument({
      id: "u1",
      metrics: { truePeak: { role: "limit" } },
    });
    // Empty limit rules survive normalization until the user fills in bounds.
    expect(document.metrics).toEqual({
      truePeak: { role: "limit", severity: "warn" },
    });
  });

  it("drops rules with an unknown role", () => {
    const document = normalizeRuleDocument({
      id: "u1",
      metrics: { truePeak: { role: "banish", max: -1 } },
    });
    expect(document.metrics).toEqual({});
  });

  it("treats any severity other than fail as a warning", () => {
    const document = normalizeRuleDocument({
      id: "u1",
      metrics: {
        truePeak: { role: "limit", max: -1, severity: "catastrophe" },
        integrated: { role: "limit", max: -1, severity: "fail" },
      },
    });
    expect(document.metrics.truePeak.severity).toBe("warn");
    expect(document.metrics.integrated.severity).toBe("fail");
  });

  it("keeps preferred ids only when a rule survived for them", () => {
    const document = normalizeRuleDocument({
      id: "u1",
      metrics: { truePeak: { role: "limit", max: -1 } },
      preferredMetricIds: ["truePeak", "integrated", "somethingNew"],
    });
    expect(document.preferredMetricIds).toEqual(["truePeak"]);
  });

  it("de-duplicates preferred ids", () => {
    const document = normalizeRuleDocument({
      id: "u1",
      metrics: { truePeak: { role: "limit", max: -1 } },
      preferredMetricIds: ["truePeak", "truePeak"],
    });
    expect(document.preferredMetricIds).toEqual(["truePeak"]);
  });

  it("carries provisional and the dialogue coverage floor through", () => {
    const document = normalizeRuleDocument({
      id: "u1",
      metrics: {
        integrated: {
          role: "target",
          target: -23,
          tolerance: { minus: 1, plus: 1 },
          provisional: true,
        },
        dialogueIntegrated: {
          role: "target",
          target: -24,
          tolerance: { minus: 2, plus: 2 },
          requiresDialogueCoverage: 15,
        },
      },
    });
    expect(document.metrics.integrated.provisional).toBe(true);
    expect(document.metrics.dialogueIntegrated.requiresDialogueCoverage).toBe(15);
  });

  it("round-trips the New profile starter unchanged", () => {
    const draft = createProfileDraft();
    // The starter is unnamed, and a blank name normalizes to "Untitled" -- everything else has to
    // survive as written.
    expect(normalizeRuleDocument(draft, { kind: "draft" })).toEqual({ ...draft, name: "Untitled" });
  });
});

describe("the last two coercion sites", () => {
  const document = (raw) =>
    normalizeLoudnessProfiles({
      active: "off",
      userProfiles: [{ id: "u1", name: "Mine", ...raw }],
    }).userProfiles[0];

  it("does not read a blank reference as a line at 0 LUFS", () => {
    // Number("") is 0, which sits inside the -70..0 window.
    for (const raw of ["", "  ", true]) {
      expect(document({ referenceLufs: raw, metrics: {} }).referenceLufs, String(raw)).toBe(null);
    }
  });

  it("still accepts a real reference, including zero", () => {
    expect(document({ referenceLufs: 0, metrics: {} }).referenceLufs).toBe(0);
    expect(document({ referenceLufs: -23, metrics: {} }).referenceLufs).toBe(-23);
  });

  it("does not read a blank dialogue-coverage floor as never inconclusive", () => {
    // A floor of 0 lets a dialogue rule conclude on almost no dialogue -- the opposite of what
    // an absent threshold should mean.
    const metrics = {
      dialogueIntegrated: {
        role: "target",
        target: -24,
        tolerance: { minus: 2, plus: 2 },
        requiresDialogueCoverage: null,
      },
    };
    expect(
      document({ metrics, preferredMetricIds: ["dialogueIntegrated"] }).metrics.dialogueIntegrated
        .requiresDialogueCoverage
    ).toBeUndefined();
  });

  it("keeps a real coverage floor", () => {
    const metrics = {
      dialogueIntegrated: {
        role: "target",
        target: -24,
        tolerance: { minus: 2, plus: 2 },
        requiresDialogueCoverage: 15,
      },
    };
    expect(
      document({ metrics, preferredMetricIds: ["dialogueIntegrated"] }).metrics.dialogueIntegrated
        .requiresDialogueCoverage
    ).toBe(15);
  });
});

describe("empty rules", () => {
  it("keeps a target rule the user has not filled in", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      userProfiles: [
        {
          id: "u1",
          name: "Mine",
          metrics: { integrated: { role: "target", severity: "fail" } },
          preferredMetricIds: ["integrated"],
        },
      ],
    });
    expect(state.userProfiles[0].metrics.integrated).toEqual({
      role: "target",
      severity: "fail",
    });
    // Preferring it is what keeps the row on screen; the row is the thing being filled in.
    expect(state.userProfiles[0].preferredMetricIds).toEqual(["integrated"]);
  });

  it("keeps a limit rule with neither bound", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      userProfiles: [
        {
          id: "u1",
          name: "Mine",
          metrics: { correlation: { role: "limit", severity: "warn" } },
          preferredMetricIds: ["correlation"],
        },
      ],
    });
    expect(state.userProfiles[0].metrics.correlation).toEqual({
      role: "limit",
      severity: "warn",
    });
  });

  it("leaves a target unfilled when its band is missing or corrupt", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      userProfiles: [
        {
          id: "u1",
          name: "Mine",
          metrics: {
            integrated: { role: "target", target: -23 },
            shortTerm: { role: "target", target: -20, tolerance: { minus: -1, plus: 1 } },
          },
          preferredMetricIds: ["integrated", "shortTerm"],
        },
      ],
    });
    const { metrics } = state.userProfiles[0];
    // Kept, so the editor still shows the row -- but with no band, so nothing judges it.
    expect(metrics.integrated).toEqual({ role: "target", severity: "warn", target: -23 });
    expect(metrics.shortTerm.tolerance).toBeUndefined();
  });

  it("drops a target, max or min that is not a number", () => {
    // Same strictness `isUsableTolerance` already applies to the band. `Number(null)` and
    // `Number("")` are both a perfectly good 0, and a 0 nobody typed is an invented threshold.
    for (const blank of [null, "", "  ", undefined, "-23", true, {}]) {
      const target = normalizeRuleDocument({
        id: "u1",
        metrics: {
          integrated: { role: "target", target: blank, tolerance: { minus: 1, plus: 1 } },
        },
      });
      expect(target.metrics.integrated.target).toBeUndefined();

      const limit = normalizeRuleDocument({
        id: "u1",
        metrics: { truePeak: { role: "limit", max: blank, min: blank } },
      });
      expect(limit.metrics.truePeak.max).toBeUndefined();
      expect(limit.metrics.truePeak.min).toBeUndefined();
    }
  });

  it("keeps a threshold the user really typed, including zero", () => {
    const document = normalizeRuleDocument({
      id: "u1",
      metrics: {
        integrated: { role: "target", target: 0, tolerance: { minus: 1, plus: 1 } },
        truePeak: { role: "limit", max: 0, min: -6 },
      },
    });
    expect(document.metrics.integrated.target).toBe(0);
    expect(document.metrics.truePeak.max).toBe(0);
    expect(document.metrics.truePeak.min).toBe(-6);
  });

  it("still rejects an unknown role", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      userProfiles: [{ id: "u1", name: "Mine", metrics: { integrated: { role: "nonsense" } } }],
    });
    expect(state.userProfiles[0].metrics).toEqual({});
  });
});
