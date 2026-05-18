/**
 * Computes PLVS-specific component color values that have no shadcn equivalent.
 * Returns plain CSS color strings consumed by applyDocumentTheme.
 *
 * @param {import("./shadcnSemanticPreset.js").ShadcnSemantic} _s  Unused — reserved for future derivation.
 * @param {"light"|"dark"} colorScheme
 */
export function buildMeterColorBridge(_s, colorScheme) {
  if (colorScheme === "light") {
    return {
      peakSamplePeak: "#e07020",
      peakTruePeak: "#d03535",
      tpMaxText: "#d03535",
      correlation: {
        bad: "#d03535",
        mid: "#7a6e5e",
        good: "#18976a",
      },
      metricRowBg: "rgba(0,0,0,0.04)",
      metricRowHoverBg: "rgba(0,0,0,0.08)",
      metricRowToggleOnBorder: "rgba(224,112,32,0.5)",
      metricRowToggleOnBg: "rgba(224,112,32,0.12)",
      metricRowToggleOnGlow: "rgba(224,112,32,0.22)",
      metricToggleOnLabel: "#e07020",
      loudnessTargetLine: "rgba(224,112,32,0.45)",
    };
  }
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
