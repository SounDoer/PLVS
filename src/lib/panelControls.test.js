import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CONTROLS,
  LEVEL_METER_MODE_OPTIONS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  normalizePanelControls,
} from "./panelControls.js";
import { STATS_OPTIONS } from "./statsCatalog.js";

describe("panelControls", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("offers the four dialogue stats options but excludes them from defaults", () => {
    const ids = STATS_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "dialogueCoverage",
        "dialogueIntegrated",
        "dialogueRange",
        "dialogueOffset",
      ])
    );
    expect(DEFAULT_PANEL_CONTROLS.statsVisibleIds).not.toContain("dialogueCoverage");
  });

  it("defines stable stats and layer option ids", () => {
    expect(LEVEL_METER_MODE_OPTIONS.map((o) => o.id)).toEqual([
      "peak",
      "rms",
      "momentary",
      "shortTerm",
    ]);
    expect(STATS_OPTIONS.map((o) => o.id)).toEqual([
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
    expect(LOUDNESS_HISTORY_LAYER_OPTIONS.map((o) => o.id)).toEqual([
      "momentary",
      "shortTerm",
      "ref",
    ]);
  });

  it("uses plain-language labels for the derived metrics", () => {
    const byId = Object.fromEntries(STATS_OPTIONS.map((o) => [o.id, o.label]));
    expect(byId.lra).toBe("Loudness Range");
    expect(byId.psr).toBe("Short-term Dynamics");
    expect(byId.plr).toBe("Integrated Dynamics");
    expect(byId.dialogueRange).toBe("Dialogue Range");
  });

  it("gives every stats option a non-empty hint", () => {
    for (const opt of STATS_OPTIONS) {
      expect(typeof opt.hint).toBe("string");
      expect(opt.hint.length).toBeGreaterThan(0);
    }
  });

  it("uses the agreed defaults", () => {
    expect(DEFAULT_PANEL_CONTROLS).toEqual({
      levelMeterMode: "peak",
      levelMeterPlaybackMax: false,
      levelMeterValueMarker: false,
      levelMeterTpMaxMarker: false,
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "pair", x: 0, y: 1 },
      spectrumView: "combined",
      spectrumPeakHold: false,
      spectrumSmoothingPercent: 25,
      spectrumTiltDbPerOctave: 3,
      spectrumXMinFreq: 20,
      spectrumXMaxFreq: 20000,
      spectrumYMaxDb: -12,
      spectrumYMinDb: -96,
      spectrogramYMinFreq: 20,
      spectrogramYMaxFreq: 20000,
      loudnessReferenceLufs: -23,
      loudnessYMinDb: -64,
      loudnessYMaxDb: 0,
      levelMeterYMinDb: -60,
      levelMeterYMaxDb: 3,
      statsVisibleIds: [
        "momentary",
        "shortTerm",
        "integrated",
        "momentaryMax",
        "shortTermMax",
        "lra",
        "psr",
        "plr",
      ],
      statsOrder: [
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
      ],
      dialogueVadEngine: "firered",
      loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
    });
  });

  it("normalizes the dialogue VAD engine", () => {
    expect(normalizePanelControls({}).dialogueVadEngine).toBe("firered");
    expect(normalizePanelControls({ dialogueVadEngine: "silero" }).dialogueVadEngine).toBe(
      "silero"
    );
    expect(normalizePanelControls({ dialogueVadEngine: "ten" }).dialogueVadEngine).toBe("ten");
    expect(normalizePanelControls({ dialogueVadEngine: "unknown" }).dialogueVadEngine).toBe(
      "firered"
    );
  });

  it("normalizes the loudness reference", () => {
    expect(normalizePanelControls({ loudnessReferenceLufs: -14 }).loudnessReferenceLufs).toBe(-14);
    expect(normalizePanelControls({ loudnessReferenceLufs: 5 }).loudnessReferenceLufs).toBe(-23);
  });

  it("defaults statsOrder to the full STATS_CANONICAL_ORDER", () => {
    expect(DEFAULT_PANEL_CONTROLS.statsOrder).toEqual([
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

  it("normalizes statsOrder: dedupe, drop unknown, backfill missing in default order", () => {
    const result = normalizePanelControls({
      statsOrder: ["psr", "psr", "bogus", "integrated"],
    });
    expect(result.statsOrder).toEqual([
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
      "sideToMid",
    ]);
  });

  it("falls back to default statsOrder when raw is not an array", () => {
    expect(normalizePanelControls({ statsOrder: "nope" }).statsOrder).toEqual(
      DEFAULT_PANEL_CONTROLS.statsOrder
    );
  });

  it("normalizes invalid input without preserving unknown ids", () => {
    expect(
      normalizePanelControls({
        levelMeterMode: "money",
        vectorscopePair: { x: 2, y: "bad" },
        spectrumChannel: { type: "single", ch: 3 },
        statsVisibleIds: ["momentary", "unknown", "momentary"],
        loudnessHistoryVisibleLayerIds: ["ref", "bad", "ref"],
      })
    ).toEqual({
      levelMeterMode: "peak",
      levelMeterPlaybackMax: false,
      levelMeterValueMarker: false,
      levelMeterTpMaxMarker: false,
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "single", ch: 3 },
      spectrumView: "combined",
      spectrumPeakHold: false,
      spectrumSmoothingPercent: 25,
      spectrumTiltDbPerOctave: 3,
      spectrumXMinFreq: 20,
      spectrumXMaxFreq: 20000,
      spectrumYMaxDb: -12,
      spectrumYMinDb: -96,
      spectrogramYMinFreq: 20,
      spectrogramYMaxFreq: 20000,
      loudnessReferenceLufs: -23,
      loudnessYMinDb: -64,
      loudnessYMaxDb: 0,
      levelMeterYMinDb: -60,
      levelMeterYMaxDb: 3,
      statsVisibleIds: ["momentary"],
      statsOrder: DEFAULT_PANEL_CONTROLS.statsOrder,
      dialogueVadEngine: "firered",
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
    expect(normalizePanelControls({ levelMeterMode: "rms" }).levelMeterMode).toBe("rms");
    expect(normalizePanelControls({}).levelMeterMode).toBe("peak");
    expect(normalizePanelControls({ levelMeterMode: "integrated" }).levelMeterMode).toBe("peak");
  });

  it("normalizes the level meter value marker toggle", () => {
    expect(normalizePanelControls({}).levelMeterValueMarker).toBe(false);
    expect(normalizePanelControls({ levelMeterValueMarker: true }).levelMeterValueMarker).toBe(
      true
    );
    expect(normalizePanelControls({ levelMeterValueMarker: false }).levelMeterValueMarker).toBe(
      false
    );
    expect(normalizePanelControls({ levelMeterValueMarker: "yes" }).levelMeterValueMarker).toBe(
      false
    );
  });

  it("normalizes the level meter playback max toggle", () => {
    expect(normalizePanelControls({}).levelMeterPlaybackMax).toBe(false);
    expect(normalizePanelControls({ levelMeterPlaybackMax: true }).levelMeterPlaybackMax).toBe(
      true
    );
    expect(normalizePanelControls({ levelMeterPlaybackMax: false }).levelMeterPlaybackMax).toBe(
      false
    );
    expect(normalizePanelControls({ levelMeterPlaybackMax: "yes" }).levelMeterPlaybackMax).toBe(
      false
    );
  });

  it("normalizes the level meter TP Max marker toggle", () => {
    expect(normalizePanelControls({}).levelMeterTpMaxMarker).toBe(false);
    expect(normalizePanelControls({ levelMeterTpMaxMarker: true }).levelMeterTpMaxMarker).toBe(
      true
    );
    expect(normalizePanelControls({ levelMeterTpMaxMarker: false }).levelMeterTpMaxMarker).toBe(
      false
    );
    expect(normalizePanelControls({ levelMeterTpMaxMarker: "yes" }).levelMeterTpMaxMarker).toBe(
      false
    );
  });

  it("drops removed vectorscope display toggles", () => {
    const normalized = normalizePanelControls({
      vectorscopeTraceHold: true,
      vectorscopeEnergyCross: true,
    });

    expect(DEFAULT_PANEL_CONTROLS).not.toHaveProperty("vectorscopeTraceHold");
    expect(DEFAULT_PANEL_CONTROLS).not.toHaveProperty("vectorscopeEnergyCross");
    expect(normalized).not.toHaveProperty("vectorscopeTraceHold");
    expect(normalized).not.toHaveProperty("vectorscopeEnergyCross");
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

describe("spectrum display controls normalization", () => {
  it("defaults to the current display behavior", () => {
    expect(normalizePanelControls({}).spectrumSmoothingPercent).toBe(25);
    expect(DEFAULT_PANEL_CONTROLS.spectrumSmoothingPercent).toBe(25);
    expect(normalizePanelControls({}).spectrumTiltDbPerOctave).toBe(3);
    expect(DEFAULT_PANEL_CONTROLS.spectrumTiltDbPerOctave).toBe(3);
    expect(normalizePanelControls({}).spectrumYMaxDb).toBe(-12);
    expect(DEFAULT_PANEL_CONTROLS.spectrumYMaxDb).toBe(-12);
    expect(normalizePanelControls({}).spectrumYMinDb).toBe(-96);
    expect(DEFAULT_PANEL_CONTROLS.spectrumYMinDb).toBe(-96);
    expect(normalizePanelControls({}).spectrumXMinFreq).toBe(20);
    expect(normalizePanelControls({}).spectrumXMaxFreq).toBe(20000);
    expect(normalizePanelControls({}).spectrogramYMinFreq).toBe(20);
    expect(normalizePanelControls({}).spectrogramYMaxFreq).toBe(20000);
    expect(normalizePanelControls({}).loudnessYMinDb).toBe(-64);
    expect(normalizePanelControls({}).loudnessYMaxDb).toBe(0);
    expect(normalizePanelControls({}).levelMeterYMinDb).toBe(-60);
    expect(normalizePanelControls({}).levelMeterYMaxDb).toBe(3);
  });

  it("clamps smoothing to 0..100 percent", () => {
    expect(normalizePanelControls({ spectrumSmoothingPercent: -1 }).spectrumSmoothingPercent).toBe(
      0
    );
    expect(normalizePanelControls({ spectrumSmoothingPercent: 101 }).spectrumSmoothingPercent).toBe(
      100
    );
    expect(normalizePanelControls({ spectrumSmoothingPercent: 42 }).spectrumSmoothingPercent).toBe(
      42
    );
    expect(
      normalizePanelControls({ spectrumSmoothingPercent: "75" }).spectrumSmoothingPercent
    ).toBe(25);
  });

  it("clamps tilt to 0..6 dB per octave", () => {
    expect(normalizePanelControls({ spectrumTiltDbPerOctave: -1 }).spectrumTiltDbPerOctave).toBe(0);
    expect(normalizePanelControls({ spectrumTiltDbPerOctave: 7 }).spectrumTiltDbPerOctave).toBe(6);
    expect(normalizePanelControls({ spectrumTiltDbPerOctave: 4.25 }).spectrumTiltDbPerOctave).toBe(
      4.25
    );
    expect(normalizePanelControls({ spectrumTiltDbPerOctave: "4.5" }).spectrumTiltDbPerOctave).toBe(
      3
    );
  });

  it("clamps Y-axis display range controls", () => {
    expect(normalizePanelControls({ spectrumYMaxDb: -60 }).spectrumYMaxDb).toBe(-60);
    expect(normalizePanelControls({ spectrumYMaxDb: 6 }).spectrumYMaxDb).toBe(0);
    expect(normalizePanelControls({ spectrumYMaxDb: -24 }).spectrumYMaxDb).toBe(-24);
    expect(normalizePanelControls({ spectrumYMaxDb: "-12" }).spectrumYMaxDb).toBe(-12);
    expect(normalizePanelControls({ spectrumYMinDb: -200 }).spectrumYMinDb).toBe(-120);
    expect(normalizePanelControls({ spectrumYMinDb: 6 }).spectrumYMinDb).toBe(-12);
    expect(normalizePanelControls({ spectrumYMinDb: -72 }).spectrumYMinDb).toBe(-72);
    expect(normalizePanelControls({ spectrumYMinDb: "-96" }).spectrumYMinDb).toBe(-96);
    expect(
      normalizePanelControls({ spectrumYMaxDb: -24, spectrumYRangeDb: 60 }).spectrumYMinDb
    ).toBe(-84);
    expect(
      normalizePanelControls({ spectrumXMinFreq: 1000, spectrumXMaxFreq: 4000 })
    ).toMatchObject({
      spectrumXMinFreq: 1000,
      spectrumXMaxFreq: 4000,
    });
  });
});
