/**
 * Default layout, typography, radii, and per-module chart defaults (`UI_PREFERENCES`).
 * Merged at runtime with `themes[mode]` overrides — see `getResolvedCharts`.
 */

function mergeCharts(base, override) {
  if (!override) return base;
  return {
    loudnessHistory: { ...base.loudnessHistory, ...override.loudnessHistory },
    vectorscope: { ...base.vectorscope, ...override.vectorscope },
    spectrum: { ...base.spectrum, ...override.spectrum },
  };
}

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

export const UI_PREFERENCES = {
  layoutPersistKey: "audiometer.ui",

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

  /** `card` is used for `--radius` at runtime and for generated first-paint CSS (`scripts/generate-theme-fallbacks.mjs`). */
  radii: {
    card: "0.625rem",
    modal: "1rem",
    pill: "9999px",
    metricRow: "0.375rem",
  },

  themes: {
    dark: {},
    light: {
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
