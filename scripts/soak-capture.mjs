#!/usr/bin/env node
/**
 * Long-run diagnostic for the capture path. Never a gate: a leak comes from a
 * commit, not from a release, and a four-hour test cannot sit inside one.
 *
 * Usage: node scripts/soak-capture.mjs [--seconds 14400] [--every 10] [--evidence]
 *
 * Exit codes match the smoke check: 0 clean, 1 drift detected, 2 rig unusable.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { open, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  RigError,
  SOAK_WARMUP_SECONDS,
  SIGNAL,
  ensureLinuxDecoders,
  assertSoakCaptureCompleted,
  harnessArgs,
  judgeSoak,
  locateHarness,
  resolveCaptureRoute,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
} from "./capture-rig.mjs";

const SETTLE_MS = 2000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`--${name} must be a positive number`);
    process.exit(2);
  }
  return value;
}

// Parsed before any rig setup, so exiting here leaks neither a player nor a file.
const seconds = arg("seconds", 14400);
const every = arg("every", 10);
const evidenceSelfTest = process.argv.includes("--evidence-self-test");
if (evidenceSelfTest && (!process.argv.includes("--evidence") || seconds < 140)) {
  console.error("--evidence-self-test requires --evidence and at least 140 seconds.");
  process.exit(2);
}
const wav = join(tmpdir(), `plvs-soak-signal-${process.pid}.wav`);
// Runs are kept as the drift baseline for later ones, so they land beside the other rig output
// rather than in the repository root.
const outPath = join(process.cwd(), "artifacts", "soak", `soak-${Date.now()}.jsonl`);
const evidencePath = process.argv.includes("--evidence") ? `${outPath}.evidence` : null;
let player = null;
let route = null;

function rssMb(pid) {
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
  const out = spawnSync(command[0], command[1], { encoding: "utf8" });
  const text = out.stdout?.trim();
  // An exited process prints nothing, and `Number("")` is 0 — which is finite.
  // Left unguarded, the last tick of a finished run records "0 MB" and drags the
  // curve to the floor, which is exactly how a real leak would be made to look
  // like memory being released.
  if (!text) {
    return null;
  }
  const bytes = Number(text);
  if (!Number.isFinite(bytes)) return null;
  return process.platform === "win32" ? bytes / (1024 * 1024) : bytes / 1024;
}

try {
  if (process.platform === "linux") ensureLinuxDecoders();
  const harness = locateHarness();
  route = resolveCaptureRoute(harness);
  // VLC's file-loop restart inserts silence into the cable. Its abrupt edges create real
  // intersample peaks and make a constant-signal drift test invalid. Keep the entire capture
  // inside one file, including setup/teardown headroom, without changing any verdict limit.
  await synthesizeSignal(wav, { seconds: Math.ceil(seconds + SETTLE_MS / 1000 + 30) });
  if (evidenceSelfTest) {
    // Intentional fixture, never used in a normal soak: a 10 ms interruption near a
    // sine maximum after warmup must produce evidence and a failed drift verdict.
    const file = await open(wav, "r+");
    try {
      const startFrame = SIGNAL.sampleRateHz * 130 + 13;
      await file.write(
        Buffer.alloc((SIGNAL.sampleRateHz / 100) * 4),
        0,
        (SIGNAL.sampleRateHz / 100) * 4,
        44 + startFrame * 4
      );
    } finally {
      await file.close();
    }
    console.log("EVIDENCE SELF-TEST: intentional 10 ms signal interruption at 130 seconds.");
  }
  player = await startPlayer(route.playerTarget, wav, {
    wait: process.argv.includes("--wait"),
    loop: false,
  });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  console.log(
    `Soaking ${route.label} (${route.platform}) for ${seconds}s, sampling every ${every}s.`
  );
  console.log(`Writing ${outPath}`);
  if (evidencePath) console.log(`Capture evidence: ${evidencePath}`);
  mkdirSync(dirname(outPath), { recursive: true });

  const child = spawn(
    harness,
    harnessArgs([
      "capture",
      "--device",
      route.captureDevice,
      "--seconds",
      String(seconds),
      "--every",
      String(every),
      "--json",
    ]),
    {
      stdio: ["ignore", "pipe", "pipe"],
      ...(evidencePath ? { env: { ...process.env, PLVS_CAPTURE_EVIDENCE_DIR: evidencePath } } : {}),
    }
  );

  const out = createWriteStream(outPath);
  const samples = [];
  const rss = [];
  let finalReport = null;
  let buffered = "";

  function consume(line) {
    if (!line.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // Not a whole JSON line; nothing to learn from it.
    }
    if (typeof parsed.t === "number") samples.push(parsed);
    else if (parsed.command === "capture") finalReport = parsed;
  }

  // RSS is sampled externally against the PID. The CLI deliberately does not
  // self-report it: that would mean a new dependency to hand back a number the
  // caller can already read, and the external figure measures the whole process.
  // One platform process query per interval is negligible against a 10s interval,
  // and the child buffers stdout meanwhile.
  const rssTimer = setInterval(() => {
    const mb = rssMb(child.pid);
    if (mb !== null) rss.push({ t: Date.now(), mb });
  }, every * 1000);

  child.stdout.on("data", (chunk) => {
    out.write(chunk);
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) consume(line);
  });
  child.stderr.pipe(process.stderr);

  // `close` fires only once the process has exited *and* its stdio have closed,
  // so every `data` event has already been consumed by this point.
  const [status] = await once(child, "close");
  clearInterval(rssTimer);
  consume(buffered); // The last line may arrive without a trailing newline.
  out.end();
  await once(out, "close");

  assertSoakCaptureCompleted(status, finalReport);
  if (player.exitCode !== null || player.signalCode !== null) {
    throw new RigError("Test-tone player exited before capture completed.");
  }

  const settled = samples.filter((s) => s.t >= SOAK_WARMUP_SECONDS);
  const { spreads, failures } = judgeSoak(samples);
  const droppedFinal = samples.length ? samples[samples.length - 1].droppedChunks : 0;
  const rssFirst = rss.length ? rss[0].mb : null;
  const rssLast = rss.length ? rss[rss.length - 1].mb : null;

  console.log(
    `\nSamples        : ${samples.length} (${settled.length} after ${SOAK_WARMUP_SECONDS}s warmup)`
  );
  for (const [field, spread] of Object.entries(spreads)) {
    console.log(`${field.padEnd(15)}: spread ${spread.toFixed(4)} dB after warmup`);
  }
  console.log(`droppedChunks  : ${droppedFinal}`);
  if (rssFirst !== null) {
    console.log(`RSS            : ${rssFirst.toFixed(1)} MB -> ${rssLast.toFixed(1)} MB`);
    console.log(
      `                 SummaryMeter accumulates ~3.5 MB over 4h by design (100 ms blocks,\n` +
        `                 144k entries x 24 bytes). Growth of that order is the floor, not a leak.`
    );
  }
  console.log(`\nFull series: ${outPath}`);

  if (settled.length < 2) {
    console.error("\nToo few settled samples to judge drift. Run longer than the warmup.");
    process.exitCode = 2;
  } else if (failures.length > 0) {
    console.error(`\nFAIL ${failures.length} reading(s) moved over a constant signal:`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
      "Each is the whole run's value over identical input; movement is a defect or a rig " +
        "contaminant (anything else reaching the cable). Do not widen the limit."
    );
    process.exitCode = 1;
  } else {
    console.log("\nOK no drift. Read the RSS figures above against the baseline in the soak spec.");
  }
} catch (err) {
  if (err instanceof RigError) {
    console.error(`\nRIG ${err.message}`);
    process.exitCode = 2;
  } else {
    console.error(err);
    process.exitCode = 2;
  }
} finally {
  stopPlayer(player);
  if (route?.release) {
    try {
      route.release();
    } catch (error) {
      console.error(`Warning: ${error.message}`);
      if ((process.exitCode ?? 0) === 0) process.exitCode = 2;
    }
  }
  // Teardown must not rewrite the verdict; see smoke-capture.mjs.
  await rm(wav, { force: true }).catch((err) => {
    console.error(`Warning: could not remove ${wav}: ${err.message}`);
  });
}
