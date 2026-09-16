#!/usr/bin/env node
/**
 * Windows process-loopback isolation spike.
 *
 * The same known signal is measured once on its own and once while a second
 * process renders an identical copy. A system mix would rise by roughly 6 dB;
 * a process-isolated stream must stay at the baseline.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ROOT,
  RigError,
  resolveRenderEndpointId,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
} from "./capture-rig.mjs";

const CAPTURE_SECONDS = 5;
const SETTLE_MS = 2000;
const MAX_METRIC_DELTA_DB = 0.1;
const PROBE_PATH = join(
  ROOT,
  "src-tauri",
  "target",
  "debug",
  "examples",
  "process_loopback_probe.exe"
);
const METRICS = ["integratedLufs", "truePeakMaxDbtp", "samplePeakMaxLDb", "samplePeakMaxRDb"];

function buildProbe() {
  const result = spawnSync(
    "cargo",
    ["build", "--manifest-path", "src-tauri/Cargo.toml", "--example", "process_loopback_probe"],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0 || !existsSync(PROBE_PATH)) {
    throw new RigError(
      `Could not build process-loopback probe:\n${result.stderr?.trim() || "unknown error"}`
    );
  }
}

function runProbe(processId) {
  const result = spawnSync(PROBE_PATH, [String(processId), String(CAPTURE_SECONDS), "--json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new RigError(
      `Process-loopback probe failed for PID ${processId}:\n${result.stderr?.trim()}`
    );
  }
  const line = result.stdout.trim().split(/\r?\n/).pop();
  try {
    return JSON.parse(line);
  } catch {
    throw new RigError(`Process-loopback probe returned invalid JSON: ${line}`);
  }
}

function assertPlayerAlive(label, player) {
  if (player.exitCode !== null || player.signalCode !== null) {
    throw new RigError(`${label} VLC process exited before capture started.`);
  }
}

async function measure(endpoint, wav, withInterference) {
  let target = null;
  let interference = null;
  try {
    target = startPlayer(endpoint, wav);
    if (withInterference) interference = startPlayer(endpoint, wav);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assertPlayerAlive("Target", target);
    if (interference) assertPlayerAlive("Interference", interference);
    return runProbe(target.pid);
  } finally {
    stopPlayer(target);
    stopPlayer(interference);
  }
}

const wav = join(tmpdir(), `plvs-process-loopback-${process.pid}.wav`);

try {
  buildProbe();
  const endpoint = resolveRenderEndpointId();
  await synthesizeSignal(wav);

  const baseline = await measure(endpoint, wav, false);
  const isolated = await measure(endpoint, wav, true);
  const failures = [];

  for (const field of METRICS) {
    const expected = baseline[field];
    const actual = isolated[field];
    const delta = Math.abs(actual - expected);
    console.log(
      `${field.padEnd(20)} baseline ${expected.toFixed(3)}  interfered ${actual.toFixed(3)}  delta ${delta.toFixed(3)} dB`
    );
    if (!Number.isFinite(expected) || !Number.isFinite(actual) || delta > MAX_METRIC_DELTA_DB) {
      failures.push({ field, expected, actual, delta });
    }
  }

  if (baseline.silentFrames > 0 || isolated.silentFrames > 0) {
    failures.push({
      field: "silentFrames",
      expected: baseline.silentFrames,
      actual: isolated.silentFrames,
    });
  }

  if (failures.length > 0) {
    console.error("\nFAIL unrelated-process audio changed the target-process reading:");
    for (const failure of failures) console.error(`  ${JSON.stringify(failure)}`);
    process.exitCode = 1;
  } else {
    console.log("\nOK unrelated-process audio was excluded from every checked meter reading.");
  }
} catch (error) {
  if (error instanceof RigError) {
    console.error(`\nRIG ${error.message}`);
    process.exitCode = 2;
  } else {
    console.error(error);
    process.exitCode = 2;
  }
} finally {
  await rm(wav, { force: true }).catch(() => {});
}
