import { describe, expect, it } from "vitest";
import { loudnessProfileEvaluate } from "./loudnessProfileEvaluate.js";
import { BUILTIN_LOUDNESS_PROFILES, createDefaultCustomDraft } from "./loudnessProfileCatalog.js";

const byId = (id) => BUILTIN_LOUDNESS_PROFILES.find((p) => p.id === id);

function sample({ values = {}, integratedReady = true, dialogueCoverage = 100 } = {}) {
  return { values, integratedReady, dialogueCoverage };
}

describe("loudnessProfileEvaluate", () => {
  it("judges nothing when the profile is Off", () => {
    expect(loudnessProfileEvaluate(null, sample({ values: { integrated: -3 } }))).toEqual({});
  });

  it("leaves metrics the profile does not prefer unwatched, even with a rule", () => {
    // EBU Programme carries an LRA descriptor and a Short-term Max rule but prefers neither.
    const statuses = loudnessProfileEvaluate(
      byId("ebu-r128"),
      sample({ values: { integrated: -23, truePeak: -6, lra: 40, shortTermMax: 0 } })
    );
    expect(statuses.lra).toBe("unwatched");
    expect(statuses.shortTermMax).toBe("unwatched");
    expect(statuses.integrated).toBe("ok");
  });

  it("passes an in-range Integrated and fails one outside the band", () => {
    const profile = byId("ebu-r128");
    expect(
      loudnessProfileEvaluate(profile, sample({ values: { integrated: -23 } })).integrated
    ).toBe("ok");
    expect(
      loudnessProfileEvaluate(profile, sample({ values: { integrated: -20 } })).integrated
    ).toBe("fail");
  });

  it("warns just inside a band edge before it actually breaches", () => {
    // Band is -23 +/- 0.5, so -22.6 still passes but is close enough to be worth a warning.
    expect(
      loudnessProfileEvaluate(byId("ebu-r128"), sample({ values: { integrated: -22.6 } }))
        .integrated
    ).toBe("warn");
  });

  it("holds Integrated pending until the engine reports it ready", () => {
    const statuses = loudnessProfileEvaluate(
      byId("ebu-r128"),
      sample({ values: { integrated: -23 }, integratedReady: false })
    );
    expect(statuses.integrated).toBe("pending");
  });

  it("holds a metric pending while its value is absent or infinite", () => {
    const profile = byId("ebu-r128");
    expect(loudnessProfileEvaluate(profile, sample({ values: {} })).truePeak).toBe("pending");
    expect(
      loudnessProfileEvaluate(profile, sample({ values: { truePeak: -Infinity } })).truePeak
    ).toBe("pending");
  });

  it("fails a true peak over the limit and passes one under it", () => {
    const profile = byId("ebu-r128");
    expect(loudnessProfileEvaluate(profile, sample({ values: { truePeak: -0.5 } })).truePeak).toBe(
      "fail"
    );
    expect(loudnessProfileEvaluate(profile, sample({ values: { truePeak: -6 } })).truePeak).toBe(
      "ok"
    );
  });

  describe("EBU R128 S1", () => {
    it("fails a Short-term Max above -18", () => {
      const statuses = loudnessProfileEvaluate(
        byId("ebu-r128-s1"),
        sample({ values: { shortTermMax: -15, integrated: -23, truePeak: -6 } })
      );
      expect(statuses.shortTermMax).toBe("fail");
    });

    it("reports LRA as not applicable rather than judging it", () => {
      const statuses = loudnessProfileEvaluate(
        byId("ebu-r128-s1"),
        sample({ values: { lra: 40 } })
      );
      expect(statuses.lra).toBe("na");
    });
  });

  describe("EBU R128 Live", () => {
    const live = byId("ebu-r128-live");

    it("still passes an in-range Integrated rather than warning forever", () => {
      // Provisional must not mean permanently yellow -- Live's Integrated never settles, so a
      // literal "unsettled => warn" reading would keep the row coloured for the whole session.
      expect(
        loudnessProfileEvaluate(live, sample({ values: { integrated: -23 } })).integrated
      ).toBe("ok");
    });

    it("caps a breach at warn instead of failing on a realtime number", () => {
      expect(
        loudnessProfileEvaluate(live, sample({ values: { integrated: -18 } })).integrated
      ).toBe("warn");
    });

    it("is more forgiving than Programme at the same Integrated value", () => {
      // Live's +/-1.0 band still contains -22.2 (so: near-edge warning), where Programme's
      // +/-0.5 band has already been breached.
      const values = { integrated: -22.2 };
      expect(loudnessProfileEvaluate(live, sample({ values })).integrated).toBe("warn");
      expect(loudnessProfileEvaluate(byId("ebu-r128"), sample({ values })).integrated).toBe("fail");
    });
  });

  describe("ATSC A/85", () => {
    const atsc = byId("atsc-a85");

    it("cannot conclude while dialogue coverage is below the floor", () => {
      const statuses = loudnessProfileEvaluate(
        atsc,
        sample({ values: { dialogueIntegrated: -24 }, dialogueCoverage: 5 })
      );
      expect(statuses.dialogueIntegrated).toBe("inconclusive");
    });

    it("cannot conclude while the dialogue path is not running at all", () => {
      const statuses = loudnessProfileEvaluate(
        atsc,
        sample({ values: { dialogueIntegrated: -24 }, dialogueCoverage: null })
      );
      expect(statuses.dialogueIntegrated).toBe("inconclusive");
    });

    it("judges dialogue loudness once coverage clears the floor", () => {
      const statuses = loudnessProfileEvaluate(
        atsc,
        sample({ values: { dialogueIntegrated: -24 }, dialogueCoverage: 40 })
      );
      expect(statuses.dialogueIntegrated).toBe("ok");
    });

    it("shows programme Integrated without judging it", () => {
      const statuses = loudnessProfileEvaluate(
        atsc,
        sample({ values: { integrated: -3 }, dialogueCoverage: 40 })
      );
      expect(statuses.integrated).toBe("unwatched");
    });

    it("fails a true peak over -2", () => {
      const statuses = loudnessProfileEvaluate(
        atsc,
        sample({ values: { truePeak: -1.5 }, dialogueCoverage: 40 })
      );
      expect(statuses.truePeak).toBe("fail");
    });
  });

  describe("Streaming -14", () => {
    it("warns rather than fails, since it is a playback reference not an upload gate", () => {
      const statuses = loudnessProfileEvaluate(
        byId("streaming-14"),
        sample({ values: { integrated: -9, truePeak: 0 } })
      );
      expect(statuses.integrated).toBe("warn");
      expect(statuses.truePeak).toBe("warn");
    });
  });

  it("evaluates the default custom draft like any other document", () => {
    const statuses = loudnessProfileEvaluate(
      createDefaultCustomDraft(),
      sample({ values: { integrated: -23, truePeak: -6 } })
    );
    expect(statuses).toEqual({ integrated: "ok", truePeak: "ok" });
  });

  it("survives a missing sample without throwing", () => {
    const statuses = loudnessProfileEvaluate(byId("ebu-r128"), undefined);
    expect(statuses.integrated).toBe("pending");
  });
});

describe("empty rules", () => {
  const withRule = (metricId, rule) => ({
    id: "u1",
    name: "Mine",
    kind: "user",
    referenceLufs: null,
    metrics: { [metricId]: rule },
    preferredMetricIds: [metricId],
  });

  it("does not crash on a target rule with no band", () => {
    // This threw TypeError before the guard: evaluateTarget reads rule.tolerance.minus.
    expect(() =>
      loudnessProfileEvaluate(withRule("integrated", { role: "target", target: -23 }), {
        values: { integrated: -30 },
        integratedReady: true,
        dialogueCoverage: null,
      })
    ).not.toThrow();
  });

  it("does not judge a target rule with no target", () => {
    const statuses = loudnessProfileEvaluate(
      withRule("integrated", { role: "target", severity: "fail" }),
      { values: { integrated: -30 }, integratedReady: true, dialogueCoverage: null }
    );
    expect(statuses.integrated).toBe("unwatched");
  });

  it("does not report an empty integrated rule as pending", () => {
    // Pending is a claim about the engine, not about the profile. An unfilled rule has no
    // opinion to be pending on.
    const statuses = loudnessProfileEvaluate(
      withRule("integrated", { role: "target", severity: "fail" }),
      { values: {}, integratedReady: false, dialogueCoverage: null }
    );
    expect(statuses.integrated).toBe("unwatched");
  });

  it("does not judge a limit rule with neither bound", () => {
    // Previously this returned "ok" -- an unfilled rule reporting a pass.
    const statuses = loudnessProfileEvaluate(
      withRule("correlation", { role: "limit", severity: "warn" }),
      { values: { correlation: -1 }, integratedReady: true, dialogueCoverage: null }
    );
    expect(statuses.correlation).toBe("unwatched");
  });

  it("judges as soon as one bound is filled", () => {
    const statuses = loudnessProfileEvaluate(
      withRule("correlation", { role: "limit", min: 0, severity: "fail" }),
      { values: { correlation: -1 }, integratedReady: true, dialogueCoverage: null }
    );
    expect(statuses.correlation).toBe("fail");
  });

  it("still judges a fully filled target", () => {
    const statuses = loudnessProfileEvaluate(
      withRule("integrated", {
        role: "target",
        target: -23,
        tolerance: { minus: 1, plus: 1 },
        severity: "fail",
      }),
      { values: { integrated: -30 }, integratedReady: true, dialogueCoverage: null }
    );
    expect(statuses.integrated).toBe("fail");
  });
});
