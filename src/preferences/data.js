/**
 * Default layout, typography, iconography, radii, and per-module **non-theme** tuning (`UI_PREFERENCES`).
 * Instrument colours are derived from theme seeds; chart geometry and meter gradient geometry live here.
 */

export const UI_PREFERENCES = {
  // Spacing is on a 4px grid: every value below is 0, 0.25, 0.5 or 0.75rem. Those are the only
  // steps that land on whole device pixels at every display scale; anything between them is
  // rounded differently from one gap to the next. See Spacing Tokens in design-tokens.md.
  layout: {
    shell: {
      paddingRem: { base: 0.25 },
      gapRem: { base: 0.25 },
    },
    splitters: {
      barThicknessPx: 1,
    },
    header: {
      paddingXRem: 0.5,
      paddingYRem: 0.25,
      actionGapRem: 0.25,
    },
    footer: {
      paddingXRem: 0.5,
      paddingYRem: 0.25,
    },
    /** Height of every form control. Scales with Interface Size so text never outgrows its box. */
    control: {
      heightPx: 24,
    },
    /** Floating editors: theme and loudness profile. Both scale with Interface Size. */
    editor: {
      preferredWidthPx: 416,
    },
    drawer: {
      preferredWidthPx: 320,
      paddingRem: 0.75,
      sectionGapRem: 0.75,
      rowGapRem: 0.25,
      rowMinHeightRem: 1.5,
    },
    articlePadding: {
      defaultXRem: 0.25,
      defaultYRem: 0.25,
    },
    spacingRem: {
      inlineValueGap: 0.5,
      metricsListGap: 0,
      chartAxisGap: 0.25,
      peakChannelGap: 0.25,
      meterChartInsetX: 0.5,
      meterLabelTopInset: 0.5,
      vectorOuterInset: 0,
      vectorCornerInset: 0.5,
      hudInset: 0.25,
      chartInsetTop: 0.25,
      chartInsetBottom: 0,
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
      yAxisRailMin: 20,
    },
  },

  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    sizesPx: {
      caption: 10,
      axis: 11,
      status: 11,
      control: 12,
      metricMeta: 12,
      panelTitle: 12,
      display: 13,
      body: 14,
      metricValue: 16,
    },
  },

  iconography: {
    sizesPx: {
      panelAction: 12,
      managementAction: 14,
      shellAction: 14,
      panelModule: 14,
    },
  },

  /** `card` is used for `--radius` at runtime and for generated first-paint CSS (`scripts/generate-theme-fallbacks.mjs`). */
  radii: {
    card: "0.625rem",
  },

  modules: {
    loudness: {
      history: {
        defaultWindowSec: 60,
        momentaryStrokeWidth: 1.2,
        shortTermStrokeWidth: 1.2,
        selectionStrokeWidth: 1.2,
      },
    },
    stats: {
      metrics: {
        valueColumnCh: 5.5,
        unitColumnRem: 2.1,
        rowMinHeightRem: 1.25,
        rowPaddingXRem: 0.25,
        rowGapRem: 0.5,
      },
    },
    vectorscope: {
      strokeWidth: 1.2,
      gridDiagInsetPct: 1.2,
      plotRadius: 240,
      gridDiagDash: "2.6 3.4",
    },
    spectrum: {
      strokeWidth: 1.5,
    },
    stereoMap: {
      strokeWidth: 1.5,
    },
    waveform: {
      strokeWidth: 1,
    },
  },
};
