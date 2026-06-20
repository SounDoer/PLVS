import { MODULE_REGISTRY } from "./registry.jsx";

export function createPanelId(moduleId, panelsById = {}) {
  if (!panelsById[moduleId]) return moduleId;
  let index = 2;
  while (panelsById[`${moduleId}-${index}`]) index += 1;
  return `${moduleId}-${index}`;
}

export function trimCustomTitle(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function createPanel(moduleId, panelsById = {}, overrides = {}) {
  const id = overrides.id ?? createPanelId(moduleId, panelsById);
  const customTitle = trimCustomTitle(overrides.customTitle);
  return {
    id,
    moduleId,
    ...(customTitle ? { customTitle } : {}),
    ...(overrides.config ? { config: overrides.config } : {}),
  };
}

export function resolvePanelModuleId(state, panelId) {
  return state.panelsById?.[panelId]?.moduleId ?? null;
}

export function resolvePanelDefinition(state, panelId) {
  const moduleId = resolvePanelModuleId(state, panelId);
  return moduleId ? MODULE_REGISTRY[moduleId] : null;
}

function unnamedPanelIdsForModule(state, moduleId) {
  return (state.panelOrder ?? []).filter((id) => {
    const panel = state.panelsById?.[id];
    return panel?.moduleId === moduleId && !trimCustomTitle(panel.customTitle);
  });
}

export function resolvePanelDisplayName(state, panelId) {
  const panel = state.panelsById?.[panelId];
  if (!panel) return panelId;

  const customTitle = trimCustomTitle(panel.customTitle);
  if (customTitle) return customTitle;

  const baseTitle = MODULE_REGISTRY[panel.moduleId]?.title ?? panel.moduleId;
  const unnamedIds = unnamedPanelIdsForModule(state, panel.moduleId);
  if (unnamedIds.length <= 1) return baseTitle;

  const index = unnamedIds.indexOf(panelId);
  return index >= 0 ? `${baseTitle} ${index + 1}` : baseTitle;
}
