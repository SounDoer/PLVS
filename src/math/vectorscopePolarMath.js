import { VS_EXTENT_FLOOR } from "./vectorscopeMath.js";

export const POLAR_SAMPLE_WINDOW_MS = 400;
export const POLAR_LEVEL_BIN_COUNT = 64;
export const POLAR_EXTENT_RELEASE_MS = 700;
export const POLAR_LEVEL_ATTACK_MS = 60;
export const POLAR_LEVEL_RELEASE_MS = 350;

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

export function polarWindowExtent(rows) {
  let extent = 0;
  for (const row of rows ?? []) {
    const pairs = row?.pairs ?? [];
    for (let index = 0; index + 1 < pairs.length; index += 2) {
      extent = Math.max(extent, projectPairToPolar(pairs[index], pairs[index + 1]).radius);
    }
  }
  return Math.max(VS_EXTENT_FLOOR, extent);
}

export function updatePolarExtent(previous, target, elapsedMs, hasSignal) {
  const validTarget = Math.max(VS_EXTENT_FLOOR, Number.isFinite(target) ? target : VS_EXTENT_FLOOR);
  if (!hasSignal) return Number.isFinite(previous) ? previous : null;
  if (!Number.isFinite(previous)) return validTarget;
  if (validTarget >= previous) return validTarget;
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const retained = Math.exp(-elapsed / POLAR_EXTENT_RELEASE_MS);
  return validTarget + (previous - validTarget) * retained;
}

function binIndexForAngle(angle, binCount) {
  const normalized = (angle + Math.PI / 2) / Math.PI;
  return Math.max(0, Math.min(binCount - 1, Math.round(normalized * (binCount - 1))));
}

export function smoothPolarBins(bins) {
  const output = new Float64Array(bins.length);
  for (let index = 0; index < bins.length; index += 1) {
    const left = bins[Math.max(0, index - 1)];
    const center = bins[index];
    const right = bins[Math.min(bins.length - 1, index + 1)];
    output[index] = left * 0.25 + center * 0.5 + right * 0.25;
  }
  return output;
}

export function aggregatePolarLevel(rows, binCount = POLAR_LEVEL_BIN_COUNT) {
  const energy = new Float64Array(binCount);
  const sampleCounts = new Uint32Array(binCount);
  for (const row of rows ?? []) {
    const pairs = row?.pairs ?? [];
    for (let index = 0; index + 1 < pairs.length; index += 2) {
      const point = projectPairToPolar(pairs[index], pairs[index + 1]);
      if (point.radius <= SIGNAL_FLOOR_LINEAR) continue;
      const bin = binIndexForAngle(point.angle, binCount);
      energy[bin] += point.radius * point.radius;
      sampleCounts[bin] += 1;
    }
  }
  for (let index = 0; index < energy.length; index += 1) {
    if (sampleCounts[index] > 0) {
      energy[index] = Math.sqrt(energy[index] / sampleCounts[index]);
    }
  }
  return smoothPolarBins(energy);
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
