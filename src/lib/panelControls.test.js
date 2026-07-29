/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CONTROLS,
  LEVEL_METER_MODE_OPTIONS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  VECTORSCOPE_MODE_OPTIONS,
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
      vectorscopeMode: "lissajous",
      vectorscopePolarLevelMaxHold: false,
      spectrumChannel: { type: "pair", x: 0, y: 1 },
      spectrumView: "combined",
      spectrumMaxHold: false,
      spectrumPeakLabels: false,
      spectrumSpeedPercent: 25,
      spectrumTiltDbPerOctave: 3,
      spectrumOctaveSmoothing: "off",
      spectrumXMinFreq: 20,
      spectrumXMaxFreq: 20000,
      spectrumYMaxDb: -12,
      spectrumYMinDb: -96,
      spectrogramYMinFreq: 20,
      spectrogramYMaxFreq: 20000,
      spectrogram3d: false,
      spectrogram3dColorize: true,
      spectrogram3dHeightGain: 1,
      spectrogram3dAzimuthDeg: 135,
      spectrogram3dElevationDeg: 60,
      spectrogram3dLineAlpha: 1,
      spectrogram3dLineWidth: 1,
      spectrogram3dFloor: true,
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
      stereoMapMode: "position",
      stereoMapPair: { first: 0, second: 1 },
      stereoMapHold: false,
      stereoMapSpeedPercent: 50,
      stereoMapOctaveSmoothing: "1/12",
      stereoMapXMinFreq: 20,
      stereoMapXMaxFreq: 20000,
      stereoMapMonoLossYMinDb: -24,
      stereoMapMsRatioYMinDb: -48,
      stereoMapMsRatioYMaxDb: 24,
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

  it("does not carry a loudness reference: the active Loudness Profile owns it", () => {
    expect(normalizePanelControls({ loudnessReferenceLufs: -14 })).not.toHaveProperty(
      "loudnessReferenceLufs"
    );
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
      vectorscopeMode: "lissajous",
      vectorscopePolarLevelMaxHold: false,
      spectrumChannel: { type: "single", ch: 3 },
      spectrumView: "combined",
      spectrumMaxHold: false,
      spectrumPeakLabels: false,
      spectrumSpeedPercent: 25,
      spectrumTiltDbPerOctave: 3,
      spectrumOctaveSmoothing: "off",
      spectrumXMinFreq: 20,
      spectrumXMaxFreq: 20000,
      spectrumYMaxDb: -12,
      spectrumYMinDb: -96,
      spectrogramYMinFreq: 20,
      spectrogramYMaxFreq: 20000,
      spectrogram3d: false,
      spectrogram3dColorize: true,
      spectrogram3dHeightGain: 1,
      spectrogram3dAzimuthDeg: 135,
      spectrogram3dElevationDeg: 60,
      spectrogram3dLineAlpha: 1,
      spectrogram3dLineWidth: 1,
      spectrogram3dFloor: true,
      loudnessYMinDb: -64,
      loudnessYMaxDb: 0,
      levelMeterYMinDb: -60,
      levelMeterYMaxDb: 3,
      statsVisibleIds: ["momentary"],
      statsOrder: DEFAULT_PANEL_CONTROLS.statsOrder,
      dialogueVadEngine: "firered",
      loudnessHistoryVisibleLayerIds: ["ref"],
      stereoMapMode: "position",
      stereoMapPair: { first: 0, second: 1 },
      stereoMapHold: false,
      stereoMapSpeedPercent: 50,
      stereoMapOctaveSmoothing: "1/12",
      stereoMapXMinFreq: 20,
      stereoMapXMaxFreq: 20000,
      stereoMapMonoLossYMinDb: -24,
      stereoMapMsRatioYMinDb: -48,
      stereoMapMsRatioYMaxDb: 24,
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

  it("normalizes vectorscope display controls", () => {
    expect(VECTORSCOPE_MODE_OPTIONS.map((option) => option.id)).toEqual([
      "lissajous",
      "polarSample",
      "polarLevel",
    ]);
    expect(normalizePanelControls({}).vectorscopeMode).toBe("lissajous");
    expect(normalizePanelControls({ vectorscopeMode: "polarSample" }).vectorscopeMode).toBe(
      "polarSample"
    );
    expect(normalizePanelControls({ vectorscopeMode: "polarLevel" }).vectorscopeMode).toBe(
      "polarLevel"
    );
    expect(normalizePanelControls({ vectorscopeMode: "unknown" }).vectorscopeMode).toBe(
      "lissajous"
    );
    expect(normalizePanelControls({ vectorscopePolarLevelMaxHold: true })).toHaveProperty(
      "vectorscopePolarLevelMaxHold",
      true
    );
    expect(normalizePanelControls({ vectorscopePolarLevelMaxHold: "yes" })).toHaveProperty(
      "vectorscopePolarLevelMaxHold",
      false
    );
  });

  it("reads the legacy vectorscopePolarLevelPeakHold key as a fallback", () => {
    expect(normalizePanelControls({ vectorscopePolarLevelPeakHold: true })).toHaveProperty(
      "vectorscopePolarLevelMaxHold",
      true
    );
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

describe("spectrumMaxHold normalization", () => {
  it("defaults to false", () => {
    expect(normalizePanelControls({}).spectrumMaxHold).toBe(false);
    expect(DEFAULT_PANEL_CONTROLS.spectrumMaxHold).toBe(false);
  });
  it("keeps booleans", () => {
    expect(normalizePanelControls({ spectrumMaxHold: true }).spectrumMaxHold).toBe(true);
    expect(normalizePanelControls({ spectrumMaxHold: false }).spectrumMaxHold).toBe(false);
  });
  it("falls back on non-boolean", () => {
    expect(normalizePanelControls({ spectrumMaxHold: "yes" }).spectrumMaxHold).toBe(false);
  });
});

describe("spectrum display controls normalization", () => {
  it("defaults to the current display behavior", () => {
    expect(normalizePanelControls({}).spectrumSpeedPercent).toBe(25);
    expect(DEFAULT_PANEL_CONTROLS.spectrumSpeedPercent).toBe(25);
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

  it("keeps peak labels off by default and normalizes non-booleans", () => {
    expect(normalizePanelControls({}).spectrumPeakLabels).toBe(false);
    expect(normalizePanelControls({ spectrumPeakLabels: true }).spectrumPeakLabels).toBe(true);
    expect(normalizePanelControls({ spectrumPeakLabels: "yes" }).spectrumPeakLabels).toBe(false);
  });

  it("reads spectrumMaxHold from presets written under the old peak hold key", () => {
    expect(normalizePanelControls({ spectrumPeakHold: true }).spectrumMaxHold).toBe(true);
    // A stored `false` is a real value: `??` must not mistake it for an absent key.
    expect(normalizePanelControls({ spectrumPeakHold: false }).spectrumMaxHold).toBe(false);
    // The new key wins when a preset somehow carries both.
    expect(
      normalizePanelControls({ spectrumMaxHold: false, spectrumPeakHold: true }).spectrumMaxHold
    ).toBe(false);
  });

  it("reads spectrumSpeedPercent from presets written under the old smoothing key", () => {
    expect(normalizePanelControls({ spectrumSmoothingPercent: 80 }).spectrumSpeedPercent).toBe(80);
    // A stored 0 must survive: `??` falls through only on null/undefined, never on a falsy 0.
    expect(normalizePanelControls({ spectrumSmoothingPercent: 0 }).spectrumSpeedPercent).toBe(0);
    // The new key wins when a preset somehow carries both.
    expect(
      normalizePanelControls({ spectrumSpeedPercent: 10, spectrumSmoothingPercent: 90 })
        .spectrumSpeedPercent
    ).toBe(10);
  });

  it("clamps speed to 0..100 percent", () => {
    expect(normalizePanelControls({ spectrumSpeedPercent: -1 }).spectrumSpeedPercent).toBe(0);
    expect(normalizePanelControls({ spectrumSpeedPercent: 101 }).spectrumSpeedPercent).toBe(100);
    expect(normalizePanelControls({ spectrumSpeedPercent: 42 }).spectrumSpeedPercent).toBe(42);
    expect(normalizePanelControls({ spectrumSpeedPercent: "75" }).spectrumSpeedPercent).toBe(25);
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

describe("stereo map panel controls normalization", () => {
  it("defaults to Position, the Vectorscope pair fallback, Hold off, and 1/12 oct smoothing", () => {
    const result = normalizePanelControls({});
    expect(result.stereoMapMode).toBe("position");
    expect(result.stereoMapPair).toEqual({ first: 0, second: 1 });
    expect(result.stereoMapHold).toBe(false);
    expect(result.stereoMapSpeedPercent).toBe(50);
    expect(result.stereoMapOctaveSmoothing).toBe("1/12");
    expect(result.stereoMapXMinFreq).toBe(20);
    expect(result.stereoMapXMaxFreq).toBe(20000);
    expect(result.stereoMapMonoLossYMinDb).toBe(-24);
    expect(result.stereoMapMsRatioYMinDb).toBe(-48);
    expect(result.stereoMapMsRatioYMaxDb).toBe(24);
  });

  it("accepts every Stereo Map mode", () => {
    for (const mode of ["position", "correlation", "monoLossDb", "msRatioDb"]) {
      expect(normalizePanelControls({ stereoMapMode: mode }).stereoMapMode).toBe(mode);
    }
  });

  it("falls back to Position for an unknown or legacy mode value", () => {
    expect(normalizePanelControls({ stereoMapMode: "width" }).stereoMapMode).toBe("position");
    expect(normalizePanelControls({ stereoMapMode: "" }).stereoMapMode).toBe("position");
    expect(normalizePanelControls({ stereoMapMode: null }).stereoMapMode).toBe("position");
  });

  it("normalizes a valid stereoMapPair, using {first, second} rather than Vectorscope's {x, y}", () => {
    expect(
      normalizePanelControls({ stereoMapPair: { first: 2, second: 4 } }).stereoMapPair
    ).toEqual({ first: 2, second: 4 });
  });

  it("falls back to the default pair for a malformed or legacy stereoMapPair", () => {
    expect(normalizePanelControls({ stereoMapPair: { x: 2, y: 4 } }).stereoMapPair).toEqual({
      first: 0,
      second: 1,
    });
    expect(
      normalizePanelControls({ stereoMapPair: { first: 2, second: "bad" } }).stereoMapPair
    ).toEqual({
      first: 0,
      second: 1,
    });
    expect(normalizePanelControls({ stereoMapPair: null }).stereoMapPair).toEqual({
      first: 0,
      second: 1,
    });
  });

  it("normalizes the Hold toggle", () => {
    expect(normalizePanelControls({ stereoMapHold: true }).stereoMapHold).toBe(true);
    expect(normalizePanelControls({ stereoMapHold: false }).stereoMapHold).toBe(false);
    expect(normalizePanelControls({ stereoMapHold: "yes" }).stereoMapHold).toBe(false);
  });

  it("clamps Speed to 0..100 percent, same convention as Spectrum", () => {
    expect(normalizePanelControls({ stereoMapSpeedPercent: -1 }).stereoMapSpeedPercent).toBe(0);
    expect(normalizePanelControls({ stereoMapSpeedPercent: 101 }).stereoMapSpeedPercent).toBe(100);
    expect(normalizePanelControls({ stereoMapSpeedPercent: 60 }).stereoMapSpeedPercent).toBe(60);
    expect(normalizePanelControls({ stereoMapSpeedPercent: "75" }).stereoMapSpeedPercent).toBe(50);
  });

  it("accepts every Spectrum octave-smoothing option and falls back to 1/12 oct otherwise", () => {
    for (const id of ["off", "1/12", "1/6", "1/3"]) {
      expect(
        normalizePanelControls({ stereoMapOctaveSmoothing: id }).stereoMapOctaveSmoothing
      ).toBe(id);
    }
    expect(
      normalizePanelControls({ stereoMapOctaveSmoothing: "1/24" }).stereoMapOctaveSmoothing
    ).toBe("1/12");
  });

  it("clamps the X range to 20 Hz..20 kHz with a minimum one-octave span", () => {
    expect(
      normalizePanelControls({ stereoMapXMinFreq: 1000, stereoMapXMaxFreq: 4000 })
    ).toMatchObject({ stereoMapXMinFreq: 1000, stereoMapXMaxFreq: 4000 });
    expect(normalizePanelControls({ stereoMapXMinFreq: 5 }).stereoMapXMinFreq).toBe(20);
    expect(normalizePanelControls({ stereoMapXMaxFreq: 30000 }).stereoMapXMaxFreq).toBe(20000);
  });

  it("clamps the Mono Loss lower bound to -60..-6 dB, defaulting to -24 dB", () => {
    expect(normalizePanelControls({}).stereoMapMonoLossYMinDb).toBe(-24);
    expect(normalizePanelControls({ stereoMapMonoLossYMinDb: -12 }).stereoMapMonoLossYMinDb).toBe(
      -12
    );
    expect(normalizePanelControls({ stereoMapMonoLossYMinDb: -90 }).stereoMapMonoLossYMinDb).toBe(
      -60
    );
    expect(normalizePanelControls({ stereoMapMonoLossYMinDb: 0 }).stereoMapMonoLossYMinDb).toBe(-6);
  });

  it("clamps the M/S Ratio range to -96..+48 dB and keeps 0 dB inside it", () => {
    expect(
      normalizePanelControls({ stereoMapMsRatioYMinDb: -96, stereoMapMsRatioYMaxDb: 48 })
    ).toMatchObject({ stereoMapMsRatioYMinDb: -96, stereoMapMsRatioYMaxDb: 48 });
    // A lower bound pushed above zero snaps to zero rather than being repaired against the other bound.
    expect(
      normalizePanelControls({ stereoMapMsRatioYMinDb: 10, stereoMapMsRatioYMaxDb: 20 })
        .stereoMapMsRatioYMinDb
    ).toBe(0);
    expect(
      normalizePanelControls({ stereoMapMsRatioYMinDb: -20, stereoMapMsRatioYMaxDb: -10 })
        .stereoMapMsRatioYMaxDb
    ).toBe(0);
    expect(normalizePanelControls({ stereoMapMsRatioYMinDb: -200 }).stereoMapMsRatioYMinDb).toBe(
      -96
    );
    expect(normalizePanelControls({ stereoMapMsRatioYMaxDb: 200 }).stereoMapMsRatioYMaxDb).toBe(48);
  });

  it("round-trips through normalization without drifting (preset save/apply idempotence)", () => {
    const once = normalizePanelControls({
      stereoMapMode: "msRatioDb",
      stereoMapPair: { first: 2, second: 5 },
      stereoMapHold: true,
      stereoMapSpeedPercent: 60,
      stereoMapOctaveSmoothing: "1/6",
      stereoMapXMinFreq: 100,
      stereoMapXMaxFreq: 8000,
      stereoMapMonoLossYMinDb: -40,
      stereoMapMsRatioYMinDb: -30,
      stereoMapMsRatioYMaxDb: 30,
    });
    const twice = normalizePanelControls(once);
    expect(twice).toEqual(once);
  });
});

describe("spectrogram 3D controls", () => {
  it("defaults to the 2D view with a colorized mesh", () => {
    const c = normalizePanelControls({});
    expect(c.spectrogram3d).toBe(false);
    expect(c.spectrogram3dColorize).toBe(true);
    expect(c.spectrogram3dHeightGain).toBe(1);
    expect(c.spectrogram3dAzimuthDeg).toBe(135);
    expect(c.spectrogram3dElevationDeg).toBe(60);
  });

  it("clamps height gain and elevation, and wraps azimuth", () => {
    expect(normalizePanelControls({ spectrogram3dHeightGain: 99 }).spectrogram3dHeightGain).toBe(3);
    expect(normalizePanelControls({ spectrogram3dHeightGain: 0 }).spectrogram3dHeightGain).toBe(
      0.3
    );
    expect(normalizePanelControls({ spectrogram3dElevationDeg: 0 }).spectrogram3dElevationDeg).toBe(
      5
    );
    // Must match the projection's own ELEVATION_MAX_DEG: two clamps on the same quantity that
    // disagree means the settings layer silently pulls back a value the renderer would accept.
    expect(
      normalizePanelControls({ spectrogram3dElevationDeg: 90 }).spectrogram3dElevationDeg
    ).toBe(85);
    expect(normalizePanelControls({ spectrogram3dAzimuthDeg: 370 }).spectrogram3dAzimuthDeg).toBe(
      10
    );
  });

  it("rejects non-boolean toggles", () => {
    expect(normalizePanelControls({ spectrogram3d: "yes" }).spectrogram3d).toBe(false);
    expect(normalizePanelControls({ spectrogram3dColorize: 1 }).spectrogram3dColorize).toBe(true);
  });
});

describe("spectrogram 3D tuning controls", () => {
  it("defaults alpha/width/floor to their agreed values", () => {
    const c = normalizePanelControls({});
    expect(c.spectrogram3dLineAlpha).toBe(1);
    expect(c.spectrogram3dLineWidth).toBe(1);
    expect(c.spectrogram3dFloor).toBe(true);
  });

  it("clamps line alpha to 0.15-1", () => {
    expect(normalizePanelControls({ spectrogram3dLineAlpha: 0 }).spectrogram3dLineAlpha).toBe(0.15);
    expect(normalizePanelControls({ spectrogram3dLineAlpha: 5 }).spectrogram3dLineAlpha).toBe(1);
  });

  it("clamps line width to 0.5-3", () => {
    expect(normalizePanelControls({ spectrogram3dLineWidth: 0 }).spectrogram3dLineWidth).toBe(0.5);
    expect(normalizePanelControls({ spectrogram3dLineWidth: 10 }).spectrogram3dLineWidth).toBe(3);
  });

  it("rejects non-boolean floor", () => {
    expect(normalizePanelControls({ spectrogram3dFloor: "yes" }).spectrogram3dFloor).toBe(true);
    expect(normalizePanelControls({ spectrogram3dFloor: false }).spectrogram3dFloor).toBe(false);
  });
});
