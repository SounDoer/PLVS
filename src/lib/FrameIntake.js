import { buildRtaBands, SPECTRUM_SETTINGS } from "../config/scales.js";
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

/**
 * Compute spectrum display data from a frame or history row.
 * @param {object} row
 * @param {{ defaultSampleRate?: number }} pick
 */
export function buildSpectrumDataSnapshot(row, pick) {
  const centers = row.spectrumBandCentersHz || [];
  const dbList = row.spectrumSmoothDb || [];
  const nyquist = (pick.defaultSampleRate || 48000) * 0.5;
  const minF = Math.max(20, SPECTRUM_SETTINGS.minHz || 20);
  const maxF = Math.max(minF * 1.2, Math.min(SPECTRUM_SETTINGS.maxHz || 20000, nyquist));
  const bands = buildRtaBands(minF, maxF, SPECTRUM_SETTINGS.resolution || "1/6");
  if (bands.length === dbList.length && dbList.length > 0) {
    return { bands, dbList: [...dbList] };
  }
  return {
    bands: getBandsFromCenters(centers),
    dbList: [...dbList],
  };
}

function buildAudioSnap(row) {
  return {
    momentary: Number.isFinite(row.lufsMomentary) ? row.lufsMomentary : -Infinity,
    shortTerm: Number.isFinite(row.lufsShortTerm) ? row.lufsShortTerm : -Infinity,
    integrated: Number.isFinite(row.integrated) ? row.integrated : -Infinity,
    lra: Number.isFinite(row.lra) ? row.lra : -Infinity,
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
    this._vectorSnap = [];
    this._spectrumSnap = [];
    this._spectrumDataSnap = [];
    this._spectrumData = null;
    this._frequencyChannelMarkers = [];
    this._channelMetadataSnap = [];
    this._pendingFrequencyMarker = null;
    this._visualWaveformHist = new RingBuffer(1); // lazily resized on first pushVisualHistRow
    this._visualSpectrumHist = new RingBuffer(1);
    this._visualVectorscopeHist = new RingBuffer(1);
    this._visualCorrHist = new RingBuffer(1);
    this._spectrogramSnapArray = [];
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
    if (!freezeSpectrum) {
      this._spectrumData = buildSpectrumDataSnapshot(frame, { defaultSampleRate });
    }
    if (frame.loudnessHistTick != null) {
      this.pushHistRow(frame.loudnessHistTick, histMaxSamples, defaultSampleRate);
    }
  }

  /**
   * Push one history row into all six snap rings.
   * Called by pushFrame (live tick) and directly by the seed path.
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
        waveformMin: row.waveformMin ?? [],
        waveformMax: row.waveformMax ?? [],
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
    ringPush(this._vectorSnap, row.vectorscopePath || "", histMaxSamples);
    ringPush(this._spectrumSnap, row.spectrumPath || "", histMaxSamples);
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
    }

    this._visualWaveformHist.push({
      waveformMin: row.waveformMin ?? [],
      waveformMax: row.waveformMax ?? [],
      timestampMs: row.timestampMs,
    });

    const minF = Math.max(20, SPECTRUM_SETTINGS.minHz || 20);
    const maxF = Math.max(minF * 1.2, Math.min(SPECTRUM_SETTINGS.maxHz || 20000, 24000));
    this._visualSpectrumHist.push({
      bands: buildRtaBands(minF, maxF, SPECTRUM_SETTINGS.resolution || "1/6"),
      dbList: [...(row.spectrumSmoothDb ?? [])],
      timestampMs: row.timestampMs,
    });

    this._visualVectorscopeHist.push({
      pairs: row.vectorscopePairs ?? [],
      timestampMs: row.timestampMs,
    });
    this._visualCorrHist.push({
      value: Number.isFinite(row.correlation) ? row.correlation : -Infinity,
      timestampMs: row.timestampMs,
    });

    this._spectrogramSnapArray = this._visualSpectrumHist.toArray();
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
  getSpectrumSnap() {
    return this._spectrumSnap;
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
  getVectorSnap() {
    return this._vectorSnap;
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
  getVisualCorrHist() {
    return this._visualCorrHist;
  }
  getSpectrogramSnapArray() {
    return this._spectrogramSnapArray;
  }

  reset() {
    this._loudnessHist = [];
    this._audioSnap = [];
    this._corrSnap = [];
    this._vectorSnap = [];
    this._spectrumSnap = [];
    this._spectrumDataSnap = [];
    this._spectrumData = null;
    this._frequencyChannelMarkers = [];
    this._channelMetadataSnap = [];
    this._pendingFrequencyMarker = null;
    this._visualWaveformHist.clear();
    this._visualSpectrumHist.clear();
    this._visualVectorscopeHist.clear();
    this._visualCorrHist.clear();
    this._spectrogramSnapArray = [];
  }
}
