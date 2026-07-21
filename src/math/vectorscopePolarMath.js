export const POLAR_SAMPLE_WINDOW_MS = 400;
export const POLAR_LEVEL_BIN_COUNT = 64;
// Polar Level aggregates a shorter window than Polar Sample so the leading edge reads as real-time.
// A fast attack pushes rays out to the current level (Ozone's "outer portion for real-time"); the
// release lets them shrink back toward the center. Release is kept moderate rather than long: since
// each direction holds its window peak, a long release would pin every recently-active direction out
// and the fan would look permanently fat. A shorter release lets it breathe with the real energy
// distribution; a slightly slower attack ignores one-off micro-transients that would flare it wide.
export const POLAR_LEVEL_WINDOW_MS = 180;
export const POLAR_LEVEL_ATTACK_MS = 20;
export const POLAR_LEVEL_RELEASE_MS = 220;

const INV_SQRT2 = 1 / Math.sqrt(2);
const SIGNAL_FLOOR_LINEAR = 10 ** (-90 / 20);

function clampSample(value) {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function projectPairToPolar(left, right) {
  const l = clampSample(left);
  const r = clampSample(right);
  const side = (r - l) * INV_SQRT2;
  const foldedMid = Math.abs((l + r) * INV_SQRT2);
  return {
    x: side,
    y: foldedMid,
    radius: Math.hypot(side, foldedMid),
    angle: Math.atan2(side, foldedMid),
  };
}

export function selectPolarWindow(slab, windowMs = POLAR_SAMPLE_WINDOW_MS) {
  const length = slab?.length ?? 0;
  if (length === 0) return [];
  const newestTs = slab.timestampAt(length - 1);
  if (!Number.isFinite(newestTs)) return [];
  const rows = [];
  for (let index = length - 1; index >= 0; index -= 1) {
    const timestampMs = slab.timestampAt(index);
    if (!Number.isFinite(timestampMs)) break;
    const ageMs = newestTs - timestampMs;
    if (ageMs > windowMs) break;
    const row = slab.rowAt(index);
    if (!row?.pairs?.length) continue;
    rows.push({ pairs: row.pairs, ageMs, timestampMs });
  }
  rows.reverse();
  return rows;
}

export function polarSampleAlpha(ageMs, windowMs = POLAR_SAMPLE_WINDOW_MS) {
  if (!Number.isFinite(ageMs) || windowMs <= 0) return 0;
  return 0.9 * (1 - Math.max(0, Math.min(1, ageMs / windowMs)));
}

function binIndexForAngle(angle, binCount) {
  const normalized = (angle + Math.PI / 2) / Math.PI;
  return Math.max(0, Math.min(binCount - 1, Math.round(normalized * (binCount - 1))));
}

export function smoothPolarBins(bins) {
  // Valley-filling smooth: lift each bin toward its neighbour average but never below its own value.
  // This de-jags the polygon without ever attenuating a peak, so a concentrated direction (e.g. a
  // mono signal that lands in a single bin) still reaches its true radius instead of being shrunk by
  // the kernel. A plain low-pass would halve an isolated bin (~-6 dB) and make such content read small.
  const output = new Float64Array(bins.length);
  for (let index = 0; index < bins.length; index += 1) {
    const left = bins[Math.max(0, index - 1)];
    const center = bins[index];
    const right = bins[Math.min(bins.length - 1, index + 1)];
    const blended = left * 0.25 + center * 0.5 + right * 0.25;
    output[index] = Math.max(center, blended);
  }
  return output;
}

function accumulatePairsIntoBins(pairs, peak, binCount) {
  for (let index = 0; index + 1 < pairs.length; index += 2) {
    const point = projectPairToPolar(pairs[index], pairs[index + 1]);
    if (point.radius <= SIGNAL_FLOOR_LINEAR) continue;
    const bin = binIndexForAngle(point.angle, binCount);
    if (point.radius > peak[bin]) peak[bin] = point.radius;
  }
}

export function aggregatePolarLevel(rows, binCount = POLAR_LEVEL_BIN_COUNT) {
  const peak = new Float64Array(binCount);
  for (const row of rows ?? []) {
    accumulatePairsIntoBins(row?.pairs ?? [], peak, binCount);
  }
  // Per-direction peak amplitude: each bin is the loudest sample pointing that way in the window,
  // independent of the other directions. Paired with a full-scale reference (see Polar Scaling) this
  // is Ozone's model — a full-scale sample reaches the arc, real clipping (radius = sqrt(2)) hits it
  // exactly, and nothing overshoots. No magnification, so quiet material is honestly smaller.
  return smoothPolarBins(peak);
}

// Snapshot Peak hold reconstruction. The live per-bin hold is a running maximum since Clear that is
// never stored (design: runtime-only). To show what the hold looked like at a scrubbed historical
// moment T, replay it from the frozen history: build the cumulative per-bin raw peak (a prefix
// maximum), so a row index yields the hold accumulated up to that row. Built once per frozen slab
// (Clear empties the slab, so row 0 is the reset point). Raw (pre-smooth) peaks are stored so the
// smoothing matches aggregatePolarLevel.
//
// Rows are bucketed into ~1s groups and one cumulative prefix is stored per completed bucket,
// shrinking the table ~25x versus one entry per row. Lookup starts from the previous bucket's
// prefix and replays at most one bucket, preserving exact selected-time semantics without storing
// every row's envelope.
export const POLAR_LEVEL_PEAK_HOLD_BUCKET_ROWS = 25;

export function buildPolarLevelPeakHoldTable(slab, binCount = POLAR_LEVEL_BIN_COUNT) {
  const length = slab?.length ?? 0;
  const bucketRows = POLAR_LEVEL_PEAK_HOLD_BUCKET_ROWS;
  const bucketCount = Math.ceil(length / bucketRows);
  const table = new Float64Array(bucketCount * binCount);
  const running = new Float64Array(binCount);
  for (let index = 0; index < length; index += 1) {
    accumulatePairsIntoBins(slab.rowAt(index)?.pairs ?? [], running, binCount);
    // Store the cumulative max at each bucket's last row (and at a trailing partial bucket).
    if ((index + 1) % bucketRows === 0 || index === length - 1) {
      table.set(running, Math.floor(index / bucketRows) * binCount);
    }
  }
  return { table, binCount, length, bucketRows, slab };
}

export function polarLevelPeakHoldAt(built, index) {
  if (!built || index < 0 || index >= built.length) return null;
  const { table, binCount, bucketRows, slab } = built;
  const bucket = Math.floor(index / bucketRows);
  const running = new Float64Array(binCount);
  if (bucket > 0) {
    running.set(table.subarray((bucket - 1) * binCount, bucket * binCount));
  }
  for (let rowIndex = bucket * bucketRows; rowIndex <= index; rowIndex += 1) {
    accumulatePairsIntoBins(slab.rowAt(rowIndex)?.pairs ?? [], running, binCount);
  }
  return smoothPolarBins(running);
}

function timeAlpha(elapsedMs, timeMs) {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  return 1 - Math.exp(-elapsed / timeMs);
}

export function updatePolarLevelEnvelope(previous, target, elapsedMs, { settled = false } = {}) {
  const next = Float64Array.from(target ?? []);
  if (settled || !previous || previous.length !== next.length) return next;
  for (let index = 0; index < next.length; index += 1) {
    const alpha = timeAlpha(
      elapsedMs,
      next[index] >= previous[index] ? POLAR_LEVEL_ATTACK_MS : POLAR_LEVEL_RELEASE_MS
    );
    next[index] = previous[index] + (next[index] - previous[index]) * alpha;
  }
  return next;
}

export function updatePolarPeakHold(previous, envelope, { enabled, reset = false } = {}) {
  if (!enabled) return null;
  if (reset || !previous || previous.length !== envelope.length) return Float64Array.from(envelope);
  const held = Float64Array.from(previous);
  for (let index = 0; index < held.length; index += 1) {
    held[index] = Math.max(held[index], envelope[index]);
  }
  return held;
}
