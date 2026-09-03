import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { readPublicPanelAnalysis } from "./panelAnalysis.js";

describe("readPublicPanelAnalysis", () => {
  it("reports when a Spectrum request is waiting for its selected channels", () => {
    const workspace = {
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: {
        ...DEFAULT_WORKSPACE_STATE.panelControlsById,
        spectrum: {
          ...DEFAULT_WORKSPACE_STATE.panelControlsById.spectrum,
          spectrumChannel: { type: "pair", x: 0, y: 3 },
        },
      },
    };

    expect(readPublicPanelAnalysis(workspace, "spectrum", { channelCount: 2 })).toEqual({
      status: "waitingForChannels",
    });
  });

  it("reports an active Vectorscope request for an available pair", () => {
    expect(
      readPublicPanelAnalysis(DEFAULT_WORKSPACE_STATE, "vectorscope", { channelCount: 2 })
    ).toEqual({
      status: "active",
    });
  });

  it("reports when a Stereo Map request is waiting for its selected pair", () => {
    const workspace = {
      ...DEFAULT_WORKSPACE_STATE,
      panelsById: {
        ...DEFAULT_WORKSPACE_STATE.panelsById,
        "stereo-map": { id: "stereo-map", moduleId: "stereo-map" },
      },
      panelOrder: [...DEFAULT_WORKSPACE_STATE.panelOrder, "stereo-map"],
      panelControlsById: {
        ...DEFAULT_WORKSPACE_STATE.panelControlsById,
        "stereo-map": {
          ...DEFAULT_WORKSPACE_STATE.panelControlsById["stereo-map"],
          stereoMapPair: { x: 1, y: 2 },
        },
      },
    };

    expect(readPublicPanelAnalysis(workspace, "stereo-map", { channelCount: 2 })).toEqual({
      status: "waitingForChannels",
    });
  });

  it("separates a Stats panel's demand from the shared Dialogue Detection runtime", () => {
    expect(
      readPublicPanelAnalysis(DEFAULT_WORKSPACE_STATE, "stats", {
        dialogueDetectionActive: true,
      })
    ).toEqual({
      dialogueDetection: { requestedByPanel: false, runtime: "active" },
    });
  });

  it("separates a Waveform panel's demand from the shared spectral runtime", () => {
    expect(
      readPublicPanelAnalysis(DEFAULT_WORKSPACE_STATE, "waveform", {
        spectralWaveformActive: true,
      })
    ).toEqual({
      spectralWaveform: { requestedByPanel: false, runtime: "active" },
    });
  });
});
