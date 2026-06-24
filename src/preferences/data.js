/**
 * Default layout, typography, radii, and per-module **non-theme** tuning (`UI_PREFERENCES`).
 * Instrument colours are derived from theme seeds; chart geometry and meter gradient geometry live here.
 */

export const UI_PREFERENCES = {
  layout: {
    shell: {
      paddingRem: { base: 0.8 },
      gapRem: { base: 0.55 },
    },
    splitters: {
      barThicknessPx: 1,
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
      defaultXRem: 0.25,
      defaultYRem: 0.35,
      metricsRem: 0,
    },
    spacingRem: {
      inlineValueGap: 0.4,
      metricsListGap: 0.2,
      chartAxisGap: 0.4,
      peakChannelGap: 0.4,
      meterChartInsetX: 0.6,
      meterLabelTopInset: 0.5,
      vectorOuterInset: 0,
      vectorCornerInset: 0.4,
      hudInset: 0.25,
      chartInsetTop: 0.2,
      chartInsetBottom: 0,
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
    spectrogramSplit: {
      initialRatio: 0.72,
      dragMinRatio: 0.5,
      dragMaxRatio: 0.88,
      dragPixelsPerDelta: 500,
    },
    heightsRem: {
      peakModuleMin: 12,
      historyModuleMin: 10,
      spectrumModuleMin: 10,
      historyChartMin: 8,
      chartXAxisRowRem: 0.8,
    },
    widthsPx: {
      axisRail: 20,
    },
  },

  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    sizesPx: {
      title: 16,
      axisValue: 13,
      axisUnit: 11,
      extraValue: 13,
      metricMeta: 12,
      metricValue: 18,
      status: 11,
    },
    weights: {
      appTitle: 800,
    },
  },

  /** `card` is used for `--radius` at runtime and for generated first-paint CSS (`scripts/generate-theme-fallbacks.mjs`). */
  radii: {
    card: "0.625rem",
    metricRow: "0.375rem",
  },

  modules: {
    loudness: {
      history: {
        defaultWindowSec: 60,
        momentaryStrokeWidth: 1.1,
        shortTermStrokeWidth: 2.1,
        selectionStrokeWidth: 1.2,
      },
      metrics: {
        valueColumnCh: 5.5,
        unitColumnRem: 2.1,
        rowMinHeightRem: 2.5,
        rowPaddingXRem: 0.5,
        rowPaddingYRem: 0.375,
        rowGapRem: 0.5,
      },
    },
    peak: {
      meterGradient: {
        midStopPercent: 46,
      },
    },
    vectorscope: {
      strokeWidth: 1,
      axisOpacity: 0.8,
      gridDiagInsetPct: 1.2,
      plotRadius: 240,
      gridDiagDash: "2.6 3.4",
    },
    spectrum: {
      strokeWidth: 1.5,
      fillOpacityTop: 0.22,
      fillOpacityBottom: 0.03,
      gridOpacity: 0.08,
      spectrumGrid: {
        verticalSpacingPx: 56,
        horizontalSpacingPx: 34,
      },
    },
    waveform: {
      fillOpacity: 0.22,
      strokeWidth: 1,
    },
  },
};
