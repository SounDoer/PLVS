import { loudnessFromTopFrac, freqToXFrac } from "../config/scales";

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
 * Finds the nearest spectrum band index to a pointer X position.
 * @param {number} clientX
 * @param {DOMRect} rect
 * @param {{ fCenter: number }[]} bands
 * @returns {number}
 */
export function computeSpectrumHoverIndex(clientX, rect, bands) {
  const width = Math.max(1, rect.width);
  const x = Math.max(0, Math.min(width, clientX - rect.left));
  const xFrac = x / width;
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
