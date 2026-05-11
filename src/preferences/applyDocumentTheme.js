import { applyShadcnSemanticTokensToDocument } from "../theme/shadcnSemanticPreset.js";
import { buildMeterColorBridge } from "../theme/meterColorBridge.js";
import { getBuiltinTheme } from "../theme/builtinThemes.js";
import { UI_PREFERENCES } from "./data.js";

function setCssVar(name, value) {
  if (value === undefined || value === null) return;
  document.documentElement.style.setProperty(name, String(value));
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
  const spectrumOpacities =
    (byScheme && byScheme[colorScheme]) ||
    (byScheme && byScheme.dark) || { verticalLineOpacity: 0.08, horizontalLineOpacity: 0.08 };

  setCssVar("--ui-font-sans", typography.fontFamily);

  const s = typography.sizesPx;
  setCssVar("--ui-fs-app-title", `${s.title}px`);
  setCssVar("--ui-fs-section", `${s.section}px`);
  setCssVar("--ui-fs-settings-heading", `${s.section}px`);
  setCssVar("--ui-fs-axis-value", `${s.axisValue}px`);
  setCssVar("--ui-fs-axis-unit", `${s.axisUnit}px`);
  setCssVar("--ui-fs-extra", `${s.extraValue}px`);
  setCssVar("--ui-fs-metric-meta", `${s.metricMeta}px`);
  setCssVar("--ui-fs-metric-value", `${s.metricValue}px`);
  setCssVar("--ui-fs-action", `${s.action}px`);
  setCssVar("--ui-fs-status", `${s.status}px`);
  setCssVar("--ui-fw-app-title", String(typography.weights.appTitle));
  setCssVar("--ui-fw-section", String(typography.weights.section));

  setCssVar("--radius", radii.card);
  setCssVar("--ui-radius-card", radii.card);
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

  setCssVar("--ui-section-gap", `${splitters.sectionGapPx}px`);
  setCssVar("--ui-splitter-main", `${splitters.sectionGapPx}px`);
  setCssVar("--ui-splitter-row", `${splitters.sectionGapPx}px`);
  setCssVar("--ui-loudness-gap", `${splitters.loudnessGapPx}px`);
  setCssVar("--ui-splitter-bar-thickness", `${splitters.barThicknessPx}px`);

  const lm = prefs.modules.loudness.metrics;
  setCssVar("--ui-metric-row-min-h", `${lm.rowMinHeightRem}rem`);
  setCssVar("--ui-metric-row-pad-x", `${lm.rowPaddingXRem}rem`);
  setCssVar("--ui-metric-row-pad-y", `${lm.rowPaddingYRem}rem`);
  setCssVar("--ui-metric-row-gap", `${lm.rowGapRem}rem`);

  setCssVar("--ui-header-pad-x", `${header.paddingXRem}rem`);
  setCssVar("--ui-header-pad-y", `${header.paddingYRem}rem`);

  setCssVar("--ui-article-pad-x", `${articlePadding.defaultXRem}rem`);
  setCssVar("--ui-article-pad-y", `${articlePadding.defaultYRem}rem`);
  setCssVar("--ui-article-pad-metrics", `${articlePadding.metricsRem}rem`);
  setCssVar("--ui-section-title-gap", `${articlePadding.sectionTitleGapRem}rem`);
  setCssVar("--ui-metrics-title-gap", `${articlePadding.metricsTitleGapRem}rem`);

  setCssVar("--ui-panel-footer-gap", `${spacingRem.panelFooterGap}rem`);
  setCssVar("--ui-metrics-list-gap", `${spacingRem.metricsListGap}rem`);
  setCssVar("--ui-axis-gap-x", `${spacingRem.axisGapX}rem`);
  setCssVar("--ui-header-action-gap", `${spacingRem.headerActionGap}rem`);
  setCssVar("--ui-inline-value-gap", `${spacingRem.inlineValueGap}rem`);
  setCssVar("--ui-tp-info-left-blank", `${spacingRem.tpInfoLeftBlank}rem`);
  setCssVar("--ui-corr-info-left-blank", `${spacingRem.corrInfoLeftBlank}rem`);
  setCssVar("--ui-axis-gap-y", `${spacingRem.axisGapY}rem`);
  setCssVar("--ui-peak-axis-chart-gap", `${spacingRem.peakAxisChartGap}rem`);
  setCssVar("--ui-peak-channel-gap", `${spacingRem.peakChannelGap}rem`);
  setCssVar("--ui-peak-display-top-inset", `${spacingRem.peakDisplayTopInset}rem`);
  setCssVar("--ui-peak-display-bottom-inset", `${spacingRem.peakDisplayBottomInset}rem`);
  setCssVar("--ui-meter-chart-inset-x", `${spacingRem.meterChartInsetX}rem`);
  setCssVar("--ui-meter-label-left-inset", `${spacingRem.meterLabelLeftInset}rem`);
  setCssVar("--ui-meter-label-top-inset", `${spacingRem.meterLabelTopInset}rem`);
  setCssVar("--ui-chart-outer-inset", `${spacingRem.chartOuterInset}rem`);
  setCssVar("--ui-vector-corner-inset", `${spacingRem.vectorCornerInset}rem`);
  setCssVar("--ui-history-display-top-inset", `${spacingRem.historyDisplayTopInset}rem`);
  setCssVar("--ui-history-display-bottom-inset", `${spacingRem.historyDisplayBottomInset}rem`);
  setCssVar("--ui-history-svg-pad", `${spacingRem.historySvgPad}rem`);
  setCssVar("--ui-hud-inset", `${spacingRem.hudInset}rem`);
  setCssVar("--ui-spectrum-display-top-inset", `${spacingRem.spectrumDisplayTopInset}rem`);
  setCssVar("--ui-spectrum-display-bottom-inset", `${spacingRem.spectrumDisplayBottomInset}rem`);
  setCssVar("--ui-spectrum-svg-pad", `${spacingRem.spectrumSvgPad}rem`);

  setCssVar("--ui-footer-pad-x", `${footer.paddingXRem}rem`);
  setCssVar("--ui-footer-pad-y", `${footer.paddingYRem}rem`);

  setCssVar("--ui-settings-modal-max-w", `${settingsModal.maxWidthRem}rem`);
  setCssVar("--ui-settings-modal-pad", `${settingsModal.paddingRem}rem`);
  setCssVar("--ui-settings-overlay-pad", `${settingsModal.overlayPaddingRem}rem`);
  setCssVar("--ui-settings-header-gap", `${settingsModal.headerGapRem}rem`);
  setCssVar("--ui-settings-content-gap", `${settingsModal.contentGapRem}rem`);
  setCssVar("--ui-settings-inline-gap", `${settingsModal.inlineGapRem}rem`);
  setCssVar("--ui-settings-action-pad-x", `${settingsModal.actionPadXRem}rem`);
  setCssVar("--ui-settings-action-pad-y", `${settingsModal.actionPadYRem}rem`);
}

/**
 * Theme-owned palette tokens (ADR 0002 `applyTheme`).
 * @param {import("../preferences/themeResolve.js").ThemeId} themeId
 */
export function applyThemeToDocument(themeId) {
  if (typeof document === "undefined") return;
  const theme = getBuiltinTheme(themeId);
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.setProperty("color-scheme", theme.colorScheme);

  applyShadcnSemanticTokensToDocument(theme.semantic);

  const bridge = buildMeterColorBridge(theme.semantic, theme.colorScheme);
  const colors = { ...bridge, ...(theme.meterColorOverrides ?? {}) };

  setCssVar("--ui-color-page-bg", colors.pageBg);
  setCssVar("--ui-color-text-primary", colors.textPrimary);
  setCssVar("--ui-color-text-secondary", colors.textSecondary);
  setCssVar("--ui-color-text-muted", colors.textMuted);
  setCssVar("--ui-color-text-subtle", colors.textSubtle);
  setCssVar("--ui-color-panel-bg", colors.panelBg);
  setCssVar("--ui-color-panel-bg-splitter", colors.panelBgSplitter);
  setCssVar("--ui-color-inset-bg", colors.insetBg);
  setCssVar("--ui-color-inset-dark", colors.insetDark);
  setCssVar("--ui-color-border-default", colors.borderDefault);
  setCssVar("--ui-color-divider", colors.divider);
  setCssVar("--ui-color-brand", colors.brand);
  setCssVar("--ui-color-brand-light", colors.brandLight);
  setCssVar("--ui-color-brand-hover", colors.brandHover);
  setCssVar("--ui-color-control-bg", colors.controlBg);
  setCssVar("--ui-color-peak-sample", colors.peakSamplePeak);
  setCssVar("--ui-color-peak-true", colors.peakTruePeak);
  setCssVar("--ui-color-tp-max", colors.tpMaxText);
  setCssVar("--ui-color-corr-bad", colors.correlation.bad);
  setCssVar("--ui-color-corr-mid", colors.correlation.mid);
  setCssVar("--ui-color-corr-good", colors.correlation.good);
  setCssVar("--ui-color-loudness-target-line", colors.loudnessTargetLine);
  setCssVar("--ui-color-settings-overlay", colors.settingsOverlay);
  setCssVar("--ui-color-settings-row-bg", colors.settingsRowBg);
  setCssVar("--ui-color-legend-on-bg", colors.legendHistOnBg);
  setCssVar("--ui-color-legend-on-text", colors.legendHistOnText);
  setCssVar("--ui-color-legend-off-bg", colors.legendHistOffBg);
  setCssVar("--ui-color-legend-off-text", colors.legendHistOffText);
  setCssVar("--ui-color-metric-row-bg", colors.metricRowBg);
  setCssVar("--ui-color-metric-row-border", colors.metricRowBorder);
  setCssVar("--ui-color-metric-row-hover-bg", colors.metricRowHoverBg);
  setCssVar("--ui-color-metric-row-toggle-on-bg", colors.metricRowToggleOnBg);
  setCssVar("--ui-color-metric-row-toggle-on-border", colors.metricRowToggleOnBorder);
  setCssVar("--ui-color-metric-row-toggle-on-glow", colors.metricRowToggleOnGlow);
  setCssVar("--ui-color-metric-label", colors.metricLabelText);
  setCssVar("--ui-color-metric-value", colors.metricValueText);
  setCssVar("--ui-color-metric-unit", colors.metricUnitText);
  setCssVar("--ui-color-metric-toggle-on-label", colors.metricToggleOnLabelText);
  setCssVar("--ui-color-metric-toggle-on-unit", colors.metricToggleOnUnitText);
  setCssVar("--ui-color-target-label", colors.targetLabel);
  setCssVar("--ui-color-target-value", colors.targetValue);
  setCssVar("--ui-color-control-hover-bg", colors.controlHoverBg);
  setCssVar("--ui-shadow-settings-dialog", colors.settingsDialogShadow);

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
  setCssVar("--ui-vs-axis-op", String(vs.axisOpacity));
  setCssVar("--ui-vs-grid-diag-stroke", vs.gridDiagStroke);
  setCssVar("--ui-vs-grid-diag-dash", vs.gridDiagDash);

  const spectrum = charts.spectrum;
  setCssVar("--ui-sp-stroke-w", String(spectrum.strokeWidth));
  setCssVar("--ui-sp-fill-top", String(spectrum.fillOpacityTop ?? 0.18));
  setCssVar("--ui-sp-fill-bottom", String(spectrum.fillOpacityBottom ?? 0.02));
}
