import { getPanelControls } from "../workspace/panelControlInstances.js";
import { resolveEffectiveChannelControls } from "../analysis/effectiveChannels.js";

const DIALOGUE_METRICS = new Set([
  "dialogueCoverage",
  "dialogueIntegrated",
  "dialogueRange",
  "loudnessToDialogueRatio",
]);

function channelIsAvailable(selection, channelCount) {
  const assumedCount = Number.isInteger(channelCount) && channelCount > 0 ? channelCount : 2;
  if (selection?.type === "single") return selection.ch < assumedCount;
  return selection?.x < assumedCount && selection?.y < assumedCount;
}

/// The selection the panel analyses while its requested one waits for channels. The request stays in
/// `controls`; this names the fallback, under the public control name it falls back for.
function effectiveSelection(moduleId, controls, context, field, publicName) {
  const { controls: effective, unavailable } = resolveEffectiveChannelControls(
    moduleId,
    controls,
    context.channelTopology
  );
  return unavailable ? { [publicName]: effective[field] } : {};
}

/**
 * @param {string} panelId
 */
export function readPublicPanelAnalysis(workspace, panelId, context = {}) {
  const moduleId = workspace?.panelsById?.[panelId]?.moduleId;
  const controls = getPanelControls(workspace, panelId);

  if (moduleId === "spectrum" || moduleId === "spectrogram") {
    return {
      status: channelIsAvailable(controls.spectrumChannel, context.channelCount)
        ? "active"
        : "waitingForChannels",
      ...effectiveSelection(moduleId, controls, context, "spectrumChannel", "effectiveChannel"),
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
      ...effectiveSelection(moduleId, controls, context, "vectorscopePair", "effectiveChannelPair"),
    };
  }

  if (moduleId === "stereo-map") {
    return {
      status: channelIsAvailable({ type: "pair", ...controls.stereoMapPair }, context.channelCount)
        ? "active"
        : "waitingForChannels",
      ...effectiveSelection(moduleId, controls, context, "stereoMapPair", "effectiveChannelPair"),
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
