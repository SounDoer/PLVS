/**
 * Default layout, typography, radii, and per-module **non-theme** tuning (`UI_PREFERENCES`).
 * Chart stroke colours, stroke widths, vectorscope geometry, and meter gradients are defined per
 * builtin theme in `src/theme/builtinThemes.js` and applied via `applyThemeToDocument` (CSS vars).
 */

export const UI_PREFERENCES = {
  layoutPersistKey: "plvs.ui",

  layout: {
    shell: {
      maxWidthPx: 1600,
      paddingRem: { base: 0.8, lg: 1.2 },
      gapRem: { base: 0.55, lg: 0.6 },
    },
    splitters: {
      sectionGapRem: 0.55,
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
      metricsListGap: 0.2,
      axisGapX: 0.4,
      axisGapY: 0.4,
      peakAxisChartGap: 0.5,
      peakChannelGap: 0.4,
      peakDisplayTopInset: 0.5,
      peakDisplayBottomInset: 0.5,
      meterChartInsetX: 0.6,
      meterLabelTopInset: 0.5,
      chartOuterInset: 0,
      vectorCornerInset: 0.4,
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
      title: 16,
      section: 12,
      axisValue: 13,
      axisUnit: 11,
      extraValue: 13,
      metricMeta: 12,
      metricValue: 18,
      action: 14,
      status: 11,
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

  modules: {
    loudness: {
      history: {
        defaultWindowSec: 120,
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
    spectrum: {
      /**
       * Spectrum grid line opacities keyed by **browser `color-scheme` hint** from the active theme
       * (`"light"` | `"dark"`), not Tailwind `.dark` / `dark:`.
       */
      spectrumOpacityByColorScheme: {
        colorSchemeDark: {
          verticalLineOpacity: 0.08,
          horizontalLineOpacity: 0.08,
        },
        colorSchemeLight: {
          verticalLineOpacity: 0.07,
          horizontalLineOpacity: 0.05,
        },
      },
      spectrumGrid: {
        verticalSpacingPx: 56,
        horizontalSpacingPx: 34,
      },
    },
  },
};
