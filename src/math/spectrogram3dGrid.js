import { SPECTROGRAM_DB_MIN, SPECTROGRAM_DB_MAX } from "../config/scales.js";

/**
 * Select the frames that become ridges in the 3D waterfall, and read their levels into one grid.
 *
 * Each ridge IS a captured frame, positioned at its own timestamp. That is what makes the surface
 * flow: as the window slides, every ridge moves smoothly toward the old end, new ones appear at the
 * new end, and old ones fall off.
 *
 * The obvious alternative -- cut the window into N fixed slots and ask each slot which frame covers
 * it -- is what the 2D heatmap's long-zoom branch does, and it is wrong here. A slot is a fixed
 * screen position that keeps getting re-fed with whichever frame currently covers it, so window
 * movement smaller than one slot produces no visible change at all, and crossing a slot boundary
 * makes every ridge re-bind at once. That reads as stuttering and shimmering rather than motion,
 * and no amount of tuning ridge count or spacing removes it, because the stepping is in the
 * sampling rather than in the density.
 *
 * Decimation therefore buckets by ABSOLUTE time, not by position within the window. Bucket edges
 * that moved with the window would re-select different frames on every slide, reintroducing the
 * shimmer this exists to avoid.
 *
 * Real capture gaps need no special handling: a stretch of time holding no frames simply
 * contributes no ridges, which is the 3D equivalent of the blank columns the 2D path leaves.
 */

const DB_RANGE = SPECTROGRAM_DB_MAX - SPECTROGRAM_DB_MIN;

/**
 * @param {object} args
 * @param {{ length: number, rowAt: (i: number) => any, timestampAt: (i: number) => number }} args.view
 * @param {number} args.startIdx first in-window frame index, inclusive
 * @param {number} args.endIdx last in-window frame index, inclusive
 * @param {number} args.oldestMs window start, in ms
 * @param {number} args.span window width, in ms
 * @param {number} args.maxRidges upper bound on the number of ridges drawn
 * @param {Int16Array} args.yToBand frequency sample points; its length sets pointCount
 * @returns {{ heights: Float32Array, tFracs: Float64Array, count: number, pointCount: number }}
 */
export function sampleWaterfallGrid({
  view,
  startIdx,
  endIdx,
  oldestMs,
  span,
  maxRidges,
  yToBand,
}) {
  const pointCount = yToBand.length;
  const cap = Math.max(1, Math.floor(maxRidges));
  const heights = new Float32Array(cap * pointCount);
  const tFracs = new Float64Array(cap);

  if (!view || endIdx < startIdx || !(span > 0)) {
    return { heights, tFracs, count: 0, pointCount };
  }

  // One frame per absolute-time bucket. Buckets are anchored to the epoch rather than to the
  // window, so a frame stays selected while the window slides past it.
  const strideMs = span / cap;
  let lastBucket = NaN;
  let count = 0;

  for (let i = startIdx; i <= endIdx && count < cap; i++) {
    const ts = view.timestampAt(i);
    if (!Number.isFinite(ts)) continue;

    const bucket = Math.floor(ts / strideMs);
    if (bucket === lastBucket) continue;

    const snap = view.rowAt(i);
    const dbList = snap?.dbList;
    if (!dbList) continue;

    lastBucket = bucket;
    const base = count * pointCount;
    for (let q = 0; q < pointCount; q++) {
      const db = dbList[yToBand[q]];
      const norm = Number.isFinite(db) ? (db - SPECTROGRAM_DB_MIN) / DB_RANGE : 0;
      heights[base + q] = norm < 0 ? 0 : norm > 1 ? 1 : norm;
    }
    tFracs[count] = (ts - oldestMs) / span;
    count += 1;
  }

  return { heights, tFracs, count, pointCount };
}
