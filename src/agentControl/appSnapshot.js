import { getPanelControls } from "../workspace/panelControlInstances.js";
import { resolvePanelDisplayName } from "../workspace/panelInstances.js";
import { readPublicPanelAnalysis } from "./panelAnalysis.js";
import { readPublicPanelAxes } from "./panelAxes.js";
import { readPublicPanelControls } from "./panelControls.js";
import { serializeWorkspaceLayout } from "./workspaceLayout.js";
import { DEVICE_CONTROL_METHODS } from "./protocol.js";
import { buildModuleList } from "./moduleControl.js";

const METHODS = [
  "app.capabilities",
  "app.inspect",
  "measurement.describe",
  "measurement.inspect",
  "measurement.wait",
  "view.describe",
  "view.inspect",
  "view.update",
  "view.reset",
  "module.list",
  "module.describe",
  "workspace.applyLayout",
  "axis.describe",
  "axis.inspect",
  "axis.shared.update",
  "axis.shared.reset",
  "axis.panel.update",
  "axis.panel.reset",
  "panel.describe",
  "panel.update",
  "panel.reset",
  "preset.list",
  "preset.describe",
  "preset.rename",
  "preset.delete",
  "preset.reorder",
  "preset.save",
  "preset.update",
  "preset.apply",
  "preset.export",
  "preset.import",
  "theme.list",
  "theme.inspect",
  "theme.describe",
  "theme.select",
  "theme.followSystem",
  "theme.create",
  "theme.update",
  "theme.rename",
  "theme.duplicate",
  "theme.delete",
  "theme.reorder",
  "theme.export",
  "theme.import",
  "loudnessProfile.list",
  "loudnessProfile.describe",
  "loudnessProfile.select",
  "loudnessProfile.create",
  "loudnessProfile.update",
  "loudnessProfile.rename",
  "loudnessProfile.delete",
  "loudnessProfile.reorder",
  "loudnessProfile.export",
  "loudnessProfile.import",
  "config.export",
  "config.import",
  "settings.describe",
  "settings.inspect",
  "settings.update",
  ...DEVICE_CONTROL_METHODS,
  "app.wait",
  "transport.inspect",
  "transport.source.live",
  "transport.source.file",
  "transport.live.start",
  "transport.live.stop",
  "transport.live.clear",
  "transport.file.analyze",
  "transport.file.reanalyze",
  "transport.file.stop",
  "transport.file.select",
  "transport.file.remove",
  "transport.file.clear",
  "dock.describe",
  "dock.inspect",
  "dock.enter",
  "dock.exit",
  "dock.layout.apply",
  "dock.panel.describe",
  "dock.panel.update",
  "dock.panel.reset",
];

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
  return {
    revision,
    appVersion: String(runtime.appVersion),
    protocolVersion: 1,
    features: {},
    runtime: {
      available: runtime.available === true,
      appName: String(runtime.appName),
      appVersion: String(runtime.appVersion),
      identifier: String(runtime.identifier),
      platform: String(runtime.platform),
    },
    methods: [...METHODS],
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
