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
export function peakFromTopFrac(v, range = {}) {
  if (Number.isFinite(range.min) && Number.isFinite(range.max)) {
    return rangedFromTopFrac(v, range.min, range.max);
  }
  return 1 - peakFrac(v);
}

/** Loudness History axis: -64 to 0 dB (typical LUFS readout range). */
export const LOUDNESS_DB_MIN = -64;
export const LOUDNESS_DB_MAX = 0;
const LOUDNESS_DB_RNG = LOUDNESS_DB_MAX - LOUDNESS_DB_MIN;

/** Loudness: from-top normalized position; -3 dB → 0, -64 dB → 1 on this axis. */
export function rangedFromTopFrac(v, min, max) {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 1;
  const c = Math.max(safeMin, Math.min(safeMax, Number.isFinite(v) ? v : safeMin));
  return 1 - (c - safeMin) / (safeMax - safeMin);
}

export function loudnessFromTopFrac(v, range = {}) {
  if (Number.isFinite(range.min) && Number.isFinite(range.max)) {
    return rangedFromTopFrac(v, range.min, range.max);
  }
  const c = Math.max(
    LOUDNESS_DB_MIN,
    Math.min(LOUDNESS_DB_MAX, Number.isFinite(v) ? v : LOUDNESS_DB_MIN)
  );
  return 1 - (c - LOUDNESS_DB_MIN) / LOUDNESS_DB_RNG;
}

/** Loudness History y for SVG viewBox height 220 (must match App buildHistoryPath). */
export function loudnessHistY(v, viewH = 220, range = {}) {
  return viewH * loudnessFromTopFrac(v, range);
}

export function rangedHistY(v, viewH = 220, min, max) {
  return viewH * rangedFromTopFrac(v, min, max);
}

/** Spectrum viewBox height 260; dB→y uses top/bottom padding so max dB does not hug the SVG edge */
export const SPEC_VIEW_H = 260;
/** Top padding inside viewBox (px); max dB maps to this y, not 0 */
export const SPEC_VIEW_TOP_PAD = 10;
/** Bottom padding inside viewBox (px) */
export const SPEC_VIEW_BOTTOM_PAD = 4;
export const SPEC_DB_MAX = 0;
export const SPEC_DB_RANGE = 84;
export const SPEC_DB_MIN = SPEC_DB_MAX - SPEC_DB_RANGE;
/** Plot height for dB→y (viewBox height minus vertical padding) */
export const SPEC_PLOT_H = SPEC_VIEW_H - SPEC_VIEW_TOP_PAD - SPEC_VIEW_BOTTOM_PAD;

/** React Spectrum: default FFT→RTA display params (not theme tokens; see App tick) */
export const SPECTRUM_SETTINGS = {
  resolution: "1/24", // 1/3 | 1/6 | 1/12 | 1/24 | 1/48
  weighting: "z", // z | a | c
  smoothing: "fast", // fast | normal | slow
  freqSmoothingKernel: [0.12, 0.76, 0.12],
  tiltDbPerOctave: 0,
  freeze: false,
  minHz: 20,
  maxHz: 20000,
};

function normalizeSpectrumRange(range = {}) {
  const yMaxDb = Number.isFinite(range.yMaxDb) ? range.yMaxDb : SPEC_DB_MAX;
  const yMinDb = Number.isFinite(range.yMinDb)
    ? range.yMinDb
    : yMaxDb - (Number.isFinite(range.yRangeDb) ? range.yRangeDb : SPEC_DB_RANGE);
  return { yMaxDb, yMinDb, yRangeDb: Math.max(1, yMaxDb - yMinDb) };
}

export function spectrumDbToYViewBox(d, range = {}) {
  const { yMaxDb, yRangeDb } = normalizeSpectrumRange(range);
  const yMinDb = yMaxDb - yRangeDb;
  const dd = Math.max(yMinDb, Math.min(yMaxDb, Number.isFinite(d) ? d : yMinDb));
  return SPEC_VIEW_H - SPEC_VIEW_BOTTOM_PAD - ((dd - yMinDb) / yRangeDb) * SPEC_PLOT_H;
}

/** Tick line top as fraction of full viewBox height (same coords as spectrum trace) */
export function spectrumDbToTopFrac(d, range = {}) {
  return spectrumDbToYViewBox(d, range) / SPEC_VIEW_H;
}

const LOG20 = Math.log10(20);
const LOG20K = Math.log10(20000);
const LOG_DEN = LOG20K - LOG20;

/** Frequency Hz → [0,1] for log horizontal axis tick placement */
export function freqToXFrac(f) {
  const ff = Math.max(20, Math.min(20000, f));
  return (Math.log10(ff) - LOG20) / LOG_DEN;
}

export function freqToFracInRange(f, minHz = 20, maxHz = 20000) {
  const safeMin = Math.max(1, Number.isFinite(minHz) ? minHz : 20);
  const safeMax = Math.max(safeMin * 1.001, Number.isFinite(maxHz) ? maxHz : 20000);
  const ff = Math.max(safeMin, Math.min(safeMax, Number.isFinite(f) ? f : safeMin));
  const logMin = Math.log10(safeMin);
  const logMax = Math.log10(safeMax);
  return (Math.log10(ff) - logMin) / (logMax - logMin);
}

export function rangedFreqToXFrac(f, minHz = 20, maxHz = 20000) {
  return freqToFracInRange(f, minHz, maxHz);
}

export function rangedFreqToYFrac(f, minHz = 20, maxHz = 20000) {
  return 1 - freqToFracInRange(f, minHz, maxHz);
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

export function buildSpectrumYTicks(range = {}) {
  const { yMaxDb, yRangeDb } = normalizeSpectrumRange(range);
  const yMinDb = yMaxDb - yRangeDb;
  const ticks = [{ v: yMaxDb, lb: `${yMaxDb}` }];
  for (let v = yMaxDb - 12; v > yMinDb; v -= 12) {
    ticks.push({ v, lb: `${v}` });
  }
  ticks.push({ v: yMinDb, lb: `${yMinDb}` });
  return ticks;
}

/** Spectrum left dB ticks for the default -12..-96 dB display range */
export const SPEC_Y_TICKS = buildSpectrumYTicks();

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

const ADAPTIVE_TICK_MIN_GAP_PX = 24;

/** dB step ladder (1-2-5 decade pattern); ticks land on multiples so 0 and round values always hit. */
const DB_NICE_STEPS = [1, 2, 5, 10, 20, 50, 100];

/**
 * Frequency "nice number" tiers, coarse to fine. Each entry is the per-decade mantissa set, so the
 * coarsest tier gives the classic 20/50/100/200/500/1k... pattern and finer tiers fill narrow zooms.
 */
const FREQ_NICE_TIERS = [
  [1, 2, 5],
  [1, 2, 3, 5],
  [1, 1.5, 2, 3, 5, 7],
  [1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8],
];

function formatDb(value) {
  const r = Math.round(value);
  return r > 0 ? `+${r}` : `${r}`;
}

export function formatFreqLabel(hz) {
  if (hz >= 1000) {
    const k = Math.round((hz / 1000) * 10) / 10;
    return `${k}k`;
  }
  return `${Math.round(hz)}`;
}

export function buildAdaptiveDbTicks(minDb, maxDb, axisPx = 300) {
  if (!(maxDb > minDb)) return [{ v: maxDb, lb: formatDb(maxDb) }];
  const maxTicks = Math.max(2, Math.floor(axisPx / 32));
  const roundedMin = Math.round(minDb);
  const roundedMax = Math.round(maxDb);
  if (!(roundedMax > roundedMin)) {
    return [{ v: roundedMax, lb: formatDb(roundedMax) }];
  }
  const span = roundedMax - roundedMin;
  const step =
    DB_NICE_STEPS.find(
      (s) => Math.floor(roundedMax / s) - Math.ceil(roundedMin / s) + 1 <= maxTicks
    ) ?? span;
  // Endpoints are always labeled; interior ticks land on multiples of the chosen step (0 included).
  const byValue = new Map([
    [roundedMax, { v: roundedMax, lb: formatDb(roundedMax) }],
    [roundedMin, { v: roundedMin, lb: formatDb(roundedMin) }],
  ]);
  for (let v = Math.ceil(roundedMin / step) * step; v < roundedMax; v += step) {
    if (v > roundedMin && !byValue.has(v)) byValue.set(v, { v, lb: formatDb(v) });
  }
  const ticks = [...byValue.values()].sort((a, b) => b.v - a.v);
  return filterTicksByPixelGap(
    ticks,
    axisPx,
    (tick) => rangedFromTopFrac(tick.v, roundedMin, roundedMax) * axisPx,
    // Always keep the 0 dB reference line (only an interior tick when the range crosses 0, e.g. peak +3).
    (tick) => tick.v === 0
  );
}

function niceFreqsInRange(mantissas, minHz, maxHz) {
  const out = [];
  const startDecade = Math.floor(Math.log10(minHz));
  const endDecade = Math.ceil(Math.log10(maxHz));
  for (let decade = startDecade; decade <= endDecade; decade += 1) {
    const base = 10 ** decade;
    for (const mantissa of mantissas) {
      const f = mantissa * base;
      if (f > minHz && f < maxHz) out.push(f);
    }
  }
  return out;
}

export function buildAdaptiveFreqTicks(minHz, maxHz, axisPx = 500) {
  if (!(maxHz > minHz)) return [{ v: maxHz, lb: formatFreqLabel(maxHz) }];
  const maxTicks = Math.max(2, Math.floor(axisPx / 40));
  const minDesired = Math.max(3, Math.floor(maxTicks * 0.6));
  // Pick the coarsest tier that reaches the desired density; fall through to the finest otherwise.
  let chosen = niceFreqsInRange(FREQ_NICE_TIERS[0], minHz, maxHz);
  for (const tier of FREQ_NICE_TIERS) {
    chosen = niceFreqsInRange(tier, minHz, maxHz);
    if (chosen.length + 2 >= minDesired) break;
  }
  const ticks = [
    { v: minHz, lb: formatFreqLabel(minHz) },
    ...chosen.map((f) => ({ v: f, lb: formatFreqLabel(f) })),
    { v: maxHz, lb: formatFreqLabel(maxHz) },
  ].sort((a, b) => a.v - b.v);
  const spaced = filterTicksByPixelGap(
    ticks,
    axisPx,
    (tick) => rangedFreqToYFrac(tick.v, minHz, maxHz) * axisPx
  );
  return dedupeAdjacentLabels(spaced);
}

/**
 * Drops interior ticks whose formatted label repeats a neighbour (both endpoints kept).
 * Narrow log ranges produce more pixel slots than distinct round labels, which otherwise
 * renders runs like "1k, 1k, 1.1k, 1.1k"; collapse those to one tick per label.
 */
function dedupeAdjacentLabels(ticks) {
  if (ticks.length <= 2) return ticks;
  const kept = [ticks[0]];
  for (const tick of ticks.slice(1, -1)) {
    if (tick.lb !== kept.at(-1).lb) kept.push(tick);
  }
  const last = ticks.at(-1);
  while (kept.length > 1 && kept.at(-1).lb === last.lb) kept.pop();
  kept.push(last);
  return kept;
}

function filterTicksByPixelGap(ticks, axisPx, topPxForTick, isProtected = () => false) {
  if (ticks.length <= 2) return ticks;
  const minGapPx = Math.min(ADAPTIVE_TICK_MIN_GAP_PX, Math.max(0, axisPx / 2 - 1));
  const first = ticks[0];
  const last = ticks.at(-1);
  const lastPx = topPxForTick(last);
  const kept = [first];
  const keptPx = [topPxForTick(first)];
  for (const tick of ticks.slice(1, -1)) {
    const tickPx = topPxForTick(tick);
    const hasRoom =
      Math.abs(tickPx - lastPx) >= minGapPx &&
      keptPx.every((existingPx) => Math.abs(tickPx - existingPx) >= minGapPx);
    if (hasRoom || isProtected(tick)) {
      kept.push(tick);
      keptPx.push(tickPx);
    }
  }
  kept.push(last);
  return kept;
}
