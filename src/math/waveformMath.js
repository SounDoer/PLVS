const MAX_WAVEFORM_SUB_SAMPLES_PER_BUCKET = 16;

function rowAt(entries, index) {
  if (!entries) return undefined;
  if (typeof entries.rowAt === "function") return entries.rowAt(index);
  if (typeof entries.at === "function" && !Array.isArray(entries)) return entries.at(index);
  return entries[index];
}

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
    const row = rowAt(histSourceList, e);
    const pairs = row.waveformSubPairs;
    const subCount = row.waveformSubCount | 0;
    const wmin = row.waveformMin ?? [];
    const wmax = row.waveformMax ?? [];
    const hasWholeTickBounds = wmin.length > 0 || wmax.length > 0;
    const subSampleDensity = subCount * coordsPerBucket;
    const useWholeTickBounds =
      hasWholeTickBounds &&
      (coordsPerBucket >= 1 || subSampleDensity > MAX_WAVEFORM_SUB_SAMPLES_PER_BUCKET);

    if (!useWholeTickBounds && pairs && subCount > 0 && pairs.length >= subCount * stride) {
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

function firstEntryForWholeTickBucket(bucket, kStart, coordsPerBucket) {
  const target = bucket + kStart;
  let entry = Math.floor(target * coordsPerBucket - 0.5);
  while (Math.floor((entry + 0.5) / coordsPerBucket) < target) entry += 1;
  while (Math.floor((entry - 1 + 0.5) / coordsPerBucket) >= target) entry -= 1;
  return entry;
}

/**
 * Match sliceWaveformSubHistory exactly while querying whole-tick bounds from
 * the lossless history index for windows at or beyond one entry per pixel.
 */
export function sliceWaveformSubHistoryFromIndex(
  histSourceList,
  index,
  visibleSamples,
  effectiveOffsetSamples,
  channelCount,
  pixelWidth
) {
  const W = Math.max(1, Math.floor(pixelWidth));
  const total = histSourceList.length;
  const windowSamples = Math.max(1, visibleSamples);
  const coordsPerBucket = windowSamples / W;
  if (!index || coordsPerBucket < 1) {
    return sliceWaveformSubHistory(
      histSourceList,
      visibleSamples,
      effectiveOffsetSamples,
      channelCount,
      pixelWidth
    );
  }

  const off = Math.max(0, Math.min(Math.max(0, total - 1), effectiveOffsetSamples));
  const newestVisible = total - 1 - off;
  const oldestVisible = newestVisible - windowSamples + 1;

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

  const retainedStart = index.retainedStartSequence;
  const retainedEnd = index.retainedEndSequence - 1;
  const hasData = new Array(bucketCount).fill(false);
  index.beginQueryBatch();

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const firstEntry = Math.max(
      start,
      firstEntryForWholeTickBucket(bucket, kStart, coordsPerBucket)
    );
    const lastEntry = Math.min(
      end,
      firstEntryForWholeTickBucket(bucket + 1, kStart, coordsPerBucket) - 1
    );
    const firstSequence = Math.max(retainedStart, retainedStart + firstEntry);
    const lastSequence = Math.min(retainedEnd, retainedStart + lastEntry);
    if (firstSequence > lastSequence) continue;

    const result = index.queryRange(firstSequence, lastSequence);
    if (!result) continue;
    for (let channel = 0; channel < channelCount; channel += 1) {
      mins[channel][bucket] = result.mins[channel] ?? 0;
      maxes[channel][bucket] = result.maxes[channel] ?? 0;
    }
    hasData[bucket] = true;
  }

  const firstJ = hasData.indexOf(true);
  const lastJ = hasData.lastIndexOf(true);
  if (firstJ >= 0) {
    for (let bucket = firstJ + 1; bucket <= lastJ; bucket += 1) {
      if (!hasData[bucket]) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          mins[channel][bucket] = mins[channel][bucket - 1];
          maxes[channel][bucket] = maxes[channel][bucket - 1];
        }
      }
    }
  }

  return {
    mins,
    maxes,
    bucketCount,
    fracPhase,
    firstBucket: firstJ,
    lastBucket: lastJ,
  };
}
