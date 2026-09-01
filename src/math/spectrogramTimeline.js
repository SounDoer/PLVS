/**
 * Timeline math for timestamp-positioned Spectrogram rendering.
 *
 * Pure: no React, no canvas. The Spectrogram places each visual frame at the x of its real
 * timestamp within the visible time window, so per-key history gaps (no-backfill) render as real
 * blank space and the heatmap shares one time-linear x mapping with the time axis, selection line,
 * and frequency markers.
 */

function rowAt(entries, index) {
  if (!entries) return undefined;
  if (typeof entries.rowAt === "function") return entries.rowAt(index);
  if (typeof entries.at === "function" && !Array.isArray(entries)) return entries.at(index);
  return entries[index];
}

function timestampAt(entries, index) {
  if (!entries) return undefined;
  if (typeof entries.timestampAt === "function") return entries.timestampAt(index);
  return rowAt(entries, index)?.timestampMs;
}

function hasTimestamps(entries) {
  return entries?.length > 0 && Number.isFinite(timestampAt(entries, 0));
}

function sampleIntervalMsNear(entries, index) {
  const current = timestampAt(entries, index);
  const prev = timestampAt(entries, index - 1);
  if (Number.isFinite(current) && Number.isFinite(prev) && current > prev) return current - prev;

  const next = timestampAt(entries, index + 1);
  if (Number.isFinite(current) && Number.isFinite(next) && next > current) return next - current;

  return NaN;
}

/** First index whose timestampAt >= target (lower bound). view is ascending by timestamp. */
function lowerBound(view, target) {
  let lo = 0;
  let hi = view.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (view.timestampAt(mid) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose timestampAt > target (upper bound). view is ascending by timestamp. */
function upperBound(view, target) {
  let lo = 0;
  let hi = view.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (view.timestampAt(mid) <= target) lo = mid + 1;
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
 * @param {number} [historySampleMs] nominal hist-rate period; avoids amplifying timestamp jitter
 * @returns {{ oldestMs: number, newestMs: number } | null}
 */
export function spectrogramTimeWindow(
  historyEntries,
  effectiveOffsetSamples,
  visibleSamples,
  historySampleMs
) {
  if (!hasTimestamps(historyEntries)) return null;
  const total = historyEntries.length;
  const requestedOffset = Math.max(0, Math.floor(effectiveOffsetSamples || 0));
  const offset = Math.min(total - 1, requestedOffset);
  const newestIdx = total - 1 - offset;
  const requested = Math.max(1, Math.floor(visibleSamples || 0));
  const oldestIdx = newestIdx - requested + 1;
  const newestMs = timestampAt(historyEntries, newestIdx);
  const intervalMs =
    Number.isFinite(historySampleMs) && historySampleMs > 0
      ? historySampleMs
      : sampleIntervalMsNear(historyEntries, newestIdx);
  const shouldExtrapolateLeft = oldestIdx < 0 && requestedOffset === offset && intervalMs > 0;
  return {
    oldestMs: shouldExtrapolateLeft
      ? newestMs - (requested - 1) * intervalMs
      : timestampAt(historyEntries, Math.max(0, oldestIdx)),
    newestMs,
  };
}

/**
 * Advances only the Spectrogram's paint window to the newest visual frame, without moving the
 * shared history viewport used by axes, markers, hover, or the other timeline panels.
 *
 * The caller owns the live-edge policy. This helper only bounds the shift: a missing or older
 * visual row leaves the master window untouched, while a stalled master clock can never be hidden
 * by more than one history interval.
 */
export function spectrogramRenderTimeWindow(timeWindow, visualFrames, maxAdvanceMs) {
  if (!timeWindow || !(timeWindow.newestMs > timeWindow.oldestMs)) return timeWindow;
  if (!visualFrames || visualFrames.length === 0) return timeWindow;
  const visualNewestMs = timestampAt(visualFrames, visualFrames.length - 1);
  const advanceMs = Math.min(
    Math.max(0, Number(maxAdvanceMs) || 0),
    Math.max(0, visualNewestMs - timeWindow.newestMs)
  );
  if (!(advanceMs > 0)) return timeWindow;
  return {
    oldestMs: timeWindow.oldestMs + advanceMs,
    newestMs: timeWindow.newestMs + advanceMs,
  };
}

/**
 * Nominal frame interval near the newest row, inferred from real timestamps rather than assumed.
 * Gap detection (`spectrogramFrameEndMs`) needs a nominal interval to size its gap threshold, but
 * the actual cadence depends on how the view was produced: live visual history ticks at ~40ms
 * (`VISUAL_HIST_SAMPLE_SEC`), while file-mode visual history is coarser, ~100ms (see
 * docs/superpowers/specs/2026-06-29-sample-clocked-history-cadence-design.md, "File-mode visual
 * resolution"). A caller-supplied constant tuned for the live cadence makes every file-mode frame
 * look like a gap, painting narrow bars separated by blank stripes instead of one continuous
 * heatmap. Falls back to `fallbackMs` when the view has too few rows to infer an interval.
 */
export function resolveSpectrogramSampleMs(view, fallbackMs) {
  if (!view || view.length < 2) return fallbackMs;
  const interval = sampleIntervalMsNear(view, view.length - 1);
  return Number.isFinite(interval) && interval > 0 ? interval : fallbackMs;
}

/**
 * How many intervals back `resolveStableSpectrogramSampleMs` looks. Long enough that a stall or a
 * dropped emit cannot become the minimum, short enough to follow a real cadence change (live -> file)
 * within well under a second.
 */
const STABLE_SAMPLE_LOOKBACK = 16;

// The two visual-history producers have fixed nominal cadences. Match measurements to these actual
// contracts rather than rounding on an arbitrary grid: live timestamps can occasionally measure
// 39ms or 45-48ms around their 40ms gate, while cumulative file timestamps can alternate between
// 99ms and 100ms at sample rates whose 100ms chunk is not an integer number of frames.
const NOMINAL_SAMPLE_CADENCES_MS = [40, 100];

/**
 * The same nominal frame interval as `resolveSpectrogramSampleMs`, but stable across updates.
 *
 * The single-interval estimator is right for gap detection, which only needs a scale, and wrong for
 * any caller that QUANTISES by the period: live visual frames are timestamped with a wall clock
 * gated at ">= VISUAL_EMIT_MS since the last emit", so the newest interval measures 40-48ms and
 * lands on a different value nearly every update. `sampleWaterfallGrid` builds its decimation stride
 * as a whole number of periods and anchors buckets to the epoch, where a stride that moves by one
 * period shifts every bucket edge by hundreds of periods -- the 3D waterfall then re-selects most of
 * its ridges on every frame, which reads as the whole surface jumping.
 *
 * The minimum over recent intervals rejects isolated capture gaps and stalls. It is still a noisy
 * measurement, though, so match it to a cadence a producer can actually emit. This avoids both
 * sides of generic grid rounding: 45ms must not become 50ms, and 39/99ms must not become 30/90ms.
 *
 * @param {{ length: number, timestampAt?: (i:number)=>number }} view ascending by timestamp
 * @param {number} fallbackMs used when the view carries too few usable intervals
 */
export function resolveStableSpectrogramSampleMs(view, fallbackMs) {
  if (!view || view.length < 2) return fallbackMs;
  const newest = view.length - 1;
  const oldest = Math.max(1, newest - STABLE_SAMPLE_LOOKBACK + 1);
  let smallest = Infinity;
  for (let i = oldest; i <= newest; i++) {
    const interval = timestampAt(view, i) - timestampAt(view, i - 1);
    if (Number.isFinite(interval) && interval > 0 && interval < smallest) smallest = interval;
  }
  if (smallest === Infinity) return fallbackMs;
  let nearest = NOMINAL_SAMPLE_CADENCES_MS[0];
  let nearestDistance = Math.abs(smallest - nearest);
  for (let i = 1; i < NOMINAL_SAMPLE_CADENCES_MS.length; i++) {
    const candidate = NOMINAL_SAMPLE_CADENCES_MS[i];
    const distance = Math.abs(smallest - candidate);
    // Keep the shorter cadence on an exact tie; do not invent a wider stride without evidence.
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function spectrogramFrameEndMs(view, index, sampleMs, gapFactor = 1.8) {
  const ts = view?.timestampAt?.(index);
  if (!Number.isFinite(ts)) return NaN;

  const nextTs = view.timestampAt(index + 1);
  const gapThresh = gapFactor * sampleMs;
  if (Number.isFinite(nextTs) && nextTs > ts && nextTs - ts <= gapThresh) return nextTs;

  return ts + sampleMs;
}

/**
 * Index range `[startIdx, endIdx]` of frames whose timestamp falls within `[oldestMs, newestMs]`.
 * Returns `{ startIdx: 0, endIdx: -1 }` (empty) when no frame is in range.
 *
 * @param {{ length: number, timestampAt: (i:number)=>number }} view ascending by timestamp
 */
export function inWindowRange(view, oldestMs, newestMs) {
  if (!view || view.length === 0) return { startIdx: 0, endIdx: -1 };
  const startIdx = lowerBound(view, oldestMs);
  const endIdx = upperBound(view, newestMs) - 1;
  if (startIdx > endIdx) return { startIdx: 0, endIdx: -1 };
  return { startIdx, endIdx };
}

/**
 * Timestamps at which to draw data-availability boundary marker lines: where a request key's history
 * appears (gap before) or disappears (gap after) strictly inside the visible window. Segment edges
 * that merely touch the window bound (data continues beyond the view) are clipped, not marked, so a
 * continuous capture produces no markers.
 *
 * @param {{ length: number, timestampAt: (i:number)=>number }} view ascending by timestamp
 * @param {number} oldestMs window start
 * @param {number} newestMs window end
 * @param {number} sampleMs nominal visual sample period (ms)
 * @param {number} [gapFactor] a gap is a jump > gapFactor * sampleMs between consecutive frames
 * @returns {number[]} boundary timestamps (ms)
 */
export function spectrogramDataBoundaryMarkers(
  view,
  oldestMs,
  newestMs,
  sampleMs,
  gapFactor = 1.8
) {
  if (!view || view.length === 0 || !(newestMs > oldestMs)) return [];
  const gapThresh = gapFactor * sampleMs;
  const eps = sampleMs * 0.5;
  // Scan one sample beyond the window on each side so edge frames see their true neighbors.
  const startScan = Math.max(0, lowerBound(view, oldestMs - 2 * sampleMs));
  const endScan = Math.min(view.length - 1, upperBound(view, newestMs + 2 * sampleMs) - 1);
  if (typeof view.timestampGapBoundaries === "function") {
    const marks = [];
    const appendStart = (ts) => {
      if (ts > oldestMs + eps && ts < newestMs - eps) {
        marks.push({ ts, label: "Data starts here" });
      }
    };
    const appendEnd = (ts) => {
      const endEdge = ts + sampleMs;
      if (endEdge > oldestMs + eps && endEdge < newestMs - eps) {
        marks.push({ ts: endEdge, label: "Data ends here" });
      }
    };

    if (startScan === 0) appendStart(view.timestampAt(0));
    const queryStart = Math.max(0, startScan - 1);
    const queryEnd = Math.min(view.length - 1, endScan + 1);
    for (const { previousTimestampMs, nextTimestampMs } of view.timestampGapBoundaries(
      queryStart,
      queryEnd,
      gapThresh
    )) {
      appendEnd(previousTimestampMs);
      appendStart(nextTimestampMs);
    }
    if (endScan === view.length - 1) appendEnd(view.timestampAt(view.length - 1));
    return marks;
  }

  const marks = [];
  for (let i = startScan; i <= endScan; i += 1) {
    const ts = view.timestampAt(i);
    if (!Number.isFinite(ts)) continue;
    const gapBefore = i === 0 || ts - view.timestampAt(i - 1) > gapThresh;
    if (gapBefore && ts > oldestMs + eps && ts < newestMs - eps) {
      marks.push({ ts, label: "Data starts here" });
    }
    const gapAfter = i === view.length - 1 || view.timestampAt(i + 1) - ts > gapThresh;
    const endEdge = ts + sampleMs;
    if (gapAfter && endEdge > oldestMs + eps && endEdge < newestMs - eps) {
      marks.push({ ts: endEdge, label: "Data ends here" });
    }
  }
  return marks;
}

export function spectrogramDataBoundaries(view, oldestMs, newestMs, sampleMs, gapFactor = 1.8) {
  return spectrogramDataBoundaryMarkers(view, oldestMs, newestMs, sampleMs, gapFactor).map(
    ({ ts }) => ts
  );
}
