import { normalizeDockPanelSizes } from "./dockPanelSizing.js";

/** Workspace panel module ids that Dock can render, in the normal app catalog order. */
export const DOCK_PANEL_MODULE_IDS = [
  "transport",
  "levelMeter",
  "loudness",
  "stats",
  "vectorscope",
  "spectrum",
  "spectrogram",
  "waveform",
];

/** Legacy dock module ids, in catalog order (kept in sync with registry.jsx). */
export const DOCK_MODULE_IDS = [
  "level",
  "loudness",
  "spectrum",
  "correlation",
  "stats",
  "waveform",
  "spectrogram",
  "transport",
];

/** Complete first-run Dock layout, ordered from transport/readouts to history views. */
export const DEFAULT_DOCK_MODULES = [
  "transport",
  "level",
  "loudness",
  "stats",
  "correlation",
  "spectrum",
  "spectrogram",
  "waveform",
];

export const DOCK_MODULE_ID_BY_PANEL_MODULE_ID = Object.freeze({
  levelMeter: "level",
  loudness: "loudness",
  stats: "stats",
  vectorscope: "correlation",
  spectrum: "spectrum",
  spectrogram: "spectrogram",
  waveform: "waveform",
  transport: "transport",
});

export const PANEL_MODULE_ID_BY_DOCK_MODULE_ID = Object.freeze({
  level: "levelMeter",
  loudness: "loudness",
  stats: "stats",
  correlation: "vectorscope",
  spectrum: "spectrum",
  spectrogram: "spectrogram",
  waveform: "waveform",
  transport: "transport",
});

function trimCustomTitle(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function dockModuleIdForPanelModuleId(moduleId) {
  return DOCK_MODULE_ID_BY_PANEL_MODULE_ID[moduleId] ?? null;
}

export function panelModuleIdForDockModuleId(moduleId) {
  return PANEL_MODULE_ID_BY_DOCK_MODULE_ID[moduleId] ?? moduleId;
}

export function isKnownDockPanelModuleId(moduleId) {
  return DOCK_PANEL_MODULE_IDS.includes(moduleId) || moduleId === "transport";
}

export function createDockPanelId(moduleId, panelsById = {}) {
  const base = String(moduleId || "panel");
  if (!panelsById[base]) return base;
  let index = 2;
  while (panelsById[`${base}-${index}`]) index += 1;
  return `${base}-${index}`;
}

export function createDockPanel(moduleId, panelsById = {}, overrides = {}) {
  const normalizedModuleId = panelModuleIdForDockModuleId(moduleId);
  if (!isKnownDockPanelModuleId(normalizedModuleId)) return null;
  const id = overrides.id ?? createDockPanelId(normalizedModuleId, panelsById);
  const customTitle = trimCustomTitle(overrides.customTitle);
  return {
    id,
    moduleId: normalizedModuleId,
    ...(customTitle ? { customTitle } : {}),
  };
}

function panelFromLegacyModule(moduleId, panelsById) {
  const panelModuleId = panelModuleIdForDockModuleId(moduleId);
  return createDockPanel(panelModuleId, panelsById, { id: moduleId });
}

function legacyModulesFromPanels(panelsById, panelOrder) {
  return panelOrder
    .map((panelId) => dockModuleIdForPanelModuleId(panelsById[panelId]?.moduleId))
    .filter(Boolean);
}

function withLegacyModules(layout) {
  return {
    ...layout,
    modules: legacyModulesFromPanels(layout.panelsById, layout.panelOrder),
  };
}

function ensureDockLayout(layout) {
  if (layout?.panelsById && Array.isArray(layout.panelOrder)) return withLegacyModules(layout);
  return normalizeDockLayout(layout);
}

/** Normalize the persisted `dock` value from workspaceStore. */
export function normalizeDockLayout(raw) {
  if (raw && typeof raw === "object" && raw.panelsById && Array.isArray(raw.panelOrder)) {
    const panelsById = {};
    const panelOrder = [];
    for (const id of raw.panelOrder) {
      const rawPanel = raw.panelsById?.[id];
      const panel = createDockPanel(rawPanel?.moduleId, panelsById, {
        id,
        customTitle: rawPanel?.customTitle,
      });
      if (!panel || panelsById[panel.id]) continue;
      panelsById[panel.id] = panel;
      panelOrder.push(panel.id);
    }
    return withLegacyModules({
      panelsById,
      panelOrder,
      panelSizesById: normalizeDockPanelSizes(panelsById, raw.panelSizesById),
    });
  }
  const list = raw && typeof raw === "object" ? raw.modules : undefined;
  const source = Array.isArray(list) ? list : DEFAULT_DOCK_MODULES;
  const panelsById = {};
  const panelOrder = [];
  for (const id of source) {
    if (!DOCK_MODULE_IDS.includes(id)) continue;
    const panel = panelFromLegacyModule(id, panelsById);
    if (!panel || panelsById[panel.id]) continue;
    panelsById[panel.id] = panel;
    panelOrder.push(panel.id);
  }
  return withLegacyModules({ panelsById, panelOrder, panelSizesById: {} });
}

export function toggleDockModule(layout, id) {
  const moduleId = panelModuleIdForDockModuleId(id);
  if (!isKnownDockPanelModuleId(moduleId)) return layout;
  layout = ensureDockLayout(layout);
  const existing = layout.panelOrder.find(
    (panelId) => layout.panelsById[panelId]?.moduleId === moduleId
  );
  if (existing) return removeDockPanel(layout, existing);
  return addDockPanel(layout, moduleId);
}

export function reorderDockModule(layout, fromIndex, toIndex) {
  layout = ensureDockLayout(layout);
  const panelOrder = [...layout.panelOrder];
  const clamp = (i) => Math.max(0, Math.min(panelOrder.length - 1, i));
  const from = clamp(fromIndex);
  const to = clamp(toIndex);
  if (from === to) return layout;
  const [moved] = panelOrder.splice(from, 1);
  panelOrder.splice(to, 0, moved);
  return withLegacyModules({ ...layout, panelOrder });
}

export function addDockPanel(layout, moduleId) {
  layout = ensureDockLayout(layout);
  const panel = createDockPanel(moduleId, layout.panelsById);
  if (!panel) return layout;
  return withLegacyModules({
    ...layout,
    panelsById: { ...layout.panelsById, [panel.id]: panel },
    panelOrder: [...layout.panelOrder, panel.id],
  });
}

export function removeDockPanel(layout, panelId) {
  layout = ensureDockLayout(layout);
  if (!layout.panelsById[panelId]) return layout;
  const { [panelId]: _removed, ...panelsById } = layout.panelsById;
  const { [panelId]: _removedSize, ...panelSizesById } = layout.panelSizesById ?? {};
  return withLegacyModules({
    ...layout,
    panelsById,
    panelSizesById,
    panelOrder: layout.panelOrder.filter((id) => id !== panelId),
  });
}

export function renameDockPanel(layout, panelId, customTitle) {
  layout = ensureDockLayout(layout);
  const panel = layout.panelsById[panelId];
  if (!panel) return layout;
  const title = trimCustomTitle(customTitle);
  const nextPanel = { ...panel };
  if (title) nextPanel.customTitle = title;
  else delete nextPanel.customTitle;
  return withLegacyModules({
    ...layout,
    panelsById: { ...layout.panelsById, [panelId]: nextPanel },
  });
}

export function setDockPanelOrder(layout, panelOrder) {
  layout = ensureDockLayout(layout);
  if (!Array.isArray(panelOrder)) return layout;
  const seen = new Set();
  const nextOrder = [];
  for (const id of panelOrder) {
    if (!layout.panelsById[id] || seen.has(id)) continue;
    seen.add(id);
    nextOrder.push(id);
  }
  return withLegacyModules({ ...layout, panelOrder: nextOrder });
}
