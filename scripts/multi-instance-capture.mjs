#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RigError,
  SIGNAL,
  compareMetrics,
  harnessArgs,
  locateHarness,
  resolveCaptureRoute,
  resolveRenderEndpointId,
  runCli,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
  withCaptureRig,
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
  const index = process.argv.lastIndexOf(`--${name}`);
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

function runChild(executable, args, resourceEverySeconds = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
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
    child.once("error", reject);
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

export async function runConcurrentCapture({
  count = 2,
  seconds = 15,
  every = null,
  wait = false,
} = {}) {
  const harness = locateHarness();
  const route = resolveCaptureRoute(harness);
  const wav = join(tmpdir(), `plvs-multi-capture-${process.pid}.wav`);
  let player = null;
  try {
    await synthesizeSignal(wav);
    const truth = parseTruth(runCli(harness, harnessArgs(["analyze", wav, "--json"])));
    player = await startPlayer(route.playerTarget, wav, { wait });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const args = [
      "capture",
      "--device",
      route.captureDevice,
      "--seconds",
      String(seconds),
      "--json",
    ];
    if (every !== null) args.push("--every", String(every));
    const children = await Promise.all(
      Array.from({ length: count }, () => runChild(harness, harnessArgs(args), every))
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
    return { ...result, reports, artifactDirectory, route };
  } finally {
    stopPlayer(player);
    await rm(wav, { force: true }).catch(() => {});
  }
}

async function main() {
  try {
    const probeIndex = process.argv.indexOf("--process-timing-probe");
    if (probeIndex !== -1) {
      await runProcessTimingProbe(probeIndex);
      return;
    }
    const count = parsePositive("instances", 2);
    const seconds = parsePositive("seconds", 15);
    const every = process.argv.includes("--every") ? parsePositive("every", 10) : null;
    const wait = process.argv.includes("--wait");
    const result = await runConcurrentCapture({ count, seconds, every, wait });
    console.log(
      `Captured ${result.route.label} (${result.route.platform}) in ${count} independent processes for ${seconds}s.`
    );
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

async function runProcessTimingProbe(index) {
  if (process.platform !== "win32") throw new RigError("Process timing requires Windows.");
  const executable = process.argv[index + 1];
  if (!executable || executable.startsWith("--") || !existsSync(resolve(executable))) {
    throw new RigError("Pass the built process_loopback_probe.exe after --process-timing-probe.");
  }
  const seconds = parsePositive("seconds", 15);
  if (!Number.isSafeInteger(seconds)) throw new RigError("--seconds must be an integer.");
  const measureMix = process.argv.includes("--measure-mix");
  if (measureMix && seconds > 60) throw new RigError("Mix measurement accepts up to 60 seconds.");
  const measurePhase = process.argv.includes("--measure-mix-phase");
  const measureInput = process.argv.includes("--measure-mix-input");
  const restartMember = process.argv.includes("--restart-mix-member");
  const dropMember = restartMember || process.argv.includes("--drop-mix-member");
  if (measureInput && (!measureMix || measurePhase || dropMember || seconds < 4)) {
    throw new RigError(
      "--measure-mix-input requires --measure-mix for at least 4 seconds on its own."
    );
  }
  if (measurePhase && (!measureMix || dropMember || seconds < 4)) {
    throw new RigError(
      "--measure-mix-phase requires --measure-mix for at least 4 seconds without a member exit."
    );
  }
  if (restartMember && (!measureMix || seconds < 12)) {
    throw new RigError("--restart-mix-member requires --measure-mix for at least 12 seconds.");
  }
  if (dropMember && (!measureMix || seconds < 8)) {
    throw new RigError("--drop-mix-member requires --measure-mix for at least 8 seconds.");
  }
  const wav = join(tmpdir(), `plvs-process-timing-${process.pid}.wav`);
  const secondWav = measureMix ? join(tmpdir(), `plvs-process-mix-right-${process.pid}.wav`) : wav;
  const returnPeak = -12;
  const phasePeak = -4;
  const returnWav = restartMember
    ? join(tmpdir(), `plvs-process-mix-return-${process.pid}.wav`)
    : null;
  const reportPath = await withCaptureRig(
    async () => {
      const players = [];
      try {
        const endpoint = resolveRenderEndpointId();
        await synthesizeSignal(wav, {
          seconds: seconds + 15,
          ...(measureMix ? { peakRDb: -Infinity } : {}),
          ...(measurePhase ? { peakLDb: phasePeak } : {}),
        });
        if (measureMix)
          await synthesizeSignal(secondWav, {
            seconds: dropMember
              ? SETTLE_MS / 1000 + seconds / (restartMember ? 3 : 2)
              : seconds + 15,
            peakLDb: -Infinity,
            ...(measureInput ? { freqHz: SIGNAL.freqHz + 1 } : {}),
            ...(measurePhase
              ? { peakLDb: phasePeak, peakRDb: -Infinity, freqHz: SIGNAL.freqHz + 1 }
              : {}),
          });
        if (returnWav) {
          await synthesizeSignal(returnWav, {
            seconds: seconds + 15,
            peakLDb: -Infinity,
            peakRDb: returnPeak,
          });
        }
        for (const file of [wav, secondWav]) {
          const child = await startPlayer(endpoint, file, {
            independent: true,
            loop: !dropMember || file === wav,
          });
          players.push(child);
          if (child.pid === undefined) await once(child, "spawn");
        }
        await new Promise((settled) => setTimeout(settled, SETTLE_MS));
        if (players.some((player) => player.exitCode !== null)) {
          throw new RigError("A test player exited before capture began.");
        }
        const [first, second] = players.map((player) => String(player.pid));
        const args = [
          first,
          String(seconds),
          ...(measureInput
            ? ["--mix-input", "CABLE Output"]
            : ["--with-pid", second, ...(measureMix ? ["--mix"] : [])]),
          ...(restartMember ? ["--restart-parent-pid", String(process.pid)] : []),
        ];
        const [probe, replacementPid] = restartMember
          ? await runRestartProbe(resolve(executable), args, async () => {
              const original = players[1];
              if (original.exitCode === null && original.signalCode === null) {
                await once(original, "exit", { signal: AbortSignal.timeout(seconds * 1000) });
              }
              await new Promise((settled) => setTimeout(settled, 1500));
              const child = await startPlayer(endpoint, returnWav, { independent: true });
              players.push(child);
              if (child.pid === undefined) await once(child, "spawn");
              return child.pid;
            })
          : [runCli(resolve(executable), args), null];
        const report = parseJsonLines(probe.stdout).at(-1);
        if (probe.status !== 0 || report?.streams?.length !== (measureInput ? 1 : 2)) {
          throw new RigError(`Process timing probe failed: ${probe.stderr.trim() || "no report"}`);
        }
        const directory = join(ROOT, "artifacts", "capture", `process-timing-${Date.now()}`);
        mkdirSync(directory, { recursive: true });
        const path = join(directory, "report.json");
        writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
        if (report.streams.some((stream) => !Number.isFinite(stream.integratedLufs))) {
          throw new RigError(`A process capture was silent. Report: ${path}`);
        }
        if (measureInput) {
          const [application] = report.streams;
          const mixed = report.mix?.Ok;
          const monoPeak = SIGNAL.peakRDb - 20 * Math.log10(Math.SQRT2);
          const leftPeak = 20 * Math.log10(10 ** (SIGNAL.peakLDb / 20) + 10 ** (monoPeak / 20));
          if (
            !mixed ||
            mixed.droppedPackets !== 0 ||
            mixed.comparedFrames < (seconds - 1) * SIGNAL.sampleRateHz ||
            mixed.partialFrames + mixed.emptyFrames > SIGNAL.sampleRateHz ||
            application.samplePeakMaxRDb !== null ||
            !Number.isFinite(mixed.samplePeakMaxRDb) ||
            Math.abs(mixed.samplePeakMaxRDb - monoPeak) > 0.2 ||
            !Number.isFinite(mixed.samplePeakMaxLDb) ||
            Math.abs(mixed.samplePeakMaxLDb - leftPeak) > 0.2
          ) {
            throw new Error(
              `The app and input mix did not match the test signals. Report: ${path}`
            );
          }
          return path;
        }
        if (measureMix) {
          const [left, right] = report.streams;
          const mixed = report.mix?.Ok;
          if (!mixed)
            throw new RigError(`Mix could not be measured: ${report.mix?.Err}. Report: ${path}`);
          if (
            left.samplePeakMaxRDb !== null ||
            (measurePhase ? right.samplePeakMaxRDb : right.samplePeakMaxLDb) !== null
          ) {
            throw new RigError(
              `The process captures did not isolate the two test signals. Report: ${path}`
            );
          }
          if (mixed.droppedPackets !== 0 || mixed.emptyFrames >= SIGNAL.sampleRateHz) {
            throw new Error(`Mix lost capture data. Report: ${path}`);
          }
          if (
            mixed.comparedFrames < SIGNAL.sampleRateHz ||
            (dropMember && mixed.partialFrames < SIGNAL.sampleRateHz) ||
            (!dropMember && mixed.partialFrames >= SIGNAL.sampleRateHz)
          ) {
            throw new Error(`Mix coverage did not match the test scenario. Report: ${path}`);
          }
          if (measurePhase) {
            // The 1 Hz beat sweeps both phase extremes regardless of when each player starts.
            const expectedFullPeak = phasePeak + 20 * Math.log10(2);
            if (
              !Number.isFinite(left.samplePeakMaxLDb) ||
              !Number.isFinite(right.samplePeakMaxLDb) ||
              Math.abs(left.samplePeakMaxLDb - phasePeak) > 0.2 ||
              Math.abs(right.samplePeakMaxLDb - phasePeak) > 0.2 ||
              !Number.isFinite(mixed.samplePeakMaxLDb) ||
              Math.abs(mixed.samplePeakMaxLDb - expectedFullPeak) > 0.2 ||
              !Number.isFinite(mixed.truePeakMaxDbtp) ||
              Math.abs(mixed.truePeakMaxDbtp - expectedFullPeak) > 0.2 ||
              !Number.isFinite(mixed.minFullWindowPeakLDb) ||
              mixed.minFullWindowPeakLDb > phasePeak - 25
            ) {
              throw new Error(
                `Mix beat missed its addition or cancellation target. Report: ${path}`
              );
            }
            return path;
          }
          const rightCoverage = dropMember
            ? mixed.comparedFrames / (mixed.comparedFrames + mixed.partialFrames)
            : 1;
          const replacement = report.replacement;
          if (
            restartMember &&
            (replacement?.processId !== replacementPid ||
              replacement.samplePeakMaxLDb !== null ||
              !Number.isFinite(replacement.integratedLufs) ||
              replacement.capturedFrames < SIGNAL.sampleRateHz)
          ) {
            throw new Error(
              `The replacement process did not supply the expected signal. Report: ${path}`
            );
          }
          const replacementCoverage = restartMember
            ? Math.min(replacement.capturedFrames, mixed.comparedFrames) /
              (mixed.comparedFrames + mixed.partialFrames)
            : 0;
          const expected = {
            integratedLufs:
              10 *
              Math.log10(
                10 ** (left.integratedLufs / 10) +
                  (rightCoverage - replacementCoverage) * 10 ** (right.integratedLufs / 10) +
                  replacementCoverage * 10 ** ((replacement?.integratedLufs ?? 0) / 10)
              ),
            samplePeakMaxLDb: SIGNAL.peakLDb,
            samplePeakMaxRDb: restartMember ? returnPeak : SIGNAL.peakRDb,
          };
          const comparison = compareMetrics(expected, mixed);
          if (!comparison.ok)
            throw new Error(
              `Mix readings differ: ${JSON.stringify(comparison.failures)}. Report: ${path}`
            );
          const expectedTruePeak = Math.max(
            left.truePeakMaxDbtp,
            right.truePeakMaxDbtp,
            replacement?.truePeakMaxDbtp ?? -Infinity
          );
          if (
            !Number.isFinite(mixed.truePeakMaxDbtp) ||
            Math.abs(mixed.truePeakMaxDbtp - expectedTruePeak) > 0.2
          ) {
            throw new Error(`Mix True Peak differs from the isolated captures. Report: ${path}`);
          }
        }
        return path;
      } finally {
        for (const player of players) stopPlayer(player, { keepLease: true });
        await rm(wav, { force: true });
        if (measureMix) await rm(secondWav, { force: true });
        if (returnWav) await rm(returnWav, { force: true });
      }
    },
    { wait: process.argv.includes("--wait") }
  );
  console.log(`Windows process timing report: ${reportPath}`);
}

async function runRestartProbe(executable, args, restart) {
  const [probe, replacement] = await Promise.allSettled([runChild(executable, args), restart()]);
  if (probe.status === "rejected") throw probe.reason;
  if (replacement.status === "rejected") throw replacement.reason;
  return [probe.value, replacement.value];
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
