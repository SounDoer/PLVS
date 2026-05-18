/**
 * Computes PLVS-specific component color values that have no shadcn equivalent.
 * Returns plain CSS color strings consumed by applyDocumentTheme.
 *
 * @param {import("./shadcnSemanticPreset.js").ShadcnSemantic} _s  Reserved for future light theme.
 * @param {"light"|"dark"} _colorScheme  Reserved for future light theme.
 */
export function buildMeterColorBridge(_s, _colorScheme) {
  return {
    peakSamplePeak: "#fb923c",
    peakTruePeak: "#f97373",
    tpMaxText: "#f97373",
    correlation: {
      bad: "#f97373",
      mid: "#9e9488",
      good: "#34d399",
    },
    metricRowBg: "rgba(255,255,255,0.04)",
    metricRowHoverBg: "rgba(255,255,255,0.07)",
    metricRowToggleOnBorder: "rgba(251,146,60,0.4)",
    metricRowToggleOnBg: "rgba(251,146,60,0.10)",
    metricRowToggleOnGlow: "rgba(251,146,60,0.25)",
    metricToggleOnLabel: "#fb923c",
    loudnessTargetLine: "rgba(251,146,60,0.4)",
  };
}
