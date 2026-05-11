/**
 * Shared scale math for React meters so ticks and plotted curves stay aligned.
 */

/** Peak / Loudness History shared axis: -60 to +3 dB (matches legacy peak.js MMIN/MMAX). */
export const PEAK_DB_MIN = -60;
export const PEAK_DB_MAX = 3;
const PEAK_DB_RNG = PEAK_DB_MAX - PEAK_DB_MIN;

/** 0..1 linear position: +3 dB → 1, -60 dB → 0 */
export function peakFrac(v) {
  const c = Math.max(PEAK_DB_MIN, Math.min(PEAK_DB_MAX, Number.isFinite(v) ? v : PEAK_DB_MIN));
  return (c - PEAK_DB_MIN) / PEAK_DB_RNG;
}

/**
 * Normalized position from the top of the dial/plot: +3 dB → 0, -60 dB → 1.
 * Same (1 - frac) mapping as other meters for reuse across components.
 */
export function peakFromTopFrac(v) {
  return 1 - peakFrac(v);
}

/** Loudness History axis: -64 to 0 dB (typical LUFS readout range). */
export const LOUDNESS_DB_MIN = -64;
export const LOUDNESS_DB_MAX = 0;
const LOUDNESS_DB_RNG = LOUDNESS_DB_MAX - LOUDNESS_DB_MIN;

/** Loudness: from-top normalized position; -3 dB → 0, -64 dB → 1 on this axis. */
export function loudnessFromTopFrac(v) {
  const c = Math.max(
    LOUDNESS_DB_MIN,
    Math.min(LOUDNESS_DB_MAX, Number.isFinite(v) ? v : LOUDNESS_DB_MIN)
  );
  return 1 - (c - LOUDNESS_DB_MIN) / LOUDNESS_DB_RNG;
}

/** Loudness History y for SVG viewBox height 220 (must match App buildHistoryPath). */
export function loudnessHistY(v, viewH = 220) {
  return viewH * loudnessFromTopFrac(v);
}

/** Spectrum viewBox height 260; dB→y uses top/bottom padding so 0 dB does not hug the SVG edge */
export const SPEC_VIEW_H = 260;
/** Top padding inside viewBox (px); 0 dB maps to this y, not 0 */
export const SPEC_VIEW_TOP_PAD = 10;
/** Bottom padding inside viewBox (px) */
export const SPEC_VIEW_BOTTOM_PAD = 4;
export const SPEC_DB_MIN = -100;
export const SPEC_DB_MAX = 0;
const SPEC_DB_RNG = SPEC_DB_MAX - SPEC_DB_MIN;
/** Plot height for dB→y (viewBox height minus vertical padding) */
export const SPEC_PLOT_H = SPEC_VIEW_H - SPEC_VIEW_TOP_PAD - SPEC_VIEW_BOTTOM_PAD;

/** React Spectrum: default FFT→RTA display params (not theme tokens; see App tick) */
export const SPECTRUM_SETTINGS = {
  resolution: "1/24", // 1/3 | 1/6 | 1/12 | 1/24 | 1/48
  weighting: "z", // z | a | c
  smoothing: "fast", // fast | normal | slow
  showPeakHold: false,
  peakHoldMs: 1000,
  peakDecayDbPerSec: 12,
  freqSmoothingKernel: [0.12, 0.76, 0.12],
  tiltDbPerOctave: 0,
  freeze: false,
  minHz: 20,
  maxHz: 20000,
};

export function spectrumDbToYViewBox(d) {
  const dd = Math.max(SPEC_DB_MIN, Math.min(SPEC_DB_MAX, Number.isFinite(d) ? d : SPEC_DB_MIN));
  return SPEC_VIEW_H - SPEC_VIEW_BOTTOM_PAD - ((dd - SPEC_DB_MIN) / SPEC_DB_RNG) * SPEC_PLOT_H;
}

/** Tick line top as fraction of full viewBox height (same coords as spectrum trace) */
export function spectrumDbToTopFrac(d) {
  return spectrumDbToYViewBox(d) / SPEC_VIEW_H;
}

const LOG20 = Math.log10(20);
const LOG20K = Math.log10(20000);
const LOG_DEN = LOG20K - LOG20;

/** Frequency Hz → [0,1] for log horizontal axis tick placement */
export function freqToXFrac(f) {
  const ff = Math.max(20, Math.min(20000, f));
  return (Math.log10(ff) - LOG20) / LOG_DEN;
}

const RTA_BANDS_PER_OCTAVE = {
  "1/3": 3,
  "1/6": 6,
  "1/12": 12,
  "1/24": 24,
  "1/48": 48,
};

export function getRtaBandsPerOctave(resolution = "1/6") {
  return RTA_BANDS_PER_OCTAVE[resolution] || RTA_BANDS_PER_OCTAVE["1/6"];
}

export function buildRtaBands(minHz = 20, maxHz = 20000, resolution = "1/6") {
  const lo = Math.max(1, minHz);
  const hi = Math.max(lo + 1, maxHz);
  const n = getRtaBandsPerOctave(resolution);
  const half = Math.pow(2, 1 / (2 * n));
  const step = Math.pow(2, 1 / n);
  const bands = [];
  let center = lo;
  for (let guard = 0; guard < 512 && center <= hi * 1.001; guard += 1) {
    const fLow = center / half;
    const fHigh = center * half;
    if (fHigh >= lo && fLow <= hi) {
      bands.push({
        fLow: Math.max(lo, fLow),
        fHigh: Math.min(hi, fHigh),
        fCenter: center,
      });
    }
    center *= step;
  }
  return bands;
}

function weightingA(fHz) {
  const f2 = fHz * fHz;
  const num = 12194 * 12194 * f2 * f2;
  const den =
    (f2 + 20.6 * 20.6) *
    Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
    (f2 + 12194 * 12194);
  return 2 + 20 * Math.log10(Math.max(1e-20, num / den));
}

function weightingC(fHz) {
  const f2 = fHz * fHz;
  const num = 12194 * 12194 * f2;
  const den = (f2 + 20.6 * 20.6) * (f2 + 12194 * 12194);
  return 0.06 + 20 * Math.log10(Math.max(1e-20, num / den));
}

export function getWeightingDb(freqHz, mode = "z") {
  const f = Math.max(10, freqHz);
  if (mode === "a") return weightingA(f);
  if (mode === "c") return weightingC(f);
  return 0;
}

/** Peak meter main ticks (left rail) */
export const PEAK_TICKS = [
  { v: 3, lb: "+3" },
  { v: 0, lb: "0" },
  { v: -6, lb: "-6" },
  { v: -12, lb: "-12" },
  { v: -24, lb: "-24" },
  { v: -48, lb: "-48" },
  { v: -60, lb: "-60" },
];

/** Loudness History left ticks (keep dB in -60..+3 to align with the drawn curve) */
export const LOUDNESS_TICKS = [
  { v: 0, lb: "0" },
  { v: -6, lb: "-6" },
  { v: -12, lb: "-12" },
  { v: -18, lb: "-18" },
  { v: -27, lb: "-27" },
  { v: -36, lb: "-36" },
  { v: -45, lb: "-45" },
  { v: -54, lb: "-54" },
  { v: -63, lb: "-63" },
];

/** Spectrum left dB ticks (-100 to 0) */
export const SPEC_Y_TICKS = [
  { v: 0, lb: "0" },
  { v: -20, lb: "-20" },
  { v: -40, lb: "-40" },
  { v: -60, lb: "-60" },
  { v: -80, lb: "-80" },
];

/** Spectrum frequency axis labels */
export const FREQ_LABELS = [
  [20, "20"],
  [50, "50"],
  [100, "100"],
  [200, "200"],
  [500, "500"],
  [1000, "1k"],
  [2000, "2k"],
  [5000, "5k"],
  [10000, "10k"],
  [20000, "20k"],
];
