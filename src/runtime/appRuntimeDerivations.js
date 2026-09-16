import { roleTokensToLabels, seedTokensFromLabels } from "../math/channelRoles.js";
import { layoutIdForRoles, standardLayoutIdForCount } from "../math/channelLayoutTable.js";
import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";
import { getPanelControls } from "../workspace/panelControlInstances.js";

export const DIALOGUE_STAT_IDS = [
  "dialogueCoverage",
  "dialogueIntegrated",
  "dialogueRange",
  "dialogueOffset",
];

/// Every request-family array and every request field here is required by `AnalysisRequests` in
/// src-tauri/src/ipc/types.rs, which declares no serde defaults. A missing field fails
/// deserialization of the whole `set_analysis_requests` payload. Adding a request family or
/// request field means adding it here.
export function deriveBackendAnalysisRequests(requests) {
  return {
    spectrum: requests.spectrumRequests.map((request) => ({
      key: request.key,
      channel: request.channel,
      view: request.view,
      speedPercent: request.speedPercent,
      octaveSmoothing: request.octaveSmoothing,
    })),
    vectorscope: requests.vectorscopeRequests.map((request) => ({
      key: request.key,
      x: request.pair.x,
      y: request.pair.y,
    })),
    stereoMap: requests.stereoMapRequests.map((request) => ({
      key: request.key,
      pair: request.pair,
      speedPercent: request.speedPercent,
      octaveSmoothing: request.octaveSmoothing,
    })),
    spectralWaveform: requests.spectralWaveform === true,
  };
}

export function deriveChannelLabelRuntime({ channelCount, channelLabelOverrides }) {
  const channelLabelOverride =
    channelCount > 0 ? (channelLabelOverrides[channelCount] ?? null) : null;
  const overrideLabels = channelLabelOverride ? roleTokensToLabels(channelLabelOverride) : null;
  const autoLayoutId = channelCount > 0 ? standardLayoutIdForCount(channelCount) : null;
  const channelAutoLabels =
    channelCount > 0
      ? getPeakMeterChannelLabels(channelCount, {
          formatId: autoLayoutId ?? undefined,
          resolvedLayout: autoLayoutId ? undefined : "unknown",
        })
      : [];

  return {
    channelLabelOverride,
    channelRoles: channelLabelOverride,
    selectedLayoutId: channelLabelOverride
      ? (layoutIdForRoles(channelLabelOverride) ?? "custom")
      : autoLayoutId,
    overrideLabels,
    channelAutoLabels,
    channelLabelTokens: channelLabelOverride ?? seedTokensFromLabels(channelAutoLabels),
    peakLabelContext: {
      formatId: autoLayoutId ?? undefined,
      resolvedLayout: autoLayoutId ? undefined : "unknown",
      overrideLabels,
    },
  };
}

/// Whether any Stats panel is showing a dialogue row. Showing one is what turns the detector on;
/// which detector runs is a global setting, not a panel control.
export function deriveDialogueRuntime(workspaceState) {
  for (const panelId of workspaceState.panelOrder) {
    const panel = workspaceState.panelsById[panelId];
    if (panel?.moduleId !== "stats") continue;
    const controls = getPanelControls(workspaceState, panelId);
    if (controls.statsVisibleIds.some((id) => DIALOGUE_STAT_IDS.includes(id))) {
      return { dialogueGating: true };
    }
  }

  return { dialogueGating: false };
}
