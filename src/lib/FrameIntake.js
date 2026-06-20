import { RingBuffer } from "./RingBuffer.js";

// Band center arrays are fixed for a given DSP configuration (same sample rate + resolution).
// Cache keyed by "length:first:last" so all history entries share one object array.
const _bandsFromCentersCache = new Map();
function getBandsFromCenters(centers) {
  const key =
    centers.length > 0 ? `${centers.length}:${centers[0]}:${centers[centers.length - 1]}` : "";
  let cached = _bandsFromCentersCache.get(key);
  if (!cached) {
    cached = centers.map((fc) => ({ fLow: fc, fHigh: fc, fCenter: fc }));
    _bandsFromCentersCache.set(key, cached);
  }
  return cached;
}

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_F32 = new Float32Array(0);
const _constantArrayCache = new Map();
const _constantF32Cache = new Map();

function constantValueOf(values) {
  if (!values?.length) return { isConstant: false, value: undefined };
  const first = values[0];
  for (let i = 1; i < values.length; i++) {
    if (!Object.is(values[i], first)) return { isConstant: false, value: undefined };
  }
  return { isConstant: true, value: first };
}

function constantCacheKey(length, value) {
  return `${length}:${Object.is(value, -0) ? 0 : value}`;
}

function getConstantArray(length, value) {
  const key = constantCacheKey(length, value);
  let cached = _constantArrayCache.get(key);
  if (!cached) {
    cached = Object.freeze(new Array(length).fill(value));
    _constantArrayCache.set(key, cached);
  }
  return cached;
}

function getConstantFloat32Array(length, value) {
  const key = constantCacheKey(length, value);
  let cached = _constantF32Cache.get(key);
  if (!cached) {
    cached = new Float32Array(length);
    cached.fill(value);
    _constantF32Cache.set(key, cached);
  }
  return cached;
}

function snapshotNumericArray(values) {
  if (!values?.length) return EMPTY_ARRAY;
  const constant = constantValueOf(values);
  if (constant.isConstant) return getConstantArray(values.length, constant.value);
  return Array.from(values);
}

function snapshotFloat32Array(values) {
  if (!values?.length) return EMPTY_F32;
  const constant = constantValueOf(values);
  if (constant.isConstant) return getConstantFloat32Array(values.length, constant.value);
  return Float32Array.from(values);
}

/**
 * Compute spectrum display data from a frame or history row.
 * @param {object} row
 */
export function buildSpectrumDataSnapshot(row) {
  const centers = row.spectrumBandCentersHz || [];
  const dbList = row.spectrumSmoothDb || [];
  const dbListB = row.spectrumSmoothDbB || [];
  return {
    bands: getBandsFromCenters(centers),
    dbList: snapshotNumericArray(dbList),
    dbListB: snapshotNumericArray(dbListB),
  };
}

function buildAudioSnap(row) {
  return {
    momentary: Number.isFinite(row.lufsMomentary) ? row.lufsMomentary : -Infinity,
    shortTerm: Number.isFinite(row.lufsShortTerm) ? row.lufsShortTerm : -Infinity,
    mMax: Number.isFinite(row.lufsMMax) ? row.lufsMMax : -Infinity,
    stMax: Number.isFinite(row.lufsStMax) ? row.lufsStMax : -Infinity,
    integrated: Number.isFinite(row.integrated) ? row.integrated : -Infinity,
    lra: Number.isFinite(row.lra) ? row.lra : -Infinity,
    dialogueIntegrated: Number.isFinite(row.dialogueIntegrated)
      ? row.dialogueIntegrated
      : -Infinity,
    dialogueLra: Number.isFinite(row.dialogueLra) ? row.dialogueLra : 0,
    dialoguePercent: Number.isFinite(row.dialoguePercent) ? row.dialoguePercent : null,
    truePeakL: Number.isFinite(row.truePeakL) ? row.truePeakL : -Infinity,
    truePeakR: Number.isFinite(row.truePeakR) ? row.truePeakR : -Infinity,
    tpMax: Number.isFinite(row.truePeakMaxDbtp) ? row.truePeakMaxDbtp : -Infinity,
    samplePeak: Number.isFinite(row.truePeakMaxDbtp) ? row.truePeakMaxDbtp : -Infinity,
    tpL: Number.isFinite(row.sampleLDb) ? row.sampleLDb : -Infinity,
    tpR: Number.isFinite(row.sampleRDb) ? row.sampleRDb : -Infinity,
    sampleL: Number.isFinite(row.sampleLDb) ? row.sampleLDb : -Infinity,
    sampleR: Number.isFinite(row.sampleRDb) ? row.sampleRDb : -Infinity,
    samplePeakMaxL: Number.isFinite(row.samplePeakMaxL) ? row.samplePeakMaxL : -Infinity,
    samplePeakMaxR: Number.isFinite(row.samplePeakMaxR) ? row.samplePeakMaxR : -Infinity,
    correlation: Number.isFinite(row.correlation) ? row.correlation : -Infinity,
    vectorscopePairX: Number.isFinite(row.vectorscopePairX) ? row.vectorscopePairX : 0,
    vectorscopePairY: Number.isFinite(row.vectorscopePairY) ? row.vectorscopePairY : 1,
  };
}

function ringPush(arr, value, max) {
  arr.push(value);
  if (arr.length > max) arr.shift();
}

/**
 * Owns all live-data ring buffers (history, snaps, spectrum).
 * Replaces the scattered loudnessHistRef / audioSnapRef / corrSnapRef / vectorSnapRef /
 * spectrumSnapRef / spectrumDataSnapRef / spectrumDataRef / histRef pattern.
 */
export class FrameIntake {
  constructor() {
    this._loudnessHist = [];
    this._audioSnap = [];
    this._corrSnap = [];
    this._spectrumDataSnap = [];
    this._spectrumData = null;
    this._frequencyChannelMarkers = [];
    this._channelMetadataSnap = [];
    this._pendingFrequencyMarker = null;
    this._visualWaveformHist = new RingBuffer(1); // lazily resized on first pushVisualHistRow
    this._visualSpectrumHist = new RingBuffer(1);
    this._visualVectorscopeHist = new RingBuffer(1);
    this._visualCorrHist = new RingBuffer(1);
    // Request-keyed visual history: one ring per active analysis request key. Rings are created
    // lazily and retained after a key goes inactive (no panel uses it), so scrubbing back to an
    // old request still shows its history until reset() / capacity change clears them.
    this._visualSpectrumHistByKey = new Map();
    this._visualVectorscopeHistByKey = new Map();
    // Cached per-key spectrogram arrays, rebuilt once per visual tick so the canvas can read a
    // stable reference each frame.
    this._spectrogramSnapArrayByKey = new Map();
    // Constant grid frequencies from the live frame; the ~25 Hz visual tick omits them.
    this._lastSpectrumCenters = [];
    this._currentChannelMetadata = {
      frequencyLabel: "L/R",
      vectorscopePairLabel: "L/R",
    };
  }

  /**
   * Process a live audio frame.
   * @param {object} frame AudioFramePayload from Tauri
   * @param {number} histMaxSamples ring capacity
   * @param {number} defaultSampleRate for spectrum band calc
   * @param {boolean} [freezeSpectrum] skip live spectrum update when true
   */
  pushFrame(frame, histMaxSamples, defaultSampleRate, freezeSpectrum = false) {
    if (frame.spectrumBandCentersHz?.length) {
      this._lastSpectrumCenters = frame.spectrumBandCentersHz;
    }
    if (!freezeSpectrum) {
      this._spectrumData = buildSpectrumDataSnapshot(frame, { defaultSampleRate });
    }
    if (frame.loudnessHistTick != null) {
      this.pushHistRow(frame.loudnessHistTick, histMaxSamples, defaultSampleRate);
    }
  }

  /**
   * Push one history row into the hist-rate snap rings.
   * Spectrum/vectorscope SVG paths are not stored here — they are rebuilt on demand
   * from the visual rings (see useSnapshot), so only numeric/data snaps are kept.
   * @param {object} row MeterHistoryEntry
   * @param {number} histMaxSamples
   * @param {number} defaultSampleRate
   */
  pushHistRow(row, histMaxSamples, defaultSampleRate) {
    const hm = Number.isFinite(row.lufsMomentary) ? row.lufsMomentary : -Infinity;
    const hst = Number.isFinite(row.lufsShortTerm) ? row.lufsShortTerm : -Infinity;
    ringPush(
      this._loudnessHist,
      {
        m: hm,
        st: hst,
        waveformMin: snapshotNumericArray(row.waveformMin),
        waveformMax: snapshotNumericArray(row.waveformMax),
        waveformSubPairs: snapshotFloat32Array(row.waveformSubPairs),
        waveformSubCount: row.waveformSubCount ?? 0,
        timestampMs: row.timestampMs,
      },
      histMaxSamples
    );
    ringPush(this._audioSnap, buildAudioSnap(row), histMaxSamples);
    ringPush(
      this._corrSnap,
      Number.isFinite(row.correlation) ? row.correlation : -Infinity,
      histMaxSamples
    );
    ringPush(
      this._spectrumDataSnap,
      buildSpectrumDataSnapshot(row, { defaultSampleRate }),
      histMaxSamples
    );
    ringPush(this._frequencyChannelMarkers, this._pendingFrequencyMarker, histMaxSamples);
    ringPush(this._channelMetadataSnap, { ...this._currentChannelMetadata }, histMaxSamples);
    this._pendingFrequencyMarker = null;
  }

  pushVisualHistRow(row, visualMaxSamples) {
    if (this._visualWaveformHist.capacity !== visualMaxSamples) {
      this._visualWaveformHist = new RingBuffer(visualMaxSamples);
      this._visualSpectrumHist = new RingBuffer(visualMaxSamples);
      this._visualVectorscopeHist = new RingBuffer(visualMaxSamples);
      this._visualCorrHist = new RingBuffer(visualMaxSamples);
      // Per-key rings are sized to the same window; drop them so they are recreated at the new
      // capacity rather than mixing sizes.
      this._visualSpectrumHistByKey = new Map();
      this._visualVectorscopeHistByKey = new Map();
      this._spectrogramSnapArrayByKey = new Map();
    }

    this._visualWaveformHist.push({
      waveformMin: snapshotNumericArray(row.waveformMin),
      waveformMax: snapshotNumericArray(row.waveformMax),
      timestampMs: row.timestampMs,
    });

    this._visualSpectrumHist.push({
      bands: getBandsFromCenters(row.spectrumBandCentersHz ?? this._lastSpectrumCenters),
      dbList: snapshotNumericArray(row.spectrumSmoothDb),
      dbListB: snapshotNumericArray(row.spectrumSmoothDbB),
      timestampMs: row.timestampMs,
    });

    this._visualVectorscopeHist.push({
      pairs: snapshotNumericArray(row.vectorscopePairs),
      timestampMs: row.timestampMs,
    });
    this._visualCorrHist.push({
      value: Number.isFinite(row.correlation) ? row.correlation : -Infinity,
      timestampMs: row.timestampMs,
    });

    const spectrumByKey = row.spectrumByKey;
    if (spectrumByKey) {
      for (const key in spectrumByKey) {
        const entry = spectrumByKey[key];
        let ring = this._visualSpectrumHistByKey.get(key);
        if (!ring) {
          ring = new RingBuffer(visualMaxSamples);
          this._visualSpectrumHistByKey.set(key, ring);
        }
        ring.push({
          bands: getBandsFromCenters(entry.bandCentersHz ?? this._lastSpectrumCenters),
          dbList: snapshotNumericArray(entry.smoothDb),
          dbListB: snapshotNumericArray(entry.smoothDbB),
          timestampMs: row.timestampMs,
        });
        this._spectrogramSnapArrayByKey.set(key, ring.toArray());
      }
    }
    const vectorscopeByKey = row.vectorscopeByKey;
    if (vectorscopeByKey) {
      for (const key in vectorscopeByKey) {
        const entry = vectorscopeByKey[key];
        let ring = this._visualVectorscopeHistByKey.get(key);
        if (!ring) {
          ring = new RingBuffer(visualMaxSamples);
          this._visualVectorscopeHistByKey.set(key, ring);
        }
        ring.push({
          pairs: snapshotNumericArray(entry.pairs),
          correlation: Number.isFinite(entry.correlation) ? entry.correlation : -Infinity,
          timestampMs: row.timestampMs,
        });
      }
    }
  }

  /** Set live spectrum data to the last seeded row (used by seed finalize). */
  finalizeFromRow(row, defaultSampleRate) {
    this._spectrumData = buildSpectrumDataSnapshot(row, { defaultSampleRate });
  }

  setPendingFrequencyMarker(marker) {
    this._pendingFrequencyMarker = marker
      ? { type: "frequencyChannelChange", from: marker.from, to: marker.to }
      : null;
  }

  setCurrentChannelMetadata(metadata) {
    this._currentChannelMetadata = {
      frequencyLabel: metadata?.frequencyLabel ?? this._currentChannelMetadata.frequencyLabel,
      vectorscopePairLabel:
        metadata?.vectorscopePairLabel ?? this._currentChannelMetadata.vectorscopePairLabel,
    };
  }

  getLoudnessHistory() {
    return this._loudnessHist;
  }
  getSpectrumData() {
    return this._spectrumData;
  }
  getSpectrumDataSnap() {
    return this._spectrumDataSnap;
  }
  getAudioSnap() {
    return this._audioSnap;
  }
  getCorrSnap() {
    return this._corrSnap;
  }
  getFrequencyChannelMarkers() {
    return this._frequencyChannelMarkers;
  }
  getChannelMetadataSnap() {
    return this._channelMetadataSnap;
  }
  getVisualWaveformHist() {
    return this._visualWaveformHist;
  }
  getVisualSpectrumHist() {
    return this._visualSpectrumHist;
  }
  getVisualVectorscopeHist() {
    return this._visualVectorscopeHist;
  }
  getVisualSpectrumHistByKey(key) {
    return this._visualSpectrumHistByKey.get(key) ?? null;
  }
  getVisualVectorscopeHistByKey(key) {
    return this._visualVectorscopeHistByKey.get(key) ?? null;
  }
  getSpectrogramSnapArrayForKey(key) {
    return this._spectrogramSnapArrayByKey.get(key) ?? EMPTY_ARRAY;
  }
  /** Freeze per-key spectrum history into plain arrays for snapshot scrubbing. */
  snapshotVisualSpectrumByKey() {
    const out = {};
    for (const [key, ring] of this._visualSpectrumHistByKey) out[key] = ring.toArray();
    return out;
  }
  /** Freeze per-key vectorscope history into plain arrays for snapshot scrubbing. */
  snapshotVisualVectorscopeByKey() {
    const out = {};
    for (const [key, ring] of this._visualVectorscopeHistByKey) out[key] = ring.toArray();
    return out;
  }
  getVisualCorrHist() {
    return this._visualCorrHist;
  }

  reset() {
    this._loudnessHist = [];
    this._audioSnap = [];
    this._corrSnap = [];
    this._spectrumDataSnap = [];
    this._spectrumData = null;
    this._frequencyChannelMarkers = [];
    this._channelMetadataSnap = [];
    this._pendingFrequencyMarker = null;
    this._visualWaveformHist.clear();
    this._visualSpectrumHist.clear();
    this._visualVectorscopeHist.clear();
    this._visualCorrHist.clear();
    this._visualSpectrumHistByKey = new Map();
    this._visualVectorscopeHistByKey = new Map();
    this._spectrogramSnapArrayByKey = new Map();
  }
}
