import { describe, expect, it } from "vitest";
import {
  BUILTIN_LOUDNESS_PROFILES,
  LOUDNESS_PROFILE_CUSTOM,
  LOUDNESS_PROFILE_OFF,
  METRIC_RULE_ROLE,
  MIN_DIALOGUE_COVERAGE_PERCENT,
  builtinSelectionId,
  createDefaultCustomDraft,
  createEmptyRule,
  duplicateAsDraft,
  isKnownMetricId,
  isRuleEmpty,
  isUsableTolerance,
  parseSelection,
  resolveActiveDocument,
  userSelectionId,
  withReferenceLufs,
} from "./loudnessProfileCatalog.js";
import { STATS_CANONICAL_ORDER } from "./statsCatalog.js";

const byId = (id) => BUILTIN_LOUDNESS_PROFILES.find((p) => p.id === id);

describe("loudnessProfileCatalog built-ins", () => {
  it("ships the v1 short list in order", () => {
    expect(BUILTIN_LOUDNESS_PROFILES.map((p) => p.id)).toEqual([
      "ebu-r128",
      "ebu-r128-live",
      "ebu-r128-s1",
      "atsc-a85",
      "streaming-14",
    ]);
  });

  it("gives every built-in a reference line, a name and preferred metrics", () => {
    for (const profile of BUILTIN_LOUDNESS_PROFILES) {
      expect(profile.kind).toBe("builtin");
      expect(typeof profile.name).toBe("string");
      expect(profile.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(profile.referenceLufs)).toBe(true);
      expect(profile.preferredMetricIds.length).toBeGreaterThan(0);
    }
  });

  it("addresses only metrics that Stats can actually show", () => {
    for (const profile of BUILTIN_LOUDNESS_PROFILES) {
      for (const metricId of Object.keys(profile.metrics)) {
        expect(isKnownMetricId(metricId), `${profile.id} -> ${metricId}`).toBe(true);
      }
      for (const metricId of profile.preferredMetricIds) {
        expect(isKnownMetricId(metricId), `${profile.id} preferred -> ${metricId}`).toBe(true);
      }
    }
  });

  it("only prefers metrics it has a rule for", () => {
    for (const profile of BUILTIN_LOUDNESS_PROFILES) {
      for (const metricId of profile.preferredMetricIds) {
        expect(profile.metrics[metricId], `${profile.id} -> ${metricId}`).toBeTruthy();
      }
    }
  });

  it("keeps every target expressible as a target + tolerance pair", () => {
    // The CLI's --target-lufs / --lufs-tolerance are meant to be derived from a profile later
    // (design doc, Roadmap). A target rule that could not round-trip through that pair would
    // strand the CLI.
    for (const profile of BUILTIN_LOUDNESS_PROFILES) {
      for (const [metricId, rule] of Object.entries(profile.metrics)) {
        if (rule.role !== "target") continue;
        expect(Number.isFinite(rule.target), `${profile.id} -> ${metricId}`).toBe(true);
        expect(Number.isFinite(rule.tolerance.minus)).toBe(true);
        expect(Number.isFinite(rule.tolerance.plus)).toBe(true);
      }
    }
  });

  it("uses the reference lines the design pins", () => {
    expect(byId("ebu-r128").referenceLufs).toBe(-23);
    expect(byId("ebu-r128-live").referenceLufs).toBe(-23);
    expect(byId("ebu-r128-s1").referenceLufs).toBe(-23);
    expect(byId("atsc-a85").referenceLufs).toBe(-24);
    expect(byId("streaming-14").referenceLufs).toBe(-14);
  });

  it("widens the Integrated tolerance for Live and marks it permanently provisional", () => {
    expect(byId("ebu-r128").metrics.integrated.tolerance).toEqual({ minus: 0.5, plus: 0.5 });
    expect(byId("ebu-r128-live").metrics.integrated.tolerance).toEqual({ minus: 1, plus: 1 });
    expect(byId("ebu-r128-live").metrics.integrated.provisional).toBe(true);
    // Programme is not provisional: only Live claims its Integrated never settles.
    expect(byId("ebu-r128").metrics.integrated.provisional).toBeUndefined();
  });

  it("caps Short-term Max at -18 for S1 and marks LRA not applicable", () => {
    expect(byId("ebu-r128-s1").metrics.shortTermMax).toMatchObject({ max: -18, severity: "fail" });
    expect(byId("ebu-r128-s1").metrics.lra.role).toBe("na");
  });

  it("anchors ATSC on dialogue with a coverage floor and a -2 true peak limit", () => {
    const atsc = byId("atsc-a85");
    expect(atsc.metrics.dialogueIntegrated).toMatchObject({
      target: -24,
      tolerance: { minus: 2, plus: 2 },
      requiresDialogueCoverage: MIN_DIALOGUE_COVERAGE_PERCENT,
    });
    expect(atsc.metrics.truePeak.max).toBe(-2);
    // Programme Integrated is shown, never judged: the profile is dialogue-anchored.
    expect(atsc.metrics.integrated.role).toBe("descriptor");
  });

  it("treats Streaming -14 as a playback reference rather than a hard gate", () => {
    const streaming = byId("streaming-14");
    expect(streaming.metrics.integrated.target).toBe(-14);
    expect(streaming.metrics.integrated.severity).toBe("warn");
    expect(streaming.metrics.truePeak).toMatchObject({ max: -1, severity: "warn" });
  });

  it("never lets a descriptor or n/a rule fail", () => {
    for (const profile of BUILTIN_LOUDNESS_PROFILES) {
      for (const rule of Object.values(profile.metrics)) {
        if (rule.role === "descriptor" || rule.role === "na") {
          expect(rule.severity).not.toBe("fail");
        }
      }
    }
  });
});

describe("createDefaultCustomDraft", () => {
  it("starts at Integrated -23 and TP -1, both watched", () => {
    const draft = createDefaultCustomDraft();
    expect(draft.kind).toBe("draft");
    expect(draft.referenceLufs).toBe(-23);
    expect(draft.preferredMetricIds).toEqual(["integrated", "truePeak"]);
    expect(draft.metrics.integrated.target).toBe(-23);
    expect(draft.metrics.truePeak.max).toBe(-1);
  });

  it("returns a fresh object each call so edits cannot leak between drafts", () => {
    const first = createDefaultCustomDraft();
    first.metrics.integrated.target = -9;
    expect(createDefaultCustomDraft().metrics.integrated.target).toBe(-23);
  });
});

describe("duplicateAsDraft", () => {
  it("copies a built-in into an editable draft that remembers its origin", () => {
    const draft = duplicateAsDraft("ebu-r128-s1", () => "generated-id");
    expect(draft).toMatchObject({
      id: "generated-id",
      kind: "draft",
      basedOn: "ebu-r128-s1",
      referenceLufs: -23,
    });
    expect(draft.name).toContain("EBU R128 S1");
    expect(draft.metrics.shortTermMax.max).toBe(-18);
  });

  it("deep-copies, so editing the draft cannot mutate the built-in", () => {
    const draft = duplicateAsDraft("ebu-r128", () => "generated-id");
    draft.metrics.integrated.target = -9;
    expect(byId("ebu-r128").metrics.integrated.target).toBe(-23);
  });

  it("returns null for an unknown built-in", () => {
    expect(duplicateAsDraft("nope", () => "generated-id")).toBe(null);
  });
});

describe("parseSelection", () => {
  it("reads each selection shape", () => {
    expect(parseSelection(LOUDNESS_PROFILE_OFF)).toEqual({ kind: "off", id: null });
    expect(parseSelection(LOUDNESS_PROFILE_CUSTOM)).toEqual({ kind: "draft", id: null });
    expect(parseSelection(builtinSelectionId("ebu-r128"))).toEqual({
      kind: "builtin",
      id: "ebu-r128",
    });
    expect(parseSelection(userSelectionId("abc"))).toEqual({ kind: "user", id: "abc" });
  });

  it("degrades unknown or malformed values to Off rather than throwing", () => {
    expect(parseSelection(undefined).kind).toBe("off");
    expect(parseSelection(null).kind).toBe("off");
    expect(parseSelection(42).kind).toBe("off");
    expect(parseSelection("garbage").kind).toBe("off");
  });
});

describe("resolveActiveDocument", () => {
  const userProfile = { id: "u1", name: "Mine", kind: "user", referenceLufs: -16, metrics: {} };
  const customDraft = createDefaultCustomDraft();

  it("returns null for Off", () => {
    expect(resolveActiveDocument({ active: LOUDNESS_PROFILE_OFF })).toBe(null);
  });

  it("resolves built-in, draft and user selections", () => {
    expect(resolveActiveDocument({ active: builtinSelectionId("atsc-a85") }).referenceLufs).toBe(
      -24
    );
    expect(resolveActiveDocument({ active: LOUDNESS_PROFILE_CUSTOM, customDraft })).toBe(
      customDraft
    );
    expect(
      resolveActiveDocument({ active: userSelectionId("u1"), userProfiles: [userProfile] })
    ).toBe(userProfile);
  });

  it("returns null when the selection points at something that is gone", () => {
    // A layout preset can outlive the user profile it referenced.
    expect(
      resolveActiveDocument({ active: userSelectionId("deleted"), userProfiles: [userProfile] })
    ).toBe(null);
    expect(resolveActiveDocument({ active: builtinSelectionId("removed") })).toBe(null);
    expect(resolveActiveDocument({ active: LOUDNESS_PROFILE_CUSTOM, customDraft: null })).toBe(
      null
    );
  });

  it("treats a missing state as Off", () => {
    expect(resolveActiveDocument(undefined)).toBe(null);
    expect(resolveActiveDocument({})).toBe(null);
  });
});

describe("withReferenceLufs", () => {
  it("carries the anchor target along with the reference", () => {
    const moved = withReferenceLufs(createDefaultCustomDraft(), -16);
    expect(moved.referenceLufs).toBe(-16);
    expect(moved.metrics.integrated.target).toBe(-16);
  });

  it("keeps the user's tolerance band", () => {
    const draft = createDefaultCustomDraft();
    draft.metrics.integrated.tolerance = { minus: 2, plus: 1 };
    expect(withReferenceLufs(draft, -16).metrics.integrated.tolerance).toEqual({
      minus: 2,
      plus: 1,
    });
  });

  it("moves a dialogue anchor rather than assuming integrated", () => {
    const moved = withReferenceLufs(
      duplicateAsDraft("atsc-a85", () => "copy"),
      -27
    );
    expect(moved.metrics.dialogueIntegrated.target).toBe(-27);
    // ATSC's program Integrated is a descriptor, so the copy does not carry it at all -- there is
    // no second target for the reference to land on by mistake.
    expect(moved.metrics.integrated).toBeUndefined();
  });

  it("leaves limits alone", () => {
    const moved = withReferenceLufs(createDefaultCustomDraft(), -16);
    expect(moved.metrics.truePeak.max).toBe(-1);
  });

  it("still moves the reference when the profile targets nothing", () => {
    const moved = withReferenceLufs(
      {
        id: "x",
        name: "x",
        kind: "draft",
        referenceLufs: -23,
        metrics: {},
        preferredMetricIds: [],
      },
      -16
    );
    expect(moved.referenceLufs).toBe(-16);
  });
});

describe("isRuleEmpty", () => {
  it("calls a target rule with no target empty", () => {
    expect(isRuleEmpty({ role: "target", severity: "fail" })).toBe(true);
  });

  it("calls a target rule with a target filled", () => {
    expect(isRuleEmpty({ role: "target", target: -23, tolerance: { minus: 1, plus: 1 } })).toBe(
      false
    );
  });

  it("calls a target with no band empty, whatever its target", () => {
    // A zero-width band is permanently warn under the near-boundary margin, so a half-typed
    // target must be inert rather than default-banded.
    expect(isRuleEmpty({ role: "target", target: -23 })).toBe(true);
  });

  it("calls a limit rule with neither bound empty", () => {
    expect(isRuleEmpty({ role: "limit", severity: "fail" })).toBe(true);
  });

  it("accepts either bound as filled", () => {
    expect(isRuleEmpty({ role: "limit", max: -1 })).toBe(false);
    expect(isRuleEmpty({ role: "limit", min: 0 })).toBe(false);
  });

  // descriptor and na are deliberate annotations, not half-finished rules.
  it("does not call descriptor or na empty", () => {
    expect(isRuleEmpty({ role: "descriptor" })).toBe(false);
    expect(isRuleEmpty({ role: "na" })).toBe(false);
  });

  it("calls a band with no target empty", () => {
    expect(isRuleEmpty({ role: "target", tolerance: { minus: 1, plus: 1 } })).toBe(true);
  });

  it("calls a missing rule empty", () => {
    expect(isRuleEmpty(undefined)).toBe(true);
  });
});

describe("isUsableTolerance", () => {
  it("needs both halves", () => {
    expect(isUsableTolerance({ minus: 1, plus: 1 })).toBe(true);
    expect(isUsableTolerance({ minus: 1 })).toBe(false);
    expect(isUsableTolerance({ plus: 1 })).toBe(false);
    expect(isUsableTolerance(undefined)).toBe(false);
  });

  it("rejects a negative half", () => {
    expect(isUsableTolerance({ minus: -1, plus: 1 })).toBe(false);
    expect(isUsableTolerance({ minus: 1, plus: -1 })).toBe(false);
  });

  it("accepts a zero band, which is a band the user chose", () => {
    expect(isUsableTolerance({ minus: 0, plus: 0 })).toBe(true);
  });

  it("rejects the shapes an untouched form field produces", () => {
    // The live preview feeds unnormalized drafts straight to evaluation, so "" and null arrive
    // here directly. Number() reads both as a perfectly good 0.
    expect(isUsableTolerance({ minus: "", plus: "" })).toBe(false);
    expect(isUsableTolerance({ minus: 1, plus: "" })).toBe(false);
    expect(isUsableTolerance({ minus: null, plus: null })).toBe(false);
    expect(isUsableTolerance({ minus: "1", plus: "1" })).toBe(false);
  });
});

describe("a half-typed band", () => {
  it("reads as empty rather than as a band with a NaN edge", () => {
    // minus typed, plus not yet. Truthiness would call this filled, and evaluation would then
    // compare against target + undefined -- NaN, which every comparison reads as false.
    expect(isRuleEmpty({ role: "target", target: -23, tolerance: { minus: 1 } })).toBe(true);
  });
});

describe("anchorMetricId via withReferenceLufs", () => {
  it("skips an empty target rule when moving the reference", () => {
    const document = {
      id: "u1",
      name: "Mine",
      kind: "user",
      referenceLufs: -24,
      metrics: {
        integrated: { role: "target", severity: "fail" },
        dialogueIntegrated: {
          role: "target",
          target: -24,
          tolerance: { minus: 2, plus: 2 },
          severity: "fail",
        },
      },
      preferredMetricIds: ["integrated", "dialogueIntegrated"],
    };

    const moved = withReferenceLufs(document, -16);
    // The real target rule follows the line; the unfilled one is not the anchor.
    expect(moved.metrics.dialogueIntegrated.target).toBe(-16);
    expect(moved.metrics.integrated.target).toBeUndefined();
  });
});

describe("METRIC_RULE_ROLE", () => {
  it("shapes every metric Stats can show", () => {
    // A metric the editor can add but cannot shape would be unreachable.
    for (const id of STATS_CANONICAL_ORDER) {
      expect(["target", "limit"], id).toContain(METRIC_RULE_ROLE[id]);
    }
  });

  it("shapes nothing Stats cannot show", () => {
    for (const id of Object.keys(METRIC_RULE_ROLE)) {
      expect(STATS_CANONICAL_ORDER, id).toContain(id);
    }
  });

  it("assigns the role each metric's rule actually needs", () => {
    // Set equality alone would let a swapped role through, and a target on LRA would ask the
    // user for a band around a range statistic.
    expect(METRIC_RULE_ROLE).toEqual({
      momentary: "target",
      shortTerm: "target",
      integrated: "target",
      dialogueIntegrated: "target",
      momentaryMax: "limit",
      shortTermMax: "limit",
      truePeak: "limit",
      dialogueCoverage: "limit",
      correlation: "limit",
      psr: "limit",
      plr: "limit",
      lra: "limit",
      dialogueRange: "limit",
      dialogueOffset: "limit",
      sideToMid: "limit",
    });
  });

  it("builds an empty rule in the metric's own shape", () => {
    expect(createEmptyRule("truePeak")).toEqual({ role: "limit", severity: "fail" });
    expect(createEmptyRule("integrated")).toEqual({ role: "target", severity: "fail" });
  });

  it("builds nothing for an unknown metric", () => {
    expect(createEmptyRule("nonsense")).toBe(null);
  });

  it("builds rules that read as empty", () => {
    for (const id of STATS_CANONICAL_ORDER) {
      expect(isRuleEmpty(createEmptyRule(id)), id).toBe(true);
    }
  });
});

describe("duplicateAsDraft drops annotations", () => {
  it("drops descriptor rules the editor cannot show", () => {
    const copy = duplicateAsDraft("ebu-r128", () => "copy");
    expect(copy.metrics.integrated).toBeTruthy();
    expect(copy.metrics.truePeak).toBeTruthy();
    // lra and shortTermMax are descriptors on this built-in: authoring notes saying "we do not
    // judge this", which a user profile says by not mentioning the metric at all.
    expect(copy.metrics.lra).toBeUndefined();
    expect(copy.metrics.shortTermMax).toBeUndefined();
  });

  it("drops na rules", () => {
    const copy = duplicateAsDraft("ebu-r128-s1", () => "copy");
    expect(copy.metrics.lra).toBeUndefined();
    expect(copy.metrics.shortTermMax).toBeTruthy();
  });

  it("keeps preferred ids in step with the rules that survived", () => {
    const copy = duplicateAsDraft("atsc-a85", () => "copy");
    // dialogueCoverage is preferred on ATSC but only a descriptor, so it goes with the rule.
    expect(copy.preferredMetricIds).toEqual(["dialogueIntegrated", "truePeak"]);
  });

  it("still records what it was copied from", () => {
    const copy = duplicateAsDraft("ebu-r128", () => "copy");
    expect(copy.basedOn).toBe("ebu-r128");
    expect(copy.kind).toBe("draft");
    expect(copy.name).toBe("EBU R128 (copy)");
  });
});
