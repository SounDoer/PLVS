/**
 * Slice the visible history window and return per-channel waveform min/max arrays.
 *
 * @param {import('../ipc/types.js').MeterHistoryEntry[]} histSourceList
 * @param {number} visibleSamples          how many entries to show
 * @param {number} effectiveOffsetSamples  how many recent entries to skip (0 = live edge)
 * @param {number} channelCount
 * @returns {{ mins: number[][], maxes: number[][], entryCount: number }}
 *   mins[ch][i] and maxes[ch][i] are the linear amplitude bounds for the i-th visible entry.
 */
export function sliceWaveformHistory(
  histSourceList,
  visibleSamples,
  effectiveOffsetSamples,
  channelCount
) {
  const total = histSourceList.length;
  const end = Math.max(0, total - effectiveOffsetSamples);
  const start = Math.max(0, end - visibleSamples);
  const visible = histSourceList.slice(start, end);
  const n = visible.length;

  const mins = Array.from({ length: channelCount }, () => new Array(n).fill(0));
  const maxes = Array.from({ length: channelCount }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    const entryMins = visible[i].waveformMin ?? [];
    const entryMaxes = visible[i].waveformMax ?? [];
    for (let ch = 0; ch < channelCount; ch++) {
      mins[ch][i] = entryMins[ch] ?? 0;
      maxes[ch][i] = entryMaxes[ch] ?? 0;
    }
  }

  return { mins, maxes, entryCount: n };
}
