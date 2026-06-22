/**
 * Timeline math for timestamp-positioned Spectrogram rendering.
 *
 * Pure: no React, no canvas. The Spectrogram places each visual frame at the x of its real
 * timestamp within the visible time window, so per-key history gaps (no-backfill) render as real
 * blank space and the heatmap shares one time-linear x mapping with the time axis, selection line,
 * and frequency markers.
 */

function hasTimestamps(entries) {
  return Array.isArray(entries) && entries.length > 0 && Number.isFinite(entries[0]?.timestampMs);
}

/** First index whose timestampMs >= target (lower bound). frames must be ascending by timestamp. */
function lowerBound(frames, target) {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timestampMs < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose timestampMs > target (upper bound). frames must be ascending by timestamp. */
function upperBound(frames, target) {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timestampMs <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Visible time window `[oldestMs, newestMs]` taken from the loudness history timeline (the master
 * clock the rest of the chart uses). Returns null when history carries no timestamps.
 *
 * @param {{ timestampMs: number }[]} historyEntries hist-rate rows, ascending by timestamp
 * @param {number} effectiveOffsetSamples history-sample offset back from the newest sample
 * @param {number} visibleSamples history-sample window width
 * @returns {{ oldestMs: number, newestMs: number } | null}
 */
export function spectrogramTimeWindow(historyEntries, effectiveOffsetSamples, visibleSamples) {
  if (!hasTimestamps(historyEntries)) return null;
  const total = historyEntries.length;
  const offset = Math.max(0, Math.min(total - 1, Math.floor(effectiveOffsetSamples || 0)));
  const newestIdx = total - 1 - offset;
  const requested = Math.max(1, Math.floor(visibleSamples || 0));
  const oldestIdx = Math.max(0, newestIdx - requested + 1);
  return {
    oldestMs: historyEntries[oldestIdx].timestampMs,
    newestMs: historyEntries[newestIdx].timestampMs,
  };
}

/**
 * Index range `[startIdx, endIdx]` of frames whose timestampMs falls within `[oldestMs, newestMs]`.
 * Returns `{ startIdx: 0, endIdx: -1 }` (empty) when no frame is in range.
 *
 * @param {{ timestampMs: number }[]} frames ascending by timestamp
 */
export function inWindowRange(frames, oldestMs, newestMs) {
  if (!Array.isArray(frames) || frames.length === 0) return { startIdx: 0, endIdx: -1 };
  const startIdx = lowerBound(frames, oldestMs);
  const endIdx = upperBound(frames, newestMs) - 1;
  if (startIdx > endIdx) return { startIdx: 0, endIdx: -1 };
  return { startIdx, endIdx };
}

/**
 * Timestamps at which to draw data-availability boundary marker lines: where a request key's history
 * appears (gap before) or disappears (gap after) strictly inside the visible window. Segment edges
 * that merely touch the window bound (data continues beyond the view) are clipped, not marked, so a
 * continuous capture produces no markers.
 *
 * @param {{ timestampMs: number }[]} frames ascending by timestamp
 * @param {number} oldestMs window start
 * @param {number} newestMs window end
 * @param {number} sampleMs nominal visual sample period (ms)
 * @param {number} [gapFactor] a gap is a jump > gapFactor * sampleMs between consecutive frames
 * @returns {number[]} boundary timestamps (ms)
 */
export function spectrogramDataBoundaries(frames, oldestMs, newestMs, sampleMs, gapFactor = 1.8) {
  if (!Array.isArray(frames) || frames.length === 0 || !(newestMs > oldestMs)) return [];
  const gapThresh = gapFactor * sampleMs;
  const eps = sampleMs * 0.5;
  // Scan one sample beyond the window on each side so edge frames see their true neighbors.
  const startScan = Math.max(0, lowerBound(frames, oldestMs - 2 * sampleMs));
  const endScan = Math.min(frames.length - 1, upperBound(frames, newestMs + 2 * sampleMs) - 1);
  const marks = [];
  for (let i = startScan; i <= endScan; i++) {
    const ts = frames[i]?.timestampMs;
    if (!Number.isFinite(ts)) continue;
    const gapBefore = i === 0 || ts - frames[i - 1].timestampMs > gapThresh;
    if (gapBefore && ts > oldestMs + eps && ts < newestMs - eps) marks.push(ts);
    const gapAfter = i === frames.length - 1 || frames[i + 1].timestampMs - ts > gapThresh;
    const endEdge = ts + sampleMs;
    if (gapAfter && endEdge > oldestMs + eps && endEdge < newestMs - eps) marks.push(endEdge);
  }
  return marks;
}
