/**
 * @param {number} channelCount
 * @returns {{ x: number; y: number; label: string; key: string }[]}
 */
export function buildVectorscopePairOptions(channelCount) {
  const n = Number.isFinite(channelCount) ? Math.max(0, Math.floor(channelCount)) : 0;
  const out = [];
  if (n < 2) return out;
  for (let x = 0; x < n; x += 1) {
    for (let y = x + 1; y < n; y += 1) {
      out.push({ x, y, key: `${x}-${y}`, label: `Ch ${x + 1}/Ch ${y + 1}` });
    }
  }
  return out;
}

/**
 * Minimal formatting for issue #29:
 * - When layout is known and pair is (0,1), show "FL/FR"
 * - Otherwise, fall back to "Ch i/Ch j"
 *
 * @param {{ x?: number; y?: number; layoutKnown?: boolean }} opts
 */
export function formatVectorscopePairLabel({ x, y, layoutKnown }) {
  const xi = Number.isFinite(x) ? Math.max(0, Math.floor(Number(x))) : 0;
  const yi = Number.isFinite(y) ? Math.max(0, Math.floor(Number(y))) : 1;
  if (layoutKnown && xi === 0 && yi === 1) return "FL/FR";
  return `Ch ${xi + 1}/Ch ${yi + 1}`;
}

