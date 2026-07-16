export const DOCK_PANEL_SIZING_BY_MODULE_ID = Object.freeze({
  levelMeter: {
    minWidth: 140,
    defaultWidth: 180,
    maxPreferredWidth: 420,
    growthPolicy: "fixed",
  },
  loudness: {
    minWidth: 154,
    defaultWidth: 200,
    maxPreferredWidth: 480,
    growthPolicy: "fixed",
  },
  spectrum: {
    minWidth: 180,
    defaultWidth: 360,
    maxPreferredWidth: 960,
    growthPolicy: "flexible",
  },
  vectorscope: {
    minWidth: 160,
    defaultWidth: 220,
    maxPreferredWidth: 360,
    growthPolicy: "fixed",
  },
  stats: {
    minWidth: 160,
    defaultWidth: 240,
    maxPreferredWidth: 420,
    growthPolicy: "fixed",
  },
  waveform: {
    minWidth: 160,
    defaultWidth: 300,
    maxPreferredWidth: 960,
    growthPolicy: "flexible",
  },
  spectrogram: {
    minWidth: 180,
    defaultWidth: 320,
    maxPreferredWidth: 960,
    growthPolicy: "flexible",
  },
  transport: {
    minWidth: 90,
    defaultWidth: 120,
    maxPreferredWidth: 180,
    growthPolicy: "fixed",
  },
});

const LEGACY_MODULE_ID = Object.freeze({
  level: "levelMeter",
  correlation: "vectorscope",
});

export function getDockPanelSizing(moduleId) {
  const normalized = LEGACY_MODULE_ID[moduleId] ?? moduleId;
  return (
    DOCK_PANEL_SIZING_BY_MODULE_ID[normalized] ?? {
      minWidth: 100,
      defaultWidth: 180,
      maxPreferredWidth: 480,
      growthPolicy: "fixed",
    }
  );
}

export function clampDockPanelWidth(value, minWidth, maxPreferredWidth) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(minWidth, Math.min(maxPreferredWidth, number));
}

export function normalizeDockPanelSizes(panelsById, raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
  for (const [panelId, panel] of Object.entries(panelsById ?? {})) {
    const sizing = getDockPanelSizing(panel?.moduleId);
    const width = clampDockPanelWidth(raw[panelId], sizing.minWidth, sizing.maxPreferredWidth);
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
  const safeLeft = clampDockPanelWidth(
    Number(leftWidth) || leftSizing.defaultWidth,
    leftSizing.minWidth,
    leftSizing.maxPreferredWidth
  );
  const safeRight = clampDockPanelWidth(
    Number(rightWidth) || rightSizing.defaultWidth,
    rightSizing.minWidth,
    rightSizing.maxPreferredWidth
  );
  const minDelta = Math.max(
    leftSizing.minWidth - safeLeft,
    safeRight - rightSizing.maxPreferredWidth
  );
  const maxDelta = Math.min(
    leftSizing.maxPreferredWidth - safeLeft,
    safeRight - rightSizing.minWidth
  );
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
