import { hexToOklch, oklchToHex, transform } from "./colorTransform.js";

// Scheme-aware deltas tuned to match hand-tuned anchors within rgb-distance 30.
const SNAP = { dark: { dL: 0.12, dC: -0.006, dH: 36 }, light: { dL: -0.16, dC: -0.02, dH: 18 } };
const OVER = { dark: { dL: -0.075, dC: 0.052, dH: -18 }, light: { dL: -0.05, dC: 0.08, dH: -28 } };
const SIBLING = {
  dark: { dL: -0.138, dC: -0.02, dH: -4.4 },
  light: { dL: -0.18, dC: -0.02, dH: -6 },
};

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

  return {
    // accent is the brand bridge into the shadcn shell (spec §3): --primary/--ring follow accent,
    // overriding the explicit semantic values so brand buttons + focus rings track the theme accent.
    "--primary": accent,
    "--ring": accent,
    "--ui-loudness-momentary": accent,
    "--ui-loudness-momentary-snap": accentSnap,
    "--ui-loudness-momentary-over": over(accent),
    "--ui-loudness-shortterm": shortterm,
    "--ui-loudness-shortterm-snap": snap(shortterm),
    "--ui-loudness-shortterm-over": over(shortterm),
    "--ui-loudness-selection": accentSnap,
    "--ui-loudness-grid": `color-mix(in srgb, var(--border) ${gridPct}%, transparent)`,
    "--ui-vectorscope-trace": accent,
    "--ui-vectorscope-trace-snap": accentSnap,
    "--ui-vectorscope-grid-stroke": "color-mix(in srgb, var(--border) 80%, transparent)",
    "--ui-spectrum-primary": accent,
    "--ui-spectrum-primary-snap": accentSnap,
    "--ui-spectrum-secondary": accentSecondary,
    "--ui-spectrum-secondary-snap": snap(accentSecondary),
    "--ui-waveform-trace": accent,
    "--ui-waveform-trace-snap": accentSnap,
    "--ui-signal-peak-sample": accent,
    "--ui-signal-tp-max": signal.bad,
    "--ui-signal-bad": signal.bad,
    "--ui-signal-warn": signal.warn,
    "--ui-signal-good": signal.good,
    "--ui-meter-gradient-top": signal.bad,
    "--ui-meter-gradient-mid": signal.warn,
    "--ui-meter-gradient-bottom": signal.good,
  };
}
