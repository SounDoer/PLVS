/**
 * Decimate the visible sub-block history to one min/max bucket per device pixel,
 * with bucket boundaries anchored to absolute entry-index position so that
 * scrolling translates the envelope (sub-pixel) instead of re-bucketing.
 *
 * Coordinate basis is entry-index space (matches the shared Loudness History axis):
 *   absPos(e, s) = e + (s + 0.5) / subCount
 *
 * @param {{waveformSubPairs?: Float32Array|number[], waveformSubCount?: number, waveformMin?: number[], waveformMax?: number[]}[]} histSourceList
 * @param {number} visibleSamples         window width in history entries (zoom)
 * @param {number} effectiveOffsetSamples entries from the live edge (may be fractional)
 * @param {number} channelCount
 * @param {number} pixelWidth             canvas backing-store width in device px (W)
 * @returns {{ mins: number[][], maxes: number[][], bucketCount: number, fracPhase: number, firstBucket: number, lastBucket: number }}
 */
export function sliceWaveformSubHistory(
  histSourceList,
  visibleSamples,
  effectiveOffsetSamples,
  channelCount,
  pixelWidth
) {
  const W = Math.max(1, Math.floor(pixelWidth));
  const total = histSourceList.length;
  const windowSamples = Math.max(1, visibleSamples);
  const coordsPerBucket = windowSamples / W;

  const off = Math.max(0, Math.min(Math.max(0, total - 1), effectiveOffsetSamples));
  const newestVisible = total - 1 - off;
  const oldestVisible = newestVisible - windowSamples + 1; // may be negative at startup

  const kStart = Math.floor(oldestVisible / coordsPerBucket);
  const kEnd = Math.floor((newestVisible + 1) / coordsPerBucket);
  const bucketCount = Math.max(1, kEnd - kStart + 1);
  const fracPhase = oldestVisible / coordsPerBucket - kStart;

  const mins = Array.from({ length: channelCount }, () => new Array(bucketCount).fill(0));
  const maxes = Array.from({ length: channelCount }, () => new Array(bucketCount).fill(0));

  if (total === 0) return { mins, maxes, bucketCount, fracPhase, firstBucket: -1, lastBucket: -1 };

  const start = Math.max(0, Math.floor(oldestVisible));
  const end = Math.min(total - 1, Math.ceil(newestVisible));
  if (end < start) return { mins, maxes, bucketCount, fracPhase, firstBucket: -1, lastBucket: -1 };

  const hasData = new Array(bucketCount).fill(false);
  const stride = 2 * channelCount;

  const fold = (j, ch, mn, mx) => {
    if (!hasData[j]) {
      mins[ch][j] = mn;
      maxes[ch][j] = mx;
    } else {
      if (mn < mins[ch][j]) mins[ch][j] = mn;
      if (mx > maxes[ch][j]) maxes[ch][j] = mx;
    }
  };

  for (let e = start; e <= end; e++) {
    const row = histSourceList[e];
    const pairs = row.waveformSubPairs;
    const subCount = row.waveformSubCount | 0;

    if (pairs && subCount > 0 && pairs.length >= subCount * stride) {
      for (let s = 0; s < subCount; s++) {
        const absPos = e + (s + 0.5) / subCount;
        const j = Math.floor(absPos / coordsPerBucket) - kStart;
        if (j < 0 || j >= bucketCount) continue;
        const base = s * stride;
        for (let ch = 0; ch < channelCount; ch++) {
          fold(j, ch, pairs[base + ch * 2], pairs[base + ch * 2 + 1]);
        }
        hasData[j] = true;
      }
    } else {
      const absPos = e + 0.5;
      const j = Math.floor(absPos / coordsPerBucket) - kStart;
      if (j < 0 || j >= bucketCount) continue;
      const wmin = row.waveformMin ?? [];
      const wmax = row.waveformMax ?? [];
      for (let ch = 0; ch < channelCount; ch++) {
        fold(j, ch, wmin[ch] ?? 0, wmax[ch] ?? 0);
      }
      hasData[j] = true;
    }
  }

  // Carry-forward across empty interior buckets for a continuous envelope.
  const firstJ = hasData.indexOf(true);
  const lastJ = hasData.lastIndexOf(true);
  if (firstJ >= 0) {
    for (let j = firstJ + 1; j <= lastJ; j++) {
      if (!hasData[j]) {
        for (let ch = 0; ch < channelCount; ch++) {
          mins[ch][j] = mins[ch][j - 1];
          maxes[ch][j] = maxes[ch][j - 1];
        }
      }
    }
  }

  return { mins, maxes, bucketCount, fracPhase, firstBucket: firstJ, lastBucket: lastJ };
}
