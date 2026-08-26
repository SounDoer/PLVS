import {
  HISTORY_MAX_WINDOW_SEC,
  HISTORY_MIN_WINDOW_SEC,
  mediaTimeAxisRangeSec,
} from "./historyMath";

// The time viewport is stored as a window length and an offset, but the settings row shows the two
// numbers written at the ends of the rail -- and the rail runs in opposite directions depending on
// the source. Live counts down from the left ("30s ago" to "now"); file counts up through absolute
// media time. Editing an end therefore means something different in each mode, and these two
// functions are the only place that knows which.
//
// Both work from the *effective* viewport rather than the stored one, because that is what the
// labels are built from: a window longer than the retention setting shows, and must edit as, the
// length actually on screen.

/** @returns {{ left: number, right: number }} the values at the rail's ends, as the labels round them */
export function edgesFromViewport({
  sourceMode,
  totalSamples,
  visibleSamples,
  effectiveOffsetSamples,
  sampleSec,
}) {
  if (sourceMode === "file") {
    const { startSec, endSec } = mediaTimeAxisRangeSec(
      totalSamples,
      effectiveOffsetSamples,
      visibleSamples,
      sampleSec
    );
    return { left: Math.round(startSec), right: Math.round(endSec) };
  }
  const offsetSec = effectiveOffsetSamples * sampleSec;
  return {
    left: Math.round(offsetSec + visibleSamples * sampleSec),
    right: Math.round(offsetSec),
  };
}

/** @returns {{ windowSec: number, offsetSec: number }} clamped against the source this viewport is on */
export function viewportFromEdges({
  left,
  right,
  sourceMode,
  totalSamples,
  sampleSec,
  maxWindowSec = HISTORY_MAX_WINDOW_SEC,
}) {
  const isFile = sourceMode === "file";
  // A range input can hand back its ends in either order. Reading the span as an absolute value
  // keeps that from becoming a negative window, which every consumer downstream would clamp
  // differently.
  const spanSec = Math.abs(left - right);
  const sourceMaxWindowSec = isFile ? totalSamples * sampleSec : maxWindowSec;
  const windowSec = Math.max(
    HISTORY_MIN_WINDOW_SEC,
    Math.min(Math.max(HISTORY_MIN_WINDOW_SEC, sourceMaxWindowSec), spanSec)
  );

  // The scrollable distance is whatever the window does not already cover.
  const maxOffsetSec = Math.max(0, totalSamples * sampleSec - windowSec);
  const rawOffsetSec = isFile
    ? // File edges are media time from the start, so the offset is the distance from the newest
      // sample back to the right-hand edge.
      (totalSamples - 1) * sampleSec - Math.max(left, right)
    : Math.min(left, right);

  return { windowSec, offsetSec: Math.max(0, Math.min(maxOffsetSec, rawOffsetSec)) };
}
