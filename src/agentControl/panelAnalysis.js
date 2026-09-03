import { getPanelControls } from "../workspace/panelControlInstances.js";

const DIALOGUE_METRICS = new Set([
  "dialogueCoverage",
  "dialogueIntegrated",
  "dialogueRange",
  "dialogueOffset",
]);

function channelIsAvailable(selection, channelCount) {
  const assumedCount = Number.isInteger(channelCount) && channelCount > 0 ? channelCount : 2;
  if (selection?.type === "single") return selection.ch < assumedCount;
  return selection?.x < assumedCount && selection?.y < assumedCount;
}

export function readPublicPanelAnalysis(workspace, panelId, context = {}) {
  const moduleId = workspace?.panelsById?.[panelId]?.moduleId;
  const controls = getPanelControls(workspace, panelId);

  if (moduleId === "spectrum" || moduleId === "spectrogram") {
    return {
      status: channelIsAvailable(controls.spectrumChannel, context.channelCount)
        ? "active"
        : "waitingForChannels",
    };
  }

  if (moduleId === "vectorscope") {
    return {
      status: channelIsAvailable(
        { type: "pair", ...controls.vectorscopePair },
        context.channelCount
      )
        ? "active"
        : "waitingForChannels",
    };
  }

  if (moduleId === "stereo-map") {
    return {
      status: channelIsAvailable({ type: "pair", ...controls.stereoMapPair }, context.channelCount)
        ? "active"
        : "waitingForChannels",
    };
  }

  if (moduleId === "stats") {
    return {
      dialogueDetection: {
        requestedByPanel: controls.statsVisibleIds.some((id) => DIALOGUE_METRICS.has(id)),
        runtime: context.dialogueDetectionActive === true ? "active" : "notRequested",
      },
    };
  }

  if (moduleId === "waveform") {
    return {
      spectralWaveform: {
        requestedByPanel: controls.waveformFrequencyColor || controls.waveformCentroid,
        runtime: context.spectralWaveformActive === true ? "active" : "notRequested",
      },
    };
  }

  return {};
}
