#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { harnessArgs, locateHarness, runCli } from "./capture-rig.mjs";
import { generateDialogueBenchmarkFixtures } from "./dialogue-benchmark-fixtures.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = join(ROOT, "artifacts/dialogue-benchmark");
const MODEL_PATH = join(ARTIFACT_ROOT, "models/silero-v6.2.onnx");
const RESULT_PATH = join(ARTIFACT_ROOT, "results.json");
const SUMMARY_PATH = join(ARTIFACT_ROOT, "summary.md");
const GENERATED_MANIFEST_PATH = join(ARTIFACT_ROOT, "corpus/manifest.resolved.json");
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
      loudnessToDialogueRatioAbsoluteErrors: [],
      coverageAbsoluteErrors: [],
      dialogueRangeAbsoluteErrors: [],
      boundaryErrors: [],
      readinessExcludedDurations: [],
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
    if (Number.isFinite(run.metrics.loudnessToDialogueRatioErrorLu)) {
      group.loudnessToDialogueRatioAbsoluteErrors.push(
        Math.abs(run.metrics.loudnessToDialogueRatioErrorLu)
      );
    }
    if (Number.isFinite(run.metrics.dialogueCoverageErrorPercentagePoints)) {
      group.coverageAbsoluteErrors.push(
        Math.abs(run.metrics.dialogueCoverageErrorPercentagePoints)
      );
    }
    if (Number.isFinite(run.metrics.dialogueRangeErrorLu)) {
      group.dialogueRangeAbsoluteErrors.push(Math.abs(run.metrics.dialogueRangeErrorLu));
    }
    if (Number.isFinite(run.meanBoundaryErrorMs)) {
      group.boundaryErrors.push(run.meanBoundaryErrorMs);
    }
    group.readinessExcludedDurations.push(run.readinessExcludedMs);
    group.realtimeFactors.push(run.realtimeFactor);
    groups.set(key, group);
  }
  const mean = (values) =>
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return [...groups.values()].map((group) => {
    const precision =
      group.truePositiveBlocks / (group.truePositiveBlocks + group.falsePositiveBlocks);
    const recall =
      group.truePositiveBlocks / (group.truePositiveBlocks + group.falseNegativeBlocks);
    return {
      engine: group.engine,
      fusion: group.fusion,
      precision,
      recall,
      f1: (2 * precision * recall) / (precision + recall),
      falsePositiveDurationMs: group.falsePositiveBlocks * report.blockDurationMs,
      falseNegativeDurationMs: group.falseNegativeBlocks * report.blockDurationMs,
      meanBoundaryErrorMs: mean(group.boundaryErrors),
      meanAbsoluteDialogueLoudnessErrorLu: mean(group.dialogueLoudnessAbsoluteErrors),
      meanAbsoluteLoudnessToDialogueRatioErrorLu: mean(group.loudnessToDialogueRatioAbsoluteErrors),
      meanAbsoluteCoverageErrorPercentagePoints: mean(group.coverageAbsoluteErrors),
      meanAbsoluteDialogueRangeErrorLu: mean(group.dialogueRangeAbsoluteErrors),
      meanReadinessExcludedMs: mean(group.readinessExcludedDurations),
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
    "| Engine | Fusion | F1 | Precision | Recall | FP ms | FN ms | Boundary ms | DL err | LDR err | Coverage err | Range err | Readiness ms | RTF |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.engine} | ${row.fusion} | ${row.f1.toFixed(3)} | ${row.precision.toFixed(3)} | ${row.recall.toFixed(3)} | ${row.falsePositiveDurationMs} | ${row.falseNegativeDurationMs} | ${row.meanBoundaryErrorMs?.toFixed(0) ?? "—"} | ${row.meanAbsoluteDialogueLoudnessErrorLu?.toFixed(2) ?? "—"} LU | ${row.meanAbsoluteLoudnessToDialogueRatioErrorLu?.toFixed(2) ?? "—"} LU | ${row.meanAbsoluteCoverageErrorPercentagePoints?.toFixed(1) ?? "—"} pp | ${row.meanAbsoluteDialogueRangeErrorLu?.toFixed(2) ?? "—"} LU | ${row.meanReadinessExcludedMs?.toFixed(0) ?? "—"} | ${row.meanRealtimeFactor.toFixed(3)} |`
    );
  }
  return `${lines.join("\n")}\n`;
}

export function parseDialogueBenchmarkArgs(args) {
  let manifestPath = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--manifest") {
      throw new Error(`Unknown dialogue benchmark option: ${args[index]}`);
    }
    manifestPath = resolve(args[index + 1] ?? "");
    if (!args[index + 1]) throw new Error("--manifest requires a path");
    index += 1;
  }
  return { manifestPath };
}

function isWithinRepository(path) {
  const pathFromRoot = relative(ROOT, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

export async function runDialogueBenchmark({ manifestPath = null } = {}) {
  let corpusId;
  if (manifestPath) {
    manifestPath = resolve(manifestPath);
    if (isWithinRepository(manifestPath)) {
      throw new Error("A local programme manifest must stay outside the repository.");
    }
    const localManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    corpusId = localManifest.corpusId;
  } else {
    const corpus = await generateDialogueBenchmarkFixtures();
    corpusId = corpus.corpusId;
    manifestPath = GENERATED_MANIFEST_PATH;
  }
  const modelPath = await ensureSileroV6Model();
  const harness = locateHarness();
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const result = runCli(
    harness,
    harnessArgs([
      "dialogue-benchmark",
      "--manifest",
      manifestPath,
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
    `${JSON.stringify({ corpusId, resultPath: RESULT_PATH, summaryPath: SUMMARY_PATH }, null, 2)}\n`
  );
  process.stdout.write(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runDialogueBenchmark(parseDialogueBenchmarkArgs(process.argv.slice(2)));
}
