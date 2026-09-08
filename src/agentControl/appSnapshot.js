import { getPanelControls } from "../workspace/panelControlInstances.js";
import { resolvePanelDisplayName } from "../workspace/panelInstances.js";
import { readPublicPanelAnalysis } from "./panelAnalysis.js";
import { readPublicPanelAxes } from "./panelAxes.js";
import { readPublicPanelControls } from "./panelControls.js";
import { serializeWorkspaceLayout } from "./workspaceLayout.js";
import { runningAppCommandEntries } from "./commandManifest.js";
import { buildModuleList } from "./moduleControl.js";

function featureGateAvailable(featureGate, visual) {
  if (featureGate === undefined) return true;
  if (featureGate === "visual") return visual !== undefined;
  if (featureGate === "visual.screenshot") return visual?.screenshot === true;
  if (featureGate === "visual.recording") return visual?.recording === true;
  return false;
}

export function buildAgentControlPanelSnapshot({
  workspace,
  panelId,
  hasLoudnessReference = false,
  analysisContext = {},
}) {
  const panel = workspace.panelsById[panelId];
  return {
    id: panelId,
    moduleId: panel.moduleId,
    title: resolvePanelDisplayName(workspace, panelId),
    controls: readPublicPanelControls(panel.moduleId, getPanelControls(workspace, panelId), {
      hasLoudnessReference,
    }),
    axes: readPublicPanelAxes(workspace, panelId),
    analysis: readPublicPanelAnalysis(workspace, panelId, analysisContext),
  };
}

export function buildAgentControlCapabilities(runtime, revision) {
  const visual = runtime?.visual;
  return {
    revision,
    appVersion: String(runtime.appVersion),
    protocolVersion: 1,
    features: visual
      ? {
          visual: {
            screenshot: visual.screenshot === true,
            recording: visual.recording === true,
          },
        }
      : {},
    runtime: {
      available: runtime.available === true,
      appName: String(runtime.appName),
      appVersion: String(runtime.appVersion),
      identifier: String(runtime.identifier),
      platform: String(runtime.platform),
    },
    methods: runningAppCommandEntries
      .filter(({ featureGate }) => featureGateAvailable(featureGate, visual))
      .map(({ wireMethod }) => wireMethod),
    modules: buildModuleList(),
  };
}

export function buildAgentControlSnapshot({
  runtime,
  revision,
  workspace,
  presets,
  appearance,
  loudnessProfile,
  settings,
  transport,
  device,
  dock,
  view,
  hasLoudnessReference = false,
  analysisContext = {},
}) {
  const detectedChannelCount =
    Number.isInteger(analysisContext.channelCount) && analysisContext.channelCount > 0
      ? analysisContext.channelCount
      : null;
  return {
    revision,
    app: {
      name: String(runtime.appName),
      version: String(runtime.appVersion),
      identifier: String(runtime.identifier),
      platform: String(runtime.platform),
    },
    protocolVersion: 1,
    runtime: {
      channelTopology: {
        status: detectedChannelCount === null ? "assumed" : "detected",
        channelCount: detectedChannelCount ?? 2,
      },
      dialogueDetection:
        analysisContext.dialogueDetectionActive === true ? "active" : "notRequested",
      spectralWaveform: analysisContext.spectralWaveformActive === true ? "active" : "notRequested",
    },
    workspace: {
      layout: serializeWorkspaceLayout(workspace),
      panels: workspace.panelOrder.map((panelId) =>
        buildAgentControlPanelSnapshot({
          workspace,
          panelId,
          hasLoudnessReference,
          analysisContext,
        })
      ),
    },
    preset: {
      activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
      dirty: presets?.dirty === true,
    },
    ...(appearance ? { appearance } : {}),
    ...(loudnessProfile ? { loudnessProfile } : {}),
    ...(settings ? { settings } : {}),
    ...(transport ? { transport } : {}),
    ...(device ? { device } : {}),
    ...(dock ? { dock } : {}),
    ...(view ? { view } : {}),
  };
}

export function readAgentControlRuntime() {
  const injected = globalThis.window?.__PLVS_INITIAL_STATE__?.agentControl;
  if (!injected || injected.available !== true) return { available: false, enabled: false };
  return {
    available: true,
    enabled: injected.enabled === true,
    appName: injected.appName,
    appVersion: injected.appVersion,
    identifier: injected.identifier,
    platform: injected.platform,
  };
}
