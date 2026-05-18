import { applyShadcnSemanticTokensToDocument, oklchSafe } from "../theme/shadcnSemanticPreset.js";
import { buildMeterColorBridge } from "../theme/meterColorBridge.js";
import { getBuiltinTheme } from "../theme/builtinThemes.js";
import { UI_PREFERENCES } from "./data.js";

function setCssVar(name, value) {
  if (value === undefined || value === null) return;
  document.documentElement.style.setProperty(name, String(oklchSafe(value)));
}

/**
 * Spatial / typographic / non-palette tuning (ADR 0002 `applyLayout`).
 * @param {typeof UI_PREFERENCES} prefs
 * @param {{ colorScheme: "light" | "dark" }} ctx Active theme’s `colorScheme` (for spectrum grid opacities only).
 */
export function applyLayoutToDocument(prefs = UI_PREFERENCES, ctx = { colorScheme: "dark" }) {
  if (typeof document === "undefined") return;
  const colorScheme = ctx.colorScheme === "light" ? "light" : "dark";
  const { typography, radii } = prefs;
  const {
    shell,
    splitters,
    header,
    footer,
    articlePadding,
    spacingRem,
    settingsModal,
    heightsRem,
    widthsPx,
  } = prefs.layout;

  const byScheme = prefs.modules.spectrum.spectrumOpacityByColorScheme;
  const schemeKey = colorScheme === "light" ? "colorSchemeLight" : "colorSchemeDark";
  const spectrumOpacities = (byScheme && byScheme[schemeKey]) || {
    verticalLineOpacity: 0.08,
    horizontalLineOpacity: 0.08,
  };

  setCssVar("--ui-font-sans", typography.fontFamily);

  const s = typography.sizesPx;
  setCssVar("--ui-fs-app-title", `${s.title}px`);
  setCssVar("--ui-fs-panel-title", `${s.section}px`);
  setCssVar("--ui-fs-axis", `${s.axisUnit}px`);
  setCssVar("--ui-fs-display", `${s.extraValue}px`);
  setCssVar("--ui-fs-metric-meta", `${s.metricMeta}px`);
  setCssVar("--ui-fs-metric-value", `${s.metricValue}px`);
  setCssVar("--ui-fs-controls", `${s.action}px`);
  setCssVar("--ui-fs-status", `${s.status}px`);
  setCssVar("--ui-fw-app-title", String(typography.weights.appTitle));
  setCssVar("--ui-fw-section", String(typography.weights.section));

  setCssVar("--radius", radii.card);
  setCssVar("--ui-radius-modal", radii.modal);
  setCssVar("--ui-radius-pill", radii.pill);
  setCssVar("--ui-radius-metric-row", radii.metricRow);

  setCssVar("--ui-shell-max-w", `${shell.maxWidthPx}px`);
  setCssVar("--ui-shell-pad", `${shell.paddingRem.base}rem`);
  setCssVar("--ui-shell-pad-lg", `${shell.paddingRem.lg}rem`);
  setCssVar("--ui-shell-gap", `${shell.gapRem.base}rem`);
  setCssVar("--ui-shell-gap-lg", `${shell.gapRem.lg}rem`);

  setCssVar("--ui-spectrum-grid-v", String(spectrumOpacities.verticalLineOpacity));
  setCssVar("--ui-spectrum-grid-h", String(spectrumOpacities.horizontalLineOpacity));

  setCssVar("--ui-min-h-peak", `${heightsRem.peakModuleMin}rem`);
  setCssVar("--ui-min-h-history", `${heightsRem.historyModuleMin}rem`);
  setCssVar("--ui-min-h-spectrum", `${heightsRem.spectrumModuleMin}rem`);
  setCssVar("--ui-min-h-history-chart", `${heightsRem.historyChartMin}rem`);
  setCssVar("--ui-chart-x-axis-row-h", `${heightsRem.chartXAxisRowRem}rem`);

  setCssVar("--ui-w-loudness-y-axis", `${widthsPx.loudnessYAxis}px`);
  setCssVar("--ui-w-spectrum-y-axis", `${widthsPx.spectrumYAxis}px`);
  setCssVar("--ui-w-peak-ticks", `${widthsPx.peakTickCol}px`);

  setCssVar("--ui-panel-gap", `${splitters.sectionGapRem}rem`);
  setCssVar("--ui-loudness-gap", `${splitters.loudnessGapPx}px`);
  setCssVar("--ui-splitter-bar-thickness", `${splitters.barThicknessPx}px`);

  const lm = prefs.modules.loudness.metrics;
  setCssVar("--ui-metric-row-min-h", `${lm.rowMinHeightRem}rem`);
  setCssVar("--ui-metric-row-pad-x", `${lm.rowPaddingXRem}rem`);
  setCssVar("--ui-metric-row-pad-y", `${lm.rowPaddingYRem}rem`);
  setCssVar("--ui-metric-row-gap", `${lm.rowGapRem}rem`);

  setCssVar("--ui-header-pad-x", `${header.paddingXRem}rem`);
  setCssVar("--ui-header-pad-y", `${header.paddingYRem}rem`);

  setCssVar("--ui-panel-pad-x", `${articlePadding.defaultXRem}rem`);
  setCssVar("--ui-panel-pad-y", `${articlePadding.defaultYRem}rem`);
  setCssVar("--ui-panel-pad-metrics", `${articlePadding.metricsRem}rem`);
  setCssVar("--ui-panel-title-gap", `${articlePadding.sectionTitleGapRem}rem`);
  setCssVar("--ui-metric-title-gap", `${articlePadding.metricsTitleGapRem}rem`);

  setCssVar("--ui-panel-footer-gap", `${spacingRem.panelFooterGap}rem`);
  setCssVar("--ui-metric-list-gap", `${spacingRem.metricsListGap}rem`);
  setCssVar("--ui-chart-axis-gap", `${spacingRem.axisGapX}rem`);
  setCssVar("--ui-header-action-gap", `${spacingRem.headerActionGap}rem`);
  setCssVar("--ui-metric-inline-gap", `${spacingRem.inlineValueGap}rem`);
  setCssVar("--ui-tp-info-left-blank", `${spacingRem.tpInfoLeftBlank}rem`);
  setCssVar("--ui-corr-info-left-blank", `${spacingRem.corrInfoLeftBlank}rem`);
  setCssVar("--ui-peak-axis-chart-gap", `${spacingRem.peakAxisChartGap}rem`);
  setCssVar("--ui-peak-channel-gap", `${spacingRem.peakChannelGap}rem`);
  setCssVar("--ui-chart-inset-top", `${spacingRem.spectrumDisplayTopInset}rem`);
  setCssVar("--ui-chart-inset-bottom", `${spacingRem.spectrumDisplayBottomInset}rem`);
  setCssVar("--ui-meter-chart-inset-x", `${spacingRem.meterChartInsetX}rem`);
  setCssVar("--ui-meter-label-left-inset", `${spacingRem.meterLabelLeftInset}rem`);
  setCssVar("--ui-meter-label-top-inset", `${spacingRem.meterLabelTopInset}rem`);
  setCssVar("--ui-chart-outer-inset", `${spacingRem.chartOuterInset}rem`);
  setCssVar("--ui-vector-corner-inset", `${spacingRem.vectorCornerInset}rem`);
  setCssVar("--ui-chart-pad", `${spacingRem.historySvgPad}rem`);
  setCssVar("--ui-chart-hud-inset", `${spacingRem.hudInset}rem`);

  setCssVar("--ui-footer-pad-x", `${footer.paddingXRem}rem`);
  setCssVar("--ui-footer-pad-y", `${footer.paddingYRem}rem`);

  setCssVar("--ui-modal-pad", `${settingsModal.paddingRem}rem`);
  setCssVar("--ui-modal-header-gap", `${settingsModal.headerGapRem}rem`);
  setCssVar("--ui-modal-gap", `${settingsModal.contentGapRem}rem`);
  setCssVar("--ui-modal-action-pad-x", `${settingsModal.actionPadXRem}rem`);
  setCssVar("--ui-modal-action-pad-y", `${settingsModal.actionPadYRem}rem`);
}

/**
 * Theme-owned palette tokens (ADR 0002 `applyTheme`).
 * @param {import("../theme/builtinThemes.js").ThemeId} themeId
 */
export function applyThemeToDocument(themeId) {
  if (typeof document === "undefined") return;
  const theme = getBuiltinTheme(themeId);
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.setProperty("color-scheme", theme.colorScheme);

  applyShadcnSemanticTokensToDocument(theme.semantic);

  const bridge = buildMeterColorBridge(theme.semantic, theme.colorScheme);
  const colors = theme.meterColorOverrides ? { ...bridge, ...theme.meterColorOverrides } : bridge;

  setCssVar("--ui-signal-peak-sample", colors.peakSamplePeak);
  setCssVar("--ui-signal-peak-true", colors.peakTruePeak);
  setCssVar("--ui-signal-tp-max", colors.tpMaxText);
  setCssVar("--ui-signal-corr-bad", colors.correlation.bad);
  setCssVar("--ui-signal-corr-mid", colors.correlation.mid);
  setCssVar("--ui-signal-corr-good", colors.correlation.good);
  setCssVar("--ui-metric-row-bg", colors.metricRowBg);
  setCssVar("--ui-metric-row-hover-bg", colors.metricRowHoverBg);
  setCssVar("--ui-metric-row-toggle-on-border", colors.metricRowToggleOnBorder);
  setCssVar("--ui-metric-row-toggle-on-bg", colors.metricRowToggleOnBg);
  setCssVar("--ui-metric-row-toggle-on-glow", colors.metricRowToggleOnGlow);
  setCssVar("--ui-metric-toggle-on-label", colors.metricToggleOnLabel);
  setCssVar("--ui-chart-target-line", colors.loudnessTargetLine);

  const charts = theme.charts;
  setCssVar("--ui-chart-momentary", charts.loudnessHistory.momentaryStroke);
  setCssVar("--ui-chart-momentary-snap", charts.loudnessHistory.momentaryStrokeSnap);
  setCssVar("--ui-chart-shortterm", charts.loudnessHistory.shortTermStroke);
  setCssVar("--ui-chart-shortterm-snap", charts.loudnessHistory.shortTermStrokeSnap);
  setCssVar("--ui-chart-selection", charts.loudnessHistory.selectionStroke);
  setCssVar("--ui-chart-vectorscope-live", charts.vectorscope.strokeLive);
  setCssVar("--ui-chart-vectorscope-snap", charts.vectorscope.strokeSnap);
  setCssVar("--ui-chart-spectrum-live", charts.spectrum.strokeLive);
  setCssVar("--ui-chart-spectrum-snap", charts.spectrum.strokeSnap);
  setCssVar("--ui-chart-spectrum-fill-top", String(charts.spectrum.fillOpacityTop ?? 0.18));
  setCssVar("--ui-chart-spectrum-fill-bottom", String(charts.spectrum.fillOpacityBottom ?? 0.02));

  const meterGradient = theme.meterGradient;
  setCssVar("--ui-meter-grad-top", meterGradient.top);
  setCssVar("--ui-meter-grad-mid", meterGradient.mid);
  setCssVar("--ui-meter-grad-mid-stop", `${meterGradient.midStopPercent}%`);
  setCssVar("--ui-meter-grad-bottom", meterGradient.bottom);

  const lh = charts.loudnessHistory;
  setCssVar("--ui-lh-stroke-m-w", String(lh.momentaryStrokeWidth));
  setCssVar("--ui-lh-stroke-st-w", String(lh.shortTermStrokeWidth));
  setCssVar("--ui-lh-stroke-st-op", String(lh.shortTermOpacity));
  setCssVar("--ui-lh-stroke-sel-w", String(lh.selectionStrokeWidth));
  setCssVar("--ui-loudness-history-grid-line", lh.historyGridLineColor);

  const vs = charts.vectorscope;
  setCssVar("--ui-vs-stroke-w", String(vs.strokeWidth));
  setCssVar("--ui-vs-stroke-w-halo", String(vs.strokeWidth * 3));
  setCssVar("--ui-vs-axis-op", String(vs.axisOpacity));
  setCssVar("--ui-vs-path-glow-opacity", String(vs.axisOpacity * 0.22));
  setCssVar("--ui-vs-grid-diag-stroke", vs.gridDiagStroke);
  setCssVar("--ui-vs-grid-diag-dash", vs.gridDiagDash);

  const spectrum = charts.spectrum;
  setCssVar("--ui-sp-stroke-w", String(spectrum.strokeWidth));
  setCssVar("--ui-sp-stroke-w-inner", String(Math.max(1, spectrum.strokeWidth - 1)));
  setCssVar("--ui-sp-fill-top", String(spectrum.fillOpacityTop ?? 0.18));
  setCssVar("--ui-sp-fill-bottom", String(spectrum.fillOpacityBottom ?? 0.02));
}
