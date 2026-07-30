import { SPECTROGRAM_DB_MAX } from "../config/scales.js";

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
 * Bucket WIDTH has to be stable for the same reason, and that is easy to get wrong. The window's
 * edges are real captured timestamps, so `span` jitters by a few ms on every history update; a
 * stride derived straight from `span / maxRidges` inherits that jitter, every bucket edge shifts,
 * and frames sitting near an edge flip in and out of the selection. With dozens of buckets, several
 * ridges then blink on and off per update. Quantising the stride to a whole number of frame periods
 * pins the edges: the stride only changes when the window is actually resized, never from jitter.
 *
 * Real capture gaps need no special handling: a stretch of time holding no frames simply
 * contributes no ridges, which is the 3D equivalent of the blank columns the 2D path leaves.
 */

/**
 * @param {object} args
 * @param {{ length: number, rowAt: (i: number) => any, timestampAt: (i: number) => number }} args.view
 * @param {number} args.startIdx first in-window frame index, inclusive
 * @param {number} args.endIdx last in-window frame index, inclusive
 * @param {number} args.oldestMs window start, in ms
 * @param {number} args.span window width, in ms
 * @param {number} args.sampleMs nominal frame period; quantises the stride so it cannot jitter
 * @param {number} args.maxRidges upper bound on the number of ridges drawn
 * @param {Int16Array} args.yToBand frequency sample points; its length sets pointCount
 * @param {number} args.dbFloor dB value that normalises to height 0; the top stays SPECTROGRAM_DB_MAX
 * @returns {{ heights: Float32Array, tFracs: Float64Array, count: number, pointCount: number, strideMs: number }}
 *          `strideMs` is the quantised bucket width, returned so callers can scale per-bucket
 *          tolerances by the actual decimation stride rather than by the row count -- at capture
 *          start the rows all sit at one end of the window, and a tolerance derived from
 *          `span / count` smears them across the empty rest of it.
 */
export function sampleWaterfallGrid({
  view,
  startIdx,
  endIdx,
  oldestMs,
  span,
  sampleMs,
  maxRidges,
  yToBand,
  dbFloor,
}) {
  const dbRange = SPECTROGRAM_DB_MAX - dbFloor;
  const pointCount = yToBand.length;
  const cap = Math.max(1, Math.floor(maxRidges));
  const heights = new Float32Array(cap * pointCount);
  const tFracs = new Float64Array(cap);

  // One frame per absolute-time bucket. Buckets are anchored to the epoch rather than to the
  // window, so a frame stays selected while the window slides past it, and their width is a whole
  // number of frame periods so window jitter cannot move the edges.
  const rawStrideMs = span / cap;
  const strideMs =
    Number.isFinite(sampleMs) && sampleMs > 0
      ? sampleMs * Math.max(1, Math.round(rawStrideMs / sampleMs))
      : rawStrideMs;

  if (!view || endIdx < startIdx || !(span > 0)) {
    return { heights, tFracs, count: 0, pointCount, strideMs };
  }

  // Seed from the frame just *outside* the window, so which frame wins a bucket never depends on
  // where the window edge happens to fall. Seeding with NaN instead force-keeps whatever frame
  // currently sits first in the window: as the edge advances that identity changes on every update,
  // at an arbitrary phase within its bucket, so the oldest ridge keeps changing shape and position
  // right up until it drops out. The entering end never showed this, because a frame there is
  // judged against the previous kept frame and then stays put.
  const beforeTs = view.timestampAt(startIdx - 1);
  let lastBucket = Number.isFinite(beforeTs) ? Math.floor(beforeTs / strideMs) : NaN;
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
      const norm = Number.isFinite(db) ? (db - dbFloor) / dbRange : 0;
      heights[base + q] = norm < 0 ? 0 : norm > 1 ? 1 : norm;
    }
    tFracs[count] = (ts - oldestMs) / span;
    count += 1;
  }

  return { heights, tFracs, count, pointCount, strideMs };
}
