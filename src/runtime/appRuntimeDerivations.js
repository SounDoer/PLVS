import { roleTokensToLabels, seedTokensFromLabels } from "../math/channelRoles.js";
import { layoutIdForRoles, standardLayoutIdForCount } from "../math/channelLayoutTable.js";
import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";

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
    vectorscope: requests.vectorscopeRequests.map(
      (/** @type {{ key: any; pair: { x: any; y: any; }; }} */ request) => ({
        key: request.key,
        x: request.pair.x,
        y: request.pair.y,
      })
    ),
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
  // Panels keep a two-channel placeholder before capture reports a real topology. Label that
  // assumed topology as stereo; a detected but unidentified topology must still use Ch N labels.
  const displayLayoutId = channelCount === 0 ? "stereo" : autoLayoutId;
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
    peakLabelContext:
      /** @type {import("../math/peakMeterChannelLabels.js").PeakMeterChannelLabelsContext} */ ({
        formatId: displayLayoutId ?? undefined,
        resolvedLayout: displayLayoutId ? undefined : "unknown",
        overrideLabels,
      }),
  };
}

/// Dialogue analysis is a measurement capability, not a rendering side effect. It remains active
/// even when no Stats panel currently exposes one of its readings.
export function deriveDialogueRuntime(workspaceState) {
  void workspaceState;
  return { dialogueGating: true };
}
