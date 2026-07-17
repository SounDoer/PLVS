#!/usr/bin/env node
/**
 * Long-run diagnostic for the capture path. Never a gate: a leak comes from a
 * commit, not from a release, and a four-hour test cannot sit inside one.
 *
 * Usage: node scripts/soak-capture.mjs [--seconds 14400] [--every 10]
 *
 * Exit codes match the smoke check: 0 clean, 1 drift detected, 2 rig unusable.
 */
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CAPTURE_DEVICE,
  RigError,
  locateCli,
  resolveRenderEndpointId,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
} from "./capture-rig.mjs";

/** Early on, few blocks exist and BS.1770's relative gate has not settled, so
 *  the first readings legitimately differ. */
const WARMUP_SECONDS = 60;
/** Integrated loudness is a gated mean: over a constant signal it is
 *  mathematically independent of block count, so it must stay flat. Any visible
 *  movement is accumulation error or corrupted PCM. */
const DRIFT_LIMIT_DB = 0.01;
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
const wav = join(tmpdir(), `plvs-soak-signal-${process.pid}.wav`);
const outPath = join(process.cwd(), `soak-${Date.now()}.jsonl`);
let player = null;

function rssMb(pid) {
  const out = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`,
    ],
    { encoding: "utf8" },
  );
  const text = out.stdout?.trim();
  // An exited process prints nothing, and `Number("")` is 0 — which is finite.
  // Left unguarded, the last tick of a finished run records "0 MB" and drags the
  // curve to the floor, which is exactly how a real leak would be made to look
  // like memory being released.
  if (!text) {
    return null;
  }
  const bytes = Number(text);
  return Number.isFinite(bytes) ? bytes / (1024 * 1024) : null;
}

try {
  const cli = locateCli();
  const endpoint = resolveRenderEndpointId();
  await synthesizeSignal(wav);
  player = startPlayer(endpoint, wav);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  console.log(`Soaking ${CAPTURE_DEVICE} for ${seconds}s, sampling every ${every}s.`);
  console.log(`Writing ${outPath}`);

  const child = spawn(
    cli,
    [
      "capture",
      "--device",
      CAPTURE_DEVICE,
      "--seconds",
      String(seconds),
      "--every",
      String(every),
      "--json",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
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
  // One PowerShell launch per interval (1,440 over a default 4h run) costs ~100 ms
  // of blocked event loop each — negligible against a 10s interval, and the child
  // buffers stdout meanwhile.
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

  if (status === 2) {
    throw new RigError("plvs-cli capture could not start; see output above.");
  }
  if (finalReport && finalReport.status !== "ok") {
    throw new RigError(`plvs-cli capture failed mid-run: ${finalReport.error?.message}`);
  }

  const settled = samples.filter((s) => s.t >= WARMUP_SECONDS && Number.isFinite(s.integratedLufs));
  const lufs = settled.map((s) => s.integratedLufs);
  const spread = lufs.length > 1 ? Math.max(...lufs) - Math.min(...lufs) : 0;
  const droppedFinal = samples.length ? samples[samples.length - 1].droppedChunks : 0;
  const rssFirst = rss.length ? rss[0].mb : null;
  const rssLast = rss.length ? rss[rss.length - 1].mb : null;

  console.log(
    `\nSamples        : ${samples.length} (${settled.length} after ${WARMUP_SECONDS}s warmup)`,
  );
  console.log(`integratedLufs : spread ${spread.toFixed(4)} dB after warmup`);
  console.log(`droppedChunks  : ${droppedFinal}`);
  if (rssFirst !== null) {
    console.log(`RSS            : ${rssFirst.toFixed(1)} MB -> ${rssLast.toFixed(1)} MB`);
    console.log(
      `                 SummaryMeter accumulates ~3.5 MB over 4h by design (100 ms blocks,\n` +
        `                 144k entries x 24 bytes). Growth of that order is the floor, not a leak.`,
    );
  }
  console.log(`\nFull series: ${outPath}`);

  if (settled.length < 2) {
    console.error("\nToo few settled samples to judge drift. Run longer than the warmup.");
    process.exitCode = 2;
  } else if (spread > DRIFT_LIMIT_DB) {
    console.error(`\nFAIL integrated loudness drifted ${spread.toFixed(4)} dB over a constant signal.`);
    console.error(
      "A gated mean over identical blocks is independent of block count; this is a defect.",
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
  // Teardown must not rewrite the verdict; see smoke-capture.mjs.
  await rm(wav, { force: true }).catch((err) => {
    console.error(`Warning: could not remove ${wav}: ${err.message}`);
  });
}
