import { hexToOklch, oklchToHex, transform } from "./colorTransform.js";

// Scheme-aware deltas tuned to match hand-tuned anchors within rgb-distance 30.
const SNAP = { dark: { dL: 0.12, dC: -0.006, dH: 36 }, light: { dL: -0.16, dC: -0.02, dH: 18 } };
const OVER = { dark: { dL: -0.075, dC: 0.052, dH: -18 }, light: { dL: -0.05, dC: 0.08, dH: -28 } };
const SIBLING = {
  dark: { dL: -0.138, dC: -0.02, dH: -4.4 },
  light: { dL: -0.18, dC: -0.02, dH: -6 },
};

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * @param {import("./builtinThemes.js").BuiltinTheme} theme
 * @returns {Record<string,string>}
 */
export function buildThemeTokens(theme) {
  const scheme = theme.colorScheme === "light" ? "light" : "dark";
  const { accent, accentSecondary, signal } = theme.seeds;

  const snap = (hex) => oklchToHex(transform(hexToOklch(hex), SNAP[scheme]));
  const over = (hex) => oklchToHex(transform(hexToOklch(hex), OVER[scheme]));
  const sibling = (hex) => oklchToHex(transform(hexToOklch(hex), SIBLING[scheme]));

  const accentSnap = snap(accent);
  const shortterm = sibling(accent);
  const gridPct = scheme === "light" ? 20 : 10;
  const rowTint = scheme === "light" ? "0,0,0" : "255,255,255";

  return {
    "--ui-chart-momentary": accent,
    "--ui-chart-momentary-snap": accentSnap,
    "--ui-chart-momentary-over": over(accent),
    "--ui-chart-shortterm": shortterm,
    "--ui-chart-shortterm-snap": snap(shortterm),
    "--ui-chart-shortterm-over": over(shortterm),
    "--ui-chart-selection": accentSnap,
    "--ui-chart-vectorscope-live": accent,
    "--ui-chart-vectorscope-snap": accentSnap,
    "--ui-chart-spectrum-live": accent,
    "--ui-chart-spectrum-snap": accentSnap,
    "--ui-chart-spectrum-live-b": accentSecondary,
    "--ui-chart-spectrum-snap-b": snap(accentSecondary),
    "--ui-chart-waveform-live": accent,
    "--ui-signal-peak-sample": accent,
    "--ui-signal-peak-true": signal.bad,
    "--ui-signal-tp-max": signal.bad,
    "--ui-signal-corr-bad": signal.bad,
    "--ui-signal-corr-good": signal.good,
    "--ui-signal-corr-mid": "var(--muted-foreground)",
    "--ui-meter-grad-top": signal.bad,
    "--ui-meter-grad-mid": signal.warn,
    "--ui-meter-grad-bottom": signal.good,
    "--ui-chart-target-line": rgba(accent, 0.4),
    "--ui-metric-row-bg": `rgba(${rowTint},0.04)`,
    "--ui-metric-row-hover-bg": `rgba(${rowTint},${scheme === "light" ? 0.08 : 0.07})`,
    "--ui-metric-row-toggle-on-border": rgba(accent, scheme === "light" ? 0.5 : 0.4),
    "--ui-metric-row-toggle-on-bg": rgba(accent, scheme === "light" ? 0.12 : 0.1),
    "--ui-metric-row-toggle-on-glow": rgba(accent, scheme === "light" ? 0.22 : 0.25),
    "--ui-metric-toggle-on-label": accent,
    "--ui-loudness-history-grid-line": `color-mix(in srgb, var(--border) ${gridPct}%, transparent)`,
    "--ui-vs-grid-diag-stroke": "color-mix(in srgb, var(--border) 80%, transparent)",
  };
}
