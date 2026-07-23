import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { FrameIntake } from "../src/lib/FrameIntake.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "../src/lib/historyChunkConfig.js";
import { nearestTimestampIndex } from "../src/lib/snapshotResolve.js";
import { SpectrumHistorySlab } from "../src/lib/SpectrumHistorySlab.js";
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
let benchmarkSink;

export function parseBenchmarkArgs(args) {
  return { fullVisual: args.includes("--full-visual") };
}

export function projectedVisualBytes() {
  const spectrumPrimary = VISUAL_ROWS * SPECTRUM_BANDS * Float32Array.BYTES_PER_ELEMENT;
  const vectorscopePairs = VISUAL_ROWS * VECTOR_VALUES * Float32Array.BYTES_PER_ELEMENT;
  return { spectrumPrimary, vectorscopePairs, total: spectrumPrimary + vectorscopePairs };
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
  const projected = projectedVisualBytes();
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
    fullVisual: null,
  };

  if (fullVisual) {
    // This deliberately allocates and fills all production-width rows. It is expected to retain
    // roughly 1.3 GiB+ of typed payload; there is no silent precision or row-count downgrade.
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
  }

  console.log(JSON.stringify(result, null, 2));
  console.log(`HISTORY_PERF_RESULT=${JSON.stringify(result)}`);
  return result;
}

const isMain =
  process.argv[1] != null &&
  pathToFileURL(process.argv[1]).href.toLowerCase() === import.meta.url.toLowerCase();
if (isMain) runBenchmark(parseBenchmarkArgs(process.argv.slice(2)));
