import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { deriveAnalysisRequests } from "../analysis/analysisRequests.js";
import fixtures from "../../shared/analysis-request-key-fixtures.json";
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
  it("sends the wire payload the Rust side declares, built by the real deriver", () => {
    // Chained off deriveAnalysisRequests rather than a hand-written request object: the mapper
    // re-lists the fields the deriver assembled, so a hand-written input can omit a field on
    // both sides and pass while the real payload is missing it. That is exactly how
    // octaveSmoothing shipped absent and blanked every analysis panel.
    // The expected payload lives in the shared fixture, which the Rust test deserializes — so
    // this and SpectrumAnalysisRequest cannot drift apart unnoticed.
    const state = workspace({
      panelsById: { p1: { moduleId: "spectrum" }, p2: { moduleId: "vectorscope" } },
      panelOrder: ["p1", "p2"],
      panelControlsById: {},
    });
    const payload = deriveBackendAnalysisRequests(deriveAnalysisRequests(state));
    expect(payload).toEqual(fixtures.wirePayload);
  });

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
            octaveSmoothing: "off",
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
          octaveSmoothing: "off",
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
