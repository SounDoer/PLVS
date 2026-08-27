import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { FrameIntake } from "../src/lib/FrameIntake.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "../src/lib/historyChunkConfig.js";
import { nearestTimestampIndex } from "../src/lib/snapshotResolve.js";
import { SpectrumHistorySlab } from "../src/lib/SpectrumHistorySlab.js";
import { StereoMapModeHistorySlab } from "../src/lib/StereoMapModeHistorySlab.js";
import { VectorscopeHistorySlab } from "../src/lib/VectorscopeHistorySlab.js";
import { buildHistoryPath, buildLoudnessHistoryPathsFromIndex } from "../src/math/historyMath.js";
import { LoudnessHistoryIndex } from "../src/math/loudnessHistoryIndex.js";
import {
  sliceWaveformSubHistory,
  sliceWaveformSubHistoryFromIndex,
} from "../src/math/waveformMath.js";
import { WaveformHistoryIndex } from "../src/math/waveformHistoryIndex.js";

const HIST_ROWS = 144_000;
const VISUAL_ROWS = 360_000;
const SPECTRUM_BANDS = 958;
const VECTOR_VALUES = 200;
const VIEW_WIDTHS = [600, 1200];
// Stereo Map shares Spectrum's production band-grid width. Retained history stores one selected
// Int16 mode plane plus one shared Int16 energy plane; live Rust primitives are never retained.
const STEREO_MAP_BANDS = SPECTRUM_BANDS;
const STEREO_MAP_RETENTION_MINUTES = [30, 60, 120, 240];
const STEREO_MAP_ROWS_PER_MINUTE = 60 * 25; // 40 ms visual cadence -> 25 rows/second.
let benchmarkSink;

export function parseBenchmarkArgs(args) {
  return { fullVisual: args.includes("--full-visual") };
}

export function projectedVisualBytes() {
  const spectrumPrimary = VISUAL_ROWS * SPECTRUM_BANDS * Int16Array.BYTES_PER_ELEMENT;
  const vectorscopePairs = VISUAL_ROWS * VECTOR_VALUES * Int16Array.BYTES_PER_ELEMENT;
  return { spectrumPrimary, vectorscopePairs, total: spectrumPrimary + vectorscopePairs };
}

/**
 * Retained-byte projection for one Stereo Map key with one active Position mode: Float64
 * timestamps, one Int16 value plane, one Int16 energy plane, a centi-dB row peak, a row-presence
 * bitmap, and two Int16 Hold extrema per chunk. Pure arithmetic, so the four-hour case is cheap.
 */
export function projectedStereoMapBytes(rows, { bands = STEREO_MAP_BANDS, keyCount = 1 } = {}) {
  const timestamps = rows * Float64Array.BYTES_PER_ELEMENT;
  const modeValues = rows * bands * Int16Array.BYTES_PER_ELEMENT;
  const energy = rows * bands * Int16Array.BYTES_PER_ELEMENT;
  const rowPeaks = rows * Int16Array.BYTES_PER_ELEMENT;
  const modeRows = rows * Uint8Array.BYTES_PER_ELEMENT;
  const bandCenters = bands * Float32Array.BYTES_PER_ELEMENT;
  const chunkCount = Math.ceil(rows / VISUAL_HISTORY_CHUNK_ROWS);
  const holdIndex = chunkCount * bands * Int16Array.BYTES_PER_ELEMENT * 2;
  const perKeyTotal =
    timestamps + modeValues + energy + rowPeaks + modeRows + bandCenters + holdIndex;
  return {
    timestamps,
    modeValues,
    energy,
    rowPeaks,
    modeRows,
    bandCenters,
    holdIndex,
    perKeyTotal,
    keyCount,
    total: perKeyTotal * keyCount,
  };
}

/** Projects retained bytes across the 30/60/120/240-minute retention windows for `keyCount` keys. */
export function projectedStereoMapRetentionBytes(keyCount = 1) {
  return STEREO_MAP_RETENTION_MINUTES.map((minutes) => {
    const rows = minutes * STEREO_MAP_ROWS_PER_MINUTE;
    return { minutes, rows, ...projectedStereoMapBytes(rows, { keyCount }) };
  });
}

function assertStructure(condition, message) {
  if (!condition) throw new Error(`history benchmark structural assertion failed: ${message}`);
}

function averageMs(callback, iterations = 10) {
  for (let index = 0; index < 2; index += 1) benchmarkSink = callback();
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) benchmarkSink = callback();
  return (performance.now() - started) / iterations;
}

function makeRows() {
  const emptyPairs = new Float32Array(0);
  return Array.from({ length: HIST_ROWS }, (_, index) => ({
    m: -20 + Math.sin(index / 41),
    st: -22 + Math.cos(index / 67),
    waveformMin: [-0.5, -0.4],
    waveformMax: [0.5, 0.4],
    waveformSubPairs: emptyPairs,
    waveformSubCount: 0,
    timestampMs: index * 100,
  }));
}

function timestampView() {
  let reads = 0;
  return {
    length: VISUAL_ROWS,
    timestampAt(index) {
      reads += 1;
      return index >= 0 && index < VISUAL_ROWS ? index * 40 : NaN;
    },
    reads: () => reads,
  };
}

function benchmarkScalarNoShift() {
  const intake = new FrameIntake();
  const capacity = 64;
  let shiftCalls = 0;
  const originalShift = Array.prototype.shift;
  Array.prototype.shift = function instrumentedShift(...args) {
    shiftCalls += 1;
    return originalShift.apply(this, args);
  };
  const started = performance.now();
  try {
    for (let index = 0; index <= capacity; index += 1) {
      intake.pushHistRow(
        {
          timestampMs: index * 100,
          lufsMomentary: -20,
          lufsShortTerm: -22,
          waveformMin: [-0.5, -0.4],
          waveformMax: [0.5, 0.4],
          waveformSubPairs: [],
          waveformSubCount: 0,
          correlation: 0.75,
        },
        capacity
      );
    }
  } finally {
    Array.prototype.shift = originalShift;
  }
  assertStructure(
    shiftCalls === 0,
    `scalar FrameIntake push called Array.shift ${shiftCalls} times`
  );
  assertStructure(
    intake.getLoudnessHistory().length === capacity,
    "scalar FrameIntake did not retain exact capacity"
  );
  return {
    proxyCapacity: capacity,
    retainedRows: intake.getLoudnessHistory().length,
    shiftCalls,
    elapsedMs: performance.now() - started,
  };
}

function benchmarkVisualFreeze({ rows, bands, pairValues }) {
  const bandGrid = Array.from({ length: bands }, (_, index) => ({
    fCenter: 20 * 2 ** (index / 96),
  }));
  const spectrumValues = new Float32Array(bands).fill(-30);
  const vectorscopeValues = new Float32Array(pairValues).fill(0.25);
  const spectrum = new SpectrumHistorySlab(rows, bandGrid);
  const vectorscope = new VectorscopeHistorySlab(rows, pairValues);
  for (let index = 0; index < rows; index += 1) {
    spectrum.push({ bands: bandGrid, dbList: spectrumValues, timestampMs: index * 40 });
    vectorscope.push({
      pairs: vectorscopeValues,
      correlation: 0.5,
      sideToMidDb: -6,
      midEnergy: 0.5,
      sideEnergy: 0.25,
      timestampMs: index * 40,
    });
  }

  const freezeOne = (key, slab) => {
    const started = performance.now();
    const frozen = slab.freeze();
    const elapsedMs = performance.now() - started;
    const stats = frozen.storageStats();
    assertStructure(stats.retainedRows === rows, `${key} retained ${stats.retainedRows}/${rows}`);
    assertStructure(
      stats.copiedTailRows <= VISUAL_HISTORY_CHUNK_ROWS,
      `${key} copied ${stats.copiedTailRows} tail rows`
    );
    assertStructure(
      rows <= VISUAL_HISTORY_CHUNK_ROWS || stats.sharedSealedChunks > 0,
      `${key} shared no sealed chunks`
    );
    benchmarkSink = frozen;
    return { key, ...stats, elapsedMs };
  };

  const perKey = [
    freezeOne("spectrum:single:0:combined", spectrum),
    freezeOne("vectorscope:pair:0:1", vectorscope),
  ];
  return {
    perKey,
    retainedRows: perKey.reduce((sum, item) => sum + item.retainedRows, 0),
    sharedSealedChunks: perKey.reduce((sum, item) => sum + item.sharedSealedChunks, 0),
    copiedTailRows: perKey.reduce((sum, item) => sum + item.copiedTailRows, 0),
    copiedTailBytes: perKey.reduce((sum, item) => sum + item.copiedTailBytes, 0),
    elapsedMs: perKey.reduce((sum, item) => sum + item.elapsedMs, 0),
  };
}

/**
 * Builds `keyCount` Stereo Map slabs at `rows` rows / `bands` bands each, then measures freeze
 * cost, a historical Hold lookup (`holdAtOrBeforeTimestamp`), and a live Hold read
 * (`liveHoldValues`, the Mode-switch read path). Every structural check is count-based: Hold
 * lookups must resolve from sealed per-chunk summaries rather than rescanning retained rows, and
 * the live-Hold derivation scratch must stay sized to the band grid regardless of retained rows.
 */
function benchmarkStereoMapFreeze({ rows, bands, keyCount = 1 }) {
  const bandCentersHz = Float32Array.from({ length: bands }, (_, index) => 20 * 2 ** (index / 96));
  const pl = new Float32Array(bands).fill(0.2);
  const pr = new Float32Array(bands).fill(0.25);
  const c = new Float32Array(bands).fill(0.05);

  const freezeOne = (key) => {
    const slab = new StereoMapModeHistorySlab(rows, ["position"]);
    for (let index = 0; index < rows; index += 1) {
      slab.append({ timestampMs: index * 40, sampleRateHz: 48_000, bandCentersHz, pl, pr, c });
    }

    slab.liveHoldValues();
    slab.liveHoldValues();
    slab.liveHoldValues();

    const freezeStarted = performance.now();
    const frozen = slab.freeze();
    const freezeElapsedMs = performance.now() - freezeStarted;
    const stats = frozen.storageStats();
    assertStructure(stats.retainedRows === rows, `${key} retained ${stats.retainedRows}/${rows}`);
    assertStructure(
      stats.copiedTailRows <= VISUAL_HISTORY_CHUNK_ROWS,
      `${key} copied ${stats.copiedTailRows} tail rows`
    );
    assertStructure(
      rows <= VISUAL_HISTORY_CHUNK_ROWS || stats.sharedSealedChunks > 0,
      `${key} shared no sealed chunks`
    );

    // Historical Hold at the last retained row is an exact end match for every chunk (including
    // the frozen, now-sealed tail), so it must resolve entirely from merged chunk summaries with
    // zero per-row scanning — never proportional to the full retained history.
    const holdLookupStarted = performance.now();
    const hold = frozen.holdAtOrBeforeTimestamp((rows - 1) * 40, frozen.epoch);
    const holdLookupElapsedMs = performance.now() - holdLookupStarted;
    const expectedMergedChunks = Math.ceil(rows / VISUAL_HISTORY_CHUNK_ROWS);
    assertStructure(hold != null, `${key} historical Hold query found no row`);
    assertStructure(
      hold.stats.mergedChunks === expectedMergedChunks,
      `${key} historical Hold merged ${hold.stats.mergedChunks}/${expectedMergedChunks} chunk summaries`
    );
    assertStructure(
      hold.stats.scannedRows === 0,
      `${key} historical Hold scanned ${hold.stats.scannedRows} rows instead of using merged summaries`
    );

    benchmarkSink = frozen;
    return { key, ...stats, freezeElapsedMs, holdLookupElapsedMs, holdStats: hold.stats };
  };

  const perKey = Array.from({ length: keyCount }, (_, index) =>
    freezeOne(`stereoMap:bench:${index}`)
  );
  return {
    keyCount,
    perKey,
    retainedRows: perKey.reduce((sum, item) => sum + item.retainedRows, 0),
    sharedSealedChunks: perKey.reduce((sum, item) => sum + item.sharedSealedChunks, 0),
    copiedTailRows: perKey.reduce((sum, item) => sum + item.copiedTailRows, 0),
    copiedTailBytes: perKey.reduce((sum, item) => sum + item.copiedTailBytes, 0),
    freezeElapsedMs: perKey.reduce((sum, item) => sum + item.freezeElapsedMs, 0),
    holdLookupElapsedMs: perKey.reduce((sum, item) => sum + item.holdLookupElapsedMs, 0),
  };
}

/**
 * Drives FrameIntake with a mixed workload of `spectrumKeyCount` Spectrum keys and
 * `stereoMapKeyCount` Stereo Map keys on every visual tick, at full production band width. Counts
 * `pushVisualHistRow` calls to confirm one intake call per tick regardless of key count (no
 * per-key call fan-out), and checks every per-key slab retains typed-array primaries rather than
 * per-tick JS arrays/objects.
 */
function benchmarkMixedKeyIntake({ rows, bands, spectrumKeyCount = 4, stereoMapKeyCount = 4 }) {
  const bandCentersHz = Array.from({ length: bands }, (_, index) => 20 * 2 ** (index / 96));
  const smoothDb = new Float32Array(bands).fill(-30);
  const pl = new Float32Array(bands).fill(0.2);
  const pr = new Float32Array(bands).fill(0.25);
  const c = new Float32Array(bands).fill(0.05);
  const spectrumKeys = Array.from(
    { length: spectrumKeyCount },
    (_, index) => `spectrum:bench:${index}`
  );
  const stereoMapKeys = Array.from(
    { length: stereoMapKeyCount },
    (_, index) => `stereoMap:bench:${index}`
  );

  const intake = new FrameIntake();
  intake.setRetainedVisualKeys({
    spectrum: new Set(spectrumKeys),
    vectorscope: new Set(),
    stereoMap: new Set(stereoMapKeys),
    stereoMapModesByKey: new Map(stereoMapKeys.map((key) => [key, new Set(["position"])])),
  });
  let pushCalls = 0;
  const originalPush = intake.pushVisualHistRow.bind(intake);
  intake.pushVisualHistRow = (...args) => {
    pushCalls += 1;
    return originalPush(...args);
  };

  const started = performance.now();
  for (let index = 0; index < rows; index += 1) {
    intake.pushVisualHistRow(
      {
        timestampMs: index * 40,
        waveformMin: [],
        waveformMax: [],
        spectrumByKey: Object.fromEntries(
          spectrumKeys.map((key) => [key, { bandCentersHz, smoothDb }])
        ),
        stereoMapByKey: Object.fromEntries(
          stereoMapKeys.map((key) => [key, { bandCentersHz, pl, pr, c }])
        ),
      },
      rows,
      48_000
    );
  }
  const elapsedMs = performance.now() - started;

  assertStructure(
    pushCalls === rows,
    `mixed intake called pushVisualHistRow ${pushCalls}/${rows} times`
  );
  for (const key of spectrumKeys) {
    const slab = intake.getVisualSpectrumHistByKey(key);
    assertStructure(
      slab?.length === rows,
      `spectrum key ${key} retained ${slab?.length}/${rows} rows`
    );
  }
  for (const key of stereoMapKeys) {
    const slab = intake.getVisualStereoMapHistByKey(key);
    assertStructure(
      slab?.length === rows,
      `stereoMap key ${key} retained ${slab?.length}/${rows} rows`
    );
    assertStructure(
      slab.storageStats().arrayTypes.values === "Int16Array",
      `stereoMap key ${key} did not store a packed mode plane`
    );
  }

  return { rows, spectrumKeyCount, stereoMapKeyCount, pushCalls, elapsedMs };
}

function benchmarkNearestTimestamp() {
  const timestamps = timestampView();
  const target = (VISUAL_ROWS - 2.5) * 40;
  const iterations = 100;
  const before = timestamps.reads();
  const elapsedMs = averageMs(() => nearestTimestampIndex(timestamps, target), iterations);
  const readsPerLookup = (timestamps.reads() - before) / (iterations + 2);
  assertStructure(readsPerLookup <= 24, `nearest lookup read ${readsPerLookup} timestamps`);
  return { elapsedMs, readsPerLookup };
}

function benchmarkIndexes(rows) {
  const loudness = new LoudnessHistoryIndex(HIST_ROWS);
  const waveform = new WaveformHistoryIndex(HIST_ROWS);
  for (const row of rows) {
    loudness.append(row);
    waveform.append(row);
  }

  const results = [];
  for (const width of VIEW_WIDTHS) {
    const loudnessReferenceMs = averageMs(() => ({
      m: buildHistoryPath(rows, "m", HIST_ROWS, 0, (value) => value, width, width),
      st: buildHistoryPath(rows, "st", HIST_ROWS, 0, (value) => value, width, width),
    }));
    const loudnessIndexedMs = averageMs(() =>
      buildLoudnessHistoryPathsFromIndex(
        rows,
        loudness,
        HIST_ROWS,
        0,
        (value) => value,
        width,
        width
      )
    );
    const loudnessStats = loudness.batchQueryStats();
    const loudnessBound = (width * 2 + 4) * (2 * Math.ceil(Math.log2(HIST_ROWS)) + 2);
    assertStructure(
      loudnessStats.nodesVisited <= loudnessBound,
      `${width}px loudness visited ${loudnessStats.nodesVisited}/${loudnessBound} nodes`
    );

    let waveformSourceReads = 0;
    const waveformSource = {
      length: rows.length,
      rowAt(index) {
        waveformSourceReads += 1;
        return rows[index];
      },
    };
    const waveformReferenceMs = averageMs(() =>
      sliceWaveformSubHistory(rows, HIST_ROWS, 0, 2, width)
    );
    waveformSourceReads = 0;
    const waveformIndexedMs = averageMs(() =>
      sliceWaveformSubHistoryFromIndex(waveformSource, waveform, HIST_ROWS, 0, 2, width)
    );
    const waveformStats = waveform.batchQueryStats();
    const waveformBound = (width + 2) * (2 * Math.ceil(Math.log2(HIST_ROWS)) + 2);
    assertStructure(
      waveformStats.nodesVisited <= waveformBound,
      `${width}px waveform visited ${waveformStats.nodesVisited}/${waveformBound} nodes`
    );
    assertStructure(waveformSourceReads === 0, `${width}px waveform read retained source rows`);
    results.push({
      width,
      loudness: {
        referenceMs: loudnessReferenceMs,
        indexedMs: loudnessIndexedMs,
        ...loudnessStats,
        nodeBound: loudnessBound,
      },
      waveform: {
        referenceMs: waveformReferenceMs,
        indexedMs: waveformIndexedMs,
        ...waveformStats,
        sourceReads: waveformSourceReads,
        nodeBound: waveformBound,
      },
    });
  }

  const freezeStarted = performance.now();
  const frozenLoudness = loudness.freeze();
  const frozenWaveform = waveform.freeze();
  benchmarkSink = [frozenLoudness, frozenWaveform];
  return {
    views: results,
    freeze: {
      elapsedMs: performance.now() - freezeStarted,
      loudnessRetainedRows:
        frozenLoudness.retainedEndSequence - frozenLoudness.retainedStartSequence,
      waveformRetainedRows:
        frozenWaveform.retainedEndSequence - frozenWaveform.retainedStartSequence,
    },
  };
}

function measuredMemoryBytes() {
  const memory = process.memoryUsage();
  return { arrayBuffers: memory.arrayBuffers, external: memory.external, rss: memory.rss };
}

export function runBenchmark({ fullVisual = false } = {}) {
  const rows = makeRows();
  const indexes = benchmarkIndexes(rows);
  const nearest = benchmarkNearestTimestamp();
  const scalar = benchmarkScalarNoShift();
  const safeRows = VISUAL_HISTORY_CHUNK_ROWS + 1;
  const safeVisualFreeze = benchmarkVisualFreeze({
    rows: safeRows,
    bands: SPECTRUM_BANDS,
    pairValues: VECTOR_VALUES,
  });
  const safeStereoMapFreeze = benchmarkStereoMapFreeze({
    rows: safeRows,
    bands: STEREO_MAP_BANDS,
    keyCount: 1,
  });
  const mixedKeyIntake = benchmarkMixedKeyIntake({
    rows: safeRows,
    bands: STEREO_MAP_BANDS,
    spectrumKeyCount: 4,
    stereoMapKeyCount: 4,
  });
  const projected = projectedVisualBytes();
  const stereoMapRetentionOneKey = projectedStereoMapRetentionBytes(1);
  const stereoMapRetentionFourKeys = projectedStereoMapRetentionBytes(4);
  const result = {
    mode: fullVisual ? "full-visual" : "safe",
    scalarRows: HIST_ROWS,
    visualRows: VISUAL_ROWS,
    widths: indexes.views,
    nearest,
    indexFreeze: indexes.freeze,
    scalar,
    visualFreeze: safeVisualFreeze,
    projectedVisualBytes: projected,
    stereoMapFreeze: safeStereoMapFreeze,
    stereoMapProjectedRetentionBytes: {
      oneKey: stereoMapRetentionOneKey,
      fourKeys: stereoMapRetentionFourKeys,
    },
    mixedKeyIntake,
    fullVisual: null,
  };

  if (fullVisual) {
    // This deliberately allocates and fills all production-width rows; row count and cadence are
    // unchanged, while Spectrum and Vectorscope now retain packed Int16 payloads.
    const memoryBefore = measuredMemoryBytes();
    const started = performance.now();
    const freeze = benchmarkVisualFreeze({
      rows: VISUAL_ROWS,
      bands: SPECTRUM_BANDS,
      pairValues: VECTOR_VALUES,
    });
    const memoryAfter = measuredMemoryBytes();
    result.fullVisual = {
      rows: VISUAL_ROWS,
      spectrumBands: SPECTRUM_BANDS,
      vectorscopeFloatValues: VECTOR_VALUES,
      elapsedMs: performance.now() - started,
      memoryBefore,
      memoryAfter,
      measuredDelta: {
        arrayBuffers: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
        external: memoryAfter.external - memoryBefore.external,
        rss: memoryAfter.rss - memoryBefore.rss,
      },
      freeze,
    };

    // The 240-minute Stereo Map allocation remains opt-in: one packed mode plus shared energy is
    // much smaller than three primitive Float32 planes, but still intentionally retains every row.
    const stereoMapMemoryBefore = measuredMemoryBytes();
    const stereoMapStarted = performance.now();
    const stereoMapFullFreeze = benchmarkStereoMapFreeze({
      rows: VISUAL_ROWS,
      bands: STEREO_MAP_BANDS,
      keyCount: 1,
    });
    const stereoMapMemoryAfter = measuredMemoryBytes();
    result.fullVisual.stereoMap = {
      rows: VISUAL_ROWS,
      bands: STEREO_MAP_BANDS,
      elapsedMs: performance.now() - stereoMapStarted,
      memoryBefore: stereoMapMemoryBefore,
      memoryAfter: stereoMapMemoryAfter,
      measuredDelta: {
        arrayBuffers: stereoMapMemoryAfter.arrayBuffers - stereoMapMemoryBefore.arrayBuffers,
        external: stereoMapMemoryAfter.external - stereoMapMemoryBefore.external,
        rss: stereoMapMemoryAfter.rss - stereoMapMemoryBefore.rss,
      },
      freeze: stereoMapFullFreeze,
    };
  }

  console.log(JSON.stringify(result, null, 2));
  console.log(`HISTORY_PERF_RESULT=${JSON.stringify(result)}`);
  return result;
}

const isMain =
  process.argv[1] != null &&
  pathToFileURL(process.argv[1]).href.toLowerCase() === import.meta.url.toLowerCase();
if (isMain) runBenchmark(parseBenchmarkArgs(process.argv.slice(2)));
