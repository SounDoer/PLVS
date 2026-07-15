import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import {
  deriveBackendAnalysisRequests,
  deriveChannelLabelRuntime,
  deriveDialogueRuntime,
} from "./appRuntimeDerivations.js";

function leaf(ids) {
  return { type: "leaf", tabs: ids, activeTab: ids[0] };
}

function workspace({ panelsById, panelOrder = Object.keys(panelsById), panelControlsById = {} }) {
  return {
    tree: leaf(panelOrder),
    panelsById,
    panelOrder,
    panelControlsById,
  };
}

describe("app runtime derivations", () => {
  it("maps aggregate analysis requests to the backend request shape", () => {
    expect(
      deriveBackendAnalysisRequests({
        spectrumRequests: [
          {
            key: "spectrum:single:2:combined:sp25:tilt300:smoff",
            channel: { type: "single", ch: 2 },
            view: "combined",
            speedPercent: 25,
            tiltDbPerOctave: 3,
          },
        ],
        vectorscopeRequests: [{ key: "vectorscope:pair:0:1", pair: { x: 0, y: 1 } }],
      })
    ).toEqual({
      spectrum: [
        {
          key: "spectrum:single:2:combined:sp25:tilt300:smoff",
          channel: { type: "single", ch: 2 },
          view: "combined",
          speedPercent: 25,
          tiltDbPerOctave: 3,
        },
      ],
      vectorscope: [{ key: "vectorscope:pair:0:1", x: 0, y: 1 }],
    });
  });

  it("derives live label context and editable role tokens from per-count overrides", () => {
    const runtime = deriveChannelLabelRuntime({
      channelCount: 6,
      layoutResolution: { resolved: "5.1" },
      channelLabelOverrides: { 6: ["L", "R", "C", "LFE", "Ls", "Rs"] },
    });

    expect(runtime.overrideLabels).toEqual(["L", "R", "C", "LFE", "Ls", "Rs"]);
    expect(runtime.peakLabelContext).toEqual({
      channelLayout: "auto",
      resolvedLayout: "5.1",
      overrideLabels: ["L", "R", "C", "LFE", "Ls", "Rs"],
    });
    expect(runtime.channelLabelTokens).toEqual(["L", "R", "C", "LFE", "Ls", "Rs"]);
  });

  it("derives loudness weights from the same per-count role override", () => {
    expect(
      deriveChannelLabelRuntime({
        channelCount: 3,
        layoutResolution: { resolved: "3.0" },
        channelLabelOverrides: { 3: ["L", "LFE", "Rs"] },
      }).loudnessWeights
    ).toEqual([1, 0, 10 ** (1.5 / 10)]);
  });

  it("falls back to stereo labels before a real channel count is known", () => {
    const runtime = deriveChannelLabelRuntime({
      channelCount: 0,
      layoutResolution: { resolved: "unknown" },
      channelLabelOverrides: {},
    });

    expect(runtime.peakLabelContext).toEqual({
      channelLayout: "auto",
      resolvedLayout: "stereo",
      overrideLabels: null,
    });
    expect(runtime.channelLabelTokens).toEqual([]);
    expect(runtime.loudnessWeights).toBeNull();
  });

  it("derives dialogue gating and VAD engine from visible stats controls", () => {
    expect(
      deriveDialogueRuntime(
        workspace({
          panelsById: {
            stats: { id: "stats", moduleId: "stats" },
            "stats-hidden": { id: "stats-hidden", moduleId: "stats" },
          },
          panelOrder: ["stats", "stats-hidden"],
          panelControlsById: {
            stats: {
              ...DEFAULT_PANEL_CONTROLS,
              statsVisibleIds: ["integrated", "dialogueCoverage"],
              dialogueVadEngine: "silero",
            },
            "stats-hidden": {
              ...DEFAULT_PANEL_CONTROLS,
              statsVisibleIds: ["integrated"],
              dialogueVadEngine: "ten",
            },
          },
        })
      )
    ).toEqual({ dialogueGating: true, dialogueVadEngine: "silero" });
  });

  it("keeps dialogue disabled when dialogue stats are absent", () => {
    expect(
      deriveDialogueRuntime(
        workspace({
          panelsById: { stats: { id: "stats", moduleId: "stats" } },
          panelControlsById: {
            stats: { ...DEFAULT_PANEL_CONTROLS, statsVisibleIds: ["integrated"] },
          },
        })
      )
    ).toEqual({ dialogueGating: false, dialogueVadEngine: "firered" });
  });
});
