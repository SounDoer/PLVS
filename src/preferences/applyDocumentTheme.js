import { applyShadcnSemanticTokensToDocument, oklchSafe } from "../theme/shadcnSemanticPreset.js";
import { buildThemeTokens } from "../theme/buildThemeTokens.js";
import { getTheme } from "../theme/themeRegistry.js";
import { UI_PREFERENCES } from "./data.js";

function setCssVar(name, value) {
  if (value === undefined || value === null) return;
  document.documentElement.style.setProperty(name, String(oklchSafe(value)));
}

/**
 * Spatial / typographic / iconographic / non-palette tuning (ADR 0002 `applyLayout`).
 * @param {typeof UI_PREFERENCES} prefs
 */
export function applyLayoutToDocument(prefs = UI_PREFERENCES) {
  if (typeof document === "undefined") return;
  const { typography, iconography, radii } = prefs;
  const { shell, splitters, header, footer, articlePadding, spacingRem, heightsRem, widthsPx } =
    prefs.layout;

  setCssVar("--ui-font-sans", typography.fontFamily);

  const s = typography.sizesPx;
  setCssVar("--ui-fs-caption", `${s.caption}px`);
  setCssVar("--ui-fs-axis", `${s.axis}px`);
  setCssVar("--ui-fs-status", `${s.status}px`);
  setCssVar("--ui-fs-control", `${s.control}px`);
  setCssVar("--ui-fs-metric-meta", `${s.metricMeta}px`);
  setCssVar("--ui-fs-panel-title", `${s.panelTitle}px`);
  setCssVar("--ui-fs-display", `${s.display}px`);
  setCssVar("--ui-fs-body", `${s.body}px`);
  setCssVar("--ui-fs-metric-value", `${s.metricValue}px`);

  const icons = iconography.sizesPx;
  setCssVar("--ui-icon-panel-action", `${icons.panelAction}px`);
  setCssVar("--ui-icon-management-action", `${icons.managementAction}px`);
  setCssVar("--ui-icon-shell-action", `${icons.shellAction}px`);
  setCssVar("--ui-icon-panel-module", `${icons.panelModule}px`);

  setCssVar("--radius", radii.card);

  setCssVar("--ui-shell-pad", `${shell.paddingRem.base}rem`);
  setCssVar("--ui-shell-gap", `${shell.gapRem.base}rem`);

  setCssVar("--ui-spectrum-grid-opacity", String(prefs.modules.spectrum.gridOpacity ?? 0.08));

  setCssVar("--ui-min-h-peak", `${heightsRem.peakModuleMin}rem`);
  setCssVar("--ui-min-h-history", `${heightsRem.historyModuleMin}rem`);
  setCssVar("--ui-min-h-spectrum", `${heightsRem.spectrumModuleMin}rem`);
  setCssVar("--ui-min-h-history-chart", `${heightsRem.historyChartMin}rem`);
  setCssVar(
    "--ui-chart-x-axis-row-h",
    `max(${heightsRem.chartXAxisRowRem}rem, calc(var(--ui-fs-axis) * 1.15))`
  );

  setCssVar(
    "--ui-chart-y-axis-rail-w",
    `max(${widthsPx.yAxisRailMin}px, calc(var(--ui-fs-axis) * 1.65))`
  );

  setCssVar("--ui-splitter-bar-thickness", `${splitters.barThicknessPx}px`);

  const lh = prefs.modules.loudness.history;
  const sm = prefs.modules.stats.metrics;
  setCssVar("--ui-loudness-momentary-stroke-width", String(lh.momentaryStrokeWidth));
  setCssVar("--ui-loudness-shortterm-stroke-width", String(lh.shortTermStrokeWidth));
  setCssVar("--ui-loudness-selection-stroke-width", String(lh.selectionStrokeWidth));
  setCssVar("--ui-metric-row-min-h", `${sm.rowMinHeightRem}rem`);
  setCssVar("--ui-metric-row-pad-x", `${sm.rowPaddingXRem}rem`);
  setCssVar("--ui-metric-row-gap", `${sm.rowGapRem}rem`);

  setCssVar("--ui-header-pad-x", `${header.paddingXRem}rem`);
  setCssVar("--ui-header-pad-y", `${header.paddingYRem}rem`);
  setCssVar("--ui-header-action-gap", `${header.actionGapRem}rem`);

  setCssVar("--ui-panel-pad-x", `${articlePadding.defaultXRem}rem`);
  setCssVar("--ui-panel-pad-y", `${articlePadding.defaultYRem}rem`);

  setCssVar("--ui-metric-list-gap", `${spacingRem.metricsListGap}rem`);
  setCssVar("--ui-chart-axis-gap", `${spacingRem.chartAxisGap}rem`);
  setCssVar("--ui-metric-inline-gap", `${spacingRem.inlineValueGap}rem`);
  setCssVar("--ui-peak-channel-gap", `${spacingRem.peakChannelGap}rem`);
  setCssVar("--ui-chart-inset-top", `${spacingRem.chartInsetTop}rem`);
  setCssVar("--ui-chart-inset-bottom", `${spacingRem.chartInsetBottom}rem`);
  setCssVar("--ui-meter-chart-inset-x", `${spacingRem.meterChartInsetX}rem`);
  setCssVar("--ui-meter-label-top-inset", `${spacingRem.meterLabelTopInset}rem`);
  setCssVar("--ui-vector-outer-inset", `${spacingRem.vectorOuterInset}rem`);
  setCssVar("--ui-vector-corner-inset", `${spacingRem.vectorCornerInset}rem`);
  setCssVar("--ui-chart-hud-inset", `${spacingRem.hudInset}rem`);

  setCssVar("--ui-footer-pad-x", `${footer.paddingXRem}rem`);
  setCssVar("--ui-footer-pad-y", `${footer.paddingYRem}rem`);

  const drawer = prefs.layout.drawer;
  setCssVar("--ui-drawer-w", `${drawer.preferredWidthPx}px`);
  setCssVar("--ui-drawer-pad", `${drawer.paddingRem}rem`);
  setCssVar("--ui-drawer-gap", `${drawer.sectionGapRem}rem`);
  setCssVar("--ui-drawer-row-gap", `${drawer.rowGapRem}rem`);
  setCssVar("--ui-drawer-row-min-h", `${drawer.rowMinHeightRem}rem`);

  const peak = prefs.modules.peak.meterGradient;
  setCssVar("--ui-meter-gradient-mid-stop", `${peak.midStopPercent}%`);

  const vs = prefs.modules.vectorscope;
  setCssVar("--ui-vectorscope-stroke-width", String(vs.strokeWidth));
  setCssVar("--ui-vectorscope-axis-opacity", String(vs.axisOpacity));
  setCssVar("--ui-vectorscope-grid-dash", vs.gridDiagDash);

  const spectrum = prefs.modules.spectrum;
  setCssVar("--ui-spectrum-stroke-width", String(spectrum.strokeWidth));
  setCssVar("--ui-spectrum-fill-top-opacity", String(spectrum.fillOpacityTop ?? 0.18));
  setCssVar("--ui-spectrum-fill-bottom-opacity", String(spectrum.fillOpacityBottom ?? 0.02));

  const waveform = prefs.modules.waveform;
  setCssVar("--ui-waveform-fill-opacity", String(waveform.fillOpacity ?? 0.22));
}

/**
 * Theme-owned palette tokens (ADR 0002 `applyTheme`).
 * @param {import("../theme/builtinThemes.js").ThemeId} themeId
 */
export function applyThemeToDocument(themeId, customThemes = {}) {
  if (typeof document === "undefined") return;
  const theme = getTheme(themeId, customThemes);
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.setProperty("color-scheme", theme.colorScheme);

  applyShadcnSemanticTokensToDocument(theme.semantic);

  const tokens = buildThemeTokens(theme);
  for (const [name, value] of Object.entries(tokens)) {
    setCssVar(name, value);
  }
}
