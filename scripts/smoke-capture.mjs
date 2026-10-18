#!/usr/bin/env node
/**
 * Verifies the live-capture path against the file path.
 *
 * Ground truth comes from `analyze` on the same WAV rather than from hardcoded
 * constants: constants rot silently when the signal definition changes, and the
 * agreement between the two paths is the property actually worth asserting.
 *
 * Exit codes follow the CLI's contract, and the split matters: reading a rig
 * hiccup as a capture bug wastes a day, and reading a capture bug as a rig
 * hiccup ships the silent wrong number this check exists to prevent.
 *   0  live path agrees with the file path
 *   1  assertion failed — a real capture-layer defect
 *   2  rig unusable — not a code signal
 */
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  acceptanceRunId,
  hostPlatform,
  resolveEvidenceSourceSha,
  writeJsonAtomic,
} from "./acceptance-evidence.mjs";
import {
  ROOT,
  RigError,
  TOLERANCE_DB,
  compareMetrics,
  ensureLinuxDecoders,
  harnessArgs,
  locateHarness,
  resolveCaptureRoute,
  runCli,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
} from "./capture-rig.mjs";

const CAPTURE_SECONDS = 10;
const SETTLE_MS = 2000;
const wav = join(tmpdir(), `plvs-smoke-signal-${process.pid}.wav`);
const startedAt = new Date().toISOString();
const runId = acceptanceRunId();
let sourceSha = null;
let output = null;
let player = null;
let route = null;
let truth = null;
let live = null;
let comparison = null;
let failureMessage = null;
let releaseError = null;

function parseReport(label, { status, stdout, stderr }) {
  if (status === 2) {
    throw new RigError(`plvs-cli ${label} could not start: ${stderr.trim()}`);
  }
  // Strip a BOM before parsing. spawnSync reads the child's bytes directly so one
  // should not appear, but a PowerShell pipeline does prepend one and that failure
  // reads as "unparsable JSON" — a confusing way to learn about text encoding.
  const line = stdout.replace(/^﻿/, "").trim().split(/\r?\n/).pop();
  let report;
  try {
    report = JSON.parse(line);
  } catch {
    throw new RigError(`plvs-cli ${label} produced unparsable output: ${line}`);
  }
  // Exit 1 still carries a well-formed error report. For both commands the
  // reachable causes are environmental (device missing, sidecar absent), so this
  // is a rig signal rather than a capture-layer defect.
  if (report.status !== "ok") {
    throw new RigError(`plvs-cli ${label} reported an error: ${report.error?.message}`);
  }
  return report;
}

try {
  sourceSha = resolveEvidenceSourceSha(ROOT);
  if (process.platform === "linux") ensureLinuxDecoders();
  const outIndex = process.argv.indexOf("--out-dir");
  if (
    outIndex !== -1 &&
    (!process.argv[outIndex + 1] || process.argv[outIndex + 1].startsWith("--"))
  ) {
    throw new Error("--out-dir requires a directory");
  }
  output =
    outIndex === -1
      ? join(ROOT, "artifacts", "capture-smoke", sourceSha.slice(0, 8), runId)
      : resolve(process.argv[outIndex + 1]);
  const harness = locateHarness();
  route = resolveCaptureRoute(harness);

  await synthesizeSignal(wav);

  // Ground truth from the already-trusted file path.
  truth = parseReport("analyze", runCli(harness, harnessArgs(["analyze", wav, "--json"]))).summary;

  player = await startPlayer(route.playerTarget, wav, { wait: process.argv.includes("--wait") });
  // Let the loop reach the device before measuring.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  live = parseReport(
    "capture",
    runCli(
      harness,
      harnessArgs([
        "capture",
        "--device",
        route.captureDevice,
        "--seconds",
        String(CAPTURE_SECONDS),
        "--json",
      ])
    )
  );

  comparison = compareMetrics(truth, live.summary);

  console.log(`Rig         : ${route.label} (${route.platform})`);
  console.log(`Device      : ${live.source.deviceName}`);
  console.log(`Format      : ${live.source.sampleRateHz} Hz, ${live.source.channelCount} ch`);
  console.log(`Dropped     : ${live.health.droppedChunks}`);
  // Report exactly the fields compareMetrics judges, so the table cannot drift
  // away from the assertion it is supposed to explain.
  for (const field of Object.keys(TOLERANCE_DB)) {
    console.log(`${field.padEnd(12)}: file ${truth[field]}  live ${live.summary[field]}`);
  }

  if (live.health.droppedChunks > 0) {
    console.error(
      `\nFAIL ${live.health.droppedChunks} chunks dropped during a ${CAPTURE_SECONDS}s capture.`
    );
    process.exitCode = 1;
  } else if (!comparison.ok) {
    console.error("\nFAIL live capture disagrees with the file path:");
    for (const f of comparison.failures) {
      console.error(`  ${f.field}: expected ${f.expected}, got ${f.got} (${f.reason})`);
    }
    console.error("\nDo not widen the tolerance. This is what the check is for.");
    process.exitCode = 1;
  } else {
    console.log("\nOK live capture agrees with the file path.");
  }
} catch (err) {
  if (err instanceof RigError) {
    failureMessage = err.message;
    console.error(`\nRIG ${err.message}`);
    console.error("\nThis is a rig problem, not a code signal. Fix the rig, or stop and ask.");
    process.exitCode = 2;
  } else {
    failureMessage = err instanceof Error ? err.message : String(err);
    console.error(`\nTOOL ${failureMessage}`);
    process.exitCode = 2;
  }
} finally {
  stopPlayer(player);
  if (route?.release) {
    try {
      route.release();
    } catch (error) {
      releaseError = error instanceof Error ? error.message : String(error);
      if ((process.exitCode ?? 0) === 0) process.exitCode = 2;
    }
  }
  // Teardown must not rewrite the verdict: VLC's exit is asynchronous, so the
  // WAV can still be locked here, and letting that reject would surface as a
  // capture-layer failure that never happened.
  await rm(wav, { force: true }).catch((err) => {
    console.error(`Warning: could not remove ${wav}: ${err.message}`);
  });
}

if (sourceSha && output) {
  const exitCode = process.exitCode ?? 0;
  const scenarios = [
    {
      id: "rig-route",
      status: route ? "passed" : "rigUnavailable",
      ...(route ? { observation: `${route.label} (${route.platform})` } : {}),
    },
    {
      id: "live-file-agreement",
      status: !live ? "notRun" : comparison?.ok ? "passed" : "failed",
    },
    {
      id: "zero-dropped-chunks",
      status: !live ? "notRun" : live.health.droppedChunks === 0 ? "passed" : "failed",
      ...(live ? { observation: { droppedChunks: live.health.droppedChunks } } : {}),
    },
  ];
  const evidence = {
    schemaVersion: 1,
    domain: "capture",
    runId,
    sourceSha,
    platform: hostPlatform(),
    tool: { name: "capture-smoke", version: 1 },
    startedAt,
    endedAt: new Date().toISOString(),
    summary: exitCode === 0 ? "complete" : exitCode === 1 ? "failed" : "incomplete",
    scenarios,
    artifacts: [],
    cleanup: {
      status: releaseError ? "failed" : "passed",
      observations: [
        route?.platform === "linux"
          ? "The looping paplay process was stopped, the private null sink was removed, and the temporary signal was removed."
          : "The spawned VLC process was stopped and the temporary signal was removed.",
      ],
    },
    warnings: [failureMessage, releaseError].filter(Boolean),
    details: {
      route,
      source: live?.source ?? null,
      health: live?.health ?? null,
      truth,
      live: live?.summary ?? null,
      comparison,
    },
  };
  const evidencePath = join(output, "result.json");
  try {
    await writeJsonAtomic(evidencePath, evidence);
    console.log(`Evidence    : ${evidencePath}`);
  } catch (error) {
    console.error(`Could not write capture evidence: ${error.message}`);
    process.exitCode = 2;
  }
}
