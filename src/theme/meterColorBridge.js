/**
 * Maps shadcn semantic tokens to legacy `--ui-color-*` variables consumed by charts,
 * SVG strokes, and pre-Tailwind metric chrome. Surfaces follow official pairs; metering
 * accents pull from `chart-*` / `primary` where sensible.
 *
 * @param {import("./shadcnSemanticPreset.js").ShadcnSemantic} s
 * @param {"dark"|"light"} colorScheme Browser `color-scheme` hint; not a second theme axis (ADR 0002).
 */
export function buildMeterColorBridge(s, colorScheme) {
  const isLight = colorScheme === "light";
  const settingsOverlay = isLight ? "oklch(0.145 0 0 / 0.35)" : "oklch(0 0 0 / 0.55)";
  const settingsDialogShadow = isLight
    ? "0 16px 34px -14px rgb(15 23 42 / 0.28)"
    : "0 25px 50px -12px rgb(0 0 0 / 0.5)";
  const insetDark = isLight ? "oklch(0.97 0 0 / 0.98)" : "oklch(0.12 0 0 / 0.94)";

  return {
    pageBg: s.background,
    textPrimary: s.foreground,
    textSecondary: s.mutedForeground,
    textMuted: s.mutedForeground,
    textSubtle: s.mutedForeground,
    panelBg: s.card,
    panelBgSplitter: s.secondary,
    insetBg: s.muted,
    insetDark,
    borderDefault: s.border,
    divider: s.border,
    brand: s.primary,
    brandLight: s.ring,
    brandHover: s.ring,
    controlBg: s.accent,
    peakSamplePeak: s.chart4,
    peakTruePeak: s.chart2,
    tpMaxText: s.chart2,
    correlation: {
      bad: s.destructive,
      mid: s.chart3,
      good: s.chart2,
    },
    loudnessTargetLine: s.chart3,
    settingsOverlay,
    settingsRowBg: isLight ? "oklch(0.985 0 0 / 0.95)" : "oklch(0.205 0 0 / 0.88)",
    legendHistOnBg: s.accent,
    legendHistOnText: s.accentForeground,
    legendHistOffBg: s.muted,
    legendHistOffText: s.mutedForeground,
    metricRowBg: isLight ? "oklch(1 0 0 / 0.55)" : "oklch(0.269 0 0 / 0.45)",
    metricRowBorder: s.border,
    metricRowHoverBg: isLight ? "oklch(0.985 0 0 / 0.92)" : "oklch(0.269 0 0 / 0.62)",
    metricRowToggleOnBg: isLight
      ? "oklch(0.58 0.15 245 / 0.18)"
      : "oklch(0.488 0.243 264.376 / 0.22)",
    metricRowToggleOnBorder: s.primary,
    metricRowToggleOnGlow: isLight ? "oklch(0.58 0.15 245 / 0.28)" : "oklch(0.82 0.1 195 / 0.35)",
    metricLabelText: s.mutedForeground,
    metricValueText: s.foreground,
    metricUnitText: s.mutedForeground,
    metricToggleOnLabelText: isLight ? "oklch(0.35 0.12 245)" : "oklch(0.85 0.06 245)",
    metricToggleOnUnitText: isLight ? "oklch(0.4 0.12 245)" : "oklch(0.78 0.08 245)",
    targetLabel: s.mutedForeground,
    targetValue: s.chart3,
    controlHoverBg: isLight ? "oklch(0.922 0 0)" : "oklch(0.37 0 0)",
    settingsDialogShadow,
  };
}
