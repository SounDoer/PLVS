import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";
import { RaggedFloatColumn } from "./RaggedFloatColumn.js";

/** Plain numeric fields of one audio snap, one Float32 column each. */
const SCALAR_FIELDS = [
  "momentary",
  "shortTerm",
  "mMax",
  "stMax",
  "integrated",
  "lra",
  "dialogueIntegrated",
  "dialogueLra",
  "truePeakL",
  "truePeakR",
  "tpMax",
  "samplePeak",
  "tpL",
  "tpR",
  "sampleL",
  "sampleR",
  "samplePeakMaxL",
  "samplePeakMaxR",
  "correlation",
  "sideToMidDb",
  "vectorscopePairX",
  "vectorscopePairY",
];
/** Per-channel fields, whose length follows the device and so is stored ragged. */
const CHANNEL_FIELDS = ["peakDb", "rmsDb"];

function createChunk(sequenceStart) {
  const chunk = baseChunk(sequenceStart);
  for (const field of SCALAR_FIELDS) chunk[field] = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS);
  // Absent reads back as null rather than 0, so it needs a NaN-carrying column of its own.
  chunk.dialoguePercent = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS);
  chunk.dialogueActiveNow = new Uint8Array(VISUAL_HISTORY_CHUNK_ROWS);
  for (const field of CHANNEL_FIELDS) {
    // Both are dB: silence arrives as -Infinity and must read back as -Infinity, not 0 dBFS.
    chunk[field] = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2, -Infinity);
  }
  return chunk;
}

function cloneChunk(chunk) {
  const copy = {
    sequenceStart: chunk.sequenceStart,
    rowCount: chunk.rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(0, chunk.rowCount),
    dialoguePercent: chunk.dialoguePercent.slice(0, chunk.rowCount),
    dialogueActiveNow: chunk.dialogueActiveNow.slice(0, chunk.rowCount),
  };
  for (const field of SCALAR_FIELDS) copy[field] = chunk[field].slice(0, chunk.rowCount);
  for (const field of CHANNEL_FIELDS) copy[field] = chunk[field].clone();
  return copy;
}

function payloadBytes(chunk) {
  let bytes =
    chunk.timestamps.byteLength +
    chunk.dialoguePercent.byteLength +
    chunk.dialogueActiveNow.byteLength;
  for (const field of SCALAR_FIELDS) bytes += chunk[field].byteLength;
  for (const field of CHANNEL_FIELDS) bytes += chunk[field].byteLength;
  return bytes;
}

const SCHEMA = { name: "AudioSnapHistorySlab", createChunk, cloneChunk, payloadBytes };

function rowFrom(chunk, row) {
  const result = { timestampMs: chunk.timestamps[row] };
  for (const field of SCALAR_FIELDS) result[field] = chunk[field][row];
  const percent = chunk.dialoguePercent[row];
  result.dialoguePercent = Number.isNaN(percent) ? null : percent;
  result.dialogueActiveNow = chunk.dialogueActiveNow[row] === 1;
  // Materialise as a plain Array, not the Float32Array subarray RaggedFloatColumn.at() returns:
  // buildAudioSnap's peakDb/rmsDb are plain Arrays, and several downstream readers (App.jsx,
  // peakChannelMath.js, VectorscopePanel.jsx, statsCatalog.js) gate on Array.isArray. This
  // allocation happens per read (one small array per frame at a single index), not per retained
  // row, so it costs nothing against this module's goal of keeping retained rows off the GC heap.
  for (const field of CHANNEL_FIELDS) result[field] = Array.from(chunk[field].at(row));
  return result;
}

/** Packed storage for the audio-snap column of the scalar history. */
export class AudioSnapHistorySlab extends ChunkedHistorySlab {
  constructor(capacity) {
    super(capacity, SCHEMA);
  }

  /**
   * `snap` is expected to be `buildAudioSnap`'s output (`src/lib/FrameIntake.js`), where every
   * scalar field is already a number -- per-field defaults (e.g. `dialogueLra` falling back to 0,
   * `vectorscopePairY` to 1) are `buildAudioSnap`'s job, not this one. The `-Infinity` written here
   * for a non-number field is a storage sentinel for a malformed row, not a per-field default.
   */
  push(snap, timestampMs) {
    this.appendRow(timestampMs, (chunk, row) => {
      for (const field of SCALAR_FIELDS) {
        const value = snap?.[field];
        chunk[field][row] = typeof value === "number" ? value : -Infinity;
      }
      chunk.dialoguePercent[row] = Number.isFinite(snap?.dialoguePercent)
        ? snap.dialoguePercent
        : Number.NaN;
      chunk.dialogueActiveNow[row] = snap?.dialogueActiveNow ? 1 : 0;
      for (const field of CHANNEL_FIELDS) chunk[field].append(snap?.[field]);
    });
  }

  at(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  freeze() {
    return new FrozenAudioSnapHistory(this.freezeChunks());
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}

export class FrozenAudioSnapHistory extends FrozenChunkedHistory {
  rowAt(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  at(index) {
    return this.rowAt(index);
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}
