/**
 * Shared rig for the capture smoke and soak: synthesize a known signal, route it
 * into VB-Cable, and tear the player down again.
 *
 * Every hardware operation lives here on purpose. The first hand-driven
 * verification burned three attempts on VLC device selection alone (an argument
 * array split the device name on spaces and VLC opened the fragments as files;
 * `directsound` rejects a device name and wants a GUID; only `mmdevice` with an
 * MMDevice endpoint id works). A caller should never have to know any of that.
 */
import { writeFileSync, existsSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

export const CAPTURE_DEVICE = "CABLE Output";
const VB_CABLE_RENDER_NAME = "CABLE Input";
const VLC_PATHS = [
  "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
  "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
];

/** The rig is unusable: not a code signal. Callers map this to exit 2. */
export class RigError extends Error {}

export async function synthesizeSignal(path) {
  const { sampleRateHz, seconds, freqHz, peakLDb, peakRDb } = SIGNAL;
  const ampL = 10 ** (peakLDb / 20);
  const ampR = 10 ** (peakRDb / 20);
  const frames = sampleRateHz * seconds;
  const dataBytes = frames * 2 * 2;
  const buf = Buffer.alloc(44 + dataBytes);

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

  for (let i = 0; i < frames; i++) {
    const phase = (2 * Math.PI * freqHz * i) / sampleRateHz;
    buf.writeInt16LE(Math.round(Math.sin(phase) * ampL * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.sin(phase) * ampR * 32767), 44 + i * 4 + 2);
  }

  writeFileSync(path, buf);
}

/** `null` fails rather than skips: silence reports null, and a skipped null
 *  would call a dead capture path green. */
export function compareMetrics(truth, actual) {
  const failures = [];
  for (const [field, tolerance] of Object.entries(TOLERANCE_DB)) {
    const expected = truth[field];
    const got = actual[field];
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

/**
 * VB-Cable's MMDevice render endpoint id. `directsound` would need a GUID and
 * rejects the device name outright, so `mmdevice` + endpoint id is the only
 * route that works.
 */
export function resolveRenderEndpointId(friendlyName = VB_CABLE_RENDER_NAME) {
  const command = `
    $base = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render"
    Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
      $n = (Get-ItemProperty (Join-Path $_.PSPath "Properties") -ErrorAction SilentlyContinue)."{a45c254e-df1c-4efd-8020-67d146a850e0},2"
      if ($n -eq "${friendlyName}") { "{0.0.0.00000000}.{$($_.PSChildName)}" }
    }
  `;
  const out = powershell(command);
  const ids = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new RigError(
      `No audio render endpoint named "${friendlyName}". Is VB-Cable installed?`,
    );
  }
  return ids[0];
}

export function locateVlc() {
  const vlc = VLC_PATHS.find((p) => existsSync(p));
  if (!vlc) {
    throw new RigError(`VLC not found. Looked in:\n${VLC_PATHS.map((p) => `  ${p}`).join("\n")}`);
  }
  return vlc;
}

export function locateCli() {
  const cli = join(ROOT, "src-tauri", "target", "release", "plvs-cli.exe");
  if (!existsSync(cli)) {
    throw new RigError(
      `plvs-cli not built. Run:\n  cargo build --manifest-path src-tauri/Cargo.toml --release --bin plvs-cli`,
    );
  }
  return cli;
}

/**
 * Loop `wavPath` into `endpointId` and nothing else. Deliberately does not touch
 * the system default playback device: that is intrusive, and 60s of 1 kHz sine
 * through real monitors is a scream.
 */
export function startPlayer(endpointId, wavPath) {
  const vlc = locateVlc();
  const child = spawn(
    vlc,
    [
      "--intf",
      "dummy",
      "--no-video",
      "--loop",
      "--aout=mmdevice",
      `--mmdevice-audio-device=${endpointId}`,
      wavPath,
    ],
    { detached: false, stdio: "ignore", windowsHide: true },
  );
  return child;
}

/** Must run on every exit path. A VLC left looping into a virtual cable is
 *  silent, so it goes unnoticed while poisoning the next run's reading. */
export function stopPlayer(child) {
  if (child && !child.killed) {
    try {
      child.kill();
    } catch {
      // Already gone; nothing to do.
    }
  }
  spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    "Get-Process vlc -ErrorAction SilentlyContinue | Stop-Process -Force",
  ]);
}

export function runCli(cliPath, args) {
  const result = spawnSync(cliPath, args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
