import { loudnessFromTopFrac, freqToXFrac } from "../config/scales";
import { hzFromFrac } from "./spectrogramMath.js";

/**
 * Formats a history hover age as a human-readable "X ago" string.
 * @param {number} sec
 * @returns {string}
 */
export function formatHoverOffset(sec) {
  const s = Math.max(0, sec);
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    return `${m}m ${rem.toFixed(rem >= 10 ? 0 : 1)}s ago`;
  }
  return `${s.toFixed(s >= 10 ? 0 : 1)}s ago`;
}

/**
 * Formats a frequency in Hz as a human-readable label.
 * @param {number} freq
 * @returns {string}
 */
export function formatSpectrumFreq(freq) {
  if (!Number.isFinite(freq)) return "-";
  if (freq >= 1000) {
    const khz = freq / 1000;
    return `${khz >= 10 ? khz.toFixed(1) : khz.toFixed(2)} kHz`;
  }
  return `${Math.round(freq)} Hz`;
}

/**
 * Resolves the hover data for the loudness history chart from a normalized X fraction.
 *
 * @param {number} xFrac - normalized X position (0 = left, 1 = right)
 * @param {{ m: number, st: number }[]} histSourceList
 * @param {number} effectiveOffsetSamples
 * @param {number} visibleSamples
 * @param {number} sampleSec
 * @returns {{ leftPct: number, topPct: number|null, momentary: number|null, shortTerm: number|null, offsetLabel: string } | null}
 */
export function computeHistoryHoverPoint(
  xFrac,
  histSourceList,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec
) {
  if (!histSourceList.length) return null;
  const normalized = 1 - xFrac;
  const fromEndSamples = effectiveOffsetSamples + normalized * Math.max(0, visibleSamples - 1);
  const hoverIndex = Math.max(
    0,
    Math.min(histSourceList.length - 1, histSourceList.length - 1 - Math.round(fromEndSamples))
  );
  const point = histSourceList[hoverIndex];
  if (!point) return null;
  const offsetSec = Math.max(0, (histSourceList.length - 1 - hoverIndex) * sampleSec);
  const yValue = Number.isFinite(point.st) ? point.st : point.m;
  return {
    leftPct: xFrac * 100,
    topPct: Number.isFinite(yValue) ? loudnessFromTopFrac(yValue) * 100 : null,
    momentary: Number.isFinite(point.m) ? point.m : null,
    shortTerm: Number.isFinite(point.st) ? point.st : null,
    offsetLabel: formatHoverOffset(offsetSec),
  };
}

/**
 * Resolves the hover data for the waveform panel from a normalized X fraction.
 *
 * @param {number} xFrac - normalized X position (0 = left/oldest, 1 = right/newest)
 * @param {number[][]} mins - mins[ch][i] linear amplitude min
 * @param {number[][]} maxes - maxes[ch][i] linear amplitude max
 * @param {number} entryCount - number of entries in the sliced window
 * @param {number} effectiveOffsetSamples - samples from live edge the window is offset
 * @param {number} visibleSamples - width of visible window in samples
 * @param {number} sampleSec - seconds per sample
 * @param {string[]} labels - channel labels
 * @returns {{ leftPct: number, timeLabel: string, channels: Array<{ label: string, dbFs: number }> } | null}
 */
export function computeWaveformHoverPoint(
  xFrac,
  mins,
  maxes,
  entryCount,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec,
  labels
) {
  if (entryCount === 0) return null;
  const sliceIndex = Math.round(xFrac * Math.max(0, entryCount - 1));
  const offsetFromEnd = effectiveOffsetSamples + (entryCount - 1 - sliceIndex);
  const offsetSec = Math.max(0, offsetFromEnd * sampleSec);
  return {
    leftPct: xFrac * 100,
    timeLabel: formatHoverOffset(offsetSec),
    channels: labels.map((label, ch) => ({
      label,
      dbFs: 20 * Math.log10(Math.max(1e-9, Math.abs(maxes[ch]?.[sliceIndex] ?? 0))),
    })),
  };
}

/**
 * Resolves hover data for the spectrogram panel from normalized X/Y fractions.
 *
 * @param {number} xFrac - normalized X (0=left/oldest, 1=right/newest)
 * @param {number} yFrac - normalized Y (0=top=20kHz, 1=bottom=20Hz)
 * @param {{ bands: {fCenter: number}[], dbList: number[] }[]} snaps
 * @param {number} effectiveOffsetSamples
 * @param {number} visibleSamples
 * @param {number} sampleSec
 * @returns {{ leftPct: number, topPct: number, timeLabel: string, freqLabel: string, dbLabel: string } | null}
 */
export function computeSpectrogramHoverPoint(
  xFrac,
  yFrac,
  snaps,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec
) {
  if (!snaps.length) return null;

  const normalized = 1 - xFrac;
  const fromEndSamples = effectiveOffsetSamples + normalized * Math.max(0, visibleSamples - 1);
  const hoverIndex = Math.max(
    0,
    Math.min(snaps.length - 1, snaps.length - 1 - Math.round(fromEndSamples))
  );
  const snap = snaps[hoverIndex];
  if (!snap) return null;
  const offsetSec = Math.max(0, (snaps.length - 1 - hoverIndex) * sampleSec);

  const { bands, dbList } = snap;
  if (!bands?.length || !dbList?.length) return null;

  // yFrac=0 (top) → 20kHz, yFrac=1 (bottom) → 20Hz; hzFromFrac(0)=20Hz, hzFromFrac(1)=20kHz
  const hz = hzFromFrac(1 - yFrac);

  // Log-domain binary search for nearest band
  let lo = 0,
    hi = bands.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bands[mid].fCenter < hz) lo = mid + 1;
    else hi = mid;
  }
  if (
    lo > 0 &&
    Math.abs(Math.log(bands[lo - 1].fCenter) - Math.log(hz)) <
      Math.abs(Math.log(bands[lo].fCenter) - Math.log(hz))
  ) {
    lo = lo - 1;
  }
  const db = dbList[lo];

  return {
    leftPct: xFrac * 100,
    topPct: yFrac * 100,
    timeLabel: formatHoverOffset(offsetSec),
    freqLabel: formatSpectrumFreq(hz),
    dbLabel: Number.isFinite(db) ? `${db.toFixed(1)} dB` : "-",
  };
}

/**
 * Finds the nearest spectrum band index to a normalized X position.
 * @param {number} xFrac - normalized X position (0 = left, 1 = right)
 * @param {{ fCenter: number }[]} bands
 * @returns {number}
 */
export function computeSpectrumHoverIndex(xFrac, bands) {
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < bands.length; i += 1) {
    const dist = Math.abs(freqToXFrac(bands[i].fCenter) - xFrac);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }
  return nearestIdx;
}
