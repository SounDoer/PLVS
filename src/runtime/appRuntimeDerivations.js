import {
  roleTokensToLabels,
  roleTokensToLoudnessWeights,
  seedTokensFromLabels,
} from "../math/channelRoles.js";
import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";
import { getPanelControls } from "../workspace/panelControlInstances.js";
import { DEFAULT_DIALOGUE_VAD_ENGINE } from "../lib/dialogueVadEngines.js";

export const DIALOGUE_STAT_IDS = [
  "dialogueCoverage",
  "dialogueIntegrated",
  "dialogueRange",
  "dialogueOffset",
];

export function deriveBackendAnalysisRequests(requests) {
  return {
    spectrum: requests.spectrumRequests.map((request) => ({
      key: request.key,
      channel: request.channel,
      view: request.view,
      smoothingPercent: request.smoothingPercent,
      tiltDbPerOctave: request.tiltDbPerOctave,
    })),
    vectorscope: requests.vectorscopeRequests.map((request) => ({
      key: request.key,
      x: request.pair.x,
      y: request.pair.y,
    })),
  };
}

export function deriveChannelLabelRuntime({
  channelCount,
  layoutResolution,
  channelLabelOverrides,
}) {
  const channelLabelOverride =
    channelCount > 0 ? (channelLabelOverrides[channelCount] ?? null) : null;
  const overrideLabels = channelLabelOverride ? roleTokensToLabels(channelLabelOverride) : null;
  const channelAutoLabels =
    channelCount > 0
      ? getPeakMeterChannelLabels(channelCount, {
          channelLayout: "auto",
          resolvedLayout: layoutResolution.resolved,
        })
      : [];

  return {
    channelLabelOverride,
    overrideLabels,
    loudnessWeights: channelLabelOverride
      ? roleTokensToLoudnessWeights(channelLabelOverride)
      : null,
    channelAutoLabels,
    channelLabelTokens: channelLabelOverride ?? seedTokensFromLabels(channelAutoLabels),
    peakLabelContext: {
      channelLayout: "auto",
      resolvedLayout: channelCount === 0 ? "stereo" : layoutResolution.resolved,
      overrideLabels,
    },
  };
}

export function deriveDialogueRuntime(workspaceState) {
  for (const panelId of workspaceState.panelOrder) {
    const panel = workspaceState.panelsById[panelId];
    if (panel?.moduleId !== "stats") continue;
    const controls = getPanelControls(workspaceState, panelId);
    if (controls.statsVisibleIds.some((id) => DIALOGUE_STAT_IDS.includes(id))) {
      return {
        dialogueGating: true,
        dialogueVadEngine: controls.dialogueVadEngine ?? DEFAULT_DIALOGUE_VAD_ENGINE,
      };
    }
  }

  return {
    dialogueGating: false,
    dialogueVadEngine: DEFAULT_DIALOGUE_VAD_ENGINE,
  };
}
