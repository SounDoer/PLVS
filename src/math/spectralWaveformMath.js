const MIN_FREQUENCY_HZ = 20;
const MAX_FREQUENCY_HZ = 20000;
const MAX_SPECTRAL_ROW_AGE_MS = 100;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
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

/**
 * The half of the frequency-to-colour map that depends only on the two split controls: three
 * anchors and their logarithms.
 *
 * A Frequency Color draw asks for one colour per pixel column, and deriving these six numbers per
 * column was most of what that loop cost. Build this once per draw and hand it to
 * `waveformFrequencyRgbInto`.
 */
export function waveformFrequencyScale({ lowMidSplitHz, midHighSplitHz }, palette) {
  const lowAnchor = Math.sqrt(MIN_FREQUENCY_HZ * lowMidSplitHz);
  const midAnchor = Math.sqrt(lowMidSplitHz * midHighSplitHz);
  const highAnchor = Math.sqrt(midHighSplitHz * MAX_FREQUENCY_HZ);
  return {
    lowAnchor,
    midAnchor,
    highAnchor,
    logLowAnchor: Math.log(lowAnchor),
    logMidAnchor: Math.log(midAnchor),
    logHighAnchor: Math.log(highAnchor),
    palette,
  };
}

/**
 * Writes one bucket's colour into `out` and returns it, so a draw can reuse a single array for
 * every column instead of allocating two per column.
 *
 * The arithmetic is the same as it always was, in the same order, including the intermediate
 * rounding of the interpolated hue -- `spectralWaveformMath.test.js` compares it byte for byte
 * against an independent transcription across the input space.
 */
export function waveformFrequencyRgbInto(scale, frequencyHz, tonality, out) {
  const { low, mid, high, neutral } = scale.palette;
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    out[0] = neutral[0];
    out[1] = neutral[1];
    out[2] = neutral[2];
    return out;
  }
  const logFrequency = Math.log(Math.max(MIN_FREQUENCY_HZ, frequencyHz));
  let hueR;
  let hueG;
  let hueB;
  if (frequencyHz <= scale.lowAnchor) {
    hueR = low[0];
    hueG = low[1];
    hueB = low[2];
  } else if (frequencyHz < scale.midAnchor) {
    const t = clamp01(
      (logFrequency - scale.logLowAnchor) / (scale.logMidAnchor - scale.logLowAnchor)
    );
    hueR = Math.round(low[0] + (mid[0] - low[0]) * t);
    hueG = Math.round(low[1] + (mid[1] - low[1]) * t);
    hueB = Math.round(low[2] + (mid[2] - low[2]) * t);
  } else if (frequencyHz < scale.highAnchor) {
    const t = clamp01(
      (logFrequency - scale.logMidAnchor) / (scale.logHighAnchor - scale.logMidAnchor)
    );
    hueR = Math.round(mid[0] + (high[0] - mid[0]) * t);
    hueG = Math.round(mid[1] + (high[1] - mid[1]) * t);
    hueB = Math.round(mid[2] + (high[2] - mid[2]) * t);
  } else {
    hueR = high[0];
    hueG = high[1];
    hueB = high[2];
  }
  // Spectral concentration spends most of its useful range near zero for real-world material.
  // A perceptual lift keeps frequency bands visually distinct while broadband/no-frequency
  // content still converges to Neutral.
  const chroma = clamp01(Math.pow(clamp01(tonality), 0.35));
  out[0] = Math.round(neutral[0] + (hueR - neutral[0]) * chroma);
  out[1] = Math.round(neutral[1] + (hueG - neutral[1]) * chroma);
  out[2] = Math.round(neutral[2] + (hueB - neutral[2]) * chroma);
  return out;
}

/**
 * One colour, for callers outside a paint loop. Builds the scale each call, so a loop should use
 * `waveformFrequencyScale` plus `waveformFrequencyRgbInto` instead.
 */
export function waveformFrequencyRgb(frequencyHz, tonality, splits, palette) {
  return waveformFrequencyRgbInto(
    waveformFrequencyScale(splits, palette),
    frequencyHz,
    tonality,
    [0, 0, 0]
  );
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

/**
 * A row's timestamp without materialising the row.
 *
 * The history slabs store their columns packed, so `rowAt` builds an object and a typed-array view
 * per field every time it is called. Every read below wants one number out of that, and the seek
 * makes many such reads, so it goes through the slab's own timestamp column when there is one.
 */
function timestampAt(rows, index) {
  if (typeof rows?.timestampAt === "function") return rows.timestampAt(index);
  return Number(rowAt(rows, index)?.timestampMs);
}

/**
 * Index of the newest row at or before `targetMs`, or 0 when every row is newer.
 *
 * Walking forward from row 0 costs the whole ring, and the ring holds the entire retention window
 * (an hour by default, four at most) while the panel typically shows a minute of it -- so the walk
 * grew with how long the app had been running, not with what was on screen. See
 * `docs/working/perf/waveform.md` §2.7.
 *
 * Assumes the timestamps do not decrease, which is what `FrameIntake` produces: the engine sends
 * `u64` milliseconds and the session-boundary offset keeps them ordered across a restart. A row
 * that arrived with no usable timestamp is stored as `-Infinity`, and one of those sitting between
 * two real rows would break that assumption; such a row resolves to "no data" for its bucket under
 * the age check below either way.
 */
function seekRowAtOrBefore(rows, targetMs, length) {
  let low = 0;
  let high = length - 1;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    if (timestampAt(rows, middle) <= targetMs) low = middle;
    else high = middle - 1;
  }
  return low;
}

function timestampAtWaveformCoordinate(rows, coordinate, nominalIntervalMs) {
  const length = rows?.length ?? 0;
  if (length <= 0 || !Number.isFinite(coordinate)) return NaN;
  const fractionalIndex = coordinate - 0.5;
  const firstTimestampMs = timestampAt(rows, 0);
  const lastTimestampMs = timestampAt(rows, length - 1);
  if (!Number.isFinite(firstTimestampMs) || !Number.isFinite(lastTimestampMs)) return NaN;
  if (fractionalIndex <= 0) return firstTimestampMs + fractionalIndex * nominalIntervalMs;
  if (fractionalIndex >= length - 1) {
    return lastTimestampMs + (fractionalIndex - (length - 1)) * nominalIntervalMs;
  }
  const lowerIndex = Math.floor(fractionalIndex);
  const upperIndex = lowerIndex + 1;
  const lowerTimestampMs = timestampAt(rows, lowerIndex);
  const upperTimestampMs = timestampAt(rows, upperIndex);
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

  let rowIndex = seekRowAtOrBefore(rows, timestampForBucket(0), rows.length);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const timestampMs = timestampForBucket(bucket);
    while (rowIndex + 1 < rows.length && timestampAt(rows, rowIndex + 1) <= timestampMs) {
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
