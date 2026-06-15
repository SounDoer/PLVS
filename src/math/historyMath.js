export const HISTORY_MIN_WINDOW_SEC = 5;
export const HISTORY_MAX_WINDOW_SEC = 7200;

/** Number of segments for the horizontal time-axis tick labels on the loudness history chart. */
export const HISTORY_TIME_TICK_STEPS = 4;

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

export function getHistoryViewport(totalSamples, historyWindowSec, historyOffsetSec, sampleSec) {
  const safeTotal = Math.max(0, totalSamples);
  const clampedWindowSec = Math.max(
    HISTORY_MIN_WINDOW_SEC,
    Math.min(HISTORY_MAX_WINDOW_SEC, historyWindowSec)
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
  viewWidth = 600
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
  const view = histSourceList.slice(start, end + 1);
  if (view.length < 2) return "";
  return view
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${((start + i - oldestVisible) / Math.max(1, winSamples - 1)) * viewWidth} ${toY(p[key])}`
    )
    .join(" ");
}
