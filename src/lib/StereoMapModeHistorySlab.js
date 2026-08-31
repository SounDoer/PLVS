import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import {
  STEREO_MAP_VALUE_INVALID,
  createStereoMapValuePlane,
  decodeStereoMapValue,
  encodeStereoMapValue,
  readStereoMapValueCode,
  sliceStereoMapValuePlane,
  stereoMapValuePlaneBytes,
  writeStereoMapValueCode,
} from "./packedHistoryCodecs.js";
import {
  STEREO_MAP_OPACITY_OPAQUE,
  createStereoMapOpacityPlane,
  decodeStereoMapOpacity,
  encodeStereoMapOpacity,
  readStereoMapOpacityCode,
  sliceStereoMapOpacityPlane,
  writeStereoMapOpacityCode,
} from "./stereoMapOpacityCodec.js";
import {
  STEREO_MAP_MODES,
  createStereoMapDerivationScratch,
  visitSelectedStereoMapDerivedPoints,
} from "../math/stereoMapMath.js";

const MODES = new Set(Object.values(STEREO_MAP_MODES));
const INVALID = STEREO_MAP_VALUE_INVALID;

function normalizedModes(modes) {
  const selected = new Set(modes ?? MODES);
  for (const mode of selected) {
    if (!MODES.has(mode)) throw new TypeError(`Unknown Stereo Map mode: ${String(mode)}`);
  }
  return selected;
}

function sameGrid(a, b) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (!Object.is(a[index], Math.fround(b[index]))) return false;
  }
  return true;
}

function createModePlane(rowCapacity, bandCount) {
  return createStereoMapValuePlane(rowCapacity * bandCount);
}

function createModeSummary(mode, bandCount) {
  // Summaries hold the same 12-bit codes the planes do, so Hold can compare them without decoding.
  const minimum = new Uint16Array(bandCount).fill(INVALID);
  const maximum =
    mode === STEREO_MAP_MODES.POSITION ? new Uint16Array(bandCount).fill(INVALID) : null;
  return { minimum, maximum };
}

function createChunk(sequenceStart, bandCount, modes) {
  const modePlanes = {};
  const modeRows = {};
  const holdSummaries = {};
  for (const mode of modes) {
    modePlanes[mode] = createModePlane(VISUAL_HISTORY_CHUNK_ROWS, bandCount);
    modeRows[mode] = new Uint8Array(VISUAL_HISTORY_CHUNK_ROWS);
    holdSummaries[mode] = createModeSummary(mode, bandCount);
  }
  return {
    sequenceStart,
    bandCount,
    rowCount: 0,
    sealed: false,
    timestamps: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
    opacity: createStereoMapOpacityPlane(VISUAL_HISTORY_CHUNK_ROWS * bandCount),
    modePlanes,
    modeRows,
    holdSummaries,
  };
}

function ensureModeInChunk(chunk, mode, bandCount) {
  chunk.modePlanes[mode] ??= createModePlane(VISUAL_HISTORY_CHUNK_ROWS, bandCount);
  chunk.modeRows[mode] ??= new Uint8Array(VISUAL_HISTORY_CHUNK_ROWS);
  chunk.holdSummaries[mode] ??= createModeSummary(mode, bandCount);
}

function cloneChunk(chunk) {
  const modePlanes = {};
  const modeRows = {};
  const holdSummaries = {};
  const { bandCount } = chunk;
  for (const [mode, plane] of Object.entries(chunk.modePlanes)) {
    modePlanes[mode] = sliceStereoMapValuePlane(plane, chunk.rowCount * bandCount);
  }
  for (const [mode, rows] of Object.entries(chunk.modeRows)) {
    modeRows[mode] = rows.slice(0, chunk.rowCount);
  }
  for (const [mode, summary] of Object.entries(chunk.holdSummaries)) {
    holdSummaries[mode] = {
      minimum: summary.minimum.slice(),
      maximum: summary.maximum?.slice() ?? null,
    };
  }
  return {
    sequenceStart: chunk.sequenceStart,
    bandCount,
    rowCount: chunk.rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(0, chunk.rowCount),
    opacity: sliceStereoMapOpacityPlane(chunk.opacity, chunk.rowCount * bandCount),
    modePlanes,
    modeRows,
    holdSummaries,
  };
}

function updateExtreme(target, index, value, maximum) {
  if (value === INVALID) return;
  if (target[index] === INVALID || (maximum ? value > target[index] : value < target[index])) {
    target[index] = value;
  }
}

function updateSummary(summary, mode, band, encoded) {
  updateExtreme(summary.minimum, band, encoded, mode === STEREO_MAP_MODES.MS_RATIO_DB);
  if (summary.maximum) updateExtreme(summary.maximum, band, encoded, true);
}

function mergeSummary(target, source, mode) {
  for (let band = 0; band < target.minimum.length; band += 1) {
    updateSummary(target, mode, band, source.minimum[band]);
    if (target.maximum) updateExtreme(target.maximum, band, source.maximum[band], true);
  }
}

function decodeHold(mode, summary) {
  const minimum = Array.from(summary.minimum, (value) => decodeStereoMapValue(mode, value));
  if (mode !== STEREO_MAP_MODES.POSITION) return minimum;
  return {
    minimum,
    maximum: Array.from(summary.maximum, (value) => decodeStereoMapValue(mode, value)),
  };
}

function projectPoint(value, opacity, { lowerBound, upperBound }) {
  if (value === null || Number.isNaN(value)) return { state: "invalid" };
  if (value < lowerBound) return { state: "belowRange", value: lowerBound, opacity };
  if (value > upperBound) return { state: "aboveRange", value: upperBound, opacity };
  if (!Number.isFinite(value)) return { state: "invalid" };
  return { state: "finite", value, opacity };
}

function payloadBytes(chunk) {
  let total = chunk.timestamps.byteLength + chunk.opacity.byteLength;
  for (const plane of Object.values(chunk.modePlanes)) total += stereoMapValuePlaneBytes(plane);
  for (const rows of Object.values(chunk.modeRows)) total += rows.byteLength;
  for (const summary of Object.values(chunk.holdSummaries)) {
    total += summary.minimum.byteLength + (summary.maximum?.byteLength ?? 0);
  }
  return total;
}

class StereoMapModeHistoryView {
  get length() {
    return this._endSequence - this._startSequence;
  }

  get version() {
    return this._version ?? 0;
  }

  get epoch() {
    return this._epoch;
  }

  get sampleRateHz() {
    return this._sampleRateHz;
  }

  get retainedModes() {
    return new Set(this._modes);
  }

  _find(sequence) {
    return this._chunks.find(
      (chunk) => sequence >= chunk.sequenceStart && sequence < chunk.sequenceStart + chunk.rowCount
    );
  }

  _sequenceAt(index) {
    return Number.isInteger(index) && index >= 0 && index < this.length
      ? this._startSequence + index
      : null;
  }

  timestampAt(index) {
    const sequence = this._sequenceAt(index);
    if (sequence == null) return NaN;
    const chunk = this._find(sequence);
    return chunk.timestamps[sequence - chunk.sequenceStart];
  }

  rowAt(index) {
    const sequence = this._sequenceAt(index);
    if (sequence == null) return undefined;
    const chunk = this._find(sequence);
    const row = sequence - chunk.sequenceStart;
    const bandCount = this._bandCentersHz.length;
    const first = row * bandCount;
    return {
      timestampMs: chunk.timestamps[row],
      sampleRateHz: this._sampleRateHz,
      bandCentersHz: this._bandCentersHz,
      derivedForMode: (mode, range) => {
        const plane = chunk.modePlanes[mode];
        if (!plane || !chunk.modeRows[mode]?.[row]) return null;
        const values = new Array(bandCount);
        const points = new Array(bandCount);
        for (let band = 0; band < bandCount; band += 1) {
          const value = decodeStereoMapValue(mode, readStereoMapValueCode(plane, first + band));
          const stored = decodeStereoMapOpacity(
            readStereoMapOpacityCode(chunk.opacity, first + band)
          );
          values[band] = value;
          points[band] = projectPoint(value, stored === null ? undefined : stored, range);
        }
        return {
          mode,
          bandCentersHz: this._bandCentersHz,
          values,
          points,
        };
      },
    };
  }

  holdAt(index, epoch = this._epoch) {
    const target = this._sequenceAt(index);
    if (target == null || epoch !== this._epoch) return null;
    const summaries = {};
    for (const mode of this._modes)
      summaries[mode] = createModeSummary(mode, this._bandCentersHz.length);
    const stats = { mergedChunks: 0, mergedCheckpoints: 0, scannedRows: 0 };
    for (const chunk of this._chunks) {
      const firstSequence = Math.max(this._startSequence, chunk.sequenceStart);
      const endSequence = Math.min(target + 1, chunk.sequenceStart + chunk.rowCount);
      if (firstSequence >= endSequence) continue;
      if (
        firstSequence === chunk.sequenceStart &&
        endSequence === chunk.sequenceStart + chunk.rowCount
      ) {
        for (const mode of this._modes) {
          if (chunk.holdSummaries[mode])
            mergeSummary(summaries[mode], chunk.holdSummaries[mode], mode);
        }
        stats.mergedChunks += 1;
        continue;
      }
      for (let sequence = firstSequence; sequence < endSequence; sequence += 1) {
        const row = sequence - chunk.sequenceStart;
        const first = row * this._bandCentersHz.length;
        for (const mode of this._modes) {
          const plane = chunk.modePlanes[mode];
          if (!plane || !chunk.modeRows[mode]?.[row]) continue;
          for (let band = 0; band < this._bandCentersHz.length; band += 1) {
            if (
              readStereoMapOpacityCode(chunk.opacity, first + band) !== STEREO_MAP_OPACITY_OPAQUE
            ) {
              continue;
            }
            updateSummary(summaries[mode], mode, band, readStereoMapValueCode(plane, first + band));
          }
        }
        stats.scannedRows += 1;
      }
    }
    const values = {};
    for (const mode of this._modes) values[mode] = decodeHold(mode, summaries[mode]);
    return { values, stats };
  }

  holdAtOrBeforeTimestamp(timestampMs, epoch = this._epoch) {
    let low = 0;
    let high = this.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (this.timestampAt(middle) <= timestampMs) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found < 0 ? null : this.holdAt(found, epoch);
  }

  storageStats() {
    const allocatedBytes = this._chunks.reduce((total, chunk) => total + payloadBytes(chunk), 0);
    return {
      chunkCount: this._chunks.length,
      retainedRows: this.length,
      sharedSealedChunks: this._sharedSealedChunks ?? 0,
      copiedTailRows: this._copiedTailRows ?? 0,
      copiedTailBytes: this._copiedTailBytes ?? 0,
      retainedModes: [...this._modes],
      arrayTypes: { values: "Uint8Array (12-bit)", opacity: "Uint8Array (4-bit)" },
      allocatedBytes: { total: allocatedBytes },
      usedBytes: { total: allocatedBytes },
    };
  }
}

export class StereoMapModeHistorySlab extends StereoMapModeHistoryView {
  constructor(capacity, modes) {
    super();
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new RangeError("capacity must be positive");
    this._capacity = capacity;
    this._modes = normalizedModes(modes);
    this._chunks = [];
    this._bandCentersHz = new Float32Array(0);
    this._sampleRateHz = NaN;
    this._startSequence = 0;
    this._endSequence = 0;
    this._epoch = 0;
    this._version = 0;
    this._scratch = null;
  }

  get capacity() {
    return this._capacity;
  }

  setRetainedModes(modes) {
    const next = normalizedModes(modes);
    this._chunks = this._chunks.map((storedChunk) => {
      const removesMode = Object.keys(storedChunk.modePlanes).some((mode) => !next.has(mode));
      const chunk =
        storedChunk.sealed && removesMode
          ? {
              ...storedChunk,
              modePlanes: { ...storedChunk.modePlanes },
              modeRows: { ...storedChunk.modeRows },
              holdSummaries: { ...storedChunk.holdSummaries },
            }
          : storedChunk;
      for (const mode of Object.keys(chunk.modePlanes)) {
        if (!next.has(mode)) {
          delete chunk.modePlanes[mode];
          delete chunk.modeRows[mode];
          delete chunk.holdSummaries[mode];
        }
      }
      return chunk;
    });
    this._modes = next;
  }

  append({ timestampMs, sampleRateHz, bandCentersHz, pl, pr, c }) {
    if (!Number.isFinite(timestampMs) || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0)
      return;
    const bandCount = bandCentersHz?.length ?? 0;
    if (
      !bandCount ||
      pl?.length !== bandCount ||
      pr?.length !== bandCount ||
      c?.length !== bandCount
    )
      return;
    const incompatible =
      this.length > 0 &&
      (!Object.is(this._sampleRateHz, sampleRateHz) ||
        !sameGrid(this._bandCentersHz, bandCentersHz));
    if (this.length === 0 || incompatible) {
      if (incompatible) {
        this._chunks = [];
        this._startSequence = 0;
        this._endSequence = 0;
        this._epoch += 1;
      }
      this._bandCentersHz = Float32Array.from(bandCentersHz);
      this._sampleRateHz = sampleRateHz;
      this._scratch = createStereoMapDerivationScratch(bandCount);
    }
    let chunk = this._chunks.at(-1);
    if (!chunk || chunk.sealed) {
      chunk = createChunk(this._endSequence, bandCount, this._modes);
      this._chunks.push(chunk);
    }
    for (const mode of this._modes) ensureModeInChunk(chunk, mode, bandCount);
    const row = chunk.rowCount;
    const first = row * bandCount;
    chunk.timestamps[row] = timestampMs;
    for (const mode of this._modes) chunk.modeRows[mode][row] = 1;
    visitSelectedStereoMapDerivedPoints(
      { bandCentersHz: this._bandCentersHz, pl, pr, c },
      this._modes,
      (mode, band, value, state) => {
        const encoded = state === "valid" ? encodeStereoMapValue(mode, value) : INVALID;
        writeStereoMapValueCode(chunk.modePlanes[mode], first + band, encoded);
      },
      this._scratch
    );
    const peakDb = this._scratch.fullGridPeakDb;
    for (let band = 0; band < bandCount; band += 1) {
      writeStereoMapOpacityCode(
        chunk.opacity,
        first + band,
        encodeStereoMapOpacity(peakDb, this._scratch.energyDb[band])
      );
    }
    for (const mode of this._modes) {
      for (let band = 0; band < bandCount; band += 1) {
        if (readStereoMapOpacityCode(chunk.opacity, first + band) !== STEREO_MAP_OPACITY_OPAQUE) {
          continue;
        }
        updateSummary(
          chunk.holdSummaries[mode],
          mode,
          band,
          readStereoMapValueCode(chunk.modePlanes[mode], first + band)
        );
      }
    }
    chunk.rowCount += 1;
    chunk.sealed = chunk.rowCount === VISUAL_HISTORY_CHUNK_ROWS;
    this._endSequence += 1;
    this._startSequence = Math.max(this._startSequence, this._endSequence - this._capacity);
    while (this._chunks[0]?.sequenceStart + this._chunks[0]?.rowCount <= this._startSequence)
      this._chunks.shift();
    this._version += 1;
  }

  liveHoldValues() {
    return this.length ? (this.holdAt(this.length - 1)?.values ?? null) : null;
  }

  freeze() {
    const chunks = [];
    let sharedSealedChunks = 0;
    let copiedTailRows = 0;
    let copiedTailBytes = 0;
    for (const chunk of this._chunks) {
      if (chunk.sealed) {
        chunks.push(chunk);
        sharedSealedChunks += 1;
      } else {
        const copy = cloneChunk(chunk);
        chunks.push(copy);
        copiedTailRows =
          Math.min(chunk.sequenceStart + chunk.rowCount, this._endSequence) -
          Math.max(chunk.sequenceStart, this._startSequence);
        copiedTailBytes = payloadBytes(copy);
      }
    }
    return Object.assign(new StereoMapModeHistoryView(), {
      _chunks: chunks,
      _modes: new Set(this._modes),
      _bandCentersHz: this._bandCentersHz,
      _sampleRateHz: this._sampleRateHz,
      _startSequence: this._startSequence,
      _endSequence: this._endSequence,
      _epoch: this._epoch,
      _version: 0,
      _sharedSealedChunks: sharedSealedChunks,
      _copiedTailRows: copiedTailRows,
      _copiedTailBytes: copiedTailBytes,
    });
  }

  clear() {
    this._chunks = [];
    this._startSequence = 0;
    this._endSequence = 0;
    this._epoch += 1;
    this._bandCentersHz = new Float32Array(0);
    this._sampleRateHz = NaN;
  }
}
