#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { harnessArgs, locateHarness, runCli } from "./capture-rig.mjs";
import { generateDialogueBenchmarkFixtures } from "./dialogue-benchmark-fixtures.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = join(ROOT, "artifacts/dialogue-benchmark");
const MODEL_PATH = join(ARTIFACT_ROOT, "models/silero-v6.2.onnx");
const RESULT_PATH = join(ARTIFACT_ROOT, "results.json");
const SUMMARY_PATH = join(ARTIFACT_ROOT, "summary.md");
const SILERO_V6_URL =
  "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2/src/silero_vad/data/silero_vad.onnx";
const SILERO_V6_SHA256 = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function ensureSileroV6Model({ path = MODEL_PATH, fetchImpl = fetch } = {}) {
  let existing = null;
  try {
    existing = await readFile(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing && sha256(existing) === SILERO_V6_SHA256) return path;
  const response = await fetchImpl(SILERO_V6_URL);
  if (!response.ok) throw new Error(`Unable to download Silero v6.2: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== SILERO_V6_SHA256) {
    throw new Error(`Silero v6.2 hash ${actual} does not match ${SILERO_V6_SHA256}.`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return path;
}

export function aggregateDialogueBenchmark(report) {
  const groups = new Map();
  for (const run of report.runs) {
    const key = `${run.engine}\0${run.fusion}`;
    const group = groups.get(key) ?? {
      engine: run.engine,
      fusion: run.fusion,
      truePositiveBlocks: 0,
      falsePositiveBlocks: 0,
      falseNegativeBlocks: 0,
      trueNegativeBlocks: 0,
      dialogueLoudnessAbsoluteErrors: [],
      coverageAbsoluteErrors: [],
      realtimeFactors: [],
    };
    for (const field of [
      "truePositiveBlocks",
      "falsePositiveBlocks",
      "falseNegativeBlocks",
      "trueNegativeBlocks",
    ]) {
      group[field] += run.confusion[field];
    }
    if (Number.isFinite(run.metrics.dialogueLoudnessErrorLu)) {
      group.dialogueLoudnessAbsoluteErrors.push(Math.abs(run.metrics.dialogueLoudnessErrorLu));
    }
    if (Number.isFinite(run.metrics.dialogueCoverageErrorPercentagePoints)) {
      group.coverageAbsoluteErrors.push(
        Math.abs(run.metrics.dialogueCoverageErrorPercentagePoints)
      );
    }
    group.realtimeFactors.push(run.realtimeFactor);
    groups.set(key, group);
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return [...groups.values()].map((group) => {
    const precision =
      group.truePositiveBlocks / (group.truePositiveBlocks + group.falsePositiveBlocks);
    const recall = group.truePositiveBlocks / (group.truePositiveBlocks + group.falseNegativeBlocks);
    return {
      engine: group.engine,
      fusion: group.fusion,
      precision,
      recall,
      f1: (2 * precision * recall) / (precision + recall),
      falsePositiveDurationMs: group.falsePositiveBlocks * report.blockDurationMs,
      falseNegativeDurationMs: group.falseNegativeBlocks * report.blockDurationMs,
      meanAbsoluteDialogueLoudnessErrorLu: mean(group.dialogueLoudnessAbsoluteErrors),
      meanAbsoluteCoverageErrorPercentagePoints: mean(group.coverageAbsoluteErrors),
      meanRealtimeFactor: mean(group.realtimeFactors),
    };
  });
}

export function renderDialogueBenchmarkSummary(report) {
  const rows = aggregateDialogueBenchmark(report).sort(
    (left, right) => right.f1 - left.f1 || left.engine.localeCompare(right.engine)
  );
  const lines = [
    "# Dialogue benchmark summary",
    "",
    `Corpus: \`${report.corpusId}\`  `,
    `Manifest SHA-256: \`${report.corpusManifestSha256}\`  `,
    `Block duration: ${report.blockDurationMs} ms`,
    "",
    "| Engine | Fusion | F1 | Precision | Recall | FP ms | FN ms | Mean abs DL error | Mean abs Coverage error | RTF |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.engine} | ${row.fusion} | ${row.f1.toFixed(3)} | ${row.precision.toFixed(3)} | ${row.recall.toFixed(3)} | ${row.falsePositiveDurationMs} | ${row.falseNegativeDurationMs} | ${row.meanAbsoluteDialogueLoudnessErrorLu.toFixed(2)} LU | ${row.meanAbsoluteCoverageErrorPercentagePoints.toFixed(1)} pp | ${row.meanRealtimeFactor.toFixed(3)} |`
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function runDialogueBenchmark() {
  const corpus = await generateDialogueBenchmarkFixtures();
  const modelPath = await ensureSileroV6Model();
  const harness = locateHarness();
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const result = runCli(
    harness,
    harnessArgs([
      "dialogue-benchmark",
      "--manifest",
      join(ARTIFACT_ROOT, "corpus/manifest.resolved.json"),
      "--silero-v6-model",
      modelPath,
      "--out",
      RESULT_PATH,
    ])
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Dialogue benchmark exited ${result.status}.`);
  }
  const report = JSON.parse(await readFile(RESULT_PATH, "utf8"));
  const summary = renderDialogueBenchmarkSummary(report);
  await writeFile(SUMMARY_PATH, summary);
  process.stdout.write(
    `${JSON.stringify({ corpusId: corpus.corpusId, resultPath: RESULT_PATH, summaryPath: SUMMARY_PATH }, null, 2)}\n`
  );
  process.stdout.write(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runDialogueBenchmark();
}
