import { describe, expect, it } from "vitest";
import { FrameIntake, buildSpectrumDataSnapshot } from "./FrameIntake.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

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
    peakHoldDb: [-6, -6],
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
    const [entry] = intake.getLoudnessHistory();
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
    expect(rings.every((ring) => ring._buf.every((entry) => entry === undefined))).toBe(true);
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
    expect(intake.getVisualWaveformHist().at(0)).toEqual({
      waveformMin: [-0.5, -0.3],
      waveformMax: [0.5, 0.3],
    });
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
    expect(frozenSpectrumSealed.rowAt(0).dbList.buffer).toBe(
      liveSpectrumSealed.rowAt(0).dbList.buffer
    );
    expect(frozenSpectrumSealed.rowAt(capacity - 1).dbList.buffer).not.toBe(
      liveSpectrumSealed.rowAt(capacity - 1).dbList.buffer
    );
    expect(frozenSpectrumTail.rowAt(0).dbList.buffer).not.toBe(
      liveSpectrumTail.rowAt(0).dbList.buffer
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
    expect(frozenVectorscopeSealed.rowAt(0).pairs.buffer).toBe(
      liveVectorscopeSealed.rowAt(0).pairs.buffer
    );
    expect(frozenVectorscopeSealed.rowAt(capacity - 1).pairs.buffer).not.toBe(
      liveVectorscopeSealed.rowAt(capacity - 1).pairs.buffer
    );
    expect(frozenVectorscopeTail.rowAt(0).pairs.buffer).not.toBe(
      liveVectorscopeTail.rowAt(0).pairs.buffer
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

  it("reuses constant waveform arrays instead of cloning silent rows", () => {
    const intake = new FrameIntake();
    const row = {
      waveformMin: [0, 0],
      waveformMax: [0, 0],
      correlation: 0,
    };

    intake.pushVisualHistRow(row, 10);
    intake.pushVisualHistRow(row, 10);

    expect(intake.getVisualWaveformHist().at(0).waveformMin).toBe(
      intake.getVisualWaveformHist().at(1).waveformMin
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

  it("pushHistRow stores waveform sub-pairs as a Float32Array on the row", () => {
    const intake = new FrameIntake();
    const pairs = new Float32Array([-0.5, 0.5, -0.3, 0.3]);
    intake.pushHistRow(makeRow({ waveformSubPairs: pairs, waveformSubCount: 1 }), HIST_MAX, SR);
    const [row] = intake.getLoudnessHistory();
    expect(row.waveformSubCount).toBe(1);
    expect(row.waveformSubPairs).toBeInstanceOf(Float32Array);
    expect(Array.from(row.waveformSubPairs)).toEqual(Array.from(pairs));
  });

  it("pushHistRow defaults sub-pairs to an empty Float32Array when absent", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(makeRow(), HIST_MAX, SR);
    const [row] = intake.getLoudnessHistory();
    expect(row.waveformSubPairs).toBeInstanceOf(Float32Array);
    expect(row.waveformSubPairs).toHaveLength(0);
    expect(row.waveformSubCount).toBe(0);
  });

  it("reuses constant waveform sub-pair arrays", () => {
    const intake = new FrameIntake();
    const pairs = new Float32Array([0, 0, 0, 0]);

    intake.pushHistRow(makeRow({ waveformSubPairs: pairs, waveformSubCount: 1 }), HIST_MAX, SR);
    intake.pushHistRow(makeRow({ waveformSubPairs: pairs, waveformSubCount: 1 }), HIST_MAX, SR);

    expect(intake.getLoudnessHistory().rowAt(0).waveformSubPairs).toBe(
      intake.getLoudnessHistory().rowAt(1).waveformSubPairs
    );
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
