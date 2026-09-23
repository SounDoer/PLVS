#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CAPTURE_DEVICE,
  RigError,
  compareMetrics,
  harnessArgs,
  locateHarness,
  resolveRenderEndpointId,
  runCli,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
} from "./capture-rig.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTLE_MS = 2000;

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line.replace(/^﻿/, ""))];
      } catch {
        return [];
      }
    });
}

function finalReport(text) {
  const lines = parseJsonLines(text);
  return (
    [...lines].reverse().find((entry) => entry?.command === "capture") ??
    [...lines].reverse().find((entry) => entry?.summary && entry?.health) ??
    null
  );
}

export function judgeConcurrentCaptures(truth, reports) {
  const failures = [];
  reports.forEach((report, index) => {
    const label = `instance ${index + 1}`;
    if (!report) {
      failures.push(`${label} did not produce a final report`);
      return;
    }
    if (report.status !== "ok") {
      failures.push(`${label} failed: ${report.error?.message || "unknown capture error"}`);
      return;
    }
    const dropped = report.health?.droppedChunks;
    if (dropped !== 0) failures.push(`${label} dropped ${dropped ?? "unknown"} chunks`);
    const comparison = compareMetrics(truth, report.summary || {});
    for (const failure of comparison.failures) {
      failures.push(
        `${label} ${failure.field}: expected ${failure.expected}, got ${failure.got} (${failure.reason})`
      );
    }
  });
  return { ok: failures.length === 0, failures };
}

export function judgeSoakSamples(series, { warmupSeconds = 60, driftLimitDb = 0.01 } = {}) {
  const failures = [];
  series.forEach((samples, index) => {
    const label = `instance ${index + 1}`;
    const timed = samples.filter((sample) => typeof sample.t === "number");
    const settled = timed.filter(
      (sample) => sample.t >= warmupSeconds && Number.isFinite(sample.integratedLufs)
    );
    if (settled.length < 2) {
      failures.push(`${label} has too few settled samples after ${warmupSeconds}s warmup`);
      return;
    }
    const values = settled.map((sample) => sample.integratedLufs);
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > driftLimitDb) {
      failures.push(`${label} drifted ${spread.toFixed(4)} dB`);
    }
    const dropped = timed.at(-1)?.droppedChunks;
    if (dropped !== 0) failures.push(`${label} ended with ${dropped ?? "unknown"} dropped chunks`);
  });
  return { ok: failures.length === 0, failures };
}

function parsePositive(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new RigError(`--${name} must be positive.`);
  return value;
}

function readRssMb(pid) {
  const command =
    process.platform === "win32"
      ? [
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`,
          ],
        ]
      : ["ps", ["-o", "rss=", "-p", String(pid)]];
  const result = spawnSync(command[0], command[1], { encoding: "utf8" });
  const value = Number(result.stdout?.trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return process.platform === "win32" ? value / 1024 / 1024 : value / 1024;
}

function runChild(harness, args, resourceEverySeconds = null) {
  return new Promise((resolve) => {
    const child = spawn(harness, harnessArgs(args), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const resources = [];
    const resourceTimer = resourceEverySeconds
      ? setInterval(() => {
          const rssMb = readRssMb(child.pid);
          if (rssMb !== null) resources.push({ tMs: Date.now(), rssMb });
        }, resourceEverySeconds * 1000)
      : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (status) => {
      if (resourceTimer) clearInterval(resourceTimer);
      resolve({ status, stdout, stderr, resources });
    });
  });
}

function parseTruth(result) {
  const report = finalReport(result.stdout) ?? parseJsonLines(result.stdout).at(-1);
  if (result.status !== 0 || report?.status !== "ok" || !report.summary) {
    throw new RigError(`Ground-truth analysis failed: ${result.stderr.trim() || "no report"}`);
  }
  return report.summary;
}

export async function runConcurrentCapture({ count = 2, seconds = 15, every = null } = {}) {
  const harness = locateHarness();
  const endpoint = resolveRenderEndpointId();
  const wav = join(tmpdir(), `plvs-multi-capture-${process.pid}.wav`);
  let player = null;
  try {
    await synthesizeSignal(wav);
    const truth = parseTruth(runCli(harness, harnessArgs(["analyze", wav, "--json"])));
    player = startPlayer(endpoint, wav);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const args = ["capture", "--device", CAPTURE_DEVICE, "--seconds", String(seconds), "--json"];
    if (every !== null) args.push("--every", String(every));
    const children = await Promise.all(
      Array.from({ length: count }, () => runChild(harness, args, every))
    );
    const reports = children.map((child) => finalReport(child.stdout));
    const result = judgeConcurrentCaptures(truth, reports);

    if (every !== null) {
      const soak = judgeSoakSamples(children.map((child) => parseJsonLines(child.stdout)));
      result.ok &&= soak.ok;
      result.failures.push(...soak.failures);
    }

    let artifactDirectory = null;
    if (every !== null) {
      artifactDirectory = join(ROOT, "artifacts", "soak", `multi-soak-${Date.now()}`);
      mkdirSync(artifactDirectory, { recursive: true });
      children.forEach((child, index) => {
        writeFileSync(join(artifactDirectory, `instance-${index + 1}.jsonl`), child.stdout);
      });
    }

    for (const [index, child] of children.entries()) {
      if (child.status !== 0) {
        result.ok = false;
        result.failures.push(
          `instance ${index + 1} exited ${child.status}: ${child.stderr.trim() || "no error output"}`
        );
      }
    }
    if (artifactDirectory) {
      writeFileSync(
        join(artifactDirectory, "summary.json"),
        `${JSON.stringify(
          {
            count,
            seconds,
            every,
            result,
            reports,
            resources: children.map((child) => child.resources),
          },
          null,
          2
        )}\n`
      );
    }
    return { ...result, reports, artifactDirectory };
  } finally {
    stopPlayer(player);
    await rm(wav, { force: true }).catch(() => {});
  }
}

async function main() {
  try {
    const count = parsePositive("instances", 2);
    const seconds = parsePositive("seconds", 15);
    const every = process.argv.includes("--every") ? parsePositive("every", 10) : null;
    console.log(`Capturing ${CAPTURE_DEVICE} in ${count} independent processes for ${seconds}s.`);
    const result = await runConcurrentCapture({ count, seconds, every });
    result.reports.forEach((report, index) => {
      console.log(
        `Instance ${index + 1}: ${report?.summary?.integratedLufs ?? "null"} LUFS, ` +
          `${report?.health?.droppedChunks ?? "unknown"} dropped chunks`
      );
    });
    if (result.artifactDirectory) console.log(`Artifacts: ${result.artifactDirectory}`);
    if (!result.ok) {
      result.failures.forEach((failure) => console.error(`FAIL ${failure}`));
      process.exitCode = 1;
    } else {
      console.log("OK concurrent captures agree with the file path.");
    }
  } catch (error) {
    console.error(`${error instanceof RigError ? "RIG" : "ERROR"} ${error.message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
