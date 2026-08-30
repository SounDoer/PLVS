import { describe, expect, it } from "vitest";
import { FrameIntake, buildSpectrumDataSnapshot, EVICTION_GRACE_MS } from "./FrameIntake.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { LoudnessHistorySlab } from "./LoudnessHistorySlab.js";

const HIST_MAX = 5;
const SR = 48000;

function makeRow(overrides = {}) {
  return {
    lufsMomentary: -23,
    lufsShortTerm: -24,
    integrated: -25,
    lra: 4,
    truePeakL: -1,
    truePeakR: -1.5,
    truePeakMaxDbtp: -1,
    sampleLDb: -3,
    sampleRDb: -3.5,
    samplePeakMaxL: -3,
    samplePeakMaxR: -3.5,
    correlation: 0.9,
    vectorscopePairX: 0,
    vectorscopePairY: 1,
    ...overrides,
  };
}

function makeFrame(overrides = {}) {
  return {
    peakDb: [-6, -6],
    lufsMomentary: -23,
    lufsShortTerm: -24,
    integrated: -25,
    lra: 4,
    truePeakL: -1,
    truePeakR: -1.5,
    truePeakMaxDbtp: -1,
    sampleLDb: -3,
    sampleRDb: -3.5,
    correlation: 0.9,
    vectorscopePairX: 0,
    vectorscopePairY: 1,
    loudnessHistTick: null,
    ...overrides,
  };
}

describe("FrameIntake", () => {
  it("starts empty", () => {
    const intake = new FrameIntake();
    expect(intake.getLoudnessHistory()).toHaveLength(0);
    expect(intake.getAudioSnap()).toHaveLength(0);
    expect(intake.getCorrSnap()).toHaveLength(0);
  });

  it("pushHistRow adds to the hist-rate rings", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow(), HIST_MAX);
    expect(intake.getLoudnessHistory()).toHaveLength(1);
    expect(intake.getAudioSnap()).toHaveLength(1);
    expect(intake.getCorrSnap()).toHaveLength(1);
  });

  it("preserves history and visual timestamps for cross-rate alignment", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ timestampMs: 1200 }), HIST_MAX, SR);
    intake.pushVisualHistRow(
      {
        timestampMs: 1240,
        waveformMin: [-0.5, -0.3],
        waveformMax: [0.5, 0.3],
        spectrumSmoothDb: [-20, -30, -40],
        vectorscopePairs: [],
        correlation: 0.8,
      },
      10
    );

    expect(intake.getLoudnessHistory().rowAt(0).timestampMs).toBe(1200);
    expect(intake.getVisualWaveformHist().at(0).timestampMs).toBe(1240);
  });

  it("writes a pending frequency marker on the next history row", () => {
    const intake = new FrameIntake();
    intake.setCurrentChannelMetadata({
      frequencyLabel: "C",
      vectorscopePairLabel: "L/R",
    });
    intake.setPendingFrequencyMarker({ from: "L/R", to: "C" });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getFrequencyChannelMarkers().toArray()).toEqual([
      { type: "frequencyChannelChange", from: "L/R", to: "C" },
    ]);
    expect(intake.getChannelMetadataSnap().toArray()).toEqual([
      { frequencyLabel: "C", vectorscopePairLabel: "L/R" },
    ]);
  });

  it("keeps frequency markers and metadata aligned with loudness history", () => {
    const intake = new FrameIntake();
    intake.setCurrentChannelMetadata({
      frequencyLabel: "L/R",
      vectorscopePairLabel: "L/R",
    });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getLoudnessHistory()).toHaveLength(2);
    expect(intake.getFrequencyChannelMarkers().toArray()).toEqual([null, null]);
    expect(intake.getChannelMetadataSnap().toArray()).toEqual([
      { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" },
      { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" },
    ]);
  });

  it("preserves existing channel metadata on partial updates", () => {
    const intake = new FrameIntake();
    intake.setCurrentChannelMetadata({ frequencyLabel: "C", vectorscopePairLabel: "L/R" });
    intake.setCurrentChannelMetadata({ frequencyLabel: "LFE" });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getChannelMetadataSnap().toArray()).toEqual([
      { frequencyLabel: "LFE", vectorscopePairLabel: "L/R" },
    ]);
  });

  it("keeps defined empty channel metadata labels", () => {
    const intake = new FrameIntake();
    intake.setCurrentChannelMetadata({ frequencyLabel: "", vectorscopePairLabel: "" });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getChannelMetadataSnap().toArray()).toEqual([
      { frequencyLabel: "", vectorscopePairLabel: "" },
    ]);
  });

  it("writes a pending frequency marker once", () => {
    const intake = new FrameIntake();
    intake.setPendingFrequencyMarker({ from: "L/R", to: "C" });

    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    expect(intake.getFrequencyChannelMarkers().toArray()).toEqual([
      { type: "frequencyChannelChange", from: "L/R", to: "C" },
      null,
    ]);
  });

  it("keeps sparse frequency markers aligned with retained history rows", () => {
    const intake = new FrameIntake();
    for (let index = 0; index < 6; index += 1) {
      if (index === 1 || index === 4) {
        intake.setPendingFrequencyMarker({ from: `${index}`, to: `${index + 1}` });
      }
      intake.pushHistRow(makeRow({ timestampMs: index * 100 }), 3, SR);
    }

    expect(intake.getSparseFrequencyChannelMarkers().query(0, 2)).toEqual([
      {
        sequence: 4,
        logicalIndex: 1,
        marker: { type: "frequencyChannelChange", from: "4", to: "5" },
      },
    ]);
    expect(intake.getFrequencyChannelMarkers().toArray()).toEqual([
      null,
      { type: "frequencyChannelChange", from: "4", to: "5" },
      null,
    ]);
  });

  it("rebuilds and clears the sparse marker index with scalar history", () => {
    const intake = new FrameIntake();
    intake.setPendingFrequencyMarker({ from: "L/R", to: "C" });
    intake.pushHistRow(makeRow(), 3, SR);
    const original = intake.getSparseFrequencyChannelMarkers();
    const frozen = intake.snapshotSparseFrequencyChannelMarkers();

    intake.pushHistRow(makeRow(), 4, SR);
    const rebuilt = intake.getSparseFrequencyChannelMarkers();
    expect(rebuilt).not.toBe(original);
    expect(rebuilt.capacity).toBe(4);
    expect(rebuilt.query(0, 0)).toEqual([]);
    expect(frozen.query(0, 0)).toHaveLength(1);

    intake.reset();
    expect(rebuilt.query(0, 0)).toEqual([]);
  });

  it("reset clears frequency markers and channel metadata history", () => {
    const intake = new FrameIntake();
    intake.setPendingFrequencyMarker({ from: "L/R", to: "C" });
    intake.pushHistRow(makeRow(), HIST_MAX, SR);

    intake.reset();

    expect(intake.getFrequencyChannelMarkers().toArray()).toEqual([]);
    expect(intake.getChannelMetadataSnap().toArray()).toEqual([]);
  });

  it("pushHistRow records loudness values correctly", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ lufsMomentary: -18, lufsShortTerm: -20 }), HIST_MAX, SR);
    const entry = intake.getLoudnessHistory().rowAt(0);
    expect(entry.m).toBe(-18);
    expect(entry.st).toBe(-20);
  });

  it("pushHistRow clamps ring to histMaxSamples", () => {
    const intake = new FrameIntake();
    for (let i = 0; i < HIST_MAX + 3; i++) {
      intake.pushHistRow(makeRow(), HIST_MAX, SR);
    }
    expect(intake.getLoudnessHistory()).toHaveLength(HIST_MAX);
    expect(intake.getAudioSnap()).toHaveLength(HIST_MAX);
    expect(intake.getCorrSnap()).toHaveLength(HIST_MAX);
  });

  it("freezes one aligned scalar snapshot boundary across later live wrap", () => {
    const intake = new FrameIntake();
    for (let index = 0; index < 3; index += 1) {
      if (index === 2) {
        intake.setCurrentChannelMetadata({
          frequencyLabel: "C",
          vectorscopePairLabel: "L/C",
        });
      }
      intake.pushHistRow(
        makeRow({
          timestampMs: index * 100,
          lufsMomentary: -20 - index,
          correlation: index / 10,
        }),
        3,
        SR
      );
    }

    const frozen = intake.snapshotScalarHistory();
    for (let index = 3; index < 8; index += 1) {
      intake.pushHistRow(makeRow({ timestampMs: index * 100, correlation: index / 10 }), 3, SR);
    }

    expect(frozen.loudness.toArray().map((row) => row.timestampMs)).toEqual([0, 100, 200]);
    expect(Array.from(frozen.correlation)).toEqual([0, 0.1, 0.2]);
    expect(frozen.channelMetadata.rowAt(2)).toEqual({
      frequencyLabel: "C",
      vectorscopePairLabel: "L/C",
    });
    expect(frozen.loudnessDisplayIndex.retainedEndSequence).toBe(3);
    expect(frozen.waveformHistoryIndex.retainedEndSequence).toBe(3);
    expect(frozen.frequencyMarkerIndex.length).toBe(3);
    expect(frozen.storageStats().scalar.copiedReferences).toBeGreaterThan(0);
  });

  it("keeps the loudness index sequence range aligned with retained scalar rows", () => {
    const intake = new FrameIntake();
    for (let sequence = 0; sequence < 9; sequence += 1) {
      intake.pushHistRow(
        makeRow({
          lufsMomentary: -30 + sequence,
          lufsShortTerm: -40 + sequence,
          timestampMs: sequence * 100,
        }),
        4,
        SR
      );
    }

    const rows = intake.getLoudnessHistory();
    const index = intake.getLoudnessDisplayIndex();
    expect(index.capacity).toBe(rows.capacity);
    expect(index.retainedStartSequence).toBe(5);
    expect(index.retainedEndSequence).toBe(9);
    expect(rows.toArray().map((row) => row.timestampMs)).toEqual([500, 600, 700, 800]);
    expect(
      index.queryRange("m", 5, 8, (sequence) => rows.rowAt(sequence - index.retainedStartSequence))
    ).toEqual({ min: -25, max: -22 });
    expect(
      index.queryRange("st", 5, 8, (sequence) => rows.rowAt(sequence - index.retainedStartSequence))
    ).toEqual({ min: -35, max: -32 });
  });

  it("rebuilds and clears the loudness index with scalar history", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ lufsMomentary: -20 }), 3, SR);
    const original = intake.getLoudnessDisplayIndex();
    const frozen = intake.snapshotLoudnessDisplayIndex();

    intake.pushHistRow(makeRow({ lufsMomentary: -10 }), 5, SR);
    const rebuilt = intake.getLoudnessDisplayIndex();
    expect(rebuilt).not.toBe(original);
    expect(rebuilt.capacity).toBe(5);
    expect(rebuilt.retainedStartSequence).toBe(0);
    expect(rebuilt.retainedEndSequence).toBe(1);
    expect(frozen.retainedEndSequence).toBe(1);

    intake.reset();
    expect(rebuilt.retainedStartSequence).toBe(0);
    expect(rebuilt.retainedEndSequence).toBe(0);
    expect(intake.getLoudnessHistory()).toHaveLength(0);
  });

  it("keeps the waveform index aligned with scalar history through wrap", () => {
    const intake = new FrameIntake();
    for (let sequence = 0; sequence < 9; sequence += 1) {
      intake.pushHistRow(
        makeRow({
          // Divisors are powers of two so every value is exact in the Float32 columns the
          // waveform index stores; /10 would make this assert float rounding, not alignment.
          waveformMin: [-sequence / 16, sequence % 2 ? -sequence / 32 : undefined],
          waveformMax: [sequence / 16],
          timestampMs: sequence * 100,
        }),
        4,
        SR
      );
    }

    const rows = intake.getLoudnessHistory();
    const index = intake.getWaveformHistoryIndex();
    expect(index.capacity).toBe(rows.capacity);
    expect(index.retainedStartSequence).toBe(5);
    expect(index.retainedEndSequence).toBe(9);
    expect(index.queryRange(5, 8)).toEqual({
      mins: [-0.5, -0.21875],
      maxes: [0.5, 0],
    });
  });

  it("rebuilds, freezes, and clears the waveform index with scalar history", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ waveformMin: [-0.25], waveformMax: [0.5] }), 3, SR);
    const original = intake.getWaveformHistoryIndex();
    const frozen = intake.snapshotWaveformHistoryIndex();

    intake.pushHistRow(makeRow({ waveformMin: [-0.8], waveformMax: [0.9] }), 5, SR);
    const rebuilt = intake.getWaveformHistoryIndex();
    expect(rebuilt).not.toBe(original);
    expect(rebuilt.capacity).toBe(5);
    expect(rebuilt.retainedEndSequence).toBe(1);
    expect(frozen.queryRange(0, 0)).toEqual({ mins: [-0.25], maxes: [0.5] });

    intake.reset();
    expect(rebuilt.retainedStartSequence).toBe(0);
    expect(rebuilt.retainedEndSequence).toBe(0);
  });

  it("keeps all scalar columns aligned after wraparound without Array.shift", () => {
    const intake = new FrameIntake();
    const originalShift = Array.prototype.shift;
    let shiftCalls = 0;
    Array.prototype.shift = function countedShift() {
      shiftCalls += 1;
      return originalShift.call(this);
    };
    try {
      for (let index = 0; index < 6; index += 1) {
        intake.setCurrentChannelMetadata({
          frequencyLabel: `f-${index}`,
          vectorscopePairLabel: `v-${index}`,
        });
        intake.pushHistRow(makeRow({ timestampMs: index * 100, correlation: index }), 3);
      }
    } finally {
      Array.prototype.shift = originalShift;
    }
    expect(shiftCalls).toBe(0);
    expect(
      intake
        .getLoudnessHistory()
        .toArray()
        .map((row) => row.timestampMs)
    ).toEqual([300, 400, 500]);
    expect(intake.getAudioSnap().length).toBe(3);
    expect(intake.getCorrSnap().toArray()).toEqual([3, 4, 5]);
    expect(intake.getFrequencyChannelMarkers().toArray()).toEqual([null, null, null]);
    expect(
      intake
        .getChannelMetadataSnap()
        .toArray()
        .map((row) => row.frequencyLabel)
    ).toEqual(["f-3", "f-4", "f-5"]);
  });

  it("pushHistRow rebuilds scalar rings when histMaxSamples changes", () => {
    const intake = new FrameIntake();
    for (let i = 0; i < 3; i++) {
      intake.pushHistRow(makeRow(), HIST_MAX, SR);
    }
    expect(intake.getLoudnessHistory()).toHaveLength(3);
    expect(intake.getAudioSnap()).toHaveLength(3);
    expect(intake.getCorrSnap()).toHaveLength(3);
    const previous = [
      intake.getLoudnessHistory(),
      intake.getAudioSnap(),
      intake.getCorrSnap(),
      intake.getFrequencyChannelMarkers(),
      intake.getChannelMetadataSnap(),
    ];

    intake.pushHistRow(makeRow(), HIST_MAX + 2, SR);

    const rebuilt = [
      intake.getLoudnessHistory(),
      intake.getAudioSnap(),
      intake.getCorrSnap(),
      intake.getFrequencyChannelMarkers(),
      intake.getChannelMetadataSnap(),
    ];
    expect(rebuilt.every((ring) => ring.length === 1 && ring.capacity === HIST_MAX + 2)).toBe(true);
    expect(rebuilt.every((ring, index) => ring !== previous[index])).toBe(true);
  });

  it("pushHistRow treats non-finite as -Infinity", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow({ lufsMomentary: NaN, correlation: undefined }), HIST_MAX, SR);
    expect(intake.getLoudnessHistory().rowAt(0).m).toBe(-Infinity);
    expect(intake.getCorrSnap().rowAt(0)).toBe(-Infinity);
  });

  it("pushFrame without histTick does not touch the hist rings", () => {
    const intake = new FrameIntake();
    intake.pushFrame(makeFrame(), HIST_MAX);
    expect(intake.getLoudnessHistory()).toHaveLength(0);
  });

  it("pushFrame with histTick pushes to all rings", () => {
    const intake = new FrameIntake();
    const row = makeRow();
    intake.pushFrame(makeFrame({ loudnessHistTick: row }), HIST_MAX);
    expect(intake.getLoudnessHistory()).toHaveLength(1);
    expect(intake.getCorrSnap()).toHaveLength(1);
  });

  it("reset clears all rings", () => {
    const intake = new FrameIntake();
    for (let i = 0; i < 3; i++) {
      intake.pushHistRow(makeRow(), HIST_MAX);
    }
    const rings = [
      intake.getLoudnessHistory(),
      intake.getAudioSnap(),
      intake.getCorrSnap(),
      intake.getFrequencyChannelMarkers(),
      intake.getChannelMetadataSnap(),
    ];
    intake.reset();
    expect(rings.every((ring) => ring.length === 0)).toBe(true);
    expect(rings.every((ring) => Array.from(ring).length === 0)).toBe(true);
    expect(intake.getLoudnessHistory()).toBe(rings[0]);
  });

  it("audioSnap has expected shape", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(
      makeRow({ lufsMomentary: -20, correlation: 0.5, vectorscopePairX: 2, vectorscopePairY: 3 }),
      HIST_MAX,
      SR
    );
    const snap = intake.getAudioSnap().rowAt(0);
    expect(snap.momentary).toBe(-20);
    expect(snap.correlation).toBe(0.5);
    expect(snap.vectorscopePairX).toBe(2);
    expect(snap.vectorscopePairY).toBe(3);
  });

  it("derives snapshot peakDb from history waveform extents", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(
      makeRow({ waveformMin: [-0.5, -0.25], waveformMax: [0.25, 0.75] }),
      HIST_MAX
    );

    const snap = intake.getAudioSnap().rowAt(0);
    expect(snap.peakDb[0]).toBeCloseTo(-6.0206, 4);
    expect(snap.peakDb[1]).toBeCloseTo(-2.4988, 4);
  });

  it("pushFrame with visualHistBatch ingests all entries into the visual ring in order", () => {
    const intake = new FrameIntake();
    const batch = [
      {
        timestampMs: 1000,
        waveformMin: [0],
        waveformMax: [0],
        spectrumSmoothDb: [],
        vectorscopePairs: [],
        correlation: 0,
      },
      {
        timestampMs: 1040,
        waveformMin: [0],
        waveformMax: [0],
        spectrumSmoothDb: [],
        vectorscopePairs: [],
        correlation: 0,
      },
      {
        timestampMs: 1080,
        waveformMin: [0],
        waveformMax: [0],
        spectrumSmoothDb: [],
        vectorscopePairs: [],
        correlation: 0,
      },
    ];
    intake.pushFrame(makeFrame({ visualHistBatch: batch }), HIST_MAX, SR, false, 10);
    expect(intake.getVisualWaveformHist().length).toBe(3);
    expect(intake.getVisualWaveformHist().at(0).timestampMs).toBe(1000);
    expect(intake.getVisualWaveformHist().at(1).timestampMs).toBe(1040);
    expect(intake.getVisualWaveformHist().at(2).timestampMs).toBe(1080);
  });

  it("pushVisualHistRow stores entry in visual ring buffers", () => {
    const intake = new FrameIntake();
    const row = {
      waveformMin: [-0.5, -0.3],
      waveformMax: [0.5, 0.3],
      spectrumSmoothDb: [-20, -30, -40],
      vectorscopePairs: new Array(400).fill(0.1),
      correlation: 0.8,
    };
    intake.pushVisualHistRow(row, 10);
    expect(intake.getVisualWaveformHist().length).toBe(1);
    const stored = intake.getVisualWaveformHist().at(0);
    expect(Array.from(stored.waveformMin)).toEqual([expect.closeTo(-0.5), expect.closeTo(-0.3)]);
    expect(Array.from(stored.waveformMax)).toEqual([expect.closeTo(0.5), expect.closeTo(0.3)]);
    expect(Array.from(stored.dominantFrequencyHz)).toEqual([0, 0]);
    expect(Array.from(stored.spectralCentroidHz)).toEqual([0, 0]);
    expect(Array.from(stored.tonality)).toEqual([0, 0]);
    expect(stored.timestampMs).toBe(-Infinity);
  });

  it("pushVisualHistRow stores request-keyed visual history per key", () => {
    const intake = new FrameIntake();
    const baseRow = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };
    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1000,
        spectrumByKey: {
          "spectrum:single:0:combined": { bandCentersHz: [100, 200], smoothDb: [-20, -30] },
        },
        vectorscopeByKey: {
          "vectorscope:pair:0:1": { pairs: [0.1, 0.2], correlation: 0.5 },
        },
      },
      10
    );

    const specRing = intake.getVisualSpectrumHistByKey("spectrum:single:0:combined");
    expect(specRing.length).toBe(1);
    expect(specRing.at(0).dbList).toBeInstanceOf(Float32Array);
    expect(Array.from(specRing.at(0).dbList)).toEqual([-20, -30]);
    const vectorSlab = intake.getVisualVectorscopeHistByKey("vectorscope:pair:0:1");
    expect(vectorSlab.length).toBe(1);
    expect(vectorSlab.rowAt(0).pairs).toBeInstanceOf(Float32Array);
    expect(Array.from(vectorSlab.rowAt(0).pairs)).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
    ]);
    // A key never seen has no ring.
    expect(intake.getVisualSpectrumHistByKey("spectrum:single:1:combined")).toBeNull();
  });

  it("freezes request-keyed vectorscope snapshots against later slab overwrites", () => {
    const intake = new FrameIntake();
    const key = "vectorscope:pair:0:1";
    const visualRow = (timestampMs, pairs, correlation) => ({
      timestampMs,
      waveformMin: [0],
      waveformMax: [0],
      vectorscopeByKey: {
        [key]: { pairs, correlation },
      },
    });

    intake.pushVisualHistRow(visualRow(1000, [0.1, 0.2], 0.1), 2);
    intake.pushVisualHistRow(visualRow(1040, [0.3, 0.4], 0.2), 2);
    const frozen = intake.snapshotVisualVectorscopeByKey()[key];

    intake.pushVisualHistRow(visualRow(1080, [0.5, 0.6], 0.3), 2);

    expect(frozen.length).toBe(2);
    expect(frozen.timestampAt(0)).toBe(1000);
    expect(Array.from(frozen.rowAt(0).pairs)).toEqual([expect.closeTo(0.1), expect.closeTo(0.2)]);
    expect(frozen.rowAt(1).correlation).toBe(0.2);
  });

  it("freezes every retained visual key by sharing sealed chunks and copying tails", () => {
    const intake = new FrameIntake();
    const capacity = VISUAL_HISTORY_CHUNK_ROWS + 1;
    const spectrumSealedKey = "spectrum:single:0:combined";
    const spectrumTailKey = "spectrum:single:1:combined";
    const vectorscopeSealedKey = "vectorscope:pair:0:1";
    const vectorscopeTailKey = "vectorscope:pair:2:3";
    const visualRow = (index, includeTailKeys = false) => ({
      timestampMs: 1000 + index * 40,
      waveformMin: [0],
      waveformMax: [0],
      spectrumByKey: {
        [spectrumSealedKey]: {
          bandCentersHz: [100, 200],
          smoothDb: [-10 - index, -20 - index],
        },
        ...(includeTailKeys
          ? {
              [spectrumTailKey]: {
                bandCentersHz: [400, 800],
                smoothDb: [-30, -40],
              },
            }
          : {}),
      },
      vectorscopeByKey: {
        [vectorscopeSealedKey]: {
          pairs: [index / capacity, -index / capacity],
          correlation: 0.5,
        },
        ...(includeTailKeys
          ? {
              [vectorscopeTailKey]: {
                pairs: [0.25, -0.25],
                correlation: -0.5,
              },
            }
          : {}),
      },
    });

    for (let index = 0; index < capacity; index += 1) {
      intake.pushVisualHistRow(visualRow(index, index === capacity - 1), capacity);
    }
    intake.pushVisualHistRow(visualRow(capacity, false), capacity);

    const liveSpectrumSealed = intake.getVisualSpectrumHistByKey(spectrumSealedKey);
    const liveSpectrumTail = intake.getVisualSpectrumHistByKey(spectrumTailKey);
    const liveVectorscopeSealed = intake.getVisualVectorscopeHistByKey(vectorscopeSealedKey);
    const liveVectorscopeTail = intake.getVisualVectorscopeHistByKey(vectorscopeTailKey);
    const spectrumByKey = intake.snapshotVisualSpectrumByKey();
    const vectorscopeByKey = intake.snapshotVisualVectorscopeByKey();

    expect(Object.keys(spectrumByKey)).toEqual([spectrumSealedKey, spectrumTailKey]);
    expect(Object.keys(vectorscopeByKey)).toEqual([vectorscopeSealedKey, vectorscopeTailKey]);

    const frozenSpectrumSealed = spectrumByKey[spectrumSealedKey];
    const frozenSpectrumTail = spectrumByKey[spectrumTailKey];
    expect(frozenSpectrumSealed.rowAt(0).packedDbList.buffer).toBe(
      liveSpectrumSealed.rowAt(0).packedDbList.buffer
    );
    expect(frozenSpectrumSealed.rowAt(capacity - 1).packedDbList.buffer).not.toBe(
      liveSpectrumSealed.rowAt(capacity - 1).packedDbList.buffer
    );
    expect(frozenSpectrumTail.rowAt(0).packedDbList.buffer).not.toBe(
      liveSpectrumTail.rowAt(0).packedDbList.buffer
    );
    expect(frozenSpectrumSealed.storageStats()).toMatchObject({
      retainedRows: capacity,
      sharedSealedChunks: 1,
      copiedTailRows: 2,
    });
    expect(frozenSpectrumTail.storageStats()).toMatchObject({
      retainedRows: 1,
      sharedSealedChunks: 0,
      copiedTailRows: 1,
    });
    expect(frozenSpectrumSealed.storageStats().copiedTailBytes).toBeGreaterThan(0);

    const frozenVectorscopeSealed = vectorscopeByKey[vectorscopeSealedKey];
    const frozenVectorscopeTail = vectorscopeByKey[vectorscopeTailKey];
    expect(frozenVectorscopeSealed.rowAt(0).packedPairs.buffer).toBe(
      liveVectorscopeSealed.rowAt(0).packedPairs.buffer
    );
    expect(frozenVectorscopeSealed.rowAt(capacity - 1).packedPairs.buffer).not.toBe(
      liveVectorscopeSealed.rowAt(capacity - 1).packedPairs.buffer
    );
    expect(frozenVectorscopeTail.rowAt(0).packedPairs.buffer).not.toBe(
      liveVectorscopeTail.rowAt(0).packedPairs.buffer
    );
    expect(frozenVectorscopeSealed.storageStats()).toMatchObject({
      retainedRows: capacity,
      sharedSealedChunks: 1,
      copiedTailRows: 2,
    });
    expect(frozenVectorscopeTail.storageStats()).toMatchObject({
      retainedRows: 1,
      sharedSealedChunks: 0,
      copiedTailRows: 1,
    });
    expect(frozenVectorscopeSealed.storageStats().copiedTailBytes).toBeGreaterThan(0);

    intake.pushVisualHistRow(visualRow(capacity + 1, true), capacity);
    intake.pushVisualHistRow(visualRow(capacity + 2), capacity);

    expect(liveSpectrumSealed.timestampAt(0)).toBe(1120);
    expect(frozenSpectrumSealed.timestampAt(0)).toBe(1040);
    expect(frozenSpectrumSealed.timestampAt(capacity - 1)).toBe(1000 + capacity * 40);
    expect(liveSpectrumTail.length).toBe(2);
    expect(frozenSpectrumTail.length).toBe(1);
    expect(Array.from(frozenSpectrumTail.rowAt(0).dbList)).toEqual([-30, -40]);
    expect(liveVectorscopeSealed.timestampAt(0)).toBe(1120);
    expect(frozenVectorscopeSealed.timestampAt(0)).toBe(1040);
    expect(liveVectorscopeTail.length).toBe(2);
    expect(frozenVectorscopeTail.length).toBe(1);
    expect(Array.from(frozenVectorscopeTail.rowAt(0).pairs)).toEqual([
      expect.closeTo(0.25),
      expect.closeTo(-0.25),
    ]);
  });

  it("recreates a request-keyed spectrum slab when the band grid changes", () => {
    const intake = new FrameIntake();
    const key = "spectrum:single:0:combined";
    const baseRow = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };

    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1000,
        spectrumByKey: {
          [key]: { bandCentersHz: [100, 200], smoothDb: [-10, -20] },
        },
      },
      10
    );

    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1040,
        spectrumByKey: {
          [key]: { bandCentersHz: [100, 200, 400], smoothDb: [-30, -40, -50] },
        },
      },
      10
    );

    const history = intake.getVisualSpectrumHistByKey(key);
    expect(history.length).toBe(1);
    expect(history.at(0).timestampMs).toBe(1040);
    expect(Array.from(history.at(0).dbList)).toEqual([-30, -40, -50]);
  });

  it("clear releases request-keyed spectrum slabs and spectrogram arrays", () => {
    const intake = new FrameIntake();
    const key = "spectrum:single:0:combined";
    const row = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
      spectrumByKey: { [key]: { bandCentersHz: [100], smoothDb: [-10] } },
    };

    intake.pushVisualHistRow(row, 10);
    expect(intake.getVisualSpectrumHistByKey(key)).not.toBeNull();
    expect(intake.getSpectrogramSnapsForKey(key).length).toBe(1);

    intake.reset();

    expect(intake.getVisualSpectrumHistByKey(key)).toBeNull();
    expect(intake.getSpectrogramSnapsForKey(key).length).toBe(0);
  });

  it("stores request-keyed secondary spectrum curves in typed row views", () => {
    const intake = new FrameIntake();
    const key = "spectrum:pair:0:1:lr";
    const row = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
      spectrumByKey: {
        [key]: {
          bandCentersHz: [100, 200],
          smoothDb: [-10, -20],
          smoothDbB: [-30, -40],
        },
      },
    };

    intake.pushVisualHistRow(row, 10);
    const snap = intake.getVisualSpectrumHistByKey(key).at(0);

    expect(snap.dbList).toBeInstanceOf(Float32Array);
    expect(snap.dbListB).toBeInstanceOf(Float32Array);
    expect(Array.from(snap.dbListB)).toEqual([-30, -40]);
  });

  it("freezes request-keyed spectrum snapshot rows against later slab overwrites", () => {
    const intake = new FrameIntake();
    const key = "spectrum:single:0:combined";
    const baseRow = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };

    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1000,
        spectrumByKey: { [key]: { bandCentersHz: [100, 200], smoothDb: [-10, -20] } },
      },
      2
    );
    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1040,
        spectrumByKey: { [key]: { bandCentersHz: [100, 200], smoothDb: [-30, -40] } },
      },
      2
    );

    const frozen = intake.snapshotVisualSpectrumByKey()[key];

    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1080,
        spectrumByKey: { [key]: { bandCentersHz: [100, 200], smoothDb: [-50, -60] } },
      },
      2
    );

    expect(Array.from(frozen.rowAt(0).dbList)).toEqual([-10, -20]);
    expect(Array.from(intake.getVisualSpectrumHistByKey(key).at(1).dbList)).toEqual([-50, -60]);
  });

  it("retains an inactive request key's history when later ticks omit it (no backfill)", () => {
    const intake = new FrameIntake();
    const baseRow = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };
    const keyA = "spectrum:single:0:combined";
    const keyB = "spectrum:single:1:combined";

    // t=1000 only A is active.
    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1000,
        spectrumByKey: { [keyA]: { bandCentersHz: [100], smoothDb: [-10] } },
      },
      10
    );
    // t=1040 the panel switched to B; A is now inactive, B starts collecting here (no backfill).
    intake.pushVisualHistRow(
      {
        ...baseRow,
        timestampMs: 1040,
        spectrumByKey: { [keyB]: { bandCentersHz: [100], smoothDb: [-20] } },
      },
      10
    );

    // A keeps its single retained entry; B only has the one from its start time.
    expect(intake.getVisualSpectrumHistByKey(keyA).length).toBe(1);
    expect(intake.getVisualSpectrumHistByKey(keyA).at(0).timestampMs).toBe(1000);
    expect(intake.getVisualSpectrumHistByKey(keyB).length).toBe(1);
    expect(intake.getVisualSpectrumHistByKey(keyB).at(0).timestampMs).toBe(1040);

    intake.reset();
    expect(intake.getVisualSpectrumHistByKey(keyA)).toBeNull();
    expect(intake.getVisualSpectrumHistByKey(keyB)).toBeNull();
  });

  it("per-key spectrogram bands come from the per-key tick band centers", () => {
    const intake = new FrameIntake();
    const centers = [100, 200, 400, 800];
    const key = "spectrum:single:0:combined";
    intake.pushVisualHistRow(
      {
        waveformMin: [0],
        waveformMax: [0],
        correlation: 0,
        spectrumByKey: {
          [key]: { bandCentersHz: centers, smoothDb: [-30, -40, -50, -60] },
        },
      },
      10
    );
    const snap = intake.getSpectrogramSnapsForKey(key);
    expect(snap.rowAt(0).bands.length).toBe(centers.length);
    expect(snap.rowAt(0).bands[0].fCenter).toBeCloseTo(centers[0]);
  });

  it("continues frontend timestamps across an explicit native capture session", () => {
    const intake = new FrameIntake();
    const key = "spectrum:single:0:combined";
    const visualRow = (timestampMs, smoothDb) => ({
      timestampMs,
      waveformMin: [0],
      waveformMax: [0],
      correlation: 0,
      spectrumByKey: {
        [key]: { bandCentersHz: [100], smoothDb },
      },
    });

    intake.pushHistRow(makeRow({ timestampMs: 1000 }), HIST_MAX);
    intake.pushVisualHistRow(visualRow(1000, [-10]), 10);

    // The Rust pipeline timestamps are relative to each capture session. Stop -> Start creates a
    // new native pipeline whose timestamps begin near zero, while the frontend history continues.
    intake.beginCaptureSession();
    intake.pushHistRow(makeRow({ timestampMs: 40 }), HIST_MAX);
    intake.pushVisualHistRow(visualRow(40, [-20]), 10);

    const loudness = intake.getLoudnessHistory();
    const spectrogram = intake.getSpectrogramSnapsForKey(key);

    expect(loudness.rowAt(1).timestampMs).toBeGreaterThan(loudness.rowAt(0).timestampMs);
    expect(spectrogram.timestampAt(1)).toBeGreaterThan(spectrogram.timestampAt(0));
  });

  it("does not infer a new capture session from a backward timestamp without an explicit boundary", () => {
    const intake = new FrameIntake();

    intake.pushHistRow(makeRow({ timestampMs: 1000 }), HIST_MAX);
    intake.pushHistRow(makeRow({ timestampMs: 40 }), HIST_MAX);

    const loudness = intake.getLoudnessHistory();
    expect(loudness.rowAt(1).timestampMs).toBe(40);
  });

  it("continues hist and visual timelines independently after a session boundary", () => {
    const intake = new FrameIntake();
    const key = "spectrum:single:0:combined";
    const visualRow = (timestampMs) => ({
      timestampMs,
      waveformMin: [0],
      waveformMax: [0],
      correlation: 0,
      spectrumByKey: {
        [key]: { bandCentersHz: [100], smoothDb: [-20] },
      },
    });

    intake.pushHistRow(makeRow({ timestampMs: 1000 }), HIST_MAX);
    intake.pushVisualHistRow(visualRow(1040), 10);

    intake.beginCaptureSession();
    intake.pushHistRow(makeRow({ timestampMs: 20 }), HIST_MAX);
    intake.pushVisualHistRow(visualRow(80), 10);

    const loudness = intake.getLoudnessHistory();
    const spectrogram = intake.getSpectrogramSnapsForKey(key);

    expect(loudness.rowAt(1).timestampMs).toBe(1001);
    expect(spectrogram.timestampAt(1)).toBe(1041);
  });

  it("does not replace existing spectrogram history with an empty startup spectrum tick", () => {
    const intake = new FrameIntake();
    const key = "spectrum:single:0:combined";
    const visualRow = (timestampMs, spectrumEntry) => ({
      timestampMs,
      waveformMin: [0],
      waveformMax: [0],
      correlation: 0,
      spectrumByKey: {
        [key]: spectrumEntry,
      },
    });

    intake.pushVisualHistRow(
      visualRow(1000, { bandCentersHz: [100, 200], smoothDb: [-10, -20] }),
      10
    );

    intake.beginCaptureSession();
    intake.pushVisualHistRow(visualRow(40, { bandCentersHz: [], smoothDb: [] }), 10);

    const spectrogram = intake.getSpectrogramSnapsForKey(key);
    expect(spectrogram.length).toBe(1);
    expect(spectrogram.timestampAt(0)).toBe(1000);
    expect(Array.from(spectrogram.rowAt(0).dbList)).toEqual([-10, -20]);
  });

  it("uses payload grid frequencies, not recomputed RTA bands", () => {
    const centers = Array.from(
      { length: 958 },
      (_, i) => 20 * Math.pow(2, (i / 957) * Math.log2(1000))
    );
    const dbList = centers.map(() => -50);
    const out = buildSpectrumDataSnapshot(
      { spectrumBandCentersHz: centers, spectrumSmoothDb: dbList },
      { defaultSampleRate: 48000 }
    );
    expect(out.bands.length).toBe(centers.length);
    expect(out.bands[0].fCenter).toBeCloseTo(centers[0]);
    expect(out.dbList.length).toBe(dbList.length);
  });

  it("visual ring evicts oldest when over capacity", () => {
    const intake = new FrameIntake();
    const row = {
      waveformMin: [0],
      waveformMax: [0],
      spectrumSmoothDb: [],
      vectorscopePairs: [],
      correlation: 0,
    };
    for (let i = 0; i < 5; i++) intake.pushVisualHistRow(row, 3);
    expect(intake.getVisualWaveformHist().length).toBe(3);
  });

  it("stores adjacent waveform rows in one columnar backing", () => {
    const intake = new FrameIntake();
    const row = {
      waveformMin: [0, 0],
      waveformMax: [0, 0],
      correlation: 0,
    };

    intake.pushVisualHistRow(row, 10);
    intake.pushVisualHistRow(row, 10);

    expect(intake.getVisualWaveformHist().at(0).waveformMin.buffer).toBe(
      intake.getVisualWaveformHist().at(1).waveformMin.buffer
    );
  });

  it("does not reuse non-constant waveform arrays", () => {
    const intake = new FrameIntake();
    intake.pushVisualHistRow({ waveformMin: [0, -0.1], waveformMax: [0, 0.1] }, 10);
    intake.pushVisualHistRow({ waveformMin: [0, -0.1], waveformMax: [0, 0.1] }, 10);

    expect(intake.getVisualWaveformHist().at(0).waveformMin).not.toBe(
      intake.getVisualWaveformHist().at(1).waveformMin
    );
  });

  it("retains per-channel spectral Waveform metrics in visual history", () => {
    const intake = new FrameIntake();
    intake.pushVisualHistRow(
      {
        waveformMin: [-0.5, -0.25],
        waveformMax: [0.5, 0.25],
        dominantFrequencyHz: [120, 2400],
        spectralCentroidHz: [320, 4800],
        tonality: [0.8, 0.25],
      },
      10
    );

    const stored = intake.getVisualWaveformHist().at(0);
    expect(Array.from(stored.dominantFrequencyHz)).toEqual([120, 2400]);
    expect(Array.from(stored.spectralCentroidHz)).toEqual([320, 4800]);
    expect(Array.from(stored.tonality)).toEqual([expect.closeTo(0.8), 0.25]);
  });

  it("pushHistRow stores waveform sub-pairs as a Float32Array on the row", () => {
    const intake = new FrameIntake();
    const pairs = new Float32Array([-0.5, 0.5, -0.3, 0.3]);
    // Sub-count is derived from the channel count carried by waveformMin/waveformMax (see
    // LoudnessHistorySlab), so both must be present with the real 2-channel shape the Rust side
    // always sends alongside sub-pairs.
    intake.pushHistRow(
      makeRow({
        waveformMin: [-0.5, -0.3],
        waveformMax: [0.5, 0.3],
        waveformSubPairs: pairs,
        waveformSubCount: 1,
      }),
      HIST_MAX,
      SR
    );
    const row = intake.getLoudnessHistory().rowAt(0);
    expect(row.waveformSubCount).toBe(1);
    expect(row.waveformSubPairs).toBeInstanceOf(Float32Array);
    expect(Array.from(row.waveformSubPairs)).toEqual(Array.from(pairs));
  });

  it("pushHistRow defaults sub-pairs to an empty Float32Array when absent", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    const row = intake.getLoudnessHistory().rowAt(0);
    expect(row.waveformSubPairs).toBeInstanceOf(Float32Array);
    expect(row.waveformSubPairs).toHaveLength(0);
    expect(row.waveformSubCount).toBe(0);
  });

  it("keeps consecutive ragged sub-pair rows at their own offsets", () => {
    // Two rows pushed from one caller-owned array. The packed column stores them back to back in
    // a shared buffer, so this pins that the second row's offsets do not overlap the first's --
    // and that neither aliases the caller's array, which the old storage interned by value.
    const intake = new FrameIntake();
    const pairs = new Float32Array([0, 0, 0, 0]);

    intake.pushHistRow(makeRow({ waveformSubPairs: pairs, waveformSubCount: 1 }), HIST_MAX, SR);
    intake.pushHistRow(makeRow({ waveformSubPairs: pairs, waveformSubCount: 1 }), HIST_MAX, SR);

    expect(Array.from(intake.getLoudnessHistory().rowAt(0).waveformSubPairs)).toEqual([0, 0, 0, 0]);
    expect(Array.from(intake.getLoudnessHistory().rowAt(1).waveformSubPairs)).toEqual([0, 0, 0, 0]);
  });
});

describe("FrameIntake Stereo Map history", () => {
  function stereoMapRow(overrides = {}) {
    return {
      waveformMin: [0],
      waveformMax: [0],
      correlation: 0,
      ...overrides,
    };
  }

  it("pushVisualHistRow stores request-keyed Stereo Map history per key (live result map merges by key)", () => {
    const intake = new FrameIntake();
    const keyA = "stereoMap:pair:0:1:sp50:sm12";
    const keyB = "stereoMap:pair:2:3:sp50:sm12";

    intake.pushVisualHistRow(
      stereoMapRow({
        timestampMs: 1000,
        stereoMapByKey: {
          [keyA]: { bandCentersHz: [100, 200], pl: [0.1, 0.2], pr: [0.3, 0.4], c: [0.05, 0.1] },
          [keyB]: { bandCentersHz: [100, 200], pl: [0.5, 0.6], pr: [0.7, 0.8], c: [0.2, 0.3] },
        },
      }),
      10,
      48000
    );

    const slabA = intake.getVisualStereoMapHistByKey(keyA);
    const slabB = intake.getVisualStereoMapHistByKey(keyB);
    expect(slabA.length).toBe(1);
    expect(slabB.length).toBe(1);
    const rowA = slabA.rowAt(0);
    expect(rowA.bandCentersHz).toBeInstanceOf(Float32Array);
    expect(rowA.derivedForMode("position", { lowerBound: -1, upperBound: 1 }).values).toEqual([
      expect.closeTo(-0.5, 3),
      expect.closeTo(-1 / 3, 3),
    ]);
    expect(rowA.sampleRateHz).toBe(48000);
    const rowB = slabB.rowAt(0);
    expect(rowB.derivedForMode("position", { lowerBound: -1, upperBound: 1 })).not.toBeNull();
    // A key never seen has no slab.
    expect(intake.getVisualStereoMapHistByKey("stereoMap:pair:9:9:sp50:sm12")).toBeNull();
  });

  it("appends successive rows for the same key to one slab (visual rows append to one slab per key)", () => {
    const intake = new FrameIntake();
    const key = "stereoMap:pair:0:1:sp50:sm12";
    const entry = (pl) => ({ bandCentersHz: [100], pl: [pl], pr: [pl], c: [0] });

    intake.pushVisualHistRow(
      stereoMapRow({ timestampMs: 1000, stereoMapByKey: { [key]: entry(0.1) } }),
      10,
      48000
    );
    intake.pushVisualHistRow(
      stereoMapRow({ timestampMs: 1040, stereoMapByKey: { [key]: entry(0.2) } }),
      10,
      48000
    );

    const slab = intake.getVisualStereoMapHistByKey(key);
    expect(slab.length).toBe(2);
    expect(slab.timestampAt(0)).toBe(1000);
    expect(slab.timestampAt(1)).toBe(1040);
    expect(
      slab.rowAt(1).derivedForMode("position", { lowerBound: -1, upperBound: 1 }).values
    ).toEqual([0]);
  });

  it("retains an inactive Stereo Map request key's history when later ticks omit it (no backfill)", () => {
    const intake = new FrameIntake();
    const keyA = "stereoMap:pair:0:1:sp50:sm12";
    const keyB = "stereoMap:pair:2:3:sp50:sm12";
    const entry = (pl) => ({ bandCentersHz: [100], pl: [pl], pr: [pl], c: [0] });

    // t=1000 only A is active.
    intake.pushVisualHistRow(
      stereoMapRow({ timestampMs: 1000, stereoMapByKey: { [keyA]: entry(0.1) } }),
      10,
      48000
    );
    // t=1040 the panel switched to B; A is now inactive, B starts here (no backfill).
    intake.pushVisualHistRow(
      stereoMapRow({ timestampMs: 1040, stereoMapByKey: { [keyB]: entry(0.2) } }),
      10,
      48000
    );

    // A (inactive key) still retains its history; B only has the row from its start time.
    expect(intake.getVisualStereoMapHistByKey(keyA).length).toBe(1);
    expect(intake.getVisualStereoMapHistByKey(keyA).timestampAt(0)).toBe(1000);
    expect(intake.getVisualStereoMapHistByKey(keyB).length).toBe(1);
    expect(intake.getVisualStereoMapHistByKey(keyB).timestampAt(0)).toBe(1040);
  });

  it("preserves file media-time timestamps unmodified across the shared visual timeline", () => {
    const intake = new FrameIntake();
    const key = "stereoMap:pair:0:1:sp50:sm12";
    const entry = { bandCentersHz: [100], pl: [0.1], pr: [0.1], c: [0] };

    // File-mode media timestamps start at (or near) zero and are monotonic, unlike live wall-clock
    // ms since epoch; they must be stored verbatim, matching the shared waveform visual ring.
    intake.pushVisualHistRow(
      stereoMapRow({ timestampMs: 100.25, stereoMapByKey: { [key]: entry } }),
      10,
      44100
    );

    const slab = intake.getVisualStereoMapHistByKey(key);
    expect(slab.timestampAt(0)).toBe(100.25);
    expect(intake.getVisualWaveformHist().at(0).timestampMs).toBe(100.25);
    expect(slab.rowAt(0).sampleRateHz).toBe(44100);
  });

  it("freezes request-keyed Stereo Map snapshots against later slab overwrites (snapshot freeze stays immutable)", () => {
    const intake = new FrameIntake();
    const key = "stereoMap:pair:0:1:sp50:sm12";
    const entry = (pl) => ({ bandCentersHz: [100], pl: [pl], pr: [pl], c: [0] });

    intake.pushVisualHistRow(
      stereoMapRow({ timestampMs: 1000, stereoMapByKey: { [key]: entry(0.1) } }),
      10,
      48000
    );
    intake.pushVisualHistRow(
      stereoMapRow({ timestampMs: 1040, stereoMapByKey: { [key]: entry(0.2) } }),
      10,
      48000
    );
    const frozen = intake.snapshotVisualStereoMapByKey()[key];

    intake.pushVisualHistRow(
      stereoMapRow({ timestampMs: 1080, stereoMapByKey: { [key]: entry(0.3) } }),
      10,
      48000
    );

    expect(frozen.length).toBe(2);
    expect(frozen.timestampAt(0)).toBe(1000);
    expect(
      frozen.rowAt(1).derivedForMode("position", { lowerBound: -1, upperBound: 1 }).values
    ).toEqual([0]);
    // Live intake kept going: a third row landed after the freeze, invisible to the frozen view.
    expect(intake.getVisualStereoMapHistByKey(key).length).toBe(3);
  });

  it("clears request-keyed Stereo Map slabs on reset (Global Clear resets slab epochs)", () => {
    const intake = new FrameIntake();
    const key = "stereoMap:pair:0:1:sp50:sm12";
    const entry = { bandCentersHz: [100], pl: [0.1], pr: [0.1], c: [0] };

    intake.pushVisualHistRow(
      stereoMapRow({ timestampMs: 1000, stereoMapByKey: { [key]: entry } }),
      10,
      48000
    );
    expect(intake.getVisualStereoMapHistByKey(key)).not.toBeNull();

    intake.reset();

    expect(intake.getVisualStereoMapHistByKey(key)).toBeNull();
  });

  it("rebuilds Stereo Map history together with Spectrum/Vectorscope when visual capacity changes (retention change)", () => {
    const intake = new FrameIntake();
    const stereoKey = "stereoMap:pair:0:1:sp50:sm12";
    const spectrumKey = "spectrum:single:0:combined";
    const entry = { bandCentersHz: [100], pl: [0.1], pr: [0.1], c: [0] };

    intake.pushVisualHistRow(
      stereoMapRow({
        timestampMs: 1000,
        stereoMapByKey: { [stereoKey]: entry },
        spectrumByKey: { [spectrumKey]: { bandCentersHz: [100], smoothDb: [-10] } },
      }),
      10,
      48000
    );
    expect(intake.getVisualStereoMapHistByKey(stereoKey).length).toBe(1);
    expect(intake.getVisualSpectrumHistByKey(spectrumKey).length).toBe(1);

    // Retention (history window) changed: visualMaxSamples changes, so both per-key maps rebuild.
    intake.pushVisualHistRow(
      stereoMapRow({
        timestampMs: 1040,
        stereoMapByKey: { [stereoKey]: entry },
        spectrumByKey: { [spectrumKey]: { bandCentersHz: [100], smoothDb: [-20] } },
      }),
      20,
      48000
    );

    expect(intake.getVisualStereoMapHistByKey(stereoKey).length).toBe(1);
    expect(intake.getVisualStereoMapHistByKey(stereoKey).timestampAt(0)).toBe(1040);
    expect(intake.getVisualSpectrumHistByKey(spectrumKey).length).toBe(1);
  });
});

describe("secondary curve in spectrum data", () => {
  it("includes dbListB when present", () => {
    const data = buildSpectrumDataSnapshot({
      spectrumBandCentersHz: [100, 1000],
      spectrumSmoothDb: [-10, -20],
      spectrumSmoothDbB: [-15, -25],
    });
    expect(data.dbListB).toEqual([-15, -25]);
  });
  it("defaults dbListB to empty when absent", () => {
    const data = buildSpectrumDataSnapshot({
      spectrumBandCentersHz: [100],
      spectrumSmoothDb: [-10],
    });
    expect(data.dbListB).toEqual([]);
  });
});

describe("visual history eviction", () => {
  const SPEC_KEY = "spectrum:pair:0:1:combined:sp25:smoff";
  const OTHER_KEY = "spectrum:pair:0:1:combined:sp40:smoff";

  function spectrumRow(timestampMs, key) {
    return {
      timestampMs,
      waveformMin: [0],
      waveformMax: [0],
      spectrumByKey: { [key]: { bandCentersHz: [100, 200], smoothDb: [-20, -30] } },
    };
  }

  function vectorscopeRow(timestampMs, key) {
    return {
      timestampMs,
      waveformMin: [0],
      waveformMax: [0],
      vectorscopeByKey: { [key]: { pairs: [0.1, 0.2], correlation: 0.5 } },
    };
  }

  function stereoMapRow(timestampMs, key) {
    return {
      timestampMs,
      waveformMin: [0],
      waveformMax: [0],
      stereoMapByKey: {
        [key]: { bandCentersHz: [100, 200], pl: [0.1, 0.2], pr: [0.3, 0.4], c: [0.05, 0.1] },
      },
    };
  }

  // A window far longer than any timestamp these tests use, so the age rule never fires unless a
  // test is specifically exercising it.
  const WIDE_WINDOW_MS = 60 * 60 * 1000;

  function retain(keys) {
    return { spectrum: new Set(keys), vectorscope: new Set(), stereoMap: new Set() };
  }

  it("keeps a key that a panel still needs", () => {
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([SPEC_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);
    intake.pushVisualHistRow(spectrumRow(1000 + EVICTION_GRACE_MS * 10, SPEC_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });

  it("keeps an unneeded key inside the grace window and drops it after", () => {
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([SPEC_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);

    // The panel moves to a new setting: SPEC_KEY is no longer needed, OTHER_KEY is.
    intake.setRetainedVisualKeys(retain([OTHER_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(2000, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();

    intake.pushVisualHistRow(spectrumRow(2000 + EVICTION_GRACE_MS - 1, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();

    intake.pushVisualHistRow(spectrumRow(2000 + EVICTION_GRACE_MS, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).toBeNull();
    expect(intake.getVisualSpectrumHistByKey(OTHER_KEY)).not.toBeNull();
  });

  it("restarts the grace window when an unneeded key is needed again", () => {
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([SPEC_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);

    intake.setRetainedVisualKeys(retain([OTHER_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(2000, OTHER_KEY), 10);

    intake.setRetainedVisualKeys(retain([SPEC_KEY, OTHER_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(2000 + EVICTION_GRACE_MS * 2, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });

  it("drops a needed slab whose newest row has left the retention window", () => {
    // A panel can be open -- so its key is retained -- and still receive nothing, because it lost
    // the request cap or the dock took its slot. Expiry is append-driven, so such a slab freezes
    // and holds rows from outside the window forever unless the age rule drops it.
    const intake = new FrameIntake();
    const windowMs = 5000;
    intake.setRetainedVisualKeys(retain([SPEC_KEY, OTHER_KEY]), windowMs);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);

    intake.pushVisualHistRow(spectrumRow(1000 + windowMs, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();

    intake.pushVisualHistRow(spectrumRow(1000 + windowMs + 1, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).toBeNull();
  });

  it("setRetainedVisualKeys alone does not evict a key", () => {
    // This only shows that one call to setRetainedVisualKeys, with a wide window, does not by
    // itself drop SPEC_KEY -- it does not prove eviction is frame-gated, since a single sweep
    // never deletes under Rule 1 regardless of when it runs (the grace window has to elapse
    // first). The real guarantee is structural: _sweepVisualHistories is only ever called from
    // pushVisualHistRow, which is what makes eviction pause while capture is stopped -- no frames
    // arrive, so no sweep runs.
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([SPEC_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);
    intake.setRetainedVisualKeys(retain([]), WIDE_WINDOW_MS);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });

  it("sweeps nothing until a retained set has been supplied", () => {
    const intake = new FrameIntake();
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);
    intake.pushVisualHistRow(spectrumRow(1000 + EVICTION_GRACE_MS * 10, SPEC_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });

  it("sweeps every family even when the pushed frame carries none of the three keyed records", () => {
    // The sweep call sits at the end of pushVisualHistRow, outside all three `if (xxxByKey)`
    // blocks. That is what lets an unfed family age out: a dead spectrum slab must still be
    // swept even on a frame that carries only a vectorscope update, or none of the three at all.
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();

    intake.pushVisualHistRow(
      { timestampMs: 1000 + EVICTION_GRACE_MS, waveformMin: [0], waveformMax: [0] },
      10
    );
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).toBeNull();
  });

  it("clears the unneeded-since bookkeeping on reset, so a reappearing key gets a fresh grace window", () => {
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);

    intake.reset();
    // SPEC_KEY reappears while it is still unneeded. If reset() left the stale "since 1000"
    // bookkeeping in place, this push would see nowMs - since already past EVICTION_GRACE_MS and
    // delete the slab it just created, in the same call.
    intake.pushVisualHistRow(spectrumRow(5000, SPEC_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();

    intake.pushVisualHistRow(spectrumRow(5000 + EVICTION_GRACE_MS - 1, SPEC_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });

  it("clears the unneeded-since bookkeeping on a capacity change, so a reappearing key gets a fresh grace window", () => {
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);

    // A different visualMaxSamples triggers the capacity-change branch, which recreates the keyed
    // maps. SPEC_KEY reappears here while still unneeded; a stale "since 1000" surviving the
    // capacity change would delete it immediately instead of restarting its grace window.
    intake.pushVisualHistRow(spectrumRow(5000, SPEC_KEY), 20);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });

  it("Rule 1 (need) applies to the vectorscope family, not just spectrum", () => {
    // retained.vectorscope keeps VS_KEY needed for the whole test, while retained.stereoMap stays
    // empty throughout. If the sweep ever fed the vectorscope family the stereoMap retained set
    // (or vice versa), VS_KEY would read as unneeded from the start and age out -- this is a
    // deliberately stark mismatch between the two sets so a family swap can't coincidentally
    // still pass.
    const VS_KEY = "vectorscope:pair:0:1";
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(
      { spectrum: new Set(), vectorscope: new Set([VS_KEY]), stereoMap: new Set() },
      WIDE_WINDOW_MS
    );
    intake.pushVisualHistRow(vectorscopeRow(1000, VS_KEY), 10);
    intake.pushVisualHistRow(vectorscopeRow(1000 + EVICTION_GRACE_MS * 10, VS_KEY), 10);
    expect(intake.getVisualVectorscopeHistByKey(VS_KEY)).not.toBeNull();
  });

  it("Rule 2 (age) applies to the stereoMap family, whose slab is not a ChunkedHistorySlab", () => {
    const SM_KEY = "stereoMap:pair:0:1:sp50:sm12";
    const OTHER_SM_KEY = "stereoMap:pair:2:3:sp50:sm12";
    const intake = new FrameIntake();
    const windowMs = 5000;
    intake.setRetainedVisualKeys(
      { spectrum: new Set(), vectorscope: new Set(), stereoMap: new Set([SM_KEY, OTHER_SM_KEY]) },
      windowMs
    );
    intake.pushVisualHistRow(stereoMapRow(1000, SM_KEY), 10, 48000);

    intake.pushVisualHistRow(stereoMapRow(1000 + windowMs, OTHER_SM_KEY), 10, 48000);
    expect(intake.getVisualStereoMapHistByKey(SM_KEY)).not.toBeNull();

    intake.pushVisualHistRow(stereoMapRow(1000 + windowMs + 1, OTHER_SM_KEY), 10, 48000);
    expect(intake.getVisualStereoMapHistByKey(SM_KEY)).toBeNull();
  });
});

describe("FrameIntake packed loudness column", () => {
  it("stores loudness rows in a packed slab", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(
      {
        timestampMs: 1000,
        lufsMomentary: -20,
        lufsShortTerm: -22,
        waveformMin: [-0.5, -0.4],
        waveformMax: [0.5, 0.4],
        waveformSubPairs: Float32Array.from([-0.1, 0.1, -0.2, 0.2]),
        waveformSubCount: 1,
        correlation: 0.75,
      },
      8
    );
    const history = intake.getLoudnessHistory();
    expect(history).toBeInstanceOf(LoudnessHistorySlab);
    expect(history.rowAt(0).m).toBeCloseTo(-20, 4);
    expect(history.rowAt(0).waveformMin).toHaveLength(2);
    expect(history.rowAt(0).waveformMin[0]).toBeCloseTo(-0.5, 4);
    expect(history.rowAt(0).waveformMin[1]).toBeCloseTo(-0.4, 4);
    expect(history.rowAt(0).waveformSubCount).toBe(1);
    expect(history.timestampAt(0)).toBe(1000);
  });

  it("does not retain the caller's arrays", () => {
    const intake = new FrameIntake();
    const waveformMin = [-0.5, -0.4];
    intake.pushHistRow(
      {
        timestampMs: 0,
        lufsMomentary: -20,
        lufsShortTerm: -22,
        waveformMin,
        waveformMax: [0.5, 0.4],
        waveformSubPairs: new Float32Array(0),
        waveformSubCount: 0,
        correlation: 0,
      },
      8
    );
    waveformMin[0] = 99;
    expect(intake.getLoudnessHistory().rowAt(0).waveformMin).toHaveLength(2);
    expect(intake.getLoudnessHistory().rowAt(0).waveformMin[0]).toBeCloseTo(-0.5, 4);
  });
});
