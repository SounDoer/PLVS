/**
 * Single-file tunable UI tokens: `applyUiPreferencesToDocument` writes `--ui-*` CSS variables and syncs shadcn
 * semantic tokens (`--background`, `--foreground`, `--card`, …) from the same theme `colors` object so Radix
 * surfaces match the metering shell (see `syncShadcnSemanticTokens`). Layout + theme persist via `layoutPersistKey`.
 *
 * Sections (Ctrl+F):
 * - `layoutPersistKey` — localStorage key (changing key abandons data under the old key)
 * - `layout` — shell, splitters, three-column drag, header/footer, article, spacingRem, heightsRem, widthsPx, settingsModal
 * - `typography` / `radii` — type scale, radii
 * - `themes` — per theme id: `colors` plus optional `charts`, `spectrumGrid`, `meterGradient` overrides
 * - `modules.peak` — dial gradients (theme may override)
 * - `modules.loudness` — History default window, Metrics rows, loudness chart tokens
 * - `modules.vector` — Vectorscope charts
 * - `modules.spectrum` — spectrum grid + Spectrum charts
 *
 * Runtime: `getResolvedCharts(prefs, uiMode)` merges module chart defaults with `themes[mode].charts`.
 *
 * Debug: DevTools → `<html>` → Computed → filter `--ui-`.
 */
function setCssVar(name, value) {
  if (value === undefined || value === null) return;
  document.documentElement.style.setProperty(name, String(value));
}

/**
 * Maps `themes[mode].colors` onto shadcn CSS variables (`--background`, `--card`, …) so Tailwind/shadcn components
 * track the active UI theme without duplicating hex values in `index.css`.
 *
 * Chart-only and layout tokens remain `--ui-*` only. Interactive accent follows `colors.brand` (primary / ring).
 *
 * @param {typeof DARK_THEME_COLORS} colors
 * @param {"dark"|"light"} mode
 */
function syncShadcnSemanticTokens(colors, mode) {
  setCssVar("--background", colors.pageBg);
  setCssVar("--foreground", colors.textPrimary);
  setCssVar("--card", colors.panelBg);
  setCssVar("--card-foreground", colors.textPrimary);
  setCssVar("--popover", colors.panelBg);
  setCssVar("--popover-foreground", colors.textPrimary);
  setCssVar("--muted", colors.insetBg);
  setCssVar("--muted-foreground", colors.textMuted);
  setCssVar("--accent", colors.controlBg);
  setCssVar("--accent-foreground", colors.textPrimary);
  setCssVar("--secondary", colors.panelBgSplitter);
  setCssVar("--secondary-foreground", colors.textPrimary);
  setCssVar("--border", colors.borderDefault);
  setCssVar("--input", colors.borderDefault);
  setCssVar("--primary", colors.brand);
  setCssVar("--primary-foreground", mode === "light" ? "#ffffff" : "#fafafa");
  setCssVar("--ring", colors.brandLight);
}

function mergeCharts(base, override) {
  if (!override) return base;
  return {
    loudnessHistory: { ...base.loudnessHistory, ...override.loudnessHistory },
    vectorscope: { ...base.vectorscope, ...override.vectorscope },
    spectrum: { ...base.spectrum, ...override.spectrum },
  };
}

function mergeShallow(base, override) {
  return { ...base, ...(override || {}) };
}

/** Flat chart defaults from the three modules for `mergeCharts` (before theme overlay) */
function chartsBaseFromPrefs(prefs) {
  const { loudness, vector, spectrum } = prefs.modules;
  return {
    loudnessHistory: { ...loudness.charts.loudnessHistory },
    vectorscope: { ...vector.charts.vectorscope },
    spectrum: { ...spectrum.charts.spectrum },
  };
}

/**
 * Resolved charts for the active theme (module defaults + `themes[mode].charts`).
 * @param {typeof UI_PREFERENCES} prefs
 * @param {"dark"|"light"} mode
 */
export function getResolvedCharts(prefs = UI_PREFERENCES, mode = "dark") {
  const m = mode === "light" ? "light" : "dark";
  return mergeCharts(chartsBaseFromPrefs(prefs), prefs.themes[m]?.charts);
}

/** Dark theme: page/panel/text/Peak lines/legends/settings (maps to --ui-color-*) */
const DARK_THEME_COLORS = {
  pageBg: "#111827", // outer page background
  textPrimary: "#f3f4f6", // primary body/title text
  textSecondary: "#d1d5db", // secondary copy
  textMuted: "#b3bcc8", // tertiary (section titles, ticks) — tuned for scan on dark bg
  textSubtle: "#8792a2", // metrics labels — still readable on dark inset
  panelBg: "#1f2937", // rounded module cards (Peak, History, …)
  panelBgSplitter: "rgba(31, 41, 55, 0.8)", // draggable splitter track
  insetBg: "#111827", // deep plot wells (spectrum / history)
  insetDark: "rgba(3, 7, 18, 0.9)", // metrics row inset background
  borderDefault: "rgba(51, 65, 85, 0.8)", // default hairlines / borders
  divider: "#4b5563", // footer rules, vector axes, etc.
  brand: "#3b82f6", // primary accent / selected controls
  brandLight: "#60a5fa", // logo “Meter” accent
  brandHover: "#60a5fa", // primary hover
  controlBg: "#374151", // settings selects, Close, unselected theme chips
  peakSamplePeak: "rgba(251, 191, 36, 0.95)", // sample-peak hairline on peak meter
  peakTruePeak: "rgba(207, 250, 254, 0.7)", // true-peak hairline
  tpMaxText: "#67e8f9", // TP MAX readout emphasis
  correlation: {
    bad: "#f87171", // low correlation
    mid: "#fcd34d", // mid correlation
    good: "#6ee7b7", // good correlation
  },
  loudnessTargetLine: "rgba(74, 222, 128, 0.85)", // history target LUFS guide (green)
  settingsOverlay: "rgba(0, 0, 0, 0.6)", // modal scrim
  settingsRowBg: "rgba(17, 24, 39, 0.7)", // settings list row background
  legendHistOnBg: "#374151", // loudness history legend “on” chip
  legendHistOnText: "#f3f4f6",
  legendHistOffBg: "#111827", // loudness history legend “off” chip
  legendHistOffText: "#9ca3af",
  metricRowBg: "rgba(31, 41, 55, 0.28)", // metrics row idle background
  metricRowBorder: "rgba(71, 85, 105, 0.5)", // metrics row border
  metricRowHoverBg: "rgba(30, 41, 59, 0.42)", // metrics row hover
  metricRowToggleOnBg: "rgba(30, 58, 138, 0.22)", // metrics row selected background
  metricRowToggleOnBorder: "#3b82f6", // metrics row selected border
  metricRowToggleOnGlow: "rgba(59, 130, 246, 0.35)", // metrics row selected glow
  metricLabelText: "#94a3b8", // metric name
  metricValueText: "#f8fafc", // metric value
  metricUnitText: "#cbd5e1", // metric unit
  metricToggleOnLabelText: "#dbeafe", // metric name when row selected
  metricToggleOnUnitText: "#bfdbfe", // metric unit when row selected
  targetLabel: "#d1d5db", // “Target” label
  targetValue: "#4ade80", // history axis target ticks (green)
  controlHoverBg: "#6b7280", // light control hover fill
  settingsDialogShadow: "0 25px 50px -12px rgb(0 0 0 / 0.5)", // settings dialog shadow
};

/** Light theme: same roles as DARK_THEME_COLORS with light-surface-friendly values */
const LIGHT_THEME_COLORS = {
  pageBg: "#e5e7eb",
  textPrimary: "#111827",
  textSecondary: "#374151",
  textMuted: "#334155",
  textSubtle: "#475569",
  panelBg: "#ffffff",
  panelBgSplitter: "rgba(209, 213, 219, 0.95)",
  insetBg: "#f9fafb",
  insetDark: "rgba(241, 245, 249, 0.98)",
  borderDefault: "rgba(148, 163, 184, 0.75)",
  divider: "#d1d5db",
  brand: "#2563eb",
  brandLight: "#3b82f6",
  brandHover: "#1d4ed8",
  controlBg: "#e5e7eb",
  peakSamplePeak: "rgba(217, 119, 6, 0.95)",
  peakTruePeak: "rgba(8, 145, 178, 0.85)",
  tpMaxText: "#0e7490",
  correlation: {
    bad: "#dc2626",
    mid: "#ca8a04",
    good: "#15803d",
  },
  loudnessTargetLine: "rgba(22, 163, 74, 0.8)", // history target guide (green)
  settingsOverlay: "rgba(15, 23, 42, 0.35)",
  settingsRowBg: "rgba(243, 244, 246, 0.95)",
  legendHistOnBg: "#e5e7eb",
  legendHistOnText: "#111827",
  legendHistOffBg: "#f3f4f6",
  legendHistOffText: "#4b5563",
  metricRowBg: "rgba(255, 255, 255, 0.55)",
  metricRowBorder: "rgba(148, 163, 184, 0.5)",
  metricRowHoverBg: "rgba(248, 250, 252, 0.92)",
  metricRowToggleOnBg: "rgba(219, 234, 254, 0.72)",
  metricRowToggleOnBorder: "#2563eb",
  metricRowToggleOnGlow: "rgba(37, 99, 235, 0.25)",
  metricLabelText: "#475569",
  metricValueText: "#0f172a",
  metricUnitText: "#475569",
  metricToggleOnLabelText: "#1e40af",
  metricToggleOnUnitText: "#1d4ed8",
  targetLabel: "#4b5563",
  targetValue: "#15803d", // history axis target ticks (green)
  controlHoverBg: "#d3ddea", // light control hover fill
  settingsDialogShadow: "0 16px 34px -14px rgb(15 23 42 / 0.28)", // lighter dialog shadow on light chrome
};

export const UI_PREFERENCES = {
  layoutPersistKey: "am.react.layout",

  layout: {
    shell: {
      maxWidthPx: 1600,
      paddingRem: { base: 0.8, lg: 1.2 },
      gapRem: { base: 0.55, lg: 0.6 },
    },
    splitters: {
      sectionGapPx: 8,
      barThicknessPx: 1,
      loudnessGapPx: 8,
    },
    header: {
      paddingXRem: 0.9,
      paddingYRem: 0.55,
    },
    footer: {
      paddingXRem: 1,
      paddingYRem: 0.65,
    },
    articlePadding: {
      defaultXRem: 0.7,
      defaultYRem: 0.5,
      metricsRem: 0,
      sectionTitleGapRem: 0.4,
      metricsTitleGapRem: 0.4,
    },
    spacingRem: {
      headerActionGap: 0.35,
      panelFooterGap: 0.4,
      inlineValueGap: 0.4,
      metricsListGap: 0.45,
      axisGapX: 0.4,
      axisGapY: 0.4,
      peakAxisChartGap: 0.5,
      peakChannelGap: 0.4,
      peakDisplayTopInset: 0.5,
      peakDisplayBottomInset: 0.5,
      meterChartInsetX: 0.6,
      meterLabelLeftInset: 1.6,
      meterLabelTopInset: 0.5,
      tpInfoLeftBlank: 5.4,
      chartOuterInset: 0,
      vectorCornerInset: 0.4,
      corrInfoLeftBlank: 4,
      historyDisplayTopInset: 0.1,
      historyDisplayBottomInset: 0,
      historySvgPad: 0.4,
      hudInset: 0.25,
      spectrumDisplayTopInset: 0.5,
      spectrumDisplayBottomInset: 0,
      spectrumSvgPad: 0.4,
    },
    settingsModal: {
      maxWidthRem: 28,
      paddingRem: 1.25,
      overlayPaddingRem: 1,
      headerGapRem: 1.25,
      contentGapRem: 1,
      inlineGapRem: 0.5,
      actionPadXRem: 0.75,
      actionPadYRem: 0.25,
    },
    mainColumn: {
      initialPx: 270,
      dragMinPx: 240,
      dragMaxPx: 360,
    },
    leftSplit: {
      initialRatio: 0.6,
      dragMinRatio: 0.5,
      dragMaxRatio: 0.72,
      dragPixelsPerDelta: 500,
    },
    rightSplit: {
      initialRatio: 0.5,
      dragMinRatio: 0.34,
      dragMaxRatio: 0.76,
      dragPixelsPerDelta: 650,
    },
    loudnessHistMetrics: {
      initialRatio: 0.7,
      dragMinRatio: 0.56,
      dragMaxRatio: 0.88,
      dragPixelsPerDelta: 720,
    },
    heightsRem: {
      peakModuleMin: 12,
      historyModuleMin: 10,
      spectrumModuleMin: 10,
      historyChartMin: 8,
      chartXAxisRowRem: 0.6,
    },
    widthsPx: {
      loudnessYAxis: 24,
      spectrumYAxis: 24,
      peakTickCol: 24,
    },
  },

  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    sizesPx: {
      title: 18,
      section: 12,
      axisValue: 13,
      axisUnit: 11,
      extraValue: 13,
      metricMeta: 14,
      metricValue: 18,
      action: 14,
      status: 13,
    },
    weights: {
      appTitle: 800,
      section: 600,
    },
  },

  radii: {
    card: "0.75rem",
    modal: "1rem",
    pill: "9999px",
    metricRow: "0.375rem",
  },

  themes: {
    dark: {
      colors: DARK_THEME_COLORS,
    },
    light: {
      colors: LIGHT_THEME_COLORS,
      charts: {
        loudnessHistory: {
          momentaryStroke: "#0e7490",
          momentaryStrokeSnap: "#c2410c",
          shortTermStroke: "#1d4ed8",
          shortTermStrokeSnap: "#9a3412",
          selectionStroke: "#c2410c",
        },
        vectorscope: {
          strokeLive: "#1d4ed8",
          strokeSnap: "#c2410c",
        },
        spectrum: {
          strokeLive: "#1d4ed8",
          strokeSnap: "#c2410c",
        },
      },
      spectrumGrid: {
        verticalLineOpacity: 0.07,
        horizontalLineOpacity: 0.05,
      },
    },
  },

  modules: {
    peak: {
      meterGradient: {
        top: "#f97373",
        mid: "#fbbf3b",
        midStopPercent: 46,
        bottom: "#34d399",
      },
    },
    loudness: {
      history: {
        defaultWindowSec: 120,
      },
      metrics: {
        valueColumnCh: 6.5,
        unitColumnRem: 3.1,
        rowMinHeightRem: 2.5,
        rowPaddingXRem: 0.5,
        rowPaddingYRem: 0.375,
        rowGapRem: 0.5,
      },
      charts: {
        loudnessHistory: {
          momentaryStroke: "#22d3ee",
          momentaryStrokeSnap: "#fb923c",
          momentaryStrokeWidth: 1.2,
          shortTermStroke: "#007AFF",
          shortTermStrokeSnap: "#f59e0b",
          shortTermStrokeWidth: 1.2,
          shortTermOpacity: 0.95,
          selectionStroke: "#f59e0b",
          selectionStrokeWidth: 1.2,
          /** Horizontal history guides aligned to the left axis ticks (any CSS <color>, including color-mix) */
          historyGridLineColor: "color-mix(in srgb, var(--ui-color-divider) 10%, transparent)",
        },
      },
    },
    vector: {
      charts: {
        vectorscope: {
          strokeLive: "#007AFF",
          strokeSnap: "#f59e0b",
          strokeWidth: 1,
          axisOpacity: 0.8,
          gridDiagInsetPct: 1.2,
          plotRadius: 240,
          /** Diagonal grid dashes: CSS <color>; `gridDiagDash` is stroke-dasharray in 0–100 viewBox user units */
          gridDiagStroke: "color-mix(in srgb, var(--ui-color-divider) 80%, transparent)",
          gridDiagDash: "2.6 3.4",
        },
      },
    },
    spectrum: {
      spectrumGrid: {
        verticalLineOpacity: 0.08,
        horizontalLineOpacity: 0.08,
        verticalSpacingPx: 56,
        horizontalSpacingPx: 34,
      },
      charts: {
        spectrum: {
          strokeLive: "#007AFF",
          strokeSnap: "#f59e0b",
          strokeWidth: 1.5,
          fillOpacityTop: 0.22,
          fillOpacityBottom: 0.03,
        },
      },
    },
  },
};

/** Matches App persistence so first paint does not flash the wrong theme */
/** Default stereo/surround L/R pair for vectorscope (first two channels in layout order). */
export function readPersistedVectorscopePair(prefs) {
  const p = prefs ?? UI_PREFERENCES;
  try {
    const raw = localStorage.getItem(p.layoutPersistKey);
    if (!raw) return { x: 0, y: 1 };
    const s = JSON.parse(raw);
    if (typeof s.vectorscopePairX === "number" && typeof s.vectorscopePairY === "number") {
      return { x: s.vectorscopePairX, y: s.vectorscopePairY };
    }
  } catch (_) {}
  return { x: 0, y: 1 };
}

export function readPersistedUiMode(prefs) {
  const p = prefs ?? UI_PREFERENCES;
  try {
    const raw = localStorage.getItem(p.layoutPersistKey);
    if (!raw) return "system";
    const s = JSON.parse(raw);
    if (s.uiMode === "system" || s.uiMode === "light" || s.uiMode === "dark") return s.uiMode;
  } catch (_) {}
  return "system";
}

/**
 * @returns {boolean} Whether the OS / browser reports dark as the preferred color scheme.
 * Defaults to `true` when `matchMedia` is unavailable (matches the former app default look).
 */
export function readSystemPrefersDark() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * @param {"system" | "dark" | "light"} stored
 * @param {boolean} systemPrefersDark
 * @returns {"dark" | "light"}
 */
export function resolveEffectiveUiMode(stored, systemPrefersDark) {
  if (stored === "light") return "light";
  if (stored === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}

/**
 * @param {typeof UI_PREFERENCES} prefs
 * @param {"dark" | "light"} mode
 */
export function applyUiPreferencesToDocument(prefs = UI_PREFERENCES, mode = "dark") {
  const m = mode === "light" ? "light" : "dark";
  const theme = prefs.themes[m];
  const colors = theme.colors;
  const charts = getResolvedCharts(prefs, m);
  const spectrumGrid = mergeShallow(prefs.modules.spectrum.spectrumGrid, theme.spectrumGrid);
  const meterGradient = mergeShallow(prefs.modules.peak.meterGradient, theme.meterGradient);
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

  setCssVar("--ui-font-sans", typography.fontFamily);
  setCssVar("color-scheme", m);

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

  setCssVar("--ui-radius-card", radii.card);
  setCssVar("--ui-radius-modal", radii.modal);
  setCssVar("--ui-radius-pill", radii.pill);
  setCssVar("--ui-radius-metric-row", radii.metricRow);

  setCssVar("--ui-shell-max-w", `${shell.maxWidthPx}px`);
  setCssVar("--ui-shell-pad", `${shell.paddingRem.base}rem`);
  setCssVar("--ui-shell-pad-lg", `${shell.paddingRem.lg}rem`);
  setCssVar("--ui-shell-gap", `${shell.gapRem.base}rem`);
  setCssVar("--ui-shell-gap-lg", `${shell.gapRem.lg}rem`);

  setCssVar("--ui-spectrum-grid-v", String(spectrumGrid.verticalLineOpacity));
  setCssVar("--ui-spectrum-grid-h", String(spectrumGrid.horizontalLineOpacity));

  setCssVar("--ui-meter-grad-top", meterGradient.top);
  setCssVar("--ui-meter-grad-mid", meterGradient.mid);
  setCssVar("--ui-meter-grad-mid-stop", `${meterGradient.midStopPercent}%`);
  setCssVar("--ui-meter-grad-bottom", meterGradient.bottom);

  setCssVar("--ui-min-h-peak", `${heightsRem.peakModuleMin}rem`);
  setCssVar("--ui-min-h-history", `${heightsRem.historyModuleMin}rem`);
  setCssVar("--ui-min-h-spectrum", `${heightsRem.spectrumModuleMin}rem`);
  setCssVar("--ui-min-h-history-chart", `${heightsRem.historyChartMin}rem`);
  setCssVar("--ui-chart-x-axis-row-h", `${heightsRem.chartXAxisRowRem}rem`);

  setCssVar("--ui-w-loudness-y-axis", `${widthsPx.loudnessYAxis}px`);
  setCssVar("--ui-w-spectrum-y-axis", `${widthsPx.spectrumYAxis}px`);
  setCssVar("--ui-w-peak-ticks", `${widthsPx.peakTickCol}px`);

  setCssVar("--ui-section-gap", `${splitters.sectionGapPx}px`);
  // splitters track size drives actual section spacing
  setCssVar("--ui-splitter-main", `${splitters.sectionGapPx}px`);
  setCssVar("--ui-splitter-row", `${splitters.sectionGapPx}px`);
  setCssVar("--ui-loudness-gap", `${splitters.loudnessGapPx}px`);
  // visual splitter bar thickness inside the track
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

  syncShadcnSemanticTokens(colors, m);
}
