import { SPECTROGRAM_DB_MIN, SPECTROGRAM_DB_MAX } from "../config/scales.js";
import { spectrogramFrameEndMs } from "./spectrogramTimeline.js";

/**
 * Downsample the spectrogram slab into a fixed-size ridge grid for the 3D waterfall.
 *
 * Same resolution strategy as the 2D long-zoom branch in useSpectrogramCanvas: for each output
 * slot, binary-search the newest frame whose own time span covers that slot. Frames outside any
 * span leave the ridge absent, so real capture gaps render as empty space exactly as they do in 2D
 * instead of being smeared across by the previous frame.
 */

const DB_RANGE = SPECTROGRAM_DB_MAX - SPECTROGRAM_DB_MIN;

/** First index whose timestamp is greater than target. View is ascending by timestamp. */
function upperBoundTimestamp(view, target, startIdx, endIdx) {
  let lo = startIdx;
  let hi = endIdx + 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (view.timestampAt(mid) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function sampleWaterfallGrid({
  view,
  startIdx,
  endIdx,
  oldestMs,
  span,
  sampleMs,
  ridgeCount,
  yToBand,
}) {
  const pointCount = yToBand.length;
  const heights = new Float32Array(ridgeCount * pointCount);
  const present = new Uint8Array(ridgeCount);
  const timestamps = new Float64Array(ridgeCount);

  if (!view || endIdx < startIdx || !(span > 0)) {
    return { heights, present, timestamps, ridgeCount, pointCount };
  }

  for (let r = 0; r < ridgeCount; r++) {
    const targetMs = oldestMs + ((r + 0.5) / ridgeCount) * span;
    const index = upperBoundTimestamp(view, targetMs, startIdx, endIdx) - 1;
    if (index < startIdx || index > endIdx) continue;

    const snap = view.rowAt(index);
    const dbList = snap?.dbList;
    if (!dbList || !Number.isFinite(snap.timestampMs)) continue;

    const frameEndMs = spectrogramFrameEndMs(view, index, sampleMs);
    if (!(targetMs >= snap.timestampMs && targetMs < frameEndMs)) continue;

    const base = r * pointCount;
    for (let p = 0; p < pointCount; p++) {
      const db = dbList[yToBand[p]];
      const norm = Number.isFinite(db) ? (db - SPECTROGRAM_DB_MIN) / DB_RANGE : 0;
      heights[base + p] = norm < 0 ? 0 : norm > 1 ? 1 : norm;
    }
    present[r] = 1;
    timestamps[r] = snap.timestampMs;
  }

  return { heights, present, timestamps, ridgeCount, pointCount };
}
