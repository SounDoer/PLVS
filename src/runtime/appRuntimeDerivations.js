import { roleTokensToLabels, seedTokensFromLabels } from "../math/channelRoles.js";
import { layoutIdForRoles, standardLayoutIdForCount } from "../math/channelLayoutTable.js";
import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";
import { buildSpectrumChannelOptions } from "../math/spectrumChannelOptions.js";
import { deriveAnalysisRequests } from "../analysis/analysisRequests.js";
import {
  effectiveWorkspaceState,
  resolveEffectiveChannelControls,
} from "../analysis/effectiveChannels.js";
import { mergeDockAnalysisRequests } from "../dock/dockAnalysisRequest.js";
import { dockModuleIdForPanelModuleId } from "../dock/dockLayout.js";

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

export function deriveSpectrumChannelOptions(channelCount, peakLabelContext) {
  const count = channelCount >= 2 ? channelCount : 2;
  return buildSpectrumChannelOptions(count, getPeakMeterChannelLabels(count, peakLabelContext));
}

export function resolveDockAnalysisPanels(panels, topology) {
  return panels.map((panel) => {
    const { controls, unavailable } = resolveEffectiveChannelControls(
      dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId,
      panel.controls,
      topology
    );
    return unavailable ? { ...panel, controls } : panel;
  });
}

export function resolveFileAnalysisSettings(settings, requestInputs, selectedTrack) {
  // Restore History and callers with an explicit request list use the original settings.
  if (!requestInputs) return settings;
  const { workspaceState, dockPanels } = requestInputs;
  const channelCount = selectedTrack?.channels ?? 0;
  const { peakLabelContext } = deriveChannelLabelRuntime({
    channelCount,
    channelLabelOverrides: settings.channelRolesByCount ?? {},
    autoChannelRoles: selectedTrack?.channelRoles,
  });
  const topology = {
    channelCount,
    peakLabelContext,
    spectrumChannelOptions: deriveSpectrumChannelOptions(channelCount, peakLabelContext),
  };
  const derived = deriveAnalysisRequests(effectiveWorkspaceState(workspaceState, topology), {
    channelCount,
  });
  const dock = dockPanels ? resolveDockAnalysisPanels(dockPanels, topology) : false;
  return {
    ...settings,
    requests: deriveBackendAnalysisRequests(mergeDockAnalysisRequests(derived, dock)),
  };
}

export function deriveChannelLabelRuntime({
  channelCount,
  channelLabelOverrides,
  autoChannelRoles = null,
}) {
  const channelLabelOverride =
    channelCount > 0 ? (channelLabelOverrides[channelCount] ?? null) : null;
  const overrideLabels = channelLabelOverride ? roleTokensToLabels(channelLabelOverride) : null;
  const nativeRoles =
    Array.isArray(autoChannelRoles) && autoChannelRoles.length === channelCount
      ? autoChannelRoles
      : null;
  const nativeLabels = nativeRoles ? roleTokensToLabels(nativeRoles) : null;
  const autoLayoutId = nativeRoles
    ? layoutIdForRoles(nativeRoles)
    : channelCount > 0
      ? standardLayoutIdForCount(channelCount)
      : null;
  // Panels keep a two-channel placeholder before capture reports a real topology. Label that
  // assumed topology as stereo; a detected but unidentified topology must still use Ch N labels.
  const displayLayoutId = channelCount === 0 ? "stereo" : autoLayoutId;
  const channelAutoLabels =
    nativeLabels ??
    (channelCount > 0
      ? getPeakMeterChannelLabels(channelCount, {
          formatId: autoLayoutId ?? undefined,
          resolvedLayout: autoLayoutId ? undefined : "unknown",
        })
      : []);

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
        overrideLabels: overrideLabels ?? nativeLabels,
      }),
  };
}

/// Dialogue analysis is a measurement capability, not a rendering side effect. It remains active
/// even when no Stats panel currently exposes one of its readings.
export function deriveDialogueRuntime(workspaceState) {
  void workspaceState;
  return { dialogueGating: true };
}
