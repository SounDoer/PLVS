const MAX_PANEL_WIDTH = 4000;

export const DOCK_PANEL_SIZING_BY_MODULE_ID = Object.freeze({
  levelMeter: { defaultWidth: 180, minWidth: 140, flexible: false },
  loudness: { defaultWidth: 200, minWidth: 150, flexible: false },
  spectrum: { defaultWidth: 360, minWidth: 180, flexible: true },
  vectorscope: { defaultWidth: 220, minWidth: 160, flexible: false },
  stats: { defaultWidth: 240, minWidth: 160, flexible: false },
  waveform: { defaultWidth: 300, minWidth: 160, flexible: true },
  spectrogram: { defaultWidth: 320, minWidth: 180, flexible: true },
  transport: { defaultWidth: 120, minWidth: 90, flexible: false },
});

const LEGACY_MODULE_ID = Object.freeze({
  level: "levelMeter",
  correlation: "vectorscope",
});

export function getDockPanelSizing(moduleId) {
  const normalized = LEGACY_MODULE_ID[moduleId] ?? moduleId;
  return (
    DOCK_PANEL_SIZING_BY_MODULE_ID[normalized] ?? {
      defaultWidth: 180,
      minWidth: 100,
      flexible: false,
    }
  );
}

export function clampDockPanelWidth(value, minWidth) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(minWidth, Math.min(MAX_PANEL_WIDTH, number));
}

export function normalizeDockPanelSizes(panelsById, raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
  for (const [panelId, panel] of Object.entries(panelsById ?? {})) {
    const sizing = getDockPanelSizing(panel?.moduleId);
    const width = clampDockPanelWidth(raw[panelId], sizing.minWidth);
    if (width !== null) normalized[panelId] = width;
  }
  return normalized;
}

export function resizeDockPanelPair({
  panelSizesById,
  leftPanel,
  rightPanel,
  leftWidth,
  rightWidth,
  delta,
}) {
  if (!leftPanel || !rightPanel) return panelSizesById;
  const leftSizing = getDockPanelSizing(leftPanel.moduleId);
  const rightSizing = getDockPanelSizing(rightPanel.moduleId);
  const safeLeft = Math.max(leftSizing.minWidth, Number(leftWidth) || leftSizing.defaultWidth);
  const safeRight = Math.max(rightSizing.minWidth, Number(rightWidth) || rightSizing.defaultWidth);
  const minDelta = leftSizing.minWidth - safeLeft;
  const maxDelta = safeRight - rightSizing.minWidth;
  const safeDelta = Math.max(minDelta, Math.min(maxDelta, Number(delta) || 0));
  return {
    ...panelSizesById,
    [leftPanel.id]: safeLeft + safeDelta,
    [rightPanel.id]: safeRight - safeDelta,
  };
}

export function resetDockPanelPair(panelSizesById, leftPanelId, rightPanelId) {
  const next = { ...panelSizesById };
  delete next[leftPanelId];
  delete next[rightPanelId];
  return next;
}
