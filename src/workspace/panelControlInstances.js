import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../lib/panelControls.js";

export function createDefaultPanelControls() {
  return normalizePanelControls(DEFAULT_PANEL_CONTROLS);
}

export function normalizePanelControlsById(panelsById = {}, panelControlsById = {}) {
  return Object.fromEntries(
    Object.keys(panelsById).map((id) => [
      id,
      normalizePanelControls(panelControlsById?.[id] ?? DEFAULT_PANEL_CONTROLS),
    ])
  );
}

export function getPanelControls(state, panelId) {
  return normalizePanelControls(
    state?.panelControlsById?.[panelId] ?? state?.panelControls ?? DEFAULT_PANEL_CONTROLS
  );
}

export function updatePanelControlsById(panelControlsById, panelId, panelControls) {
  return {
    ...panelControlsById,
    [panelId]: normalizePanelControls(panelControls),
  };
}
