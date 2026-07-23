export const HISTORY_MIN_WINDOW_SEC = 5;
export const HISTORY_MAX_WINDOW_SEC = 7200;

/** Number of segments for the horizontal time-axis tick labels on the loudness history chart. */
export const HISTORY_TIME_TICK_STEPS = 4;

function rowAt(entries, index) {
  if (!entries) return undefined;
  if (typeof entries.rowAt === "function") return entries.rowAt(index);
  if (typeof entries.at === "function" && !Array.isArray(entries)) return entries.at(index);
  return entries[index];
}

/**
 * Build human-readable time labels (e.g. `0s`, `1m30s`) along the history X axis.
 * @param {number} historyOffsetSec Viewport offset in seconds (older samples to the left).
 * @param {number} windowSec Visible window width in seconds (may be clamped by caller for UI consistency).
 */
export function buildHistoryTimeAxisLabels(historyOffsetSec, windowSec) {
  const ticks = [];
  for (let i = 0; i <= HISTORY_TIME_TICK_STEPS; i++) {
    const sec = Math.round(
      historyOffsetSec + (windowSec * (HISTORY_TIME_TICK_STEPS - i)) / HISTORY_TIME_TICK_STEPS
    );
    if (sec >= 60) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      ticks.push(`${m}m${s ? `${s}s` : ""}`);
    } else {
      ticks.push(`${sec}s`);
    }
  }
  return ticks;
}

/**
 * Build absolute media-time labels (ascending, left -> right) for the file-mode history X axis.
 * Mirrors `buildHistoryTimeAxisLabels` formatting but counts up from the oldest visible media time
 * (left) to the newest (right), instead of "time ago".
 * @param {number} startSec media time at the left (oldest visible) edge
 * @param {number} endSec media time at the right (newest visible) edge
 */
export function buildMediaTimeAxisLabels(startSec, endSec) {
  const span = Math.max(0, endSec - startSec);
  const ticks = [];
  for (let i = 0; i <= HISTORY_TIME_TICK_STEPS; i++) {
    const sec = Math.round(startSec + (span * i) / HISTORY_TIME_TICK_STEPS);
    if (sec >= 60) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      ticks.push(`${m}m${s ? `${s}s` : ""}`);
    } else {
      ticks.push(`${sec}s`);
    }
  }
  return ticks;
}

/**
 * Media-time range (seconds) covered by the visible history window, derived from sample indices.
 * File-mode history is uniformly sampled from media time 0, so sample index i maps to i * sampleSec.
 * @returns {{ startSec: number, endSec: number }} oldest (left) and newest (right) visible media time
 */
export function mediaTimeAxisRangeSec(
  totalSamples,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec
) {
  const endSec = Math.max(0, (totalSamples - 1 - effectiveOffsetSamples) * sampleSec);
  const startSec = Math.max(0, endSec - (visibleSamples - 1) * sampleSec);
  return { startSec, endSec };
}

export function getHistoryViewport(
  totalSamples,
  historyWindowSec,
  historyOffsetSec,
  sampleSec,
  maxWindowSec = HISTORY_MAX_WINDOW_SEC
) {
  const safeTotal = Math.max(0, totalSamples);
  const safeMaxWindowSec = Math.max(HISTORY_MIN_WINDOW_SEC, maxWindowSec);
  const clampedWindowSec = Math.max(
    HISTORY_MIN_WINDOW_SEC,
    Math.min(safeMaxWindowSec, historyWindowSec)
  );
  const windowSamples = Math.max(1, Math.round(clampedWindowSec / sampleSec));
  const visibleSamples = windowSamples;
  const maxOffsetSamples = Math.max(0, safeTotal - visibleSamples);
  const effectiveOffsetSamples = Math.max(
    0,
    Math.min(maxOffsetSamples, Math.round(historyOffsetSec / sampleSec))
  );
  return {
    clampedWindowSec,
    windowSamples,
    visibleSamples,
    maxOffsetSamples,
    effectiveOffsetSamples,
    effectiveOffsetSec: effectiveOffsetSamples * sampleSec,
  };
}

/**
 * Merges a target LUFS value into the base tick list, sorts descending, and returns the result.
 * @param {number} targetLufs
 * @param {{ v: number, lb: string }[]} baseTicks
 * @returns {{ v: number, lb: string }[]}
 */
export function buildLoudnessYAxisTicks(targetLufs, baseTicks) {
  const out = [...baseTicks];
  if (!out.some((t) => t.v === targetLufs)) out.push({ v: targetLufs, lb: String(targetLufs) });
  out.sort((a, b) => b.v - a.v);
  return out;
}

export function buildHistoryPath(
  histSourceList,
  key,
  visibleSamples,
  effectiveOffsetSamples,
  toY,
  viewWidth = 600,
  targetColumns = viewWidth
) {
  if (!histSourceList.length) return "";
  const total = histSourceList.length;
  const winSamples = Math.max(2, visibleSamples);
  const offSamples = Math.max(0, Math.min(Math.max(0, total - 1), effectiveOffsetSamples));
  const newestVisible = total - 1 - offSamples;
  const oldestVisible = newestVisible - winSamples + 1;
  const start = Math.max(0, oldestVisible);
  const end = Math.min(total - 1, newestVisible);
  if (end < start) return "";
  const count = end - start + 1;
  if (count < 2) return "";

  const xOf = (idx) => ((idx - oldestVisible) / Math.max(1, winSamples - 1)) * viewWidth;
  const cols = Math.max(1, Math.floor(targetColumns));

  // Faithful per-sample path when the visible window fits within the pixel budget. Sub-column
  // detail is invisible anyway, so only decimate once samples outnumber columns.
  if (count <= cols) {
    let d = "";
    for (let i = start; i <= end; i++) {
      d += `${i === start ? "M" : " L"} ${xOf(i)} ${toY(rowAt(histSourceList, i)[key])}`;
    }
    return d;
  }

  // Decimated path: bucket visible samples into <= cols columns and draw a per-column min/max
  // envelope (screen-space Y) so peaks and troughs survive. Node count is bounded by the pixel
  // budget instead of the retained sample count, so zoom-out cost stays flat over long sessions.
  const minY = new Array(cols).fill(Infinity);
  const maxY = new Array(cols).fill(-Infinity);
  for (let i = start; i <= end; i++) {
    const b = Math.min(cols - 1, Math.floor(((i - start) / count) * cols));
    const y = toY(rowAt(histSourceList, i)[key]);
    if (y < minY[b]) minY[b] = y;
    if (y > maxY[b]) maxY[b] = y;
  }

  let d = "";
  let first = true;
  for (let b = 0; b < cols; b++) {
    if (minY[b] === Infinity) continue;
    const x = xOf(start + ((b + 0.5) * count) / cols);
    d += `${first ? "M" : " L"} ${x} ${maxY[b]} L ${x} ${minY[b]}`;
    first = false;
  }
  return d;
}

export function buildHistoryPathFromIndex(
  histSourceList,
  displayIndex,
  key,
  visibleSamples,
  effectiveOffsetSamples,
  toY,
  viewWidth = 600,
  targetColumns = viewWidth
) {
  if (!histSourceList.length) return "";
  const total = histSourceList.length;
  const winSamples = Math.max(2, visibleSamples);
  const offSamples = Math.max(0, Math.min(Math.max(0, total - 1), effectiveOffsetSamples));
  const newestVisible = total - 1 - offSamples;
  const oldestVisible = newestVisible - winSamples + 1;
  const start = Math.max(0, oldestVisible);
  const end = Math.min(total - 1, newestVisible);
  if (end < start) return "";
  const count = end - start + 1;
  if (count < 2) return "";

  const xOf = (idx) => ((idx - oldestVisible) / Math.max(1, winSamples - 1)) * viewWidth;
  const cols = Math.max(1, Math.floor(targetColumns));
  if (count <= cols) {
    return buildHistoryPath(
      histSourceList,
      key,
      visibleSamples,
      effectiveOffsetSamples,
      toY,
      viewWidth,
      targetColumns
    );
  }

  displayIndex.beginQueryBatch();
  const retainedStartSequence = displayIndex.retainedStartSequence;
  const rawRowAt = (sequence) => rowAt(histSourceList, sequence - retainedStartSequence);
  let d = "";
  let first = true;
  for (let bucket = 0; bucket < cols; bucket += 1) {
    const bucketStart = start + Math.ceil((bucket * count) / cols);
    const bucketEnd = start + Math.ceil(((bucket + 1) * count) / cols) - 1;
    if (bucketEnd < bucketStart) continue;
    const range = displayIndex.queryRange(
      key,
      retainedStartSequence + bucketStart,
      retainedStartSequence + bucketEnd,
      rawRowAt
    );
    if (!range) continue;

    // toY must be monotonic. Applying it to both source extrema and sorting in screen space
    // preserves the reference envelope for both increasing and decreasing chart scales.
    const firstY = toY(range.min);
    const secondY = toY(range.max);
    const minY = Math.min(firstY, secondY);
    const maxY = Math.max(firstY, secondY);
    const x = xOf(start + ((bucket + 0.5) * count) / cols);
    d += `${first ? "M" : " L"} ${x} ${maxY} L ${x} ${minY}`;
    first = false;
  }
  return d;
}
