// Catalog, not registry: these helpers only need module identity and titles, and this file is
// imported by logic-only modules that must not pull in the panel components. The one lookup that
// does need them, resolvePanelDefinition, lives in registry.jsx.
import { MODULE_CATALOG } from "./moduleCatalog.js";

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

function unnamedPanelIdsForModule(state, moduleId) {
  return (state.panelOrder ?? []).filter((id) => {
    const panel = state.panelsById?.[id];
    return panel?.moduleId === moduleId && !trimCustomTitle(panel.customTitle);
  });
}

export function hasKnownModulesOnly(stateLike) {
  const panelsById = stateLike?.panelsById;
  if (!panelsById || typeof panelsById !== "object") return true;
  return Object.values(panelsById).every((panel) => Boolean(MODULE_CATALOG[panel?.moduleId]));
}

export function resolvePanelDisplayName(state, panelId) {
  const panel = state.panelsById?.[panelId];
  if (!panel) return panelId;

  const customTitle = trimCustomTitle(panel.customTitle);
  if (customTitle) return customTitle;

  const baseTitle = MODULE_CATALOG[panel.moduleId]?.title ?? panel.moduleId;
  const unnamedIds = unnamedPanelIdsForModule(state, panel.moduleId);
  if (unnamedIds.length <= 1) return baseTitle;

  const index = unnamedIds.indexOf(panelId);
  return index >= 0 ? `${baseTitle} ${index + 1}` : baseTitle;
}
