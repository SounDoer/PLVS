import { UI_PREFERENCES } from "../preferences/data.js";
import { resolveInterfacePreferences } from "../preferences/interfaceSize.js";
import { vectorDockMinWidth } from "../lib/vectorscopeSizing.js";
import { normalizeDockModuleControls } from "./dockModuleControls.js";
import { dockStatsCellWidth, recommendedDockStatsWidth } from "./dockStatsLayout.js";
import { dockMinHeight } from "./dockSizing.js";

// Serialization bound, not a layout cap. Rendered widths are fitted to the viewport.
export const DOCK_MAX_PREFERRED_WIDTH = 0xffffffff;

export const DOCK_PANEL_SIZING_BY_MODULE_ID = Object.freeze({
  levelMeter: {
    minWidth: 140,
    defaultWidth: 180,
    maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    growthPolicy: "fixed",
  },
  loudness: {
    minWidth: 180,
    defaultWidth: 200,
    maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    growthPolicy: "flexible",
  },
  spectrum: {
    minWidth: 180,
    defaultWidth: 360,
    maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    growthPolicy: "flexible",
  },
  vectorscope: {
    minWidth: vectorDockMinWidth(UI_PREFERENCES.typography.sizesPx.axis),
    defaultWidth: 220,
    maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    growthPolicy: "fixed",
  },
  stats: {
    minWidth: 160,
    defaultWidth: 440,
    maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    growthPolicy: "fixed",
  },
  waveform: {
    minWidth: 180,
    defaultWidth: 300,
    maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    growthPolicy: "flexible",
  },
  spectrogram: {
    minWidth: 180,
    defaultWidth: 320,
    maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    growthPolicy: "flexible",
  },
  "stereo-map": {
    minWidth: 180,
    defaultWidth: 360,
    maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    growthPolicy: "flexible",
  },
});

const LEGACY_MODULE_ID = Object.freeze({
  level: "levelMeter",
  correlation: "vectorscope",
});

/**
 * @param {string} moduleId
 */
export function getDockPanelSizing(
  moduleId,
  interfaceSize = "small",
  showAxes = true,
  options = {}
) {
  const normalized = LEGACY_MODULE_ID[moduleId] ?? moduleId;
  const { typography } = resolveInterfacePreferences(UI_PREFERENCES, interfaceSize);
  const font = typography.sizesPx;
  const base = DOCK_PANEL_SIZING_BY_MODULE_ID[normalized] ?? {
    minWidth: 100,
    defaultWidth: 180,
    maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    growthPolicy: "fixed",
  };
  if (normalized === "vectorscope") {
    return {
      ...base,
      minWidth: vectorDockMinWidth(font.axis, showAxes),
    };
  }
  const plotMinimum = 180 + Math.max(0, font.axis - 12) * (showAxes ? 8 : 4);
  if (normalized === "levelMeter") {
    const controls = normalizeDockModuleControls("level", options.controls);
    const horizontal = ["left-to-right", "right-to-left"].includes(controls.levelMeterOrientation);
    // Five mono glyphs per readout (0.6em each), plus inter-channel spacing and axis rail.
    const channels = ["peak", "rms"].includes(controls.levelMeterMode)
      ? Math.max(1, Math.floor(Number(options.channelCount) || 2))
      : 1;
    return {
      ...base,
      growthPolicy: horizontal ? "flexible" : "fixed",
      minWidth: horizontal
        ? plotMinimum
        : Math.ceil(16 + (showAxes ? 2 * font.axis : 0) + channels * (3 * font.metricValue + 3)),
    };
  }
  if (normalized === "stats") {
    const controls = normalizeDockModuleControls("stats", options.controls);
    return {
      ...base,
      minWidth: dockStatsCellWidth(font, controls.statsVisibleIds) + 12,
      // Keep the last column across fractional CSS/device-pixel rounding during native resizing.
      defaultWidth:
        recommendedDockStatsWidth(
          dockMinHeight(interfaceSize),
          controls.statsVisibleIds.length,
          font,
          controls.statsVisibleIds
        ) + 2,
    };
  }
  return { ...base, minWidth: base.growthPolicy === "flexible" ? plotMinimum : base.minWidth };
}

/**
 * @param {number} minWidth
 * @param {number} maxPreferredWidth
 */
export function clampDockPanelWidth(value, minWidth, maxPreferredWidth) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(minWidth, Math.min(maxPreferredWidth, number));
}

export function normalizeDockPanelSizes(panelsById, raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
  for (const [panelId, panel] of Object.entries(panelsById ?? {})) {
    // A saved preference must survive a temporary change of font, orientation or channel count.
    if (!panel || raw[panelId] == null) continue;
    const width = clampDockPanelWidth(raw[panelId], 1, DOCK_MAX_PREFERRED_WIDTH);
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
  interfaceSize = "small",
  showAxes = true,
  controlsByPanelId = {},
  channelCount = 2,
}) {
  if (!leftPanel || !rightPanel) return panelSizesById;
  const leftSizing = getDockPanelSizing(leftPanel.moduleId, interfaceSize, showAxes, {
    controls: controlsByPanelId[leftPanel.id],
    channelCount,
  });
  const rightSizing = getDockPanelSizing(rightPanel.moduleId, interfaceSize, showAxes, {
    controls: controlsByPanelId[rightPanel.id],
    channelCount,
  });
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

/** Fit preferences without writing them back. Overflow retains every panel's readable minimum. */
export function fitDockPanelWidths(entries, availableWidth) {
  const widths = entries.map((entry) => Math.max(entry.minWidth, entry.preferredWidth));
  let deficit = widths.reduce((sum, width) => sum + width, 0) - Math.max(0, availableWidth);
  if (deficit < 0) {
    const flexible = entries.filter((entry) => entry.growthPolicy === "flexible").length;
    if (flexible)
      entries.forEach((entry, index) => {
        if (entry.growthPolicy === "flexible") widths[index] -= deficit / flexible;
      });
  } else {
    // Protect automatically sized Stats first; if the display is too narrow it can shrink too.
    for (const protectStats of [true, false]) {
      const capacities = entries.map((entry, index) =>
        protectStats && entry.autoStats ? 0 : widths[index] - entry.minWidth
      );
      const total = capacities.reduce((sum, width) => sum + width, 0);
      if (total <= 0) continue;
      const reduction = Math.min(deficit, total);
      capacities.forEach((capacity, index) => {
        widths[index] -= (reduction * capacity) / total;
      });
      deficit -= reduction;
      if (deficit <= 0) break;
    }
  }
  return Object.fromEntries(entries.map((entry, index) => [entry.id, widths[index]]));
}

/**
 * @param {string} leftPanelId
 * @param {string} rightPanelId
 */
export function resetDockPanelPair(panelSizesById, leftPanelId, rightPanelId) {
  const next = { ...panelSizesById };
  delete next[leftPanelId];
  delete next[rightPanelId];
  return next;
}
