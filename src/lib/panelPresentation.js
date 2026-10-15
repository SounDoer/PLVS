/** @typedef {{ workspace: { hidePanelHeaders: boolean, hideAxesAndLabels: boolean }, dock: { hideAxesAndLabels: boolean } }} PanelPresentation */

/** @returns {PanelPresentation} */
export function normalizePanelPresentation(raw, legacyFocusView = {}) {
  return {
    workspace: {
      hidePanelHeaders:
        typeof raw?.workspace?.hidePanelHeaders === "boolean"
          ? raw.workspace.hidePanelHeaders
          : legacyFocusView?.compactPanels === true,
      hideAxesAndLabels: raw?.workspace?.hideAxesAndLabels === true,
    },
    dock: { hideAxesAndLabels: raw?.dock?.hideAxesAndLabels === true },
  };
}

export const DEFAULT_PANEL_PRESENTATION = normalizePanelPresentation(null);
