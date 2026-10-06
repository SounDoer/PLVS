import { findLeafWithTab } from "../workspace/treeUtils.js";
import { createUiNavigationError } from "./uiNavigationModel.js";

/**
 * Resolve a Panel Settings request through the business actions owned by the current window form.
 * This adapter deliberately does not mutate either Workspace or Dock state directly.
 *
 * @param {{
 *   panelId: string,
 *   windowForm: string,
 *   workspace: { tree: any, panelsById: Record<string, unknown>, fullscreenId: string | null },
 *   dockPanels: Array<{ id: string, [key: string]: any }>,
 *   setActiveTab: (path: number[], panelId: string) => void,
 *   openDockEditor: (view: string) => void,
 * }} options
 */
export function preparePanelSettingsNavigation({
  panelId,
  windowForm,
  workspace,
  dockPanels,
  setActiveTab,
  openDockEditor,
}) {
  if (windowForm === "dock") {
    if (!dockPanels.some((panel) => panel.id === panelId)) {
      throw createUiNavigationError("uiTargetNotFound", { kind: "panelSettings", panelId });
    }
    openDockEditor(`module:${panelId}`);
    return { handled: true, presentation: "dock" };
  }

  if (!workspace.panelsById[panelId]) {
    throw createUiNavigationError("uiTargetNotFound", { kind: "panelSettings", panelId });
  }
  if (workspace.fullscreenId) {
    if (workspace.fullscreenId !== panelId) {
      throw createUiNavigationError("uiTargetNotVisible", {
        kind: "panelSettings",
        panelId,
        windowForm,
      });
    }
    return { handled: false, presentation: "fullscreen" };
  }

  const path = findLeafWithTab(workspace.tree, panelId);
  if (path === null) {
    throw createUiNavigationError("uiTargetNotVisible", {
      kind: "panelSettings",
      panelId,
      windowForm,
    });
  }
  const leaf = path.reduce((node, index) => node.children[index], workspace.tree);
  if (leaf.activeTab !== panelId) setActiveTab(path, panelId);
  return { handled: false, presentation: "normal" };
}
