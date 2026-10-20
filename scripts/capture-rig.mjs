/**
 * Shared rig for the capture smoke and soak: synthesize a known signal, route it
 * into VB-Cable on Windows, BlackHole on macOS, or a private PulseAudio null sink
 * on Linux, and tear the player down again.
 *
 * Every hardware operation lives here on purpose. The first hand-driven
 * verification burned three attempts on VLC device selection alone (an argument
 * array split the device name on spaces and VLC opened the fragments as files;
 * `directsound` rejects a device name and wants a GUID; only `mmdevice` with an
 * MMDevice endpoint id works). A caller should never have to know any of that.
 */
import { existsSync, statSync, readdirSync } from "node:fs";
import { open } from "node:fs/promises";
import { spawnSync, spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LeaseBusyError,
  acquireLease,
  currentOwner,
  describeHolder,
  ensureLeaseDirectory,
  leasePath,
  machineLeaseDirectory,
  releaseLease,
  waitForLease,
} from "./rig-lease.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 1 kHz sine, asymmetric by design: under BS.1770 equal-weight channels
 * integrate identically, so an L/R swap is invisible to integrated loudness and
 * only per-channel peaks can catch it.
 */
export const SIGNAL = {
  sampleRateHz: 48000,
  seconds: 60,
  freqHz: 1000,
  peakLDb: -20,
  peakRDb: -26,
};

/** Peaks are a direct PCM property; integrated is a windowed statistic. */
export const TOLERANCE_DB = {
  integratedLufs: 0.5,
  samplePeakMaxLDb: 0.2,
  samplePeakMaxRDb: 0.2,
};

/** Kept for Windows-only adjacent tools while shared callers use `resolveCaptureRoute`. */
export const CAPTURE_DEVICE = "CABLE Output";
const VB_CABLE_RENDER_NAME = "CABLE Input";
const BLACKHOLE_DEVICE_NAME = "BlackHole 2ch";
const VLC_PATHS = {
  win32: [
    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
    "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
  ],
  darwin: ["/Applications/VLC.app/Contents/MacOS/VLC"],
};
const MACOS_AUDIO_PROBE = join(ROOT, "scripts", "macos", "core-audio-output.swift");

/** The rig is unusable: not a code signal. Callers map this to exit 2. */
export class RigError extends Error {}

export async function synthesizeSignal(path, { seconds = SIGNAL.seconds } = {}) {
  const { sampleRateHz, freqHz, peakLDb, peakRDb } = SIGNAL;
  const ampL = 10 ** (peakLDb / 20);
  const ampR = 10 ** (peakRDb / 20);
  const frames = Math.round(sampleRateHz * seconds);
  const dataBytes = frames * 2 * 2;
  if (!Number.isFinite(seconds) || seconds <= 0 || frames < 1 || dataBytes > 0xffffffff - 36) {
    throw new RigError("Signal duration must fit a nonempty PCM RIFF WAV (less than 4 GiB).");
  }
  const buf = Buffer.alloc(44);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRateHz, 24);
  buf.writeUInt32LE(sampleRateHz * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);

  // One second contains an integer number of cycles. Repeat these PCM bytes inside
  // a single file, without player restarts or a multi-gigabyte allocation for a soak.
  const chunkFrames = Math.min(frames, sampleRateHz);
  const chunk = Buffer.alloc(chunkFrames * 4);
  for (let i = 0; i < chunkFrames; i++) {
    const phase = (2 * Math.PI * freqHz * i) / sampleRateHz;
    chunk.writeInt16LE(Math.round(Math.sin(phase) * ampL * 32767), i * 4);
    chunk.writeInt16LE(Math.round(Math.sin(phase) * ampR * 32767), i * 4 + 2);
  }

  const file = await open(path, "w");
  try {
    await file.writeFile(buf);
    for (let written = 0; written < dataBytes; written += chunk.length) {
      await file.writeFile(chunk.subarray(0, Math.min(chunk.length, dataBytes - written)));
    }
  } finally {
    await file.close();
  }
}

/** `null` fails rather than skips: silence reports null, and a skipped null
 *  would call a dead capture path green. Both sides are guarded, not just
 *  `actual`: a missing `expected` makes `got - expected` NaN, and `NaN > tolerance`
 *  is false, so an un-guarded truth field would pass unconditionally and forever —
 *  the exact silent-green this check exists to prevent, hiding in the check. */
export function compareMetrics(truth, actual) {
  const failures = [];
  for (const [field, tolerance] of Object.entries(TOLERANCE_DB)) {
    const expected = truth[field];
    const got = actual[field];
    if (typeof expected !== "number" || !Number.isFinite(expected)) {
      failures.push({
        field,
        expected,
        got,
        tolerance,
        reason: "no ground truth for this field",
      });
      continue;
    }
    if (typeof got !== "number" || !Number.isFinite(got)) {
      failures.push({ field, expected, got, tolerance, reason: "not a finite number" });
      continue;
    }
    const delta = Math.abs(got - expected);
    if (delta > tolerance) {
      failures.push({ field, expected, got, tolerance, delta, reason: "outside tolerance" });
    }
  }
  return { ok: failures.length === 0, failures };
}

function powershell(command) {
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new RigError(`PowerShell failed: ${result.stderr?.trim() || "unknown error"}`);
  }
  return result.stdout.trim();
}

/** `{0.0.0.00000000}.{<guid>}` — exactly one pair of braces around the guid. */
const ENDPOINT_ID_SHAPE = /^\{0\.0\.0\.00000000\}\.\{[0-9a-fA-F-]{36}\}$/;

/**
 * VB-Cable's MMDevice render endpoint id. `directsound` would need a GUID and
 * rejects the device name outright, so `mmdevice` + endpoint id is the only
 * route that works.
 *
 * `PSChildName` already carries its own braces, so the id must NOT wrap it in
 * another pair. A doubled brace is accepted by VLC without complaint — it stays
 * alive, plays nothing to the endpoint, and the capture then reads pure silence.
 * That surfaces as an assertion failure on all-null metrics, i.e. a rig fault
 * wearing a code fault's clothes, which is the one confusion this whole design
 * is built to avoid. Hence the shape check below rather than trust.
 */
export function resolveRenderEndpointId(friendlyName = VB_CABLE_RENDER_NAME) {
  if (process.platform !== "win32") {
    throw new RigError("MMDevice endpoint discovery is only available on Windows.");
  }
  const command = `
    $base = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render"
    Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
      $n = (Get-ItemProperty (Join-Path $_.PSPath "Properties") -ErrorAction SilentlyContinue)."{a45c254e-df1c-4efd-8020-67d146a850e0},2"
      if ($n -eq "${friendlyName}") { "{0.0.0.00000000}.$($_.PSChildName)" }
    }
  `;
  const out = powershell(command);
  const ids = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new RigError(`No audio render endpoint named "${friendlyName}". Is VB-Cable installed?`);
  }
  if (!ENDPOINT_ID_SHAPE.test(ids[0])) {
    throw new RigError(
      `Endpoint id for "${friendlyName}" has an unexpected shape: ${ids[0]}\n` +
        `Expected {0.0.0.00000000}.{<guid>}. VLC accepts a malformed id silently and\n` +
        `plays nowhere, so this is caught here rather than read as a capture defect.`
    );
  }
  return ids[0];
}

export function locateVlc(platform = process.platform) {
  const paths = VLC_PATHS[platform];
  if (!paths) {
    throw new RigError(`The live-capture rig is not supported on ${platform}.`);
  }
  const vlc = paths.find((p) => existsSync(p));
  if (!vlc) {
    throw new RigError(`VLC not found. Looked in:\n${paths.map((p) => `  ${p}`).join("\n")}`);
  }
  return vlc;
}

function parseLastJsonLine(text, label) {
  const line = text.replace(/^﻿/, "").trim().split(/\r?\n/).filter(Boolean).at(-1);
  try {
    return JSON.parse(line);
  } catch {
    throw new RigError(`${label} produced unparsable output: ${line || "<empty>"}`);
  }
}

export function selectMacCaptureDevice(report, expectedName = BLACKHOLE_DEVICE_NAME) {
  if (report?.status !== "ok" || !Array.isArray(report.devices)) {
    throw new RigError(
      `PLVS device discovery failed: ${report?.error?.message || "missing device report"}`
    );
  }
  const matches = report.devices.filter(
    (device) => device.label === expectedName && device.kind === "systemOutput"
  );
  if (matches.length !== 1) {
    throw new RigError(
      `Expected exactly one PLVS system-output device named "${expectedName}", found ${matches.length}. ` +
        `Is BlackHole 2ch installed and active after reboot?`
    );
  }
  const device = matches[0];
  if (!/^lb-[0-9a-f]{32}$/i.test(device.id)) {
    throw new RigError(`BlackHole capture id has an unexpected shape: ${device.id}`);
  }
  if (device.sampleRateHz !== SIGNAL.sampleRateHz || device.channelCount !== 2) {
    throw new RigError(
      `BlackHole capture format is ${device.sampleRateHz} Hz, ${device.channelCount} ch; ` +
        `expected ${SIGNAL.sampleRateHz} Hz, 2 ch.`
    );
  }
  return device;
}

export function selectMacRenderDevice(report, expectedName = BLACKHOLE_DEVICE_NAME) {
  const matches = Array.isArray(report?.devices) ? report.devices : [];
  if (matches.length !== 1) {
    throw new RigError(
      `Expected exactly one Core Audio output named "${expectedName}", found ${matches.length}. ` +
        `Is BlackHole 2ch installed and active after reboot?`
    );
  }
  const device = matches[0];
  if (!Number.isInteger(device.audioObjectId) || device.audioObjectId <= 0) {
    throw new RigError(`BlackHole Core Audio object id is invalid: ${device.audioObjectId}`);
  }
  if (device.nominalSampleRateHz !== SIGNAL.sampleRateHz || device.outputChannelCount !== 2) {
    throw new RigError(
      `BlackHole render format is ${device.nominalSampleRateHz} Hz, ` +
        `${device.outputChannelCount} ch; expected ${SIGNAL.sampleRateHz} Hz, 2 ch.`
    );
  }
  return device;
}

function resolveMacRenderDevice(run = spawnSync) {
  const result = run("/usr/bin/xcrun", ["swift", MACOS_AUDIO_PROBE, BLACKHOLE_DEVICE_NAME], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new RigError(
      `Core Audio device discovery failed: ${result.stderr?.trim() || "unknown error"}`
    );
  }
  return selectMacRenderDevice(parseLastJsonLine(result.stdout ?? "", "Core Audio probe"));
}

/** Resolve platform details once so smoke/soak logic stays identical. */
export function resolveCaptureRoute(
  harness,
  {
    platform = process.platform,
    run = runCli,
    endpointResolver = resolveRenderEndpointId,
    macRenderResolver = resolveMacRenderDevice,
    linuxPulseRunner = spawnSync,
    linuxSinkName = `plvs_rig_${process.pid}`,
  } = {}
) {
  if (platform === "win32") {
    return {
      platform,
      label: "VB-Cable",
      captureDevice: CAPTURE_DEVICE,
      playerTarget: endpointResolver(),
    };
  }
  if (platform === "linux") {
    return resolveLinuxCaptureRoute({
      run: linuxPulseRunner,
      sinkName: linuxSinkName,
    });
  }
  if (platform !== "darwin") {
    throw new RigError(`The live-capture rig is not supported on ${platform}.`);
  }
  const result = run(harness, harnessArgs(["devices", "--json"]));
  if (result.status !== 0) {
    throw new RigError(`PLVS device discovery failed: ${result.stderr.trim() || "unknown error"}`);
  }
  const capture = selectMacCaptureDevice(parseLastJsonLine(result.stdout, "PLVS device discovery"));
  const render = macRenderResolver();
  return {
    platform,
    label: BLACKHOLE_DEVICE_NAME,
    captureDevice: capture.id,
    playerTarget: String(render.audioObjectId),
  };
}

/** The harness has its own Cargo profile so it never overwrites target/release/plvs.exe,
 *  which `desktop:dev-optimized` leaves as the dev-identity GUI. */
export const BUILD_HARNESS =
  "cargo build --manifest-path src-tauri/Cargo.toml --profile harness --bin plvs --features capture-harness";

export function harnessPath(root = ROOT, platform = process.platform) {
  const executable = platform === "win32" ? "plvs.exe" : "plvs";
  return join(root, "src-tauri", "target", "harness", executable);
}

/** What a harness rebuild consumes. `target/` is deliberately absent: it holds the
 *  binary being compared, not an input to it. */
const HARNESS_SOURCES = ["src-tauri/src", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];

/**
 * Paths under `root` modified after `harnessMtimeMs`. Exported for its test; callers want
 * `locateHarness`.
 */
export function staleHarnessSources(harnessMtimeMs, root = ROOT) {
  const stale = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(abs)) walk(`${rel}/${entry}`);
      return;
    }
    if (stat.mtimeMs > harnessMtimeMs) stale.push(rel);
  };
  for (const rel of HARNESS_SOURCES) walk(rel);
  return stale;
}

export function harnessArgs(args) {
  return ["--harness", ...args];
}

export function verifyHarnessBuild(harness, run = runCli) {
  const probe = run(harness, harnessArgs(["capture", "--help"]));
  if (probe.status === 0) return;
  const detail = probe.stderr.trim();
  throw new RigError(
    `The harness binary was not built with the capture harness feature.` +
      `${detail ? `\nReported: ${detail}` : ""}\nRebuild first:\n  ${BUILD_HARNESS}`
  );
}

export function assertSoakCaptureCompleted(status, finalReport) {
  if (status !== 0) {
    throw new RigError(`plvs-cli capture exited with exit code ${status ?? "unknown"}.`);
  }
  if (!finalReport) {
    throw new RigError("plvs-cli capture exited without a final report.");
  }
  if (finalReport.status !== "ok") {
    throw new RigError(`plvs-cli capture failed mid-run: ${finalReport.error?.message}`);
  }
}

/** Readings the soak holds still over its constant signal. Each is the whole capture's value so
 *  far, so after warmup any movement is accumulation error or corrupted PCM. */
export const SOAK_DRIFT_LIMIT_DB = 0.01;
/** Early on, few blocks exist and BS.1770's relative gate has not settled. */
export const SOAK_WARMUP_SECONDS = 60;
/** Keep the historical 120 s maximum warmup for comparable judgments. Older runs looped
 *  a 60 s file; current soaks play one continuous file and have no playback seam. */
export const SOAK_MAX_WARMUP_SECONDS = SOAK_WARMUP_SECONDS + SIGNAL.seconds;
/** Over a constant tone the loudest 400 ms and 3 s windows hold the programme itself, so Max M
 *  and Max S equal Integrated. A gap means the signal was not constant: something else reached
 *  the cable, which a maximum keeps for the rest of the run even if it happened in warmup. */
export const SOAK_MAX_TO_INTEGRATED_DB = 0.05;

const SOAK_DRIFT_METRICS = [
  ["integratedLufs", SOAK_WARMUP_SECONDS],
  ["lra", SOAK_WARMUP_SECONDS],
  ["mMaxLufs", SOAK_MAX_WARMUP_SECONDS],
  ["stMaxLufs", SOAK_MAX_WARMUP_SECONDS],
  ["truePeakMaxDbtp", SOAK_MAX_WARMUP_SECONDS],
];

/** Judges a soak's periodic samples. `null` and missing readings fail rather than skip, for the
 *  reason `compareMetrics` gives. Returns each metric's post-warmup spread and every failure. */
export function judgeSoak(samples) {
  const spreads = {};
  const failures = [];
  for (const [field, warmup] of SOAK_DRIFT_METRICS) {
    const settled = samples.filter((s) => s.t >= warmup);
    const missing = settled.find((s) => typeof s[field] !== "number" || !Number.isFinite(s[field]));
    if (missing) {
      failures.push(`${field} is not a finite number at t=${missing.t}s`);
      continue;
    }
    if (settled.length < 2) {
      failures.push(`${field} has fewer than two readings after its ${warmup}s warmup`);
      continue;
    }
    const values = settled.map((s) => s[field]);
    const spread = Math.max(...values) - Math.min(...values);
    spreads[field] = spread;
    if (spread > SOAK_DRIFT_LIMIT_DB) {
      failures.push(`${field} drifted ${spread.toFixed(4)} dB over a constant signal`);
    }
  }
  const last = samples.at(-1);
  for (const field of ["mMaxLufs", "stMaxLufs"]) {
    const gap = last ? Math.abs(last[field] - last.integratedLufs) : NaN;
    if (!(gap <= SOAK_MAX_TO_INTEGRATED_DB)) {
      failures.push(
        `${field} sits ${gap.toFixed(4)} dB from integratedLufs; over a constant signal they agree`
      );
    }
  }
  return { spreads, failures };
}

export function locateHarness() {
  const harness = harnessPath();
  if (!existsSync(harness)) {
    throw new RigError(`Capture harness not built. Run:\n  ${BUILD_HARNESS}`);
  }
  verifyHarnessBuild(harness);

  // Nothing on the way here rebuilds it. `npm run check` builds the debug profile, and
  // CI runners have no sound card, so this rig is the capture layer's only real
  // verification -- one that would otherwise pass against a binary predating the commit
  // it was run to check. The tell is silent: the run prints OK either way.
  const stale = staleHarnessSources(statSync(harness).mtimeMs);
  if (stale.length > 0) {
    const listed = stale.slice(0, 5).map((rel) => `  ${rel}`);
    if (stale.length > listed.length) {
      listed.push(`  ... and ${stale.length - listed.length} more`);
    }
    throw new RigError(
      `Capture harness is older than its sources, so this run would not exercise them:\n${listed.join("\n")}\nRebuild first:\n  ${BUILD_HARNESS}`
    );
  }
  return harness;
}

let heldLease = null;

function releaseRig() {
  releaseLease(heldLease);
  heldLease = null;
}

// A run that ends without reaching stopPlayer still gives the rig back. One killed outright
// leaves its lease behind, and the next run removes it once its PID is gone.
process.on("exit", releaseRig);

/**
 * Takes the rig lease (ADR 0034). Without `wait`, a busy rig is a RigError naming the run that
 * holds it; with it, this waits until that run ends.
 */
async function takeRig({ wait }) {
  if (heldLease) return;
  const path = leasePath(ensureLeaseDirectory(machineLeaseDirectory()));
  const command = [basename(process.argv[1] ?? "node"), ...process.argv.slice(2)].join(" ");
  const owner = currentOwner({ worktree: ROOT, command });
  try {
    heldLease = wait
      ? await waitForLease(path, owner, {
          onBusy: (holder) =>
            console.log(`Waiting for the capture rig, in use by ${describeHolder(holder)}.`),
        })
      : acquireLease(path, owner);
  } catch (error) {
    if (!(error instanceof LeaseBusyError)) throw error;
    throw new RigError(`${error.message}\nWait for it to finish, or rerun with --wait to queue.`);
  }
}

/**
 * Play `wavPath` into `endpointId` and nothing else. Deliberately does not touch
 * the system default playback device: that is intrusive, and 60s of 1 kHz sine
 * through real monitors is a scream.
 */
export function playerArgs(
  playerTarget,
  wavPath,
  platform = process.platform,
  { loop = true } = {}
) {
  const common = [
    "--intf",
    "dummy",
    "--no-video",
    ...(loop ? ["--loop"] : ["--no-loop", "--no-repeat", "--play-and-exit"]),
  ];
  if (platform === "win32") {
    return [...common, "--aout=mmdevice", `--mmdevice-audio-device=${playerTarget}`, wavPath];
  }
  if (platform === "darwin") {
    return [...common, "--aout=auhal", `--auhal-audio-device=${playerTarget}`, wavPath];
  }
  throw new RigError(`The live-capture player is not supported on ${platform}.`);
}

/** One paplay invocation. The long-running helper repeats it so soak input stays constant. */
export function linuxPlayerArgs(playerTarget, wavPath) {
  return ["paplay", `--device=${playerTarget}`, wavPath];
}

export function ensureLinuxDecoders() {
  if (process.env.PLVS_FFMPEG_DIR) return;
  if (existsSync("/usr/bin/ffmpeg") && existsSync("/usr/bin/ffprobe")) {
    process.env.PLVS_FFMPEG_DIR = "/usr/bin";
  }
}

export function resolveLinuxCaptureRoute({
  run = spawnSync,
  sinkName = `plvs_rig_${process.pid}`,
} = {}) {
  if (!/^[A-Za-z0-9_.-]+$/.test(sinkName)) {
    throw new RigError(`Linux rig sink name is not safe to pass to PulseAudio: ${sinkName}`);
  }
  const info = run("pactl", ["info"], { encoding: "utf8" });
  if (info.error || info.status !== 0) {
    throw new RigError(
      `PulseAudio is not available: ${info.stderr?.trim() || info.error?.message || "unknown error"}`
    );
  }
  const loaded = run(
    "pactl",
    [
      "load-module",
      "module-null-sink",
      `sink_name=${sinkName}`,
      "rate=48000",
      "channels=2",
      `sink_properties=device.description=${sinkName}`,
    ],
    { encoding: "utf8" }
  );
  const moduleId = loaded.stdout?.trim() ?? "";
  if (loaded.status !== 0 || !/^\d+$/.test(moduleId)) {
    throw new RigError(
      `Could not create the Linux null sink: ${loaded.stderr?.trim() || loaded.stdout?.trim() || loaded.error?.message || "unknown error"}`
    );
  }
  let released = false;
  return {
    platform: "linux",
    label: "PulseAudio null sink",
    // The harness matches the monitor description ("Monitor of <sink>"), the same
    // selector smoke:capture:linux already uses. The Pulse source name
    // "<sink>.monitor" is not that label.
    captureDevice: sinkName,
    playerTarget: sinkName,
    release() {
      if (released) return;
      released = true;
      const removed = run("pactl", ["unload-module", moduleId], { encoding: "utf8" });
      if (removed.error || removed.status !== 0) {
        throw new RigError(
          `Could not remove Linux null sink module ${moduleId}: ${removed.stderr?.trim() || removed.error?.message || "unknown error"}`
        );
      }
    },
  };
}

export async function startPlayer(playerTarget, wavPath, { wait = false, loop = true } = {}) {
  await takeRig({ wait });
  if (process.platform === "linux") {
    if (!existsSync("/usr/bin/paplay")) {
      throw new RigError("paplay was not found at /usr/bin/paplay.");
    }
    return spawn(
      process.execPath,
      [join(ROOT, "scripts", "linux-pulse-player.mjs"), playerTarget, wavPath],
      {
        detached: false,
        stdio: "ignore",
      }
    );
  }
  const vlc = locateVlc();
  const child = spawn(vlc, playerArgs(playerTarget, wavPath, process.platform, { loop }), {
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  return child;
}

/**
 * Must run on every exit path. A VLC left looping into a virtual cable is
 * silent, so it goes unnoticed while poisoning the next run's reading.
 *
 * Kills only the process tree we spawned. An earlier version swept every VLC on
 * the machine, which would have killed one the user had open for their own
 * purposes — and it ran on the argument-validation path too, so a typo'd flag
 * would have taken their media player with it.
 */
export function stopPlayer(child) {
  try {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    if (process.platform === "win32") {
      // /T covers any helper processes VLC spawned; /F because it is looping and
      // will not exit politely. Targeted by PID, never by image name.
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      try {
        child.kill();
      } catch {
        // taskkill already got it.
      }
    } else {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        return;
      }
      const deadline = Date.now() + 500;
      while (Date.now() < deadline) {
        try {
          process.kill(child.pid, 0);
        } catch {
          return;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // It exited between the final probe and the fallback.
      }
    }
  } finally {
    releaseRig();
  }
}

export function runCli(cliPath, args) {
  const result = spawnSync(cliPath, args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
