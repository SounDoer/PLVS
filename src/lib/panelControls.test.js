import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CONTROLS,
  LEVEL_METER_MODE_OPTIONS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  LOUDNESS_STATS_OPTIONS,
  normalizePanelControls,
} from "./panelControls.js";

describe("panelControls", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("offers the four dialogue stats options but excludes them from defaults", () => {
    const ids = LOUDNESS_STATS_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "dialogueCoverage",
        "dialogueIntegrated",
        "dialogueRange",
        "dialogueOffset",
      ])
    );
    expect(DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds).not.toContain("dialogueCoverage");
  });

  it("defines stable stats and layer option ids", () => {
    expect(LEVEL_METER_MODE_OPTIONS.map((o) => o.id)).toEqual(["peak", "momentary", "shortTerm"]);
    expect(LOUDNESS_STATS_OPTIONS.map((o) => o.id)).toEqual([
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
    ]);
    expect(LOUDNESS_HISTORY_LAYER_OPTIONS.map((o) => o.id)).toEqual([
      "momentary",
      "shortTerm",
      "ref",
    ]);
  });

  it("uses plain-language labels for the derived metrics", () => {
    const byId = Object.fromEntries(LOUDNESS_STATS_OPTIONS.map((o) => [o.id, o.label]));
    expect(byId.lra).toBe("Loudness Range");
    expect(byId.psr).toBe("Short-term Dynamics");
    expect(byId.plr).toBe("Integrated Dynamics");
    expect(byId.dialogueRange).toBe("Dialogue Range");
  });

  it("gives every stats option a non-empty hint", () => {
    for (const opt of LOUDNESS_STATS_OPTIONS) {
      expect(typeof opt.hint).toBe("string");
      expect(opt.hint.length).toBeGreaterThan(0);
    }
  });

  it("uses the agreed defaults", () => {
    expect(DEFAULT_PANEL_CONTROLS).toEqual({
      levelMeterMode: "peak",
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "pair", x: 0, y: 1 },
      spectrumView: "combined",
      spectrumPeakHold: false,
      loudnessStatsVisibleIds: [
        "momentary",
        "shortTerm",
        "integrated",
        "momentaryMax",
        "shortTermMax",
        "lra",
        "psr",
        "plr",
      ],
      loudnessStatsOrder: [
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
      ],
      loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
    });
  });

  it("defaults loudnessStatsOrder to the full LOUDNESS_STATS_ORDER", () => {
    expect(DEFAULT_PANEL_CONTROLS.loudnessStatsOrder).toEqual([
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
    ]);
  });

  it("normalizes loudnessStatsOrder: dedupe, drop unknown, backfill missing in default order", () => {
    const result = normalizePanelControls({
      loudnessStatsOrder: ["psr", "psr", "bogus", "integrated"],
    });
    expect(result.loudnessStatsOrder).toEqual([
      "psr",
      "integrated",
      "momentary",
      "shortTerm",
      "momentaryMax",
      "shortTermMax",
      "lra",
      "plr",
      "dialogueCoverage",
      "dialogueIntegrated",
      "dialogueRange",
      "dialogueOffset",
      "truePeak",
      "correlation",
    ]);
  });

  it("falls back to default loudnessStatsOrder when raw is not an array", () => {
    expect(normalizePanelControls({ loudnessStatsOrder: "nope" }).loudnessStatsOrder).toEqual(
      DEFAULT_PANEL_CONTROLS.loudnessStatsOrder
    );
  });

  it("normalizes invalid input without preserving unknown ids", () => {
    expect(
      normalizePanelControls({
        levelMeterMode: "money",
        vectorscopePair: { x: 2, y: "bad" },
        spectrumChannel: { type: "single", ch: 3 },
        loudnessStatsVisibleIds: ["momentary", "unknown", "momentary"],
        loudnessHistoryVisibleLayerIds: ["ref", "bad", "ref"],
      })
    ).toEqual({
      levelMeterMode: "peak",
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "single", ch: 3 },
      spectrumView: "combined",
      spectrumPeakHold: false,
      loudnessStatsVisibleIds: ["momentary"],
      loudnessStatsOrder: DEFAULT_PANEL_CONTROLS.loudnessStatsOrder,
      loudnessHistoryVisibleLayerIds: ["ref"],
    });
  });

  it("normalizes level meter mode", () => {
    expect(normalizePanelControls({ levelMeterMode: "momentary" }).levelMeterMode).toBe(
      "momentary"
    );
    expect(normalizePanelControls({ levelMeterMode: "shortTerm" }).levelMeterMode).toBe(
      "shortTerm"
    );
    expect(normalizePanelControls({}).levelMeterMode).toBe("peak");
    expect(normalizePanelControls({ levelMeterMode: "integrated" }).levelMeterMode).toBe("peak");
  });
});

describe("spectrumView normalization", () => {
  it("defaults to combined", () => {
    expect(normalizePanelControls({}).spectrumView).toBe("combined");
    expect(DEFAULT_PANEL_CONTROLS.spectrumView).toBe("combined");
  });
  it("keeps valid values", () => {
    expect(normalizePanelControls({ spectrumView: "ms" }).spectrumView).toBe("ms");
    expect(normalizePanelControls({ spectrumView: "lr" }).spectrumView).toBe("lr");
  });
  it("falls back on garbage", () => {
    expect(normalizePanelControls({ spectrumView: "xyz" }).spectrumView).toBe("combined");
  });
});

describe("spectrumPeakHold normalization", () => {
  it("defaults to false", () => {
    expect(normalizePanelControls({}).spectrumPeakHold).toBe(false);
    expect(DEFAULT_PANEL_CONTROLS.spectrumPeakHold).toBe(false);
  });
  it("keeps booleans", () => {
    expect(normalizePanelControls({ spectrumPeakHold: true }).spectrumPeakHold).toBe(true);
    expect(normalizePanelControls({ spectrumPeakHold: false }).spectrumPeakHold).toBe(false);
  });
  it("falls back on non-boolean", () => {
    expect(normalizePanelControls({ spectrumPeakHold: "yes" }).spectrumPeakHold).toBe(false);
  });
});
