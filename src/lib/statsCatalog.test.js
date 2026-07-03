import { describe, expect, it } from "vitest";
import {
  STATS_META,
  STATS_CANONICAL_ORDER,
  STATS_OPTIONS,
  dialogueOffsetText,
  buildStatsMetrics,
} from "./statsCatalog.js";

describe("statsCatalog", () => {
  it("lists the 12 loudness ids first, then the cross-domain readouts last", () => {
    expect(STATS_CANONICAL_ORDER).toEqual([
      "momentary",
      "shortTerm",
      "integrated",
      "momentaryMax",
      "shortTermMax",
      "lra",
      "psr",
      "plr",
      "dialogueCoverage",
      "dialogueIntegrated",
      "dialogueRange",
      "dialogueOffset",
      "truePeak",
      "correlation",
      "sideToMid",
    ]);
  });

  it("gives every catalog id a meta entry with a non-empty hint", () => {
    for (const id of STATS_CANONICAL_ORDER) {
      expect(STATS_META[id]).toBeTruthy();
      expect(typeof STATS_META[id].label).toBe("string");
      expect(STATS_META[id].label.length).toBeGreaterThan(0);
      expect(typeof STATS_META[id].shortLabel).toBe("string");
      expect(STATS_META[id].shortLabel.length).toBeGreaterThan(0);
      expect(typeof STATS_META[id].hint).toBe("string");
      expect(STATS_META[id].hint.length).toBeGreaterThan(0);
    }
  });

  it("defines the agreed medium-width short labels", () => {
    expect(
      Object.fromEntries(STATS_CANONICAL_ORDER.map((id) => [id, STATS_META[id].shortLabel]))
    ).toEqual({
      momentary: "M",
      shortTerm: "ST",
      integrated: "I",
      momentaryMax: "M Max",
      shortTermMax: "ST Max",
      lra: "LRA",
      psr: "PSR",
      plr: "PLR",
      dialogueCoverage: "Dlg Cov",
      dialogueIntegrated: "Dlg I",
      dialogueRange: "Dlg LRA",
      dialogueOffset: "Dlg Offset",
      truePeak: "TP Max",
      correlation: "Corr",
      sideToMid: "S/M",
    });
  });

  it("uses dBTP for True Peak Max and an empty unit for Correlation", () => {
    expect(STATS_META.truePeak.unit).toBe("dBTP");
    expect(STATS_META.correlation.unit).toBe("");
  });

  it("derives STATS_OPTIONS in canonical order with id/label/hint", () => {
    expect(STATS_OPTIONS.map((o) => o.id)).toEqual(STATS_CANONICAL_ORDER);
    const truePeak = STATS_OPTIONS.find((o) => o.id === "truePeak");
    expect(truePeak.label).toBe("True Peak Max");
    expect(truePeak.hint.length).toBeGreaterThan(0);
  });

  it("formats the dialogue offset as a signed LU value", () => {
    expect(dialogueOffsetText(-22, -20)).toBe("-2.0");
    expect(dialogueOffsetText(-18, -20)).toBe("+2.0");
    expect(dialogueOffsetText(-Infinity, -20)).toBe("-");
  });

  it("builds a single metrics array including True Peak Max and Correlation", () => {
    const metrics = buildStatsMetrics({
      momentary: -20,
      shortTerm: -18,
      integrated: -19,
      mMax: -10,
      stMax: -12,
      lra: 3,
      tpMax: -1,
      dialoguePercent: 62,
      dialogueIntegrated: -21,
      dialogueLra: 2,
      correlation: 0.85,
      sideToMidDb: -14.2,
    });
    const byId = Object.fromEntries(metrics.map((m) => [m.id, m]));

    expect(metrics.map((m) => m.id)).toEqual(STATS_CANONICAL_ORDER);
    expect(byId.truePeak.value).toBe("-1.0");
    expect(byId.truePeak.unit).toBe("dBTP");
    expect(byId.correlation.value).toBe("0.85");
    expect(byId.correlation.unit).toBe("");
    expect(byId.sideToMid.value).toBe("-14.2");
    expect(byId.sideToMid.unit).toBe("dB");
    // PSR = tpMax - shortTerm = -1 - (-18) = 17.0
    expect(byId.psr.value).toBe("17.0");
    expect(byId.dialogueCoverage.value).toBe("62");
  });

  it("shows a dash for Correlation when the value is not finite", () => {
    const metrics = buildStatsMetrics({ correlation: -Infinity });
    const correlation = metrics.find((m) => m.id === "correlation");
    expect(correlation.value).toBe("-");
  });

  it("shows a dash for Correlation when there is no audio signal", () => {
    const metrics = buildStatsMetrics({ peakDb: [-Infinity, -120], correlation: 0 });
    const correlation = metrics.find((m) => m.id === "correlation");
    expect(correlation.value).toBe("-");
  });
});
