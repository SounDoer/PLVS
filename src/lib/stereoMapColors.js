import { STEREO_MAP_FILL_OPACITY } from "./chartFill.js";
import { STEREO_MAP_MODES } from "../math/stereoMapMath.js";

const FALLBACK_COLOR = { r: 128, g: 128, b: 128 };

/**
 * @param {number} t
 */
export function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

/**
 * @param {number} value
 */
export function normalizedChannelPosition(value, range) {
  const span = range.upperBound - range.lowerBound;
  if (!(span > 0)) return 0;
  return clamp01((value - range.lowerBound) / span) * 2 - 1;
}

/**
 * @param {number} strengthPercent
 */
export function energyFadeOpacity(opacity, strengthPercent) {
  const base = clamp01(opacity);
  if (base === 0 || base === 1) return base;
  return base ** (Math.max(0, Math.min(100, strengthPercent)) / 100);
}

// Position: 0 at the second channel, 1 at the first channel. Blend controls how much of the
// normalized -1..+1 position range is used as the transition around center; zero is a hard split.
/**
 * @param {number} blendPercent
 */
function channelBlendT(value, range, blendPercent) {
  const normalizedPosition = normalizedChannelPosition(value, range);
  const blendWidth = clamp01(blendPercent / 100);
  if (blendWidth === 0) return normalizedPosition >= 0 ? 1 : 0;
  return clamp01((normalizedPosition + blendWidth) / (2 * blendWidth));
}

// Correlation: -1 (anti-phase) is Bad, +1 (in phase) is Good.
/**
 * @param {number} value
 */
function correlationColorT(value) {
  return clamp01((value + 1) / 2);
}

// Mono Loss: the range's lower bound is Bad, 0 dB is Good.
/**
 * @param {number} value
 */
function monoLossColorT(value, range) {
  const span = 0 - range.lowerBound;
  if (!(span > 0)) return 1;
  return clamp01((value - range.lowerBound) / span);
}

/** Parses a resolved CSS color (hex or rgb()/rgba()) into {r,g,b}. Returns null if unparseable. */
function parseColor(raw) {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let match = /^#([0-9a-f]{3})$/i.exec(value);
  if (match) {
    const [r, g, b] = match[1];
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  match = /^#([0-9a-f]{6})$/i.exec(value);
  if (match) {
    const hex = match[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  match = /^#([0-9a-f]{8})$/i.exec(value);
  if (match) {
    const hex = match[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
  if (match) return { r: +match[1], g: +match[2], b: +match[3] };
  return null;
}

export function rgbToCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * `"rgb(r, g, b)"` -> `"rgba(r, g, b, alpha)"`. Falls back to the input unchanged if unparseable.
 * @param {string} rgbCss
 */
export function withAlpha(rgbCss, alpha) {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(rgbCss);
  if (!match) return rgbCss;
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${clamp01(alpha)})`;
}

// Canvas equivalent of `color-mix(in srgb, colorA pct%, colorB)`: a plain per-channel lerp in
// sRGB, colorA weighted by pct/100.
/**
 * @param {number} pctOfA
 */
function mixColors(pctOfA, colorA, colorB) {
  const t = clamp01(pctOfA / 100);
  return rgbToCss({
    r: Math.round(colorA.r * t + colorB.r * (1 - t)),
    g: Math.round(colorA.g * t + colorB.g * (1 - t)),
    b: Math.round(colorA.b * t + colorB.b * (1 - t)),
  });
}

/**
 * @param {number} t
 */
function channelBlendColor(t, primary, secondary) {
  return mixColors(clamp01(t) * 100, primary, secondary);
}

// Continuous Bad -> Warn -> Good, derived from the existing signal tokens. t=0 is fully Bad,
// t=0.5 is fully Warn, t=1 is fully Good.
/**
 * @param {number} t
 */
function threeStopSignalColor(t, warn, bad, good) {
  const clamped = clamp01(t);
  if (clamped <= 0.5) {
    return mixColors((clamped / 0.5) * 100, warn, bad);
  }
  return mixColors(((clamped - 0.5) / 0.5) * 100, good, warn);
}

/**
 * @param {number} value
 */
export function segmentColor(mode, value, range, colors, colorBlendPercent = 100) {
  switch (mode) {
    case STEREO_MAP_MODES.POSITION:
      return channelBlendColor(
        channelBlendT(value, range, colorBlendPercent),
        colors.primary,
        colors.secondary
      );
    case STEREO_MAP_MODES.CORRELATION:
      return threeStopSignalColor(correlationColorT(value), colors.warn, colors.bad, colors.good);
    case STEREO_MAP_MODES.MONO_LOSS_DB:
      return threeStopSignalColor(
        monoLossColorT(value, range),
        colors.warn,
        colors.bad,
        colors.good
      );
    case STEREO_MAP_MODES.MS_RATIO_DB:
      // Side-dominant (positive) reuses Spectrum's Mid/Side "secondary" token, Mid-dominant
      // (negative) reuses "primary" — the same pairing Spectrum's M/S view uses. Side is not
      // tinted as dangerous; it is simply the other side of the same pair of colors as Mid.
      return value >= 0 ? colors.secondaryCss : colors.primaryCss;
    default:
      return colors.primaryCss;
  }
}

/**
 * @param {string} paletteKey
 */
export function resolveColors(themeColors, paletteKey) {
  const primary =
    parseColor(paletteKey === "snap" ? themeColors.primarySnapshot : themeColors.primary) ||
    FALLBACK_COLOR;
  const secondary =
    parseColor(paletteKey === "snap" ? themeColors.secondarySnapshot : themeColors.secondary) ||
    FALLBACK_COLOR;
  const history = paletteKey === "snap";
  const warn =
    parseColor(history ? themeColors.warningHistory : themeColors.warning) || FALLBACK_COLOR;
  const bad =
    parseColor(history ? themeColors.criticalHistory : themeColors.critical) || FALLBACK_COLOR;
  const good = parseColor(history ? themeColors.goodHistory : themeColors.good) || FALLBACK_COLOR;
  const grid = parseColor(themeColors.grid) || FALLBACK_COLOR;
  return {
    primary,
    secondary,
    warn,
    bad,
    good,
    grid,
    primaryCss: rgbToCss(primary),
    secondaryCss: rgbToCss(secondary),
    fillOpacity: STEREO_MAP_FILL_OPACITY,
  };
}
