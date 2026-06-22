import { loudnessFromTopFrac, freqToXFrac } from "../config/scales";
import { hzFromFrac } from "./spectrogramMath.js";
import { inWindowRange } from "./spectrogramTimeline.js";

/**
 * Formats a history hover age as a human-readable "X ago" string.
 * @param {number} sec
 * @returns {string}
 */
export function formatHoverOffset(sec) {
  const s = Math.max(0, sec);
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    return `${m}m ${rem.toFixed(rem >= 10 ? 0 : 1)}s ago`;
  }
  return `${s.toFixed(s >= 10 ? 0 : 1)}s ago`;
}

/**
 * Formats a frequency in Hz as a human-readable label.
 * @param {number} freq
 * @returns {string}
 */
export function formatSpectrumFreq(freq) {
  if (!Number.isFinite(freq)) return "-";
  if (freq >= 1000) {
    const khz = freq / 1000;
    return `${khz >= 10 ? khz.toFixed(1) : khz.toFixed(2)} kHz`;
  }
  return `${Math.round(freq)} Hz`;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Maps a frequency in Hz to a musical note name (A4 = 440 Hz reference).
 * Returns e.g. "A4", "C4", or "A4 +20¢" when off-pitch. "-" for invalid input.
 * @param {number} freq
 * @returns {string}
 */
export function freqToNote(freq) {
  if (!Number.isFinite(freq) || freq <= 0) return "-";
  const midi = 69 + 12 * Math.log2(freq / 440); // A4 = MIDI 69
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1; // MIDI: C4 = 60 → octave 4
  const centStr = cents === 0 ? "" : ` ${cents > 0 ? "+" : ""}${cents}¢`;
  return `${name}${octave}${centStr}`;
}

/**
 * Resolves the hover data for the loudness history chart from a normalized X fraction.
 *
 * @param {number} xFrac - normalized X position (0 = left, 1 = right)
 * @param {{ m: number, st: number }[]} histSourceList
 * @param {number} effectiveOffsetSamples
 * @param {number} visibleSamples
 * @param {number} sampleSec
 * @returns {{ leftPct: number, topPct: number|null, momentary: number|null, shortTerm: number|null, offsetLabel: string } | null}
 */
export function computeHistoryHoverPoint(
  xFrac,
  histSourceList,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec
) {
  if (!histSourceList.length) return null;
  const normalized = 1 - xFrac;
  const fromEndSamples = effectiveOffsetSamples + normalized * Math.max(0, visibleSamples - 1);
  const hoverIndex = Math.max(
    0,
    Math.min(histSourceList.length - 1, histSourceList.length - 1 - Math.round(fromEndSamples))
  );
  const point = histSourceList[hoverIndex];
  if (!point) return null;
  const offsetSec = Math.max(0, (histSourceList.length - 1 - hoverIndex) * sampleSec);
  const yValue = Number.isFinite(point.st) ? point.st : point.m;
  return {
    leftPct: xFrac * 100,
    topPct: Number.isFinite(yValue) ? loudnessFromTopFrac(yValue) * 100 : null,
    momentary: Number.isFinite(point.m) ? point.m : null,
    shortTerm: Number.isFinite(point.st) ? point.st : null,
    offsetLabel: formatHoverOffset(offsetSec),
  };
}

/**
 * Resolves the hover data for the waveform panel from a normalized X fraction.
 * dBFS is read from the decimated column under xFrac; the time label derives from
 * xFrac across the visible window (decoupled from the column count).
 *
 * @param {number} xFrac - normalized X (0 = left/oldest, 1 = right/newest)
 * @param {number[][]} mins - mins[ch][col] linear amplitude min
 * @param {number[][]} maxes - maxes[ch][col] linear amplitude max
 * @param {number} columns - number of decimated columns (mins[ch].length)
 * @param {number} effectiveOffsetSamples - entries the window is offset from the live edge
 * @param {number} visibleSamples - window width in entries
 * @param {number} sampleSec - seconds per history entry
 * @param {string[]} labels - channel labels
 * @returns {{ leftPct: number, timeLabel: string, channels: Array<{ label: string, dbFs: number }> } | null}
 */
export function computeWaveformHoverPoint(
  xFrac,
  mins,
  maxes,
  columns,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec,
  labels
) {
  if (!columns || columns === 0) return null;
  const col = Math.round(xFrac * Math.max(0, columns - 1));
  const offsetFromEnd = effectiveOffsetSamples + (1 - xFrac) * Math.max(0, visibleSamples - 1);
  const offsetSec = Math.max(0, offsetFromEnd * sampleSec);
  return {
    leftPct: xFrac * 100,
    timeLabel: formatHoverOffset(offsetSec),
    channels: labels.map((label, ch) => ({
      label,
      dbFs: 20 * Math.log10(Math.max(1e-9, Math.abs(maxes[ch]?.[col] ?? 0))),
    })),
  };
}

/**
 * Resolves hover data for the spectrogram panel from normalized X/Y fractions.
 *
 * The cursor X maps to a real timestamp within the visible window; the nearest in-window frame
 * within one sample period is used. Hovering a time gap (no frame near the cursor) returns null.
 *
 * @param {number} xFrac - normalized X (0=left/oldest, 1=right/newest)
 * @param {number} yFrac - normalized Y (0=top=20kHz, 1=bottom=20Hz)
 * @param {{ length: number, timestampAt: (i: number) => number, rowAt: (i: number) => object }} snaps
 * @param {number} oldestMs - visible window start
 * @param {number} newestMs - visible window end
 * @param {number} sampleMs - nominal visual sample period (ms); also the hover tolerance
 * @returns {{ leftPct: number, topPct: number, timeLabel: string, freqLabel: string, dbLabel: string } | null}
 */
export function computeSpectrogramHoverPoint(xFrac, yFrac, snaps, oldestMs, newestMs, sampleMs) {
  if (!snaps || !snaps.length || !(newestMs > oldestMs)) return null;

  const ts = oldestMs + xFrac * (newestMs - oldestMs);
  const { startIdx, endIdx } = inWindowRange(snaps, oldestMs, newestMs);
  if (endIdx < startIdx) return null;
  let hoverIndex = -1;
  let bestDist = Infinity;
  for (let i = startIdx; i <= endIdx; i += 1) {
    const dist = Math.abs(snaps.timestampAt(i) - ts);
    if (dist < bestDist) {
      bestDist = dist;
      hoverIndex = i;
    }
  }
  if (hoverIndex < 0 || bestDist > sampleMs) return null; // hovering a gap
  const snap = snaps.rowAt(hoverIndex);
  if (!snap) return null;
  const newestTs = snaps.timestampAt(snaps.length - 1);
  const offsetSec = Math.max(0, (newestTs - snap.timestampMs) / 1000);

  const { bands, dbList } = snap;
  if (!bands?.length || !dbList?.length) return null;

  // yFrac=0 (top) → 20kHz, yFrac=1 (bottom) → 20Hz; hzFromFrac(0)=20Hz, hzFromFrac(1)=20kHz
  const hz = hzFromFrac(1 - yFrac);

  // Log-domain binary search for nearest band
  let lo = 0,
    hi = bands.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bands[mid].fCenter < hz) lo = mid + 1;
    else hi = mid;
  }
  if (
    lo > 0 &&
    Math.abs(Math.log(bands[lo - 1].fCenter) - Math.log(hz)) <
      Math.abs(Math.log(bands[lo].fCenter) - Math.log(hz))
  ) {
    lo = lo - 1;
  }
  const db = dbList[lo];

  return {
    leftPct: xFrac * 100,
    topPct: yFrac * 100,
    timeLabel: formatHoverOffset(offsetSec),
    freqLabel: formatSpectrumFreq(hz),
    dbLabel: Number.isFinite(db) ? `${db.toFixed(1)} dB` : "-",
    noteLabel: freqToNote(bands[lo]?.fCenter ?? hz),
  };
}

/**
 * Finds the nearest spectrum band index to a normalized X position.
 * @param {number} xFrac - normalized X position (0 = left, 1 = right)
 * @param {{ fCenter: number }[]} bands
 * @returns {number}
 */
export function computeSpectrumHoverIndex(xFrac, bands) {
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < bands.length; i += 1) {
    const dist = Math.abs(freqToXFrac(bands[i].fCenter) - xFrac);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }
  return nearestIdx;
}
