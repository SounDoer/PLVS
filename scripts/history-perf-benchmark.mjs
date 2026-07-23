import { performance } from "node:perf_hooks";

import { nearestTimestampIndex } from "../src/lib/snapshotResolve.js";
import { buildHistoryPath } from "../src/math/historyMath.js";
import { sliceWaveformSubHistory } from "../src/math/waveformMath.js";

const HIST_ROWS = 144_000;
const VISUAL_ROWS = 360_000;
const SPECTRUM_BANDS = 958;
const VECTOR_VALUES = 200;
const VIEW_WIDTH = 600;
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
    typeof benchmarkSink === "string" ? benchmarkSink.length : benchmarkSink.bucketCount;
  return elapsed;
}

function reportTime(label, callback, iterations) {
  const elapsed = averageTime(callback, iterations);
  console.log(`${label}: ${elapsed.toFixed(3)} ms`);
}

const rows = mainRows();
reportTime("loudness M / 240m / 600px", () => {
  return buildHistoryPath(rows, "m", HIST_ROWS, 0, (value) => value, VIEW_WIDTH, VIEW_WIDTH);
});
reportTime("loudness ST / 240m / 600px", () => {
  return buildHistoryPath(rows, "st", HIST_ROWS, 0, (value) => value, VIEW_WIDTH, VIEW_WIDTH);
});
reportTime("waveform / 240m / 600px", () => {
  return sliceWaveformSubHistory(rows, HIST_ROWS, 0, 2, VIEW_WIDTH);
});

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
console.log(`benchmark checksum: ${benchmarkChecksum}`);
