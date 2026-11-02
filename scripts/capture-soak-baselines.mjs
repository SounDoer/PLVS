import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import {
  SIGNAL,
  SOAK_DRIFT_LIMIT_DB,
  SOAK_WARMUP_SECONDS,
  SOAK_MAX_WARMUP_SECONDS,
  SOAK_MAX_TO_INTEGRATED_DB,
  judgeSoak,
} from "./capture-rig.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINES = join(ROOT, "fixtures/capture-soak-baselines");
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const captureContract = () => ({
  revision: "continuous-stereo-tone-v1",
  signal: {
    sampleRateHz: SIGNAL.sampleRateHz,
    freqHz: SIGNAL.freqHz,
    peakLDb: SIGNAL.peakLDb,
    peakRDb: SIGNAL.peakRDb,
  },
  seconds: 14400,
  every: 10,
  warmupSeconds: SOAK_WARMUP_SECONDS,
  maximumWarmupSeconds: SOAK_MAX_WARMUP_SECONDS,
  driftLimitDb: SOAK_DRIFT_LIMIT_DB,
  maximumToIntegratedDb: SOAK_MAX_TO_INTEGRATED_DB,
});

export function analyzeSeries(text, contract = captureContract()) {
  if (
    contract.seconds !== 14400 ||
    contract.every !== 10 ||
    ![
      contract.warmupSeconds,
      contract.maximumWarmupSeconds,
      contract.driftLimitDb,
      contract.maximumToIntegratedDb,
    ].every((value) => Number.isFinite(value) && value > 0)
  ) {
    throw new Error("Invalid archived measurement contract.");
  }
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const samples = rows.filter((row) => typeof row.t === "number");
  const finals = rows.filter((row) => row.command === "capture");
  if (
    rows.length !== 1441 ||
    samples.length !== 1440 ||
    finals.length !== 1 ||
    rows.at(-1) !== finals[0]
  ) {
    throw new Error("A baseline requires exactly 1440 samples and one final capture report.");
  }
  const final = finals[0];
  if (
    samples.some((row, index) => row.t !== (index + 1) * 10 || row.droppedChunks !== 0) ||
    final.status !== "ok" ||
    final.source?.capturedMs !== 14400000 ||
    final.source?.sampleRateHz !== 48000 ||
    final.source?.channelCount !== 2 ||
    final.health?.droppedChunks !== 0
  ) {
    throw new Error("Incomplete, dropped, or incompatible four-hour capture.");
  }
  const metrics = ["integratedLufs", "lra", "mMaxLufs", "stMaxLufs", "truePeakMaxDbtp"];
  if (metrics.some((key) => !Number.isFinite(final.summary?.[key]))) {
    throw new Error("Final capture metrics must be finite.");
  }
  const judgment = judgeSoak(samples, contract);
  if (judgment.failures.length) throw new Error(judgment.failures.join("; "));
  return { samples: samples.length, spreads: judgment.spreads, final: final.summary };
}

export function loadBaselines(root = BASELINES) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.runs) || !manifest.runs.length) {
    throw new Error("Invalid baseline manifest.");
  }
  const seen = new Set();
  return manifest.runs.map((run) => {
    const provenance = `${run.platform}/${run.runId}/${run.runAttempt}`;
    if (
      !/^[a-z0-9/-]+\.jsonl\.gz$/.test(run.file) ||
      run.file.split("/").includes("..") ||
      !/^[0-9a-f]{40}$/.test(run.sourceSha) ||
      !["windows", "macos", "linux"].includes(run.platform) ||
      !run.runnerName ||
      !run.rigRevision ||
      !run.contract ||
      !/^\d+$/.test(run.runId) ||
      seen.has(run.file) ||
      seen.has(provenance) ||
      !/^\d+$/.test(run.runAttempt ?? "")
    ) {
      throw new Error("Invalid or duplicate baseline provenance.");
    }
    seen.add(run.file);
    seen.add(provenance);
    const compressed = readFileSync(join(root, run.file));
    const series = gunzipSync(compressed);
    if (sha256(compressed) !== run.sha256 || sha256(series) !== run.seriesSha256) {
      throw new Error(`Baseline checksum mismatch: ${run.file}`);
    }
    return { ...run, analysis: analyzeSeries(series.toString("utf8"), run.contract) };
  });
}

export function compareRun(identity, series, baselines) {
  const analysis = analyzeSeries(series);
  const matches = baselines.filter(
    (baseline) =>
      baseline.platform === identity.platform &&
      baseline.runnerName === identity.runnerName &&
      baseline.rigRevision === identity.rigRevision &&
      isDeepStrictEqual(baseline.contract, identity.contract) &&
      !(baseline.runId === identity.runId && baseline.runAttempt === identity.runAttempt)
  );
  const ranges = {};
  for (const [metric, current] of Object.entries(analysis.spreads)) {
    const values = matches.map((run) => run.analysis.spreads[metric]);
    if (values.length) {
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      // A larger spread is an investigation lead, not a new hard capture gate.
      ranges[metric] = { current, minimum, maximum, increased: current > maximum + 1e-12 };
    }
  }
  return {
    platform: identity.platform,
    runnerName: identity.runnerName,
    analysis,
    baselineCount: matches.length,
    status: !matches.length
      ? "no-comparable-baseline"
      : matches.length === 1
        ? "single-reference"
        : "historical-range",
    ranges,
    increasedMetrics: Object.keys(ranges).filter((metric) => ranges[metric].increased),
  };
}

export function renderReport(report) {
  const lines = [
    "### Capture Soak Baseline Comparison",
    "",
    `${report.platform} / ${report.runnerName}: ${report.status} (${report.baselineCount} reference runs).`,
    "",
    "Historical deviations are advisory; the existing capture verdict is unchanged.",
  ];
  if (report.baselineCount < 2)
    lines.push("Insufficient reference runs to establish a normal variation range.");
  lines.push(
    "",
    "| Metric | Current Spread | Reference Min | Reference Max | Larger Spread |",
    "| --- | ---: | ---: | ---: | --- |"
  );
  for (const [metric, range] of Object.entries(report.ranges)) {
    lines.push(
      `| ${metric} | ${range.current.toExponential(6)} | ${range.minimum.toExponential(6)} | ${range.maximum.toExponential(6)} | ${range.increased ? "Investigate" : "No"} |`
    );
  }
  return lines.join("\n") + "\n";
}

function main(args) {
  const [command, ...flags] = args;
  const option = (name, fallback) => {
    const i = flags.indexOf(name);
    return i < 0 ? fallback : flags[i + 1];
  };
  if (command === "verify") {
    console.log(`Verified ${loadBaselines().length} archived full-duration baselines.`);
  } else if (command === "record") {
    const env = process.env;
    if (
      !/^[0-9a-f]{40}$/.test(env.COMMIT_SHA ?? "") ||
      !["windows", "macos", "linux"].includes(env.PLATFORM) ||
      !env.RUNNER_NAME ||
      !env.GITHUB_RUN_ID
    ) {
      throw new Error("Missing trusted workflow run identity.");
    }
    writeFileSync(
      option("--out", "artifacts/soak/run.json"),
      JSON.stringify(
        {
          sourceSha: env.COMMIT_SHA,
          platform: env.PLATFORM,
          runnerName: env.RUNNER_NAME,
          rigRevision: env.CAPTURE_RIG_REVISION || "1",
          runId: env.GITHUB_RUN_ID,
          runAttempt: env.GITHUB_RUN_ATTEMPT,
          seconds: 14400,
          every: 10,
          startedAt: new Date().toISOString(),
          contract: captureContract(),
        },
        null,
        2
      ) + "\n"
    );
  } else if (command === "compare") {
    const dir = option("--run-dir", "artifacts/soak");
    const identity = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
    if (
      !identity.runnerName ||
      !identity.rigRevision ||
      !identity.contract ||
      identity.seconds !== 14400 ||
      identity.every !== 10
    ) {
      throw new Error("Missing comparable run metadata.");
    }
    const files = readdirSync(dir).filter((file) => /^soak-\d+\.jsonl$/.test(file));
    if (files.length !== 1)
      throw new Error("Expected exactly one soak series in the run directory.");
    const report = compareRun(identity, readFileSync(join(dir, files[0]), "utf8"), loadBaselines());
    writeFileSync(join(dir, "baseline-comparison.json"), JSON.stringify(report, null, 2) + "\n");
    const markdown = renderReport(report);
    writeFileSync(join(dir, "baseline-comparison.md"), markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(markdown);
    if (report.increasedMetrics.length)
      console.log(`::warning::Larger historical spreads: ${report.increasedMetrics.join(", ")}`);
  } else
    throw new Error(
      "Usage: node scripts/capture-soak-baselines.mjs verify|record|compare [--out <file>] [--run-dir <directory>]"
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
