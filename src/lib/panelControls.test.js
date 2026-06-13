import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CONTROLS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  LOUDNESS_STATS_OPTIONS,
  normalizePanelControls,
  readPersistedPanelControls,
  writePersistedPanelControls,
} from "./panelControls.js";
import { UI_PREFERENCES } from "../uiPreferences.js";

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
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "pair", x: 0, y: 1 },
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
      loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
    });
  });

  it("normalizes invalid input without preserving unknown ids", () => {
    expect(
      normalizePanelControls({
        vectorscopePair: { x: 2, y: "bad" },
        spectrumChannel: { type: "single", ch: 3 },
        loudnessStatsVisibleIds: ["momentary", "unknown", "momentary"],
        loudnessHistoryVisibleLayerIds: ["ref", "bad", "ref"],
      })
    ).toEqual({
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "single", ch: 3 },
      loudnessStatsVisibleIds: ["momentary"],
      loudnessHistoryVisibleLayerIds: ["ref"],
    });
  });

  it("reads defaults when plvs.ui has only old channel keys", () => {
    localStorage.setItem(
      UI_PREFERENCES.layoutPersistKey,
      JSON.stringify({
        vectorscopePairX: 2,
        vectorscopePairY: 3,
        spectrumChannelType: "single",
        spectrumChannelCh: 2,
      })
    );

    expect(readPersistedPanelControls()).toEqual(DEFAULT_PANEL_CONTROLS);
  });

  it("writes panelControls while preserving unrelated persisted settings", () => {
    localStorage.setItem(
      UI_PREFERENCES.layoutPersistKey,
      JSON.stringify({ appearance: "fixed", referenceLufs: -18 })
    );

    writePersistedPanelControls({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessStatsVisibleIds: [],
      loudnessHistoryVisibleLayerIds: ["momentary"],
    });

    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES.layoutPersistKey))).toEqual({
      appearance: "fixed",
      referenceLufs: -18,
      panelControls: {
        ...DEFAULT_PANEL_CONTROLS,
        loudnessStatsVisibleIds: [],
        loudnessHistoryVisibleLayerIds: ["momentary"],
      },
    });
  });

  it("removes legacy top-level channel keys when writing panelControls", () => {
    localStorage.setItem(
      UI_PREFERENCES.layoutPersistKey,
      JSON.stringify({
        appearance: "fixed",
        vectorscopePairX: 2,
        vectorscopePairY: 3,
        spectrumChannelType: "single",
        spectrumChannelX: 0,
        spectrumChannelY: 1,
        spectrumChannelCh: 2,
      })
    );

    writePersistedPanelControls(DEFAULT_PANEL_CONTROLS);

    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES.layoutPersistKey))).toEqual({
      appearance: "fixed",
      panelControls: DEFAULT_PANEL_CONTROLS,
    });
  });
});
