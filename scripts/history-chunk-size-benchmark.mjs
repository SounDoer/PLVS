import os from "node:os";
import { performance } from "node:perf_hooks";

const CANDIDATES = [256, 512, 1024];
const SPECTRUM_BANDS = 958;
const VECTORSCOPE_VALUES = 200;
const WARMUP_ITERATIONS = 30;
const RECORDED_ITERATIONS = 120;
const MAX_DUAL_SPECTRUM_BYTES = 8 * 1024 * 1024;
const MAX_P95_MS = 8;

let benchmarkSink;
let benchmarkChecksum = 0;

function percentile(sortedSamples, percentileValue) {
  const index = Math.ceil((percentileValue / 100) * sortedSamples.length) - 1;
  return sortedSamples[Math.max(0, index)];
}

function measure(copyTail) {
  for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration += 1) {
    benchmarkSink = copyTail();
  }

  const samples = [];
  for (let iteration = 0; iteration < RECORDED_ITERATIONS; iteration += 1) {
    const started = performance.now();
    benchmarkSink = copyTail();
    samples.push(performance.now() - started);
  }

  benchmarkChecksum += benchmarkSink.checksum();
  samples.sort((left, right) => left - right);
  return {
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
  };
}

function spectrumSource(rows, includeSecondary) {
  const timestamps = new Float64Array(rows);
  const primary = new Float32Array(rows * SPECTRUM_BANDS);
  const secondary = includeSecondary ? new Float32Array(primary.length) : null;
  const hasB = includeSecondary ? new Uint8Array(rows) : null;

  timestamps[timestamps.length - 1] = rows;
  primary[primary.length - 1] = 1;
  if (secondary) secondary[secondary.length - 1] = 2;
  if (hasB) hasB[hasB.length - 1] = 1;
  return { timestamps, primary, secondary, hasB };
}

function copySpectrumTail(source) {
  const timestamps = new Float64Array(source.timestamps.length);
  const primary = new Float32Array(source.primary.length);
  const secondary = source.secondary ? new Float32Array(source.secondary.length) : null;
  const hasB = source.hasB ? new Uint8Array(source.hasB.length) : null;

  timestamps.set(source.timestamps);
  primary.set(source.primary);
  secondary?.set(source.secondary);
  hasB?.set(source.hasB);

  return {
    checksum: () =>
      timestamps[timestamps.length - 1] +
      primary[primary.length - 1] +
      (secondary?.[secondary.length - 1] ?? 0) +
      (hasB?.[hasB.length - 1] ?? 0),
  };
}

function vectorscopeSource(rows) {
  const values = new Float32Array(rows * VECTORSCOPE_VALUES);
  const timestamps = new Float64Array(rows);
  const correlation = new Float64Array(rows);
  const sideToMid = new Float64Array(rows);
  const midEnergy = new Float64Array(rows);
  const sideEnergy = new Float64Array(rows);

  values[values.length - 1] = 1;
  timestamps[timestamps.length - 1] = rows;
  correlation[correlation.length - 1] = 2;
  sideToMid[sideToMid.length - 1] = 3;
  midEnergy[midEnergy.length - 1] = 4;
  sideEnergy[sideEnergy.length - 1] = 5;
  return { values, timestamps, correlation, sideToMid, midEnergy, sideEnergy };
}

function copyVectorscopeTail(source) {
  const values = new Float32Array(source.values.length);
  const timestamps = new Float64Array(source.timestamps.length);
  const correlation = new Float64Array(source.correlation.length);
  const sideToMid = new Float64Array(source.sideToMid.length);
  const midEnergy = new Float64Array(source.midEnergy.length);
  const sideEnergy = new Float64Array(source.sideEnergy.length);

  values.set(source.values);
  timestamps.set(source.timestamps);
  correlation.set(source.correlation);
  sideToMid.set(source.sideToMid);
  midEnergy.set(source.midEnergy);
  sideEnergy.set(source.sideEnergy);

  return {
    checksum: () =>
      values[values.length - 1] +
      timestamps[timestamps.length - 1] +
      correlation[correlation.length - 1] +
      sideToMid[sideToMid.length - 1] +
      midEnergy[midEnergy.length - 1] +
      sideEnergy[sideEnergy.length - 1],
  };
}

function formatResult(candidate, workload, bytes, timing) {
  return {
    candidate,
    workload,
    bytes,
    MiB: (bytes / 1024 / 1024).toFixed(3),
    p50Ms: timing.p50Ms.toFixed(3),
    p95Ms: timing.p95Ms.toFixed(3),
  };
}

const results = [];
const dualResults = [];

for (const rows of CANDIDATES) {
  const primarySource = spectrumSource(rows, false);
  const dualSource = spectrumSource(rows, true);
  const vectorscope = vectorscopeSource(rows);

  results.push(
    formatResult(
      rows,
      "Spectrum primary",
      primarySource.timestamps.byteLength + primarySource.primary.byteLength,
      measure(() => copySpectrumTail(primarySource))
    )
  );

  const dualBytes =
    dualSource.timestamps.byteLength +
    dualSource.primary.byteLength +
    dualSource.secondary.byteLength +
    dualSource.hasB.byteLength;
  const dualTiming = measure(() => copySpectrumTail(dualSource));
  dualResults.push({ rows, bytes: dualBytes, ...dualTiming });
  results.push(formatResult(rows, "Spectrum dual", dualBytes, dualTiming));

  const vectorscopeBytes = Object.values(vectorscope).reduce(
    (total, column) => total + column.byteLength,
    0
  );
  results.push(
    formatResult(
      rows,
      "Vectorscope",
      vectorscopeBytes,
      measure(() => copyVectorscopeTail(vectorscope))
    )
  );
}

const chosen =
  dualResults
    .filter((result) => result.bytes <= MAX_DUAL_SPECTRUM_BYTES && result.p95Ms < MAX_P95_MS)
    .at(-1)?.rows ?? null;

console.log(`Machine: ${os.hostname()} / ${os.cpus()[0]?.model ?? "unknown CPU"}`);
console.log(`Platform: ${os.platform()} ${os.release()} ${os.arch()}`);
console.log(`Node: ${process.version}`);
console.log(
  `Iterations: ${WARMUP_ITERATIONS} warmup + ${RECORDED_ITERATIONS} recorded per workload`
);
console.table(results);
console.log(
  `Criteria: dual Spectrum <= ${MAX_DUAL_SPECTRUM_BYTES} bytes and p95 allocation+copy < ${MAX_P95_MS} ms`
);
console.log(`Chosen: ${chosen ?? "none"}`);
console.log(`Benchmark checksum: ${benchmarkChecksum}`);

if (chosen === null) process.exitCode = 1;
