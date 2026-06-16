/**
 * Number of output columns the waveform is decimated to. Chosen ≥ the widest
 * realistic panel pixel width so each column maps to ~1 screen pixel at any zoom.
 */
export const WAVEFORM_DECIM_COLUMNS = 1000;

/**
 * Decimate the visible sub-block history into fixed per-column min/max arrays.
 *
 * Positioning is entry-index based (NOT wall-clock): a sub-pair sits at
 * (entryPosInWindow + subIndex/subCount) / (windowSamples-1), matching the
 * index-based axis the Loudness History chart uses.
 *
 * @param {{waveformSubPairs?: Float32Array|number[], waveformSubCount?: number, waveformMin?: number[], waveformMax?: number[]}[]} histSourceList
 * @param {number} visibleSamples       window width in history entries
 * @param {number} effectiveOffsetSamples entries to skip from the live edge (0 = live)
 * @param {number} channelCount
 * @param {number} [columns]            output column count (default WAVEFORM_DECIM_COLUMNS)
 * @returns {{ mins: number[][], maxes: number[][], columns: number }}
 */
export function sliceWaveformSubHistory(
  histSourceList,
  visibleSamples,
  effectiveOffsetSamples,
  channelCount,
  columns = WAVEFORM_DECIM_COLUMNS
) {
  const mins = Array.from({ length: channelCount }, () => new Array(columns).fill(0));
  const maxes = Array.from({ length: channelCount }, () => new Array(columns).fill(0));

  const total = histSourceList.length;
  if (total === 0) return { mins, maxes, columns };

  const windowSamples = Math.max(1, visibleSamples);
  const offSamples = Math.max(0, Math.min(Math.max(0, total - 1), effectiveOffsetSamples));
  const newestVisible = total - 1 - offSamples;
  const oldestVisible = newestVisible - windowSamples + 1; // may be negative (leading empty)
  const start = Math.max(0, oldestVisible);
  const end = Math.min(total - 1, newestVisible);
  if (end < start) return { mins, maxes, columns };

  const denom = windowSamples - 1 <= 0 ? 1 : windowSamples - 1;
  const hasData = new Array(columns).fill(false);

  const fold = (col, ch, mn, mx) => {
    if (!hasData[col]) {
      mins[ch][col] = mn;
      maxes[ch][col] = mx;
    } else {
      if (mn < mins[ch][col]) mins[ch][col] = mn;
      if (mx > maxes[ch][col]) maxes[ch][col] = mx;
    }
  };
  const colFor = (frac) => {
    let c = Math.round(frac * (columns - 1));
    if (c < 0) c = 0;
    else if (c >= columns) c = columns - 1;
    return c;
  };

  for (let e = start; e <= end; e++) {
    const row = histSourceList[e];
    const entryPos = e - oldestVisible; // 0..windowSamples-1
    const pairs = row.waveformSubPairs;
    const subCount = row.waveformSubCount | 0;
    const stride = 2 * channelCount;

    if (pairs && subCount > 0 && pairs.length >= subCount * stride) {
      for (let s = 0; s < subCount; s++) {
        const frac = (entryPos + (subCount > 1 ? s / subCount : 0)) / denom;
        const col = colFor(frac);
        const base = s * stride;
        for (let ch = 0; ch < channelCount; ch++) {
          fold(col, ch, pairs[base + ch * 2], pairs[base + ch * 2 + 1]);
        }
        hasData[col] = true;
      }
    } else {
      // Fallback: one point per entry from whole-tick bounds.
      const col = colFor(entryPos / denom);
      const wmin = row.waveformMin ?? [];
      const wmax = row.waveformMax ?? [];
      for (let ch = 0; ch < channelCount; ch++) {
        fold(col, ch, wmin[ch] ?? 0, wmax[ch] ?? 0);
      }
      hasData[col] = true;
    }
  }

  // Carry-forward across empty interior columns so the envelope stays continuous.
  const firstCol = hasData.indexOf(true);
  const lastCol = hasData.lastIndexOf(true);
  if (firstCol >= 0) {
    for (let c = firstCol + 1; c <= lastCol; c++) {
      if (!hasData[c]) {
        for (let ch = 0; ch < channelCount; ch++) {
          mins[ch][c] = mins[ch][c - 1];
          maxes[ch][c] = maxes[ch][c - 1];
        }
      }
    }
  }

  return { mins, maxes, columns };
}
