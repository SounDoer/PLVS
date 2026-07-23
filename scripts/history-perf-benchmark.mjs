import { performance } from "node:perf_hooks";

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
let benchmarkSink;
let benchmarkChecksum = 0;

function mainRows() {
  const waveformSubPairs = new Float32Array(0);

  return Array.from({ length: HIST_ROWS }, (_, index) => ({
    m: -20 + Math.sin(index / 41),
    st: -22 + Math.cos(index / 67),
    waveformMin: [-0.5, -0.4],
    waveformMax: [0.5, 0.4],
    waveformSubPairs,
    waveformSubCount: 0,
    timestampMs: index * 100,
  }));
}

function visualTimestampView() {
  let reads = 0;
  return {
    get length() {
      return VISUAL_ROWS;
    },
    timestampAt(index) {
      reads += 1;
      return index >= 0 && index < VISUAL_ROWS ? index * 40 : NaN;
    },
    reads() {
      return reads;
    },
  };
}

function averageTime(callback, iterations = 20) {
  for (let index = 0; index < 3; index += 1) benchmarkSink = callback();
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) benchmarkSink = callback();
  const elapsed = (performance.now() - started) / iterations;
  benchmarkChecksum +=
    typeof benchmarkSink === "string"
      ? benchmarkSink.length
      : (benchmarkSink.m?.length ?? 0) +
        (benchmarkSink.st?.length ?? 0) +
        (benchmarkSink.bucketCount ?? 0);
  return elapsed;
}

function reportTime(label, callback, iterations) {
  const elapsed = averageTime(callback, iterations);
  console.log(`${label}: ${elapsed.toFixed(3)} ms`);
  return elapsed;
}

function freezeVisualHistory() {
  const retainedRows = VISUAL_HISTORY_CHUNK_ROWS + 1;
  const bands = Array.from({ length: SPECTRUM_BANDS }, (_, index) => ({
    fCenter: 20 * 2 ** (index / 96),
  }));
  const spectrumValues = new Float32Array(SPECTRUM_BANDS).fill(-30);
  const vectorscopePairs = new Float32Array(VECTOR_VALUES).fill(0.25);
  const spectrum = new SpectrumHistorySlab(retainedRows, bands);
  const vectorscope = new VectorscopeHistorySlab(retainedRows, VECTOR_VALUES);

  for (let index = 0; index < retainedRows; index += 1) {
    spectrum.push({
      bands,
      dbList: spectrumValues,
      timestampMs: index * 40,
    });
    vectorscope.push({
      pairs: vectorscopePairs,
      correlation: 0.5,
      sideToMidDb: -6,
      midEnergy: 0.5,
      sideEnergy: 0.25,
      timestampMs: index * 40,
    });
  }

  const cases = [
    ["Spectrum", "spectrum:single:0:combined", spectrum, "dbList"],
    ["Vectorscope", "vectorscope:pair:0:1", vectorscope, "pairs"],
  ];
  const totals = {
    retainedRows: 0,
    sharedSealedChunks: 0,
    copiedTailRows: 0,
    copiedTailBytes: 0,
    elapsedMs: 0,
  };

  for (const [kind, key, slab, rowField] of cases) {
    const started = performance.now();
    const frozen = slab.freeze();
    const elapsedMs = performance.now() - started;
    const stats = frozen.storageStats();
    const firstRow = frozen.rowAt(0);
    const lastRow = frozen.rowAt(frozen.length - 1);
    benchmarkSink = frozen;
    benchmarkChecksum +=
      frozen.length +
      stats.sharedSealedChunks +
      stats.copiedTailRows +
      stats.copiedTailBytes +
      firstRow[rowField][0] +
      lastRow[rowField][lastRow[rowField].length - 1];
    totals.retainedRows += stats.retainedRows;
    totals.sharedSealedChunks += stats.sharedSealedChunks;
    totals.copiedTailRows += stats.copiedTailRows;
    totals.copiedTailBytes += stats.copiedTailBytes;
    totals.elapsedMs += elapsedMs;
    console.log(
      `freeze ${kind} ${key}: retained rows=${stats.retainedRows}, ` +
        `shared sealed chunks=${stats.sharedSealedChunks}, copied tail rows=${stats.copiedTailRows}, ` +
        `copied tail bytes=${stats.copiedTailBytes}, time=${elapsedMs.toFixed(3)} ms`
    );
  }

  console.log(
    `freeze total: retained rows=${totals.retainedRows}, ` +
      `shared sealed chunks=${totals.sharedSealedChunks}, copied tail rows=${totals.copiedTailRows}, ` +
      `copied tail bytes=${totals.copiedTailBytes}, time=${totals.elapsedMs.toFixed(3)} ms`
  );
}

const rows = mainRows();
const loudnessIndex = new LoudnessHistoryIndex(HIST_ROWS);
for (const row of rows) loudnessIndex.append(row);
for (const viewWidth of [600, 1200]) {
  reportTime(`loudness M+ST reference / 240m / ${viewWidth}px`, () => ({
    m: buildHistoryPath(rows, "m", HIST_ROWS, 0, (value) => value, viewWidth, viewWidth),
    st: buildHistoryPath(rows, "st", HIST_ROWS, 0, (value) => value, viewWidth, viewWidth),
  }));
  reportTime(`loudness M+ST indexed / 240m / ${viewWidth}px`, () =>
    buildLoudnessHistoryPathsFromIndex(
      rows,
      loudnessIndex,
      HIST_ROWS,
      0,
      (value) => value,
      viewWidth,
      viewWidth
    )
  );
  const stats = loudnessIndex.batchQueryStats();
  console.log(
    `loudness M+ST indexed nodes / ${viewWidth}px: ` +
      `${stats.nodesVisited} (raw rows=${stats.rawRowsVisited}, summaries=${stats.summaryBucketsVisited})`
  );
  benchmarkChecksum +=
    stats.nodesVisited + stats.rawRowsVisited + stats.summaryBucketsVisited + stats.queries;
}
const waveformIndex = new WaveformHistoryIndex(HIST_ROWS);
for (const row of rows) waveformIndex.append(row);
let waveformSourceReads = 0;
const waveformSource = {
  length: rows.length,
  rowAt(index) {
    waveformSourceReads += 1;
    return rows[index];
  },
};
for (const viewWidth of [600, 1200]) {
  reportTime(`waveform reference / 240m / ${viewWidth}px`, () =>
    sliceWaveformSubHistory(rows, HIST_ROWS, 0, 2, viewWidth)
  );
  waveformSourceReads = 0;
  reportTime(`waveform indexed / 240m / ${viewWidth}px`, () =>
    sliceWaveformSubHistoryFromIndex(waveformSource, waveformIndex, HIST_ROWS, 0, 2, viewWidth)
  );
  const stats = waveformIndex.batchQueryStats();
  const nodeBound = (viewWidth + 2) * (2 * Math.ceil(Math.log2(waveformIndex.capacity)) + 2);
  if (waveformSourceReads !== 0) {
    throw new Error(`waveform indexed ${viewWidth}px read ${waveformSourceReads} retained rows`);
  }
  if (stats.nodesVisited > nodeBound) {
    throw new Error(
      `waveform indexed ${viewWidth}px visited ${stats.nodesVisited} nodes (bound ${nodeBound})`
    );
  }
  console.log(
    `waveform indexed nodes / ${viewWidth}px: ${stats.nodesVisited} ` +
      `(raw index leaves=${stats.rawRowsVisited}, summaries=${stats.summaryBucketsVisited}, ` +
      `retained source reads=${waveformSourceReads})`
  );
  benchmarkChecksum +=
    stats.nodesVisited +
    stats.rawRowsVisited +
    stats.summaryBucketsVisited +
    stats.queries +
    waveformSourceReads;
}

const timestamps = visualTimestampView();
const targetTimestampMs = (VISUAL_ROWS - 2.5) * 40;
for (let index = 0; index < 3; index += 1) {
  benchmarkSink = nearestTimestampIndex(timestamps, targetTimestampMs);
}
const lookupIterations = 100;
const readsBefore = timestamps.reads();
const started = performance.now();
for (let index = 0; index < lookupIterations; index += 1) {
  benchmarkSink = nearestTimestampIndex(timestamps, targetTimestampMs);
}
const lookupMs = (performance.now() - started) / lookupIterations;
const readsPerLookup = (timestamps.reads() - readsBefore) / lookupIterations;
benchmarkChecksum += benchmarkSink;

const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(`nearest visual timestamp / 240m: ${lookupMs.toFixed(3)} ms`);
console.log(`nearest timestamp reads/lookup: ${readsPerLookup}`);
console.log(`projected Spectrum primary: ${mib(VISUAL_ROWS * SPECTRUM_BANDS * 4)} MiB`);
console.log(`projected Vectorscope pairs: ${mib(VISUAL_ROWS * VECTOR_VALUES * 4)} MiB`);
freezeVisualHistory();
console.log(`benchmark checksum: ${benchmarkChecksum}`);
