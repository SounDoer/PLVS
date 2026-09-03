import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import { resolvePanelDisplayName } from "../workspace/panelInstances.js";
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

export function buildAgentControlSnapshot({ runtime, revision, workspace, presets }) {
  return {
    app: {
      name: String(runtime.appName),
      version: String(runtime.appVersion),
      identifier: String(runtime.identifier),
      platform: String(runtime.platform),
    },
    protocolVersion: 1,
    revisions: { workspace: revision },
    workspace: {
      layout: serializeWorkspaceLayout(workspace),
      panels: workspace.panelOrder.map((panelId) => ({
        panelId,
        moduleId: workspace.panelsById[panelId].moduleId,
        title: resolvePanelDisplayName(workspace, panelId),
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
