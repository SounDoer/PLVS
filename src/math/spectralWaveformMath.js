const MIN_FREQUENCY_HZ = 20;
const MAX_FREQUENCY_HZ = 20000;
const MAX_SPECTRAL_ROW_AGE_MS = 100;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function mixRgb(first, second, amount) {
  const t = clamp01(amount);
  return first.map((value, index) => Math.round(value + (second[index] - value) * t));
}

export function parseCssRgb(value, fallback = [128, 128, 128]) {
  const text = String(value ?? "").trim();
  const hex = text.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return rgb ? rgb.slice(1, 4).map((part) => Math.round(Number(part))) : fallback;
}

export function waveformFrequencyRgb(
  frequencyHz,
  tonality,
  { lowMidSplitHz, midHighSplitHz },
  { low, mid, high, neutral }
) {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return neutral;
  const lowAnchor = Math.sqrt(MIN_FREQUENCY_HZ * lowMidSplitHz);
  const midAnchor = Math.sqrt(lowMidSplitHz * midHighSplitHz);
  const highAnchor = Math.sqrt(midHighSplitHz * MAX_FREQUENCY_HZ);
  const logFrequency = Math.log(Math.max(MIN_FREQUENCY_HZ, frequencyHz));
  let hue;
  if (frequencyHz <= lowAnchor) {
    hue = low;
  } else if (frequencyHz < midAnchor) {
    hue = mixRgb(
      low,
      mid,
      (logFrequency - Math.log(lowAnchor)) / (Math.log(midAnchor) - Math.log(lowAnchor))
    );
  } else if (frequencyHz < highAnchor) {
    hue = mixRgb(
      mid,
      high,
      (logFrequency - Math.log(midAnchor)) / (Math.log(highAnchor) - Math.log(midAnchor))
    );
  } else {
    hue = high;
  }
  // Spectral concentration spends most of its useful range near zero for real-world material.
  // A perceptual lift keeps frequency bands visually distinct while broadband/no-frequency
  // content still converges to Neutral.
  const chroma = Math.pow(clamp01(tonality), 0.35);
  return mixRgb(neutral, hue, chroma);
}

export function centroidYFraction(frequencyHz) {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const frequency = Math.max(MIN_FREQUENCY_HZ, Math.min(MAX_FREQUENCY_HZ, frequencyHz));
  const frequencyFraction =
    (Math.log(frequency) - Math.log(MIN_FREQUENCY_HZ)) /
    (Math.log(MAX_FREQUENCY_HZ) - Math.log(MIN_FREQUENCY_HZ));
  return 1 - frequencyFraction;
}

function rowAt(rows, index) {
  return typeof rows?.rowAt === "function" ? rows.rowAt(index) : rows?.[index];
}

function timestampAtWaveformCoordinate(rows, coordinate, nominalIntervalMs) {
  const length = rows?.length ?? 0;
  if (length <= 0 || !Number.isFinite(coordinate)) return NaN;
  const fractionalIndex = coordinate - 0.5;
  const firstTimestampMs = Number(rowAt(rows, 0)?.timestampMs);
  const lastTimestampMs = Number(rowAt(rows, length - 1)?.timestampMs);
  if (!Number.isFinite(firstTimestampMs) || !Number.isFinite(lastTimestampMs)) return NaN;
  if (fractionalIndex <= 0) return firstTimestampMs + fractionalIndex * nominalIntervalMs;
  if (fractionalIndex >= length - 1) {
    return lastTimestampMs + (fractionalIndex - (length - 1)) * nominalIntervalMs;
  }
  const lowerIndex = Math.floor(fractionalIndex);
  const upperIndex = lowerIndex + 1;
  const lowerTimestampMs = Number(rowAt(rows, lowerIndex)?.timestampMs);
  const upperTimestampMs = Number(rowAt(rows, upperIndex)?.timestampMs);
  if (!Number.isFinite(lowerTimestampMs) || !Number.isFinite(upperTimestampMs)) return NaN;
  return lowerTimestampMs + (upperTimestampMs - lowerTimestampMs) * (fractionalIndex - lowerIndex);
}

export function sliceSpectralWaveformMetrics(
  rows,
  startTimestampMs,
  endTimestampMs,
  bucketCount,
  channelCount,
  waveformGrid
) {
  const dominantFrequencyHz = Array.from(
    { length: channelCount },
    () => new Float32Array(Math.max(0, bucketCount))
  );
  const spectralCentroidHz = Array.from(
    { length: channelCount },
    () => new Float32Array(Math.max(0, bucketCount))
  );
  const tonality = Array.from(
    { length: channelCount },
    () => new Float32Array(Math.max(0, bucketCount))
  );
  if (
    !rows?.length ||
    bucketCount <= 0 ||
    !Number.isFinite(startTimestampMs) ||
    !Number.isFinite(endTimestampMs)
  ) {
    return { dominantFrequencyHz, spectralCentroidHz, tonality };
  }

  const gridAligned =
    Number.isFinite(waveformGrid?.newestVisibleTimestampMs) &&
    Number.isFinite(waveformGrid?.visibleSamples) &&
    waveformGrid.visibleSamples > 0 &&
    Number.isFinite(waveformGrid?.pixelWidth) &&
    waveformGrid.pixelWidth > 0;
  const coordsPerBucket = gridAligned
    ? Math.max(1, waveformGrid.visibleSamples) / Math.max(1, Math.floor(waveformGrid.pixelWidth))
    : 0;
  const fracPhase = Number.isFinite(waveformGrid?.fracPhase) ? waveformGrid.fracPhase : 0;
  const waveformRows = waveformGrid?.waveformRows;
  const nominalIntervalMs = Number.isFinite(waveformGrid?.nominalIntervalMs)
    ? waveformGrid.nominalIntervalMs
    : 100;
  const waveformRowGridAligned = gridAligned && (waveformRows?.length ?? 0) > 0;
  const timestampForBucket = waveformRowGridAligned
    ? (() => {
        const total = waveformRows.length;
        const offset = Math.max(
          0,
          Math.min(
            Math.max(0, total - 1),
            Number.isFinite(waveformGrid.effectiveOffsetSamples)
              ? waveformGrid.effectiveOffsetSamples
              : 0
          )
        );
        const newestVisible = total - 1 - offset;
        const oldestVisible = newestVisible - Math.max(1, waveformGrid.visibleSamples) + 1;
        const firstAbsoluteBucket = Math.floor(oldestVisible / coordsPerBucket);
        return (bucket) =>
          timestampAtWaveformCoordinate(
            waveformRows,
            (firstAbsoluteBucket + bucket + 1) * coordsPerBucket,
            nominalIntervalMs
          );
      })()
    : gridAligned
      ? (bucket) =>
          waveformGrid.newestVisibleTimestampMs +
          ((bucket + 1 - fracPhase) * coordsPerBucket -
            (Math.max(1, waveformGrid.visibleSamples) - 0.5)) *
            nominalIntervalMs
      : (bucket) => {
          const durationMs = Math.max(0, endTimestampMs - startTimestampMs);
          return startTimestampMs + (durationMs * bucket) / Math.max(1, bucketCount - 1);
        };

  let rowIndex = 0;
  const firstBucketTimestampMs = timestampForBucket(0);
  while (
    rowIndex + 1 < rows.length &&
    Number(rowAt(rows, rowIndex + 1)?.timestampMs) <= firstBucketTimestampMs
  ) {
    rowIndex += 1;
  }
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const timestampMs = timestampForBucket(bucket);
    while (
      rowIndex + 1 < rows.length &&
      Number(rowAt(rows, rowIndex + 1)?.timestampMs) <= timestampMs
    ) {
      rowIndex += 1;
    }
    const row = rowAt(rows, rowIndex);
    const rowTimestampMs = Number(row?.timestampMs);
    if (
      !row ||
      rowTimestampMs > timestampMs ||
      timestampMs - rowTimestampMs > MAX_SPECTRAL_ROW_AGE_MS
    ) {
      continue;
    }
    for (let channel = 0; channel < channelCount; channel += 1) {
      dominantFrequencyHz[channel][bucket] = row.dominantFrequencyHz?.[channel] ?? 0;
      spectralCentroidHz[channel][bucket] = row.spectralCentroidHz?.[channel] ?? 0;
      tonality[channel][bucket] = row.tonality?.[channel] ?? 0;
    }
  }
  return { dominantFrequencyHz, spectralCentroidHz, tonality };
}
