# Capture Smoke Gate and Soak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `plvs-cli capture` actually run — as `npm run smoke:capture` (wired into the release gate, conditional on audio code having changed) and `npm run soak:capture` (a long-run diagnostic, never a gate).

**Architecture:** One shared rig module owns every hardware operation — synthesize signal, resolve VB-Cable's endpoint, start/stop VLC — because the first hand-driven run took three failed attempts at VLC device selection alone, and anything left to improvisation will be improvised badly. Two thin callers sit on it: the smoke asserts the live path against `analyze` ground truth; the soak reads drift and growth as curves. Rig failure exits `2`, assertion failure exits `1`, matching the CLI's contract.

**Tech Stack:** Node (ESM, `.mjs`), Vitest, PowerShell for the registry lookup, VLC + VB-Cable as rig.

**Specs:** `docs/superpowers/specs/2026-07-16-capture-smoke-gate-design.md`, `docs/superpowers/specs/2026-07-16-capture-soak-design.md`

**Gate per commit:** `npm run check`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| Create `scripts/capture-rig.mjs` | Shared rig: signal synthesis, endpoint resolution, player lifecycle, CLI location, `RigError` |
| Create `scripts/capture-rig.test.mjs` | Tests for the pure parts (signal bytes, tolerance comparison) |
| Create `scripts/smoke-capture.mjs` | Rig + `capture` + `analyze` ground truth + assertion |
| Create `scripts/soak-capture.mjs` | Rig + long `capture --every` + external RSS sampling + report |
| Create `scripts/audio-code-changed.mjs` | Pure git predicate: did `audio/`/`dsp/`/`engine/` change since the last tag |
| Create `scripts/audio-code-changed.test.mjs` | Tests for the predicate's pure filtering |
| Modify `scripts/run-release-gate.mjs` | Conditionally run the smoke |
| Modify `package.json` | `smoke:capture`, `soak:capture` |
| Modify `CLAUDE.md` | The trigger line — the only doc guaranteed to be read at the right moment |
| Modify `skills/plvs-release/SKILL.md` | Gate behaviour; on red, fix the rig or stop and ask — never bypass |

**Scripts are flat.** `scripts/` has no `lib/` subdirectory and tests sit beside their source (`build-updater-manifest.test.mjs`). Follow that; do not introduce a new layout.

**Vitest picks these up.** `vite.config.js` sets no `test.include`, so the default glob catches `scripts/*.test.mjs` and they run inside `npm run check`. The environment now defaults to `node`, which is what these want — do **not** add a `@vitest-environment jsdom` docblock.

---

### Task 1: The shared rig

**Files:** Create `scripts/capture-rig.mjs`, `scripts/capture-rig.test.mjs`

- [ ] **Step 1: Write the failing tests** in `scripts/capture-rig.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { synthesizeSignal, compareMetrics, SIGNAL } from "./capture-rig.mjs";

describe("synthesizeSignal", () => {
  it("writes a WAV whose header matches the declared format", async () => {
    const path = join(tmpdir(), `plvs-rig-test-${Date.now()}.wav`);
    try {
      await synthesizeSignal(path);
      const buf = readFileSync(path);
      expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
      expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
      expect(buf.readUInt16LE(22)).toBe(2); // channels
      expect(buf.readUInt32LE(24)).toBe(SIGNAL.sampleRateHz);
      expect(buf.readUInt16LE(34)).toBe(16); // bits per sample
      const frames = SIGNAL.sampleRateHz * SIGNAL.seconds;
      expect(buf.readUInt32LE(40)).toBe(frames * 4); // data chunk size
      expect(buf.length).toBe(44 + frames * 4);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("puts a higher peak in L than in R, which is what makes a channel swap visible", async () => {
    // Equal-weight channels integrate identically under BS.1770, so only an
    // asymmetric signal can expose an L/R swap.
    const path = join(tmpdir(), `plvs-rig-asym-${Date.now()}.wav`);
    try {
      await synthesizeSignal(path);
      const buf = readFileSync(path);
      let peakL = 0;
      let peakR = 0;
      const frames = SIGNAL.sampleRateHz * SIGNAL.seconds;
      for (let i = 0; i < frames; i++) {
        peakL = Math.max(peakL, Math.abs(buf.readInt16LE(44 + i * 4)));
        peakR = Math.max(peakR, Math.abs(buf.readInt16LE(44 + i * 4 + 2)));
      }
      const dbL = 20 * Math.log10(peakL / 32767);
      const dbR = 20 * Math.log10(peakR / 32767);
      expect(dbL).toBeCloseTo(SIGNAL.peakLDb, 1);
      expect(dbR).toBeCloseTo(SIGNAL.peakRDb, 1);
      expect(dbL).toBeGreaterThan(dbR + 3);
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("compareMetrics", () => {
  const truth = {
    integratedLufs: -22.03,
    samplePeakMaxLDb: -20.0,
    samplePeakMaxRDb: -26.0,
  };

  it("accepts values inside tolerance", () => {
    const result = compareMetrics(truth, {
      integratedLufs: -22.4,
      samplePeakMaxLDb: -20.1,
      samplePeakMaxRDb: -25.9,
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects a value outside tolerance and names the field", () => {
    const result = compareMetrics(truth, {
      integratedLufs: -22.03,
      samplePeakMaxLDb: -20.0,
      samplePeakMaxRDb: -20.0,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].field).toBe("samplePeakMaxRDb");
  });

  it("catches a swapped channel map", () => {
    // The exact defect this whole check exists for: integrated is unchanged,
    // only the per-channel peaks move.
    const result = compareMetrics(truth, {
      integratedLufs: -22.03,
      samplePeakMaxLDb: -26.0,
      samplePeakMaxRDb: -20.0,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.field).sort()).toEqual([
      "samplePeakMaxLDb",
      "samplePeakMaxRDb",
    ]);
  });

  it("treats a null metric as a failure rather than passing it", () => {
    // Silence reports null. A comparison that skipped nulls would call a dead
    // capture path green.
    const result = compareMetrics(truth, {
      integratedLufs: null,
      samplePeakMaxLDb: null,
      samplePeakMaxRDb: null,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/capture-rig.test.mjs`
Expected: FAIL — cannot resolve `./capture-rig.mjs`

- [ ] **Step 3: Implement `scripts/capture-rig.mjs`**

```js
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
  const ids = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
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
```

**Do not synthesize the signal with the bundled FFmpeg.** That sidecar is a trimmed build with no `volume` filter and fails with `No such filter: 'volume'`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/capture-rig.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/capture-rig.mjs scripts/capture-rig.test.mjs
git commit -m "feat(scripts): add the shared capture rig" -m "Owns every hardware operation for the capture smoke and soak: signal synthesis, VB-Cable endpoint resolution, VLC lifecycle, and teardown. The first hand-driven verification burned three attempts on VLC device selection alone, so leaving any of it to a caller guarantees it gets re-derived badly. Tests cover the pure parts: the WAV header, the asymmetry that makes a channel swap visible, and the tolerance comparison including the null case that a naive skip would call green." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: The smoke check

**Files:** Create `scripts/smoke-capture.mjs`; Modify `package.json`

No unit test: every line needs hardware. Verified manually in Task 6.

- [ ] **Step 1: Create `scripts/smoke-capture.mjs`**

```js
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
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CAPTURE_DEVICE,
  RigError,
  compareMetrics,
  locateCli,
  resolveRenderEndpointId,
  runCli,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
} from "./capture-rig.mjs";

const CAPTURE_SECONDS = 10;
const wav = join(tmpdir(), `plvs-smoke-signal-${process.pid}.wav`);
let player = null;

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
  if (report.status !== "ok") {
    throw new RigError(`plvs-cli ${label} reported an error: ${report.error?.message}`);
  }
  return report;
}

try {
  const cli = locateCli();
  const endpoint = resolveRenderEndpointId();

  await synthesizeSignal(wav);

  // Ground truth from the already-trusted file path.
  const truth = parseReport("analyze", runCli(cli, ["analyze", wav, "--json"])).summary;

  player = startPlayer(endpoint, wav);
  // Let the loop reach the device before measuring.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const live = parseReport(
    "capture",
    runCli(cli, [
      "capture",
      "--device",
      CAPTURE_DEVICE,
      "--seconds",
      String(CAPTURE_SECONDS),
      "--json",
    ]),
  );

  const result = compareMetrics(truth, live.summary);

  console.log(`Device      : ${live.source.deviceName}`);
  console.log(`Format      : ${live.source.sampleRateHz} Hz, ${live.source.channelCount} ch`);
  console.log(`Dropped     : ${live.health.droppedChunks}`);
  for (const field of Object.keys(truth).filter((k) => k in live.summary)) {
    console.log(`${field.padEnd(12)}: file ${truth[field]}  live ${live.summary[field]}`);
  }

  if (live.health.droppedChunks > 0) {
    console.error(`\nFAIL ${live.health.droppedChunks} chunks dropped during a 10s capture.`);
    process.exitCode = 1;
  } else if (!result.ok) {
    console.error("\nFAIL live capture disagrees with the file path:");
    for (const f of result.failures) {
      console.error(`  ${f.field}: expected ${f.expected}, got ${f.got} (${f.reason})`);
    }
    console.error("\nDo not widen the tolerance. This is what the check is for.");
    process.exitCode = 1;
  } else {
    console.log("\nOK live capture agrees with the file path.");
  }
} catch (err) {
  if (err instanceof RigError) {
    console.error(`\nRIG ${err.message}`);
    console.error("\nThis is a rig problem, not a code signal. Fix the rig, or stop and ask.");
    process.exitCode = 2;
  } else {
    console.error(err);
    process.exitCode = 2;
  }
} finally {
  stopPlayer(player);
  await rm(wav, { force: true });
}
```

- [ ] **Step 2: Add the npm script** to `package.json`, next to `smoke:file-analysis`:

```json
    "smoke:capture": "node scripts/smoke-capture.mjs",
```

- [ ] **Step 3: Verify it runs.** This needs VB-Cable, VLC, and a release build.

Run: `cargo build --manifest-path src-tauri/Cargo.toml --release --bin plvs-cli`
Run: `npm run smoke:capture`
Expected: exit 0, and output showing file/live agreement.

If it exits 2, read the message — it names the missing piece.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-capture.mjs package.json
git commit -m "feat(scripts): add the capture smoke check" -m "Asserts the live-capture path against analyze on the same signal, so the two paths must agree rather than matching a constant that can rot. Exits 1 on a failed assertion and 2 on an unusable rig, keeping a real capture-layer defect distinguishable from a missing virtual cable." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The release-gate condition

**Files:** Create `scripts/audio-code-changed.mjs`, `scripts/audio-code-changed.test.mjs`; Modify `scripts/run-release-gate.mjs`

- [ ] **Step 1: Write the failing tests** in `scripts/audio-code-changed.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { filterAudioPaths, AUDIO_PATHS } from "./audio-code-changed.mjs";

describe("filterAudioPaths", () => {
  it("selects capture, dsp, and engine sources", () => {
    expect(
      filterAudioPaths([
        "src-tauri/src/audio/cpal_backend.rs",
        "src-tauri/src/dsp/loudness.rs",
        "src-tauri/src/engine/meter_pipeline.rs",
      ]),
    ).toHaveLength(3);
  });

  it("ignores frontend and doc changes, which cannot affect the audio thread", () => {
    // The overwhelming majority of this project's commits are dock/UI work.
    // Soaking or smoking those would be pure waste.
    expect(
      filterAudioPaths([
        "src/dock/DockStrip.jsx",
        "docs/cli.md",
        "README.md",
        "src-tauri/src/lib.rs",
      ]),
    ).toEqual([]);
  });

  it("selects a mixed changeset down to only the audio paths", () => {
    expect(
      filterAudioPaths(["src/App.jsx", "src-tauri/src/audio/device_enum.rs", "package.json"]),
    ).toEqual(["src-tauri/src/audio/device_enum.rs"]);
  });

  it("declares the paths it guards", () => {
    expect(AUDIO_PATHS).toEqual([
      "src-tauri/src/audio",
      "src-tauri/src/dsp",
      "src-tauri/src/engine",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/audio-code-changed.test.mjs`
Expected: FAIL — cannot resolve `./audio-code-changed.mjs`

- [ ] **Step 3: Implement `scripts/audio-code-changed.mjs`**

```js
/**
 * Did the capture path change since the last release?
 *
 * Pure git, no hardware. This is what keeps the release gate honest without
 * making VB-Cable's state a release dependency: the rig is only demanded when
 * audio code actually changed, which for this project is a small minority of
 * releases.
 */
import { spawnSync } from "node:child_process";

export const AUDIO_PATHS = ["src-tauri/src/audio", "src-tauri/src/dsp", "src-tauri/src/engine"];

export function filterAudioPaths(paths) {
  return paths.filter((p) => AUDIO_PATHS.some((dir) => p.startsWith(`${dir}/`)));
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

/**
 * `null` last tag means no release history. Return the changed paths anyway:
 * an unknown comparison base is not evidence that nothing changed.
 */
export function lastTag() {
  return git(["describe", "--tags", "--abbrev=0"]);
}

export function audioChangesSinceLastTag() {
  const tag = lastTag();
  // Resolve the tag separately and pass it as a literal — PowerShell's $(...)
  // does not interpolate inside git arguments, a trap plvs-release already records.
  const range = tag ? `${tag}..HEAD` : null;
  const args = range
    ? ["diff", "--name-only", range, "--", ...AUDIO_PATHS]
    : ["ls-files", "--", ...AUDIO_PATHS];
  const out = git(args);
  if (out === null) {
    return { tag, paths: [] };
  }
  const paths = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return { tag, paths: filterAudioPaths(paths) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/audio-code-changed.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire it into `scripts/run-release-gate.mjs`.** Replace the two existing `run(...)` calls' tail with a conditional third step:

```js
import { audioChangesSinceLastTag } from "./audio-code-changed.mjs";

run("Release state", "node", ["scripts/check-release-state.mjs"]);
run("Full repository check", npm, ["run", "check"]);

// The capture layer cannot be tested by `npm run check` — CI has no sound card —
// so it is verified here, and only when it actually changed. Releases that touch
// no audio code never need the rig at all.
const { tag, paths } = audioChangesSinceLastTag();
if (paths.length === 0) {
  console.log(`\n== Capture smoke ==\nSkipped: no audio code changed since ${tag ?? "the initial commit"}.`);
} else {
  console.log(`\n== Capture smoke ==`);
  console.log(`Audio code changed since ${tag ?? "the initial commit"}:`);
  for (const p of paths) {
    console.log(`  ${p}`);
  }
  run("Capture smoke", npm, ["run", "smoke:capture"]);
}

console.log("\nOK Local release preflight passed.");
```

Note `run()` already exits with the child's status, so a failing smoke stops the gate. There is intentionally **no bypass flag** — an agent that cannot get this green must fix the rig or stop and ask the author.

- [ ] **Step 6: Full gate**

Run: `npm run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/audio-code-changed.mjs scripts/audio-code-changed.test.mjs scripts/run-release-gate.mjs
git commit -m "feat(release): run the capture smoke when audio code changed" -m "The preflight now runs the smoke conditionally rather than checking that someone else ran it. A check cannot clear itself: git knows audio changed, not whether anything was done about it, so it would stay red after a passing smoke. Recording the result in a ledger would fix that by adding state that can go stale and lie; running the smoke as the check needs no state at all." -m "The condition is pure git, so a release with no audio changes never touches the rig and VB-Cable's state cannot block it. There is no bypass flag: the author is the escape hatch." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: The soak

**Files:** Create `scripts/soak-capture.mjs`; Modify `package.json`

- [ ] **Step 1: Create `scripts/soak-capture.mjs`**

```js
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

const seconds = arg("seconds", 14400);
const every = arg("every", 10);
const wav = join(tmpdir(), `plvs-soak-signal-${process.pid}.wav`);
const outPath = join(process.cwd(), `soak-${Date.now()}.jsonl`);
let player = null;

function rssMb(pid) {
  const out = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`],
    { encoding: "utf8" },
  );
  const bytes = Number(out.stdout?.trim());
  return Number.isFinite(bytes) ? bytes / (1024 * 1024) : null;
}

try {
  const cli = locateCli();
  const endpoint = resolveRenderEndpointId();
  await synthesizeSignal(wav);
  player = startPlayer(endpoint, wav);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(`Soaking ${CAPTURE_DEVICE} for ${seconds}s, sampling every ${every}s.`);
  console.log(`Writing ${outPath}`);

  const child = spawn(
    cli,
    ["capture", "--device", CAPTURE_DEVICE, "--seconds", String(seconds), "--every", String(every), "--json"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const out = createWriteStream(outPath);
  const samples = [];
  const rss = [];
  let buffered = "";

  // RSS is sampled externally against the PID. The CLI deliberately does not
  // self-report it: that would mean a new dependency to hand back a number the
  // caller can already read, and the external figure measures the whole process.
  const rssTimer = setInterval(() => {
    const mb = rssMb(child.pid);
    if (mb !== null) rss.push({ t: Date.now(), mb });
  }, every * 1000);

  child.stdout.on("data", (chunk) => {
    out.write(chunk);
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.t === "number") samples.push(parsed);
      } catch {
        // Partial line; the next chunk completes it.
      }
    }
  });

  const status = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  clearInterval(rssTimer);
  out.end();

  if (status === 2) {
    throw new RigError("plvs-cli capture could not start; see output above.");
  }

  const settled = samples.filter((s) => s.t >= WARMUP_SECONDS && Number.isFinite(s.integratedLufs));
  const lufs = settled.map((s) => s.integratedLufs);
  const spread = lufs.length > 1 ? Math.max(...lufs) - Math.min(...lufs) : 0;
  const droppedFinal = samples.length ? samples[samples.length - 1].droppedChunks : 0;
  const rssFirst = rss.length ? rss[0].mb : null;
  const rssLast = rss.length ? rss[rss.length - 1].mb : null;

  console.log(`\nSamples        : ${samples.length} (${settled.length} after ${WARMUP_SECONDS}s warmup)`);
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
    console.error("A gated mean over identical blocks is independent of block count; this is a defect.");
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
  await rm(wav, { force: true });
}
```

- [ ] **Step 2: Add the npm script** to `package.json`:

```json
    "soak:capture": "node scripts/soak-capture.mjs",
```

- [ ] **Step 3: Gitignore the output.** Add to `.gitignore`:

```
soak-*.jsonl
```

- [ ] **Step 4: Verify with a short run**

Run: `node scripts/soak-capture.mjs --seconds 90 --every 5`
Expected: exit 0; samples emitted; drift spread reported; a `soak-*.jsonl` written.

90 s is chosen to clear the 60 s warmup with samples left over to judge.

- [ ] **Step 5: Commit**

```bash
git add scripts/soak-capture.mjs package.json .gitignore
git commit -m "feat(scripts): add the capture soak" -m "Runs the capture path against a constant signal for hours and reports drift and growth as curves. Drift gets a hard criterion: integrated loudness is a gated mean, so over identical blocks it is mathematically independent of how many accumulated and must stay flat; any visible movement is a defect. Memory is reported rather than judged, with SummaryMeter's ~3.5 MB of by-design accumulation named so it is not read as a leak." -m "Not a gate, by design: a leak comes from a commit, so catching it at a release boundary would mean bisecting two weeks, and a four-hour test cannot sit inside a release anyway." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Documentation

**Files:** Modify `CLAUDE.md`, `skills/plvs-release/SKILL.md`

- [ ] **Step 1: Add the trigger to `CLAUDE.md`** under **踩过的坑**, after the existing entries. This is the load-bearing doc: it enters every agent session automatically, which is the only reason the soak trigger fires at all — the author does not type these commands and will not remember them.

```markdown
- **改了 `src-tauri/src/audio` / `dsp` / `engine` 之后**：这三处是采集层，`npm run check` 和 CI 都碰不到（runner 没声卡），bug 会带着满屏绿灯发出去。发版时 `release:preflight` 会自动跑 `npm run smoke:capture` 挡住你——**红了别绕，修装备（VB-Cable + VLC）或者停下来问用户**，没有 bypass flag 是故意的。另外考虑挂个 `npm run soak:capture`（默认 4 小时，睡前跑）：泄漏和指标漂移只有长跑才现形，而它不挡发版，没人提醒就永远不会跑。
```

- [ ] **Step 2: Add the gate to `skills/plvs-release/SKILL.md`.** In the Step 6 Preflight Check section, extend the check list table:

```markdown
| 3 | Capture smoke (conditional) | Runs inside `npm run release:preflight` | Only when `src-tauri/src/audio`/`dsp`/`engine` changed since the last tag. Needs VB-Cable + VLC. |
```

and add after the Complete Preflight Script block:

```markdown
### Capture Smoke

`release:preflight` runs `npm run smoke:capture` **only if** audio code changed
since the last tag. Most releases touch dock/UI code and skip it entirely,
touching no hardware.

When it does run, read the exit code:

| Exit | Meaning | What to do |
|------|---------|------------|
| 0 | Live capture agrees with the file path | Continue |
| 1 | **Assertion failed** | A real capture-layer defect. **Stop.** Do not widen the tolerance, do not proceed. |
| 2 | **Rig unusable** (no VB-Cable, no VLC, device busy) | Not a code signal. Fix the rig, or **stop and ask the user**. |

**There is no bypass flag, on purpose.** The capture layer has no other
coverage — CI runners have no sound card — so skipping this ships a version whose
audio path nobody checked. If you cannot get it green, that decision belongs to
the user, not to you.
```

- [ ] **Step 3: Verify formatting**

Run: `npm run format:check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md skills/plvs-release/SKILL.md
git commit -m "docs: record the capture smoke gate and soak trigger" -m "CLAUDE.md carries the trigger because it is the only doc guaranteed to be read at the moment it matters: it enters every agent session automatically, while the project README is read by users downloading the app, not by whoever just landed an audio change. The author does not type these commands and will not remember them, so the reminder has to reach the agent instead." -m "The release skill records what each exit code means and that there is no bypass. An agent hitting a red gate is prone to reaching for an escape hatch to get unstuck, which is exactly why none exists." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Manual verification

**Files:** none

Needs VB-Cable, VLC, and a release build. No CI runner can do any of this.

- [ ] **Step 1: Build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml --release --bin plvs-cli`

- [ ] **Step 2: Smoke, happy path**

Run: `npm run smoke:capture`
Expected: exit 0; file and live figures agree; `droppedChunks` 0.

- [ ] **Step 3: Prove the check can fail.** A check that has never gone red is not known to work. Temporarily break the tolerance in `scripts/capture-rig.mjs` (e.g. set `samplePeakMaxRDb: 0.0001`), re-run, confirm exit 1 and that the failure names the field. **Revert the edit.**

- [ ] **Step 4: Prove the rig path reports 2.** Rename or stop VB-Cable (or temporarily change `VB_CABLE_RENDER_NAME` to a name that does not exist), re-run, confirm exit **2** and a message that names the missing piece rather than blaming the code. **Revert.**

This distinction is the whole point of the two exit codes; verify it rather than assuming it.

- [ ] **Step 5: The conditional gate skips when it should**

Run: `node -e "import('./scripts/audio-code-changed.mjs').then(m => console.log(m.audioChangesSinceLastTag()))"`
Expected: reports the last tag and the audio paths changed since it. Sanity-check the answer against `git log --oneline <tag>..HEAD`.

- [ ] **Step 6: Soak, short run**

Run: `node scripts/soak-capture.mjs --seconds 90 --every 5`
Expected: exit 0; drift spread reported and small; RSS start/end printed.

- [ ] **Step 7: Record the real baseline.** Run a real soak (`npm run soak:capture`, 4 h, overnight) and write the measured post-warmup drift spread and RSS start/end into the Follow-on section of `docs/superpowers/specs/2026-07-16-capture-soak-design.md`. Until this exists, `DRIFT_LIMIT_DB` is a guess — the one part of that spec that is not yet honest.

---

## Known Gaps

- **macOS is not covered.** `audio/macos/` has its own capture path and this rig cannot reach it. Unchanged by this work; still unverified.
- **The soak measures `plvs-cli`, not the desktop app.** They share `audio/`, `dsp/`, and `engine/`, which is where a capture-layer leak would live — but the GUI additionally runs `MeterPipeline`, the IPC channel, and a React frontend, none of which this touches. The two processes' memory profiles are not comparable: the CLI's `SummaryMeter` accumulates without bound by design, while the GUI's history is bounded by the retention setting.
- **`DRIFT_LIMIT_DB` is a guess** until Task 6 Step 7 replaces it with a measured figure.
