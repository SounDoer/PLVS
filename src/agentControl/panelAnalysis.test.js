import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { createDefaultPanelControls } from "../workspace/panelControlInstances.js";
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
      dialogueDetection: { requestedByPanel: true, runtime: "active" },
    });
  });

  it("separates a Waveform panel's demand from the shared spectral runtime", () => {
    expect(
      readPublicPanelAnalysis(DEFAULT_WORKSPACE_STATE, "waveform", {
        spectralWaveformActive: true,
      })
    ).toEqual({
      spectralWaveform: { requestedByPanel: true, runtime: "active" },
    });
  });

  it("reports Dialogue Detection as active but not requested when the Stats panel has plain defaults", () => {
    const workspace = {
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: {
        ...DEFAULT_WORKSPACE_STATE.panelControlsById,
        stats: createDefaultPanelControls(),
      },
    };

    expect(
      readPublicPanelAnalysis(workspace, "stats", {
        dialogueDetectionActive: true,
      })
    ).toEqual({
      dialogueDetection: { requestedByPanel: false, runtime: "active" },
    });
  });

  it("reports the spectral runtime as active but not requested when the Waveform panel has plain defaults", () => {
    const workspace = {
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: {
        ...DEFAULT_WORKSPACE_STATE.panelControlsById,
        waveform: createDefaultPanelControls(),
      },
    };

    expect(
      readPublicPanelAnalysis(workspace, "waveform", {
        spectralWaveformActive: true,
      })
    ).toEqual({
      spectralWaveform: { requestedByPanel: false, runtime: "active" },
    });
  });
});
