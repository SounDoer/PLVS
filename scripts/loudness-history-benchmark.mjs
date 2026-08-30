/**
 * Times the Loudness panel's history path build, which a profile put second only to the
 * Spectrogram painter.
 *
 * The panel does not spend its update drawing: it spends it *querying*. A long window holds far
 * more rows than the chart has columns, so the builder asks the min/max index for one extremal
 * range per column -- six hundred queries for a six-hundred-pixel chart, every update. That is
 * structural, so it belongs in a benchmark rather than in a profile that cannot be compared
 * across runs.
 *
 *   node scripts/loudness-history-benchmark.mjs
 */
import { performance } from "node:perf_hooks";

import { LoudnessHistoryIndex } from "../src/math/loudnessHistoryIndex.js";
import { buildLoudnessHistoryPathsFromIndex } from "../src/math/historyMath.js";

const ROWS_PER_SEC = 25;
const VISUAL_TICK_MS = 1000 / ROWS_PER_SEC;

/** Four hours of loudness rows, varying enough that no column collapses to one constant. */
function seed(rowCount) {
  const rows = new Array(rowCount);
  const index = new LoudnessHistoryIndex(rowCount);
  for (let i = 0; i < rowCount; i += 1) {
    const t = i / ROWS_PER_SEC;
    const row = {
      m: -23 + Math.sin(t * 0.11) * 6 + Math.sin(t * 1.7) * 1.5,
      st: -23 + Math.sin(t * 0.07) * 4,
    };
    rows[i] = row;
    index.append(row);
  }
  return { rows, index };
}

function time(label, iterations, fn) {
  for (let i = 0; i < Math.min(20, iterations); i += 1) fn();
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  const perCallMs = (performance.now() - started) / iterations;
  console.log(
    `  ${label.padEnd(34)} ${perCallMs.toFixed(3)} ms/build` +
      `   ${((perCallMs / VISUAL_TICK_MS) * 100).toFixed(1)}% of a ${VISUAL_TICK_MS} ms tick`
  );
  return perCallMs;
}

const HOURS = 4;
const rowCount = HOURS * 3600 * ROWS_PER_SEC;
const { rows, index } = seed(rowCount);
const toY = (db) => (db + 60) * 4;

console.log(`Loudness history paths — ${rowCount.toLocaleString()} rows (${HOURS} h at 25/s)\n`);
let sink = 0;
for (const [label, visibleSamples, width] of [
  ["4 h window, 600 px", rowCount, 600],
  ["4 h window, 1200 px", rowCount, 1200],
  ["10 min window, 600 px", 10 * 60 * ROWS_PER_SEC, 600],
]) {
  time(label, 60, () => {
    const paths = buildLoudnessHistoryPathsFromIndex(rows, index, visibleSamples, 0, toY, width);
    sink += paths.m.length + paths.st.length;
  });
}
console.log(`\n(sink ${sink & 1})`);

// Where the traversal actually goes. A long window puts many rows behind one column, and the index
// answers most of that from summary buckets rather than raw rows -- which is why cutting
// per-raw-row work moves nothing measurable.
index.beginQueryBatch();
buildLoudnessHistoryPathsFromIndex(rows, index, rowCount, 0, toY, 600);
const stats = index.batchQueryStats();
console.log(
  `One 600 px build over 4 h: ${stats.queries} queries, ` +
    `${stats.summaryBucketsVisited.toLocaleString()} summary buckets, ` +
    `${stats.rawRowsVisited.toLocaleString()} raw rows ` +
    `(${((100 * stats.rawRowsVisited) / Math.max(1, stats.nodesVisited)).toFixed(1)}% raw)`
);
