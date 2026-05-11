import { getPeakMeterChannelLabels } from "./peakMeterChannelLabels.js";

/**
 * @param {number} channelCount
 * @param {import("./peakMeterChannelLabels.js").PeakMeterChannelLabelsContext} [labelCtx]
 * @returns {{ x: number; y: number; label: string; key: string }[]}
 */
export function buildVectorscopePairOptions(channelCount, labelCtx = {}) {
  const n = Number.isFinite(channelCount) ? Math.max(0, Math.floor(channelCount)) : 0;
  const out = [];
  if (n < 2) return out;
  const labels = getPeakMeterChannelLabels(n, labelCtx);
  for (let x = 0; x < n; x += 1) {
    for (let y = x + 1; y < n; y += 1) {
      const lx = labels[x] ?? `Ch ${x + 1}`;
      const ly = labels[y] ?? `Ch ${y + 1}`;
      out.push({ x, y, key: `${x}-${y}`, label: `${lx}/${ly}` });
    }
  }
  return out;
}

/**
 * Short "X/Y" caption for the selected vectorscope pair, using the same per-channel names as Peak strips
 * when `channelLabels` is supplied (from {@link getPeakMeterChannelLabels}).
 *
 * @param {{ x?: number; y?: number; channelLabels?: string[] }} opts
 */
export function formatVectorscopePairLabel({ x, y, channelLabels }) {
  const xi = Number.isFinite(x) ? Math.max(0, Math.floor(Number(x))) : 0;
  const yi = Number.isFinite(y) ? Math.max(0, Math.floor(Number(y))) : 1;
  const lx = channelLabels?.[xi] ?? `Ch ${xi + 1}`;
  const ly = channelLabels?.[yi] ?? `Ch ${yi + 1}`;
  return `${lx}/${ly}`;
}

/**
 * If the stored pair is not a valid X/Y choice for the current channel count, fall back to the
 * first available pair (always channel indices 0 and 1 when n ≥ 2 — the L/R pair for standard layouts).
 *
 * @param {{ x?: number; y?: number }} pair
 * @param {number} channelCount
 * @param {import("./peakMeterChannelLabels.js").PeakMeterChannelLabelsContext} [labelCtx]
 * @returns {{ x: number; y: number }}
 */
export function clampVectorscopePairToAvailable(pair, channelCount, labelCtx = {}) {
  const options = buildVectorscopePairOptions(channelCount, labelCtx);
  if (options.length === 0) return { x: 0, y: 1 };
  const x = Number.isFinite(pair?.x) ? Math.floor(Number(pair.x)) : 0;
  const y = Number.isFinite(pair?.y) ? Math.floor(Number(pair.y)) : 1;
  if (options.some((o) => o.x === x && o.y === y)) return { x, y };
  return { x: options[0].x, y: options[0].y };
}
