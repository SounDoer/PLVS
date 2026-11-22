import { findSpectrumPeakCandidates } from "../math/spectrumMath.js";
import { MEASUREMENT_FRESHNESS_THRESHOLD_MS } from "./measurementControl.js";

export const SPECTRUM_READOUT_SCHEMA_VERSION = 1;

/** Bands per octave for each public resolution; `full` returns the engine grid itself. */
export const SPECTRUM_READOUT_RESOLUTIONS = Object.freeze({
  octave: 1,
  third: 3,
  sixth: 6,
  twelfth: 12,
  full: null,
});
export const SPECTRUM_READOUT_DEFAULT_RESOLUTION = "third";
export const SPECTRUM_READOUT_PEAK_COUNT = 5;
/// The same bar a peak label has to clear to appear on the chart.
export const SPECTRUM_READOUT_PEAK_PROMINENCE_DB = 9;
/// The lowest level the Spectrum level axis can show. Below it the bank is at its numerical floor
/// (about -187 dB in silence), which the chart does not draw and the readout reports as null.
export const SPECTRUM_READOUT_FLOOR_DB = -120;
/// The engine grid is 96 points per octave; `full` bands reach halfway to each neighbour.
const ENGINE_GRID_POINTS_PER_OCTAVE = 96;

export const SPECTRUM_READOUT_UNAVAILABLE_REASONS = Object.freeze([
  "noSample",
  "notReady",
  "snapshotSelected",
  "fileSource",
  "belowSignalFloor",
]);

/** @param {number} value */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/** @param {number | undefined | null} db */
function levelOrNull(db) {
  return Number.isFinite(db) && db >= SPECTRUM_READOUT_FLOOR_DB ? round2(db) : null;
}

/**
 * Power mean of the grid values in one band. A Spectrum row is a power density, so averaging
 * power keeps broadband material level across resolutions; a lone tone is diluted by the band's
 * width, which is what the peak list is for.
 *
 * @param {number[]} db
 * @param {number} start
 * @param {number} end exclusive
 */
function powerMeanDb(db, start, end) {
  let sum = 0;
  let count = 0;
  for (let index = start; index < end; index += 1) {
    const value = db[index];
    if (!Number.isFinite(value)) continue;
    sum += 10 ** (value / 10);
    count += 1;
  }
  if (count === 0 || sum <= 0) return null;
  return 10 * Math.log10(sum / count);
}

/**
 * The band edges for one resolution over the engine grid. Fractional-octave bands are centred on
 * 1 kHz * 2^(k/n) and kept when they overlap the grid; `full` is one band per grid point.
 *
 * @param {number[]} centers ascending grid frequencies
 * @param {keyof typeof SPECTRUM_READOUT_RESOLUTIONS} resolution
 * @returns {{ centerHz: number, lowHz: number, highHz: number, start: number, end: number }[]}
 */
export function spectrumReadoutBands(centers, resolution) {
  if (!centers?.length) return [];
  const perOctave = SPECTRUM_READOUT_RESOLUTIONS[resolution];
  if (perOctave === null) {
    const half = 2 ** (1 / (2 * ENGINE_GRID_POINTS_PER_OCTAVE));
    return centers.map((centerHz, index) => ({
      centerHz,
      lowHz: centerHz / half,
      highHz: centerHz * half,
      start: index,
      end: index + 1,
    }));
  }
  const gridMin = centers[0];
  const gridMax = centers[centers.length - 1];
  const half = 2 ** (1 / (2 * perOctave));
  const firstK = Math.ceil(perOctave * Math.log2(gridMin / half / 1000));
  const lastK = Math.floor(perOctave * Math.log2((gridMax * half) / 1000));
  const bands = [];
  let cursor = 0;
  for (let k = firstK; k <= lastK; k += 1) {
    const centerHz = 1000 * 2 ** (k / perOctave);
    const lowHz = centerHz / half;
    const highHz = centerHz * half;
    while (cursor < centers.length && centers[cursor] < lowHz) cursor += 1;
    let end = cursor;
    while (end < centers.length && centers[end] < highHz) end += 1;
    if (end > cursor) bands.push({ centerHz, lowHz, highHz, start: cursor, end });
    cursor = end;
  }
  return bands;
}

/**
 * The most prominent peaks on one curve, at full grid resolution.
 *
 * @param {number[]} centers
 * @param {number[]} db
 */
function curvePeaks(centers, db) {
  const bands = centers.map((fCenter) => ({ fCenter }));
  return findSpectrumPeakCandidates(bands, db, {
    minProminenceDb: SPECTRUM_READOUT_PEAK_PROMINENCE_DB,
  })
    .filter((peak) => peak.db >= SPECTRUM_READOUT_FLOOR_DB)
    .slice(0, SPECTRUM_READOUT_PEAK_COUNT)
    .map((peak) => ({
      frequencyHz: round2(peak.freq),
      db: round2(peak.db),
      prominenceDb: round2(peak.prominenceDb),
    }));
}

/** @param {string} value */
function sourceState(value) {
  return ["starting", "running", "stopping", "stopped", "error"].includes(value)
    ? value
    : "stopped";
}

/**
 * Format what one Spectrum panel last drew. Pure and bounded: the curve comes from the panel's own
 * render, so this never creates analysis demand or reads another request's result.
 *
 * @param {{
 *   revision: number,
 *   observedAtMs?: number,
 *   panelId: string,
 *   resolution?: keyof typeof SPECTRUM_READOUT_RESOLUTIONS,
 *   liveState: string,
 *   sessionGeneration?: number,
 *   hasLiveSample: boolean,
 *   readout: any,
 * }} input
 */
export function buildSpectrumReadout({
  revision,
  observedAtMs = Date.now(),
  panelId,
  resolution = SPECTRUM_READOUT_DEFAULT_RESOLUTION,
  liveState,
  sessionGeneration = 0,
  hasLiveSample,
  readout,
}) {
  const observed = Number.isFinite(observedAtMs) ? observedAtMs : Date.now();
  const state = sourceState(liveState);
  const frame = readout?.frame ?? {};
  const centers = Array.isArray(readout?.centers) ? readout.centers : [];
  const curve = Array.isArray(readout?.curveDb) ? readout.curveDb : [];
  const twoCurves = Array.isArray(readout?.curveDbB) && readout.curveDbB.length === curve.length;
  const maxMode = readout?.display?.maxMode ?? "off";
  const hasCurve = centers.length > 0 && curve.length === centers.length;

  let unavailable = null;
  if (readout?.displaySource === "snapshot") unavailable = "snapshotSelected";
  else if (readout?.displaySource === "file") unavailable = "fileSource";
  else if (!hasLiveSample) unavailable = "noSample";
  else if (!hasCurve) unavailable = "notReady";

  const receivedAtMs =
    unavailable === null && Number.isFinite(frame.receivedAtMs) ? frame.receivedAtMs : null;
  const ageMs = receivedAtMs === null ? null : Math.max(0, observed - receivedAtMs);
  const freshness =
    unavailable !== null
      ? "unavailable"
      : state === "running" && ageMs !== null && ageMs <= MEASUREMENT_FRESHNESS_THRESHOLD_MS
        ? "fresh"
        : "stale";

  const bands = [];
  const peaks = [];
  if (unavailable === null) {
    const curves = [
      { id: "primary", db: curve, max: readout.maxDb },
      ...(twoCurves ? [{ id: "secondary", db: readout.curveDbB, max: readout.maxDbB }] : []),
    ];
    for (const band of spectrumReadoutBands(centers, resolution)) {
      const row = {
        centerHz: round2(band.centerHz),
        lowHz: round2(band.lowHz),
        highHz: round2(band.highHz),
      };
      curves.forEach(({ id, db, max }) => {
        const suffix = id === "primary" ? "" : "B";
        row[`db${suffix}`] = levelOrNull(powerMeanDb(db, band.start, band.end));
        if (maxMode !== "off") {
          row[`maxDb${suffix}`] =
            Array.isArray(max) && max.length === centers.length
              ? levelOrNull(powerMeanDb(max, band.start, band.end))
              : null;
        }
      });
      bands.push(row);
    }
    for (const { id, db } of curves) {
      for (const peak of curvePeaks(centers, db)) peaks.push({ curve: id, ...peak });
    }
    if (!bands.some((band) => band.db !== null || band.dbB != null)) {
      unavailable = "belowSignalFloor";
    }
  }

  const liveFrame = readout?.displaySource === "live";
  const sequence = liveFrame && Number.isSafeInteger(frame.sequence) ? frame.sequence : null;

  return {
    revision,
    schemaVersion: SPECTRUM_READOUT_SCHEMA_VERSION,
    observedAt: new Date(observed).toISOString(),
    panelId,
    source: { kind: "live", state, sessionGeneration },
    sample: {
      sequence,
      elapsedMs: sequence !== null && Number.isFinite(frame.elapsedMs) ? frame.elapsedMs : null,
      receivedAt: receivedAtMs === null ? null : new Date(receivedAtMs).toISOString(),
      ageMs,
      freshness,
    },
    unavailable,
    display: readout?.display ?? null,
    resolution,
    unit: "dB",
    bands,
    peaks,
  };
}
