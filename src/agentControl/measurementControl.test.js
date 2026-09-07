import { describe, expect, it } from "vitest";
import {
  buildMeasurementDescription,
  buildMeasurementInspection,
  MEASUREMENT_AVAILABILITY_REASONS,
  MEASUREMENT_FRESHNESS_THRESHOLD_MS,
} from "./measurementControl.js";

function record(overrides = {}) {
  return {
    sequence: 9,
    elapsedMs: 1234,
    receivedAtMs: 10_000,
    loudnessLayout: "stereo",
    loudnessLayoutKnown: true,
    dialogueActive: true,
    ...overrides,
    audio: {
      peakDb: [-5.25, -6.5],
      rmsDb: [-18.25, -19.5],
      truePeakL: -4.75,
      truePeakR: -5.25,
      tpMax: -0.75,
      momentary: -18.25,
      shortTerm: -19.125,
      integrated: -20.375,
      mMax: -14.25,
      stMax: -16.125,
      lra: 5.75,
      correlation: 0.875,
      sideToMidDb: -12.25,
      vectorscopePairX: 0,
      vectorscopePairY: 1,
      dialogueIntegrated: -21.125,
      dialogueLra: 3.25,
      dialoguePercent: 61,
      dialogueActiveNow: false,
      ...overrides.audio,
    },
  };
}

function inspect(overrides = {}) {
  return buildMeasurementInspection({
    revision: 4,
    observedAtMs: 10_018,
    liveState: "running",
    sessionGeneration: 2,
    record: record(),
    channelLabels: ["L", "R"],
    vectorscopeRequest: { x: 0, y: 1 },
    dialogueActive: true,
    ...overrides,
  });
}

describe("Measurement Control", () => {
  it("publishes a fixed ordered LIVE catalogue", () => {
    const result = buildMeasurementDescription(12);
    expect(result).toMatchObject({
      revision: 12,
      schemaVersion: 1,
      source: "live",
      freshnessThresholdMs: MEASUREMENT_FRESHNESS_THRESHOLD_MS,
      availabilityReasons: [...MEASUREMENT_AVAILABILITY_REASONS],
    });
    expect(result.metrics[0].path).toBe("levels.channels[].peakDbfs");
    expect(result.metrics.at(-1)).toEqual({
      path: "profile.overall",
      label: "Loudness Profile Overall",
      unit: "status",
      basis: "evaluation",
    });
  });

  it("formats one fresh coherent sample at raw precision", () => {
    const result = inspect();
    expect(result.sample).toEqual({
      sequence: 9,
      elapsedMs: 1234,
      receivedAt: "1970-01-01T00:00:10.000Z",
      ageMs: 18,
      freshness: "fresh",
    });
    expect(result.levels.channels[0]).toEqual({
      index: 0,
      label: "L",
      peakDbfs: -5.25,
      rmsDbfs: -18.25,
    });
    expect(result.loudness.psrDb).toBe(18.375);
    expect(result.loudness.plrDb).toBe(19.625);
    expect(result.stereo).toEqual({
      pair: { x: 0, y: 1, labels: ["L", "R"] },
      correlation: 0.875,
      sideToMidDb: -12.25,
    });
    expect(result.dialogue).toEqual({
      active: true,
      activeNow: false,
      coveragePercent: 61,
      integratedLufs: -21.125,
      rangeLu: 3.25,
      offsetLu: -0.75,
    });
    expect(result.unavailable).toEqual({});
  });

  it.each([
    ["running", 12_001, "stale"],
    ["stopped", 10_018, "stale"],
    ["error", 10_018, "stale"],
  ])("marks retained %s samples as %s", (liveState, observedAtMs, freshness) => {
    expect(inspect({ liveState, observedAtMs }).sample.freshness).toBe(freshness);
  });

  it("returns an explicit successful no-sample result", () => {
    const result = inspect({ record: null, dialogueActive: false, vectorscopeRequest: null });
    expect(result.sample).toEqual({
      sequence: null,
      elapsedMs: null,
      receivedAt: null,
      ageMs: null,
      freshness: "unavailable",
    });
    expect(result.topology).toEqual({
      channelCount: 0,
      channelLabels: [],
      loudnessLayout: null,
      loudnessLayoutKnown: false,
    });
    expect(result.levels.truePeak.leftDbtp).toBeNull();
    expect(result.loudness.integratedLufs).toBeNull();
    expect(result.dialogue.activeNow).toBeNull();
    expect(new Set(Object.values(result.unavailable))).toEqual(new Set(["noSample"]));
  });

  it("reports passive optional-analysis states without manufacturing values", () => {
    const inactive = inspect({ vectorscopeRequest: null, dialogueActive: false });
    expect(inactive.stereo.pair).toBeNull();
    expect(inactive.unavailable["stereo.correlation"]).toBe("analysisInactive");
    expect(inactive.dialogue.active).toBe(false);
    expect(inactive.unavailable["dialogue.coveragePercent"]).toBe("dialogueInactive");

    const quiet = inspect({
      record: record({ audio: { peakDb: [-100, -Infinity] } }),
    });
    expect(quiet.unavailable["stereo.correlation"]).toBe("belowSignalFloor");

    const mono = inspect({
      record: record({ audio: { peakDb: [-10], rmsDb: [-20] } }),
    });
    expect(mono.unavailable["stereo.correlation"]).toBe("insufficientChannels");
  });

  it("distinguishes dialogue with no gated result from a real zero coverage", () => {
    const result = inspect({
      record: record({
        audio: {
          dialoguePercent: 0,
          dialogueIntegrated: -Infinity,
          dialogueLra: 0,
        },
      }),
    });
    expect(result.dialogue.coveragePercent).toBe(0);
    expect(result.dialogue.integratedLufs).toBeNull();
    expect(result.unavailable["dialogue.integratedLufs"]).toBe("noDialogue");
    expect(result.unavailable["dialogue.rangeLu"]).toBe("noDialogue");
  });

  it("does not expose the engine's LRA zero sentinel during integrated warm-up", () => {
    const result = inspect({
      record: record({ audio: { integrated: -Infinity, lra: 0 } }),
    });
    expect(result.loudness.rangeLu).toBeNull();
    expect(result.unavailable["loudness.rangeLu"]).toBe("notReady");
  });

  it("evaluates the effective saved or preview profile with the canonical evaluator", () => {
    const document = {
      rules: [
        { metricId: "integrated", op: ">", value: -21, severity: "fail" },
        { metricId: "truePeak", op: ">", value: -1, severity: "warn" },
      ],
    };
    expect(
      inspect({ profile: { mode: "preview", id: "ebu", name: "Draft", document } }).profile
    ).toEqual({
      mode: "preview",
      id: "ebu",
      name: "Draft",
      overall: "fail",
      byMetric: { integrated: "fail", truePeak: "warn" },
    });
    expect(inspect().profile).toEqual({
      mode: "off",
      id: null,
      name: null,
      overall: "off",
      byMetric: {},
    });
  });

  it("converts every non-finite metric to null before JSON serialization", () => {
    const result = inspect({
      record: record({
        audio: {
          peakDb: [NaN, Infinity],
          rmsDb: [-Infinity, NaN],
          truePeakL: Infinity,
          correlation: NaN,
        },
      }),
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("NaN");
    expect(result.levels.channels[0].peakDbfs).toBeNull();
    expect(result.unavailable["levels.channels[0].peakDbfs"]).toBe("notReady");
  });
});
