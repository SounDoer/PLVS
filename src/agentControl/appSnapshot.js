import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import { getPanelControls } from "../workspace/panelControlInstances.js";
import { resolvePanelDisplayName } from "../workspace/panelInstances.js";
import { readPublicPanelAnalysis } from "./panelAnalysis.js";
import { readPublicPanelAxes } from "./panelAxes.js";
import { readPublicPanelControls } from "./panelControls.js";
import { serializeWorkspaceLayout } from "./workspaceLayout.js";

const METHODS = ["app.capabilities", "app.inspect", "workspace.applyLayout"];

export function buildAgentControlCapabilities(runtime) {
  return {
    protocolVersion: 1,
    runtime: {
      available: runtime.available === true,
      appName: String(runtime.appName),
      appVersion: String(runtime.appVersion),
      identifier: String(runtime.identifier),
      platform: String(runtime.platform),
    },
    methods: [...METHODS],
    modules: Object.values(MODULE_CATALOG).map((module) => ({
      moduleId: module.id,
      title: module.title,
    })),
  };
}

export function buildAgentControlSnapshot({
  runtime,
  revision,
  workspace,
  presets,
  hasLoudnessReference = false,
  analysisContext = {},
}) {
  const detectedChannelCount =
    Number.isInteger(analysisContext.channelCount) && analysisContext.channelCount > 0
      ? analysisContext.channelCount
      : null;
  return {
    app: {
      name: String(runtime.appName),
      version: String(runtime.appVersion),
      identifier: String(runtime.identifier),
      platform: String(runtime.platform),
    },
    protocolVersion: 1,
    revisions: { workspace: revision },
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
      panels: workspace.panelOrder.map((panelId) => ({
        id: panelId,
        moduleId: workspace.panelsById[panelId].moduleId,
        title: resolvePanelDisplayName(workspace, panelId),
        controls: readPublicPanelControls(
          workspace.panelsById[panelId].moduleId,
          getPanelControls(workspace, panelId),
          { hasLoudnessReference }
        ),
        axes: readPublicPanelAxes(workspace, panelId),
        analysis: readPublicPanelAnalysis(workspace, panelId, analysisContext),
      })),
    },
    preset: {
      activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
      dirty: presets?.dirty === true,
    },
  };
}

export function readAgentControlRuntime() {
  const injected = globalThis.window?.__PLVS_INITIAL_STATE__?.agentControl;
  if (!injected || injected.available !== true) return { available: false };
  return {
    available: true,
    appName: injected.appName,
    appVersion: injected.appVersion,
    identifier: injected.identifier,
    platform: injected.platform,
  };
}
