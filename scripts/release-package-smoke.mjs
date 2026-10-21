#!/usr/bin/env node
/**
 * Release-package smoke: runs the exact release candidate a user downloads, on a capture rig
 * runner, without installing it and without touching the maintainer's real PLVS profile.
 *
 * Windows runs the portable ZIP, macOS a copy of the app from the DMG, Linux the files of the
 * .deb unpacked with `dpkg-deb -x`. The app starts with `--plvs-test-app-data-root` (ADR 0035) on
 * a seeded profile whose only change is Agent Control enabled, and its WebView data is moved
 * beside it where the platform allows. The package's own `plvs-cli` then drives the
 * Agent Control smoke and a Live capture of the rig tone.
 *
 * Exit codes follow smoke:capture: 0 passed, 1 the package failed a check, 2 rig or tool problem.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  acceptanceRunId,
  completeScenarioCoverage,
  hostPlatform,
  normalizePlatform,
  resolveEvidenceSourceSha,
  sha256File,
  writeJsonAtomic,
} from "./acceptance-evidence.mjs";
import {
  ROOT,
  RigError,
  SIGNAL,
  resolveLinuxCaptureRoute,
  resolveMacRenderDevice,
  resolveRenderEndpointId,
  selectMacCaptureDevice,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
} from "./capture-rig.mjs";
import {
  parseJsonEnvelope,
  retryUnsettledRenderOnce,
  runAgentControlSmoke,
  verifyArtifactBuffer,
} from "./smoke-agent-control.mjs";

export const AGENT_CONTROL_SCENARIOS = [
  "discovery-and-capabilities",
  "inspect-and-safe-start",
  "settings-navigation",
  "screenshot",
  "settings-cleanup",
  "silent-recording",
];
export const REQUIRED_SCENARIOS = [
  "package-staging",
  "isolated-launch",
  ...AGENT_CONTROL_SCENARIOS,
  "capture-device-selection",
  "live-capture-signal",
  "metering-screenshot",
];

/** Integrated loudness is a windowed statistic; the peaks are direct PCM properties. */
export const TONE_TOLERANCE_DB = { integratedLufs: 0.5, peakDbfs: 0.5 };
const LAUNCH_TIMEOUT_MS = 120_000;
const CAPTURE_SETTLE_MS = 2_000;
const MEASURE_SECONDS = 10;

const usage =
  "Usage: node scripts/release-package-smoke.mjs --candidate <release-candidate-dir> [--out-dir <dir>] [--wait]";

export function parseArgs(args) {
  let candidate;
  let outDir;
  let wait = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--wait") {
      wait = true;
      continue;
    }
    const value = args[index + 1];
    if (!["--candidate", "--out-dir"].includes(flag) || !value || value.startsWith("--")) {
      throw new Error(usage);
    }
    if (flag === "--candidate") candidate = value;
    else outDir = value;
    index += 1;
  }
  if (!candidate) throw new Error(usage);
  return { candidate: resolve(candidate), outDir: outDir && resolve(outDir), wait };
}

/** The asset `release.yml` publishes for this platform, named exactly as users download it. */
export function candidatePackage(platform, candidateDir, version) {
  const names = {
    windows: `PLVS-v${version}-x64-portable.zip`,
    macos: `PLVS-v${version}-aarch64.dmg`,
    linux: `PLVS_${version}_amd64.deb`,
  };
  if (!names[platform]) throw new RigError(`No release package for ${platform}.`);
  const file = join(candidateDir, "release-assets", names[platform]);
  if (!existsSync(file)) throw new RigError(`Release candidate is missing ${file}.`);
  return file;
}

/** Paths of the staged package's app and CLI, relative to its staging directory. */
export function stagedLayout(platform, stageDir) {
  if (platform === "windows") {
    return { app: join(stageDir, "plvs.exe"), cli: join(stageDir, "plvs-cli.exe") };
  }
  if (platform === "macos") {
    const contents = join(stageDir, "PLVS.app", "Contents", "MacOS");
    return { app: join(contents, "plvs"), cli: join(contents, "plvs-cli") };
  }
  return {
    app: join(stageDir, "usr", "bin", "plvs"),
    cli: join(stageDir, "usr", "bin", "plvs-cli"),
    sidecars: join(stageDir, "usr", "lib", "plvs", "sidecars"),
  };
}

/**
 * The legacy store a first launch migrates. Agent Control is the only enabled automation; the
 * update choice is made and automatic checks are off, so no first-run dialog or network check
 * appears; closing quits instead of hiding to the tray.
 */
export function isolatedProfileSeed() {
  return {
    agentControlEnabled: true,
    "plvs:settings": {
      closeAction: "quit",
      updatePreferences: { choiceMade: true, autoCheck: false, autoDownload: false },
    },
  };
}

/** How to start the staged app on its isolated profile. */
export function launchCommand(platform, layout, isolation) {
  const args = ["--plvs-test-app-data-root", isolation.dataRoot];
  if (platform === "macos")
    return { command: layout.app, args: ["-ApplePersistenceIgnoreState", "YES", ...args], env: {} };
  if (platform === "windows") {
    // The data-root argument does not move WebView2's profile; this variable does.
    return { command: layout.app, args, env: { WEBVIEW2_USER_DATA_FOLDER: isolation.webviewRoot } };
  }
  return {
    command: layout.app,
    args,
    env: {
      // WebKitGTK keeps its data under these; XDG_RUNTIME_DIR stays, it holds the Pulse socket.
      XDG_DATA_HOME: join(isolation.webviewRoot, "data"),
      XDG_CACHE_HOME: join(isolation.webviewRoot, "cache"),
      // The packaged path is /usr/lib/plvs/sidecars; the unpacked copy lives in the stage.
      PLVS_FFMPEG_DIR: layout.sidecars,
    },
  };
}

/**
 * The release check never accepts an unrecorded package. Linux recording uses the runner's
 * distribution FFmpeg rather than anything in the package (ADR 0037), so an unavailable recorder
 * there is the rig's problem; on Windows and macOS it is the package's.
 */
export function requireRecordingScenario(platform, scenarios) {
  return scenarios.map((scenario) => {
    if (scenario.id !== "silent-recording" || scenario.status !== "unsupported") return scenario;
    const observations = scenario.observations ?? [];
    return platform === "linux"
      ? {
          ...scenario,
          status: "rigUnavailable",
          observations: [
            ...observations,
            "The release check must record; install the distribution FFmpeg on the runner with `sudo apt install ffmpeg`.",
          ],
        }
      : {
          ...scenario,
          status: "failed",
          observations: [...observations, "The release package must record on this platform."],
        };
  });
}

/** The app's device row for the rig's capture side, by the same names smoke:capture uses. */
export function selectRigDevice(platform, devices, { linuxSinkName } = {}) {
  if (!Array.isArray(devices)) throw new RigError("device list returned no devices.");
  if (platform === "macos") return selectMacCaptureDevice({ status: "ok", devices });
  const matches =
    platform === "windows"
      ? devices.filter(
          (device) => device.direction === "input" && /^CABLE Output\b/.test(device.label)
        )
      : devices.filter(
          (device) => typeof device.label === "string" && device.label.includes(linuxSinkName)
        );
  if (matches.length !== 1) {
    const labels = devices.map((device) => `${device.label} (${device.kind})`).join(", ");
    throw new RigError(
      `Expected exactly one rig capture device, found ${matches.length}. Devices: ${labels || "none"}.`
    );
  }
  return matches[0];
}

/**
 * The rig tone's readings. Both channels carry a 1 kHz sine, where BS.1770's K-weighting and its
 * -0.691 offset cancel to within 0.01 dB, so integrated loudness is the summed channel power.
 */
export function expectedTone(signal = SIGNAL) {
  const power = [signal.peakLDb, signal.peakRDb]
    .map((peakDb) => 10 ** (peakDb / 10) / 2)
    .reduce((sum, value) => sum + value, 0);
  return { integratedLufs: 10 * Math.log10(power), peakDbfs: [signal.peakLDb, signal.peakRDb] };
}

/** Every reason a fresh Live measurement is not the rig tone; null readings fail, never skip. */
export function judgeTone(measurement, expected = expectedTone()) {
  const failures = [];
  if (measurement?.source?.state !== "running") {
    failures.push(`Live is ${measurement?.source?.state ?? "unknown"}, not running`);
  }
  if (measurement?.sample?.freshness !== "fresh") {
    failures.push(`the sample is ${measurement?.sample?.freshness ?? "missing"}, not fresh`);
  }
  const check = (label, got, want, tolerance) => {
    if (typeof got !== "number" || !Number.isFinite(got)) {
      failures.push(`${label} is ${got === null ? "null" : "not a finite number"}`);
    } else if (Math.abs(got - want) > tolerance) {
      failures.push(`${label} is ${got.toFixed(2)}, expected ${want.toFixed(2)} ± ${tolerance}`);
    }
  };
  check(
    "integrated loudness",
    measurement?.loudness?.integratedLufs,
    expected.integratedLufs,
    TONE_TOLERANCE_DB.integratedLufs
  );
  const channels = measurement?.levels?.channels ?? [];
  expected.peakDbfs.forEach((peak, index) =>
    check(
      `Ch${index + 1} sample peak`,
      channels[index]?.peakDbfs ?? null,
      peak,
      TONE_TOLERANCE_DB.peakDbfs
    )
  );
  return failures;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function runTool(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new RigError(
      `${command} ${args[0] ?? ""} failed: ${result.stderr?.trim() || result.error?.message || `status ${result.status}`}`
    );
  }
  return result.stdout ?? "";
}

function stagePackage(platform, file, stageDir) {
  mkdirSync(stageDir, { recursive: true });
  if (platform === "windows") {
    runTool("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${file.replaceAll("'", "''")}' -DestinationPath '${stageDir.replaceAll("'", "''")}'`,
    ]);
    return;
  }
  if (platform === "macos") {
    const mount = mkdtempSync(join(tmpdir(), "plvs-dmg-"));
    runTool("hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-noautoopen",
      "-mountpoint",
      mount,
      file,
    ]);
    try {
      runTool("ditto", [join(mount, "PLVS.app"), join(stageDir, "PLVS.app")]);
    } finally {
      spawnSync("hdiutil", ["detach", mount, "-force"], { stdio: "ignore" });
      rmSync(mount, { recursive: true, force: true });
    }
    return;
  }
  runTool("dpkg-deb", ["-x", file, stageDir]);
  // Unpacking installs none of the package's Depends; name the ones the runner lacks.
  const names = installedPackageNames(
    runTool("dpkg-query", ["-W", "-f=${Status}\\t${Package}\\t${Provides}\\n"])
  );
  const installed = (name) => names.has(name);
  const missing = missingDebDependencies(runTool("dpkg-deb", ["-f", file, "Depends"]), installed);
  if (missing.length > 0) {
    throw new RigError(
      `The runner lacks packages the deb depends on: ${missing.join(", ")}. Install them with apt.`
    );
  }
}

/**
 * Installed package names plus the virtual names they provide, from `dpkg-query -W` lines of
 * status, package and Provides. Ubuntu 24.04's time_t transition renamed libraries such as
 * libgtk-3-0 to libgtk-3-0t64, which provides the old name that Tauri's bundler still lists.
 */
export function installedPackageNames(output) {
  const names = new Set();
  for (const line of output.split("\n")) {
    const [status, name, provides = ""] = line.split("\t");
    if (status !== "install ok installed" || !name) continue;
    names.add(name);
    for (const virtual of provides.split(",")) {
      const provided = virtual.trim().split(/[\s(:]/)[0];
      if (provided) names.add(provided);
    }
  }
  return names;
}

/** Each `Depends` group none of whose alternatives `installed` reports, as written. */
export function missingDebDependencies(depends, installed) {
  return depends
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean)
    .filter(
      (group) =>
        !group
          .split("|")
          .map((alternative) => alternative.trim().split(/[\s(:]/)[0])
          .some((name) => installed(name))
    );
}

/** Linux runners under systemd --user have no display; give the app a private Xvfb. */
export async function ensureLinuxDisplay() {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return { env: {}, stop() {} };
  if (!existsSync("/usr/bin/Xvfb")) {
    throw new RigError("No DISPLAY or WAYLAND_DISPLAY and /usr/bin/Xvfb is absent. Install xvfb.");
  }
  const server = spawn(
    "/usr/bin/Xvfb",
    ["-displayfd", "3", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
    {
      stdio: ["ignore", "ignore", "ignore", "pipe"],
    }
  );
  const display = await new Promise((resolveDisplay, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new RigError("Xvfb did not report a display.")), 10_000);
    server.stdio[3].on("data", (chunk) => {
      text += chunk;
      if (text.includes("\n")) {
        clearTimeout(timer);
        resolveDisplay(text.trim());
      }
    });
    server.on("exit", () => reject(new RigError("Xvfb exited before reporting a display.")));
  });
  return {
    env: { DISPLAY: `:${display}`, GDK_BACKEND: "x11" },
    stop() {
      server.kill("SIGTERM");
    },
  };
}

/**
 * Keep the display awake for this process on macOS. A display that sleeps mid-run stops WebView
 * animation frames, so visual captures cannot settle. It cannot unlock an already locked screen.
 */
export function keepDisplayAwake(platform, pid = process.pid, spawnProcess = spawn) {
  if (platform !== "macos") return null;
  return spawnProcess("caffeinate", ["-d", "-i", "-w", String(pid)], { stdio: "ignore" });
}

function launchApp({ command, args, env }, logFile) {
  const log = [];
  // A runner without a session bus gets a private one; the app and its bus then share a process
  // group, which stopApp ends as a whole.
  const privateBus =
    process.platform === "linux" &&
    !process.env.DBUS_SESSION_BUS_ADDRESS &&
    existsSync("/usr/bin/dbus-run-session");
  const child = spawn(
    privateBus ? "/usr/bin/dbus-run-session" : command,
    privateBus ? ["--", command, ...args] : args,
    {
      env: { ...process.env, ...env },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    }
  );
  child.stdout.on("data", (chunk) => log.push(chunk));
  child.stderr.on("data", (chunk) => log.push(chunk));
  return {
    child,
    saveLog() {
      try {
        writeFileSync(logFile, Buffer.concat(log));
      } catch {
        // The log is a diagnosis aid; losing it must not change the verdict.
      }
    },
  };
}

function stopApp(app) {
  const child = app?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    // By PID, never by image name: that would also end the maintainer's own PLVS.
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function cliRunner(cli, env) {
  return (label, args) => {
    const result = spawnSync(cli, args, {
      env: { ...process.env, ...env },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    });
    if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
    const envelope = parseJsonEnvelope(label, result.stdout ?? "");
    if (result.status !== 0) throw new Error(`${label} exited with status ${result.status}.`);
    return envelope.result;
  };
}

async function waitForInstance(cli, app) {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let last = "no answer";
  while (Date.now() < deadline) {
    if (app.child.exitCode !== null)
      throw new Error(`PLVS exited with status ${app.child.exitCode} during launch.`);
    try {
      const { instances } = cli("instances", ["instances", "--json"]);
      if (instances.length === 1) {
        const inspected = cli("ui inspect", [
          "ui",
          "inspect",
          "--json",
          "--instance",
          instances[0].instanceId,
        ]);
        if (inspected.window?.visible === true) return instances[0].instanceId;
        last = "the window is not visible yet";
      } else {
        last = `${instances.length} instances`;
      }
    } catch (error) {
      last = error.message;
    }
    await sleep(500);
  }
  throw new Error(`Agent Control did not answer within ${LAUNCH_TIMEOUT_MS / 1000}s: ${last}`);
}

/** Files below `root`, so the evidence shows the isolated profile was the one written. */
function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(root);
  return files;
}

export async function runReleasePackageSmoke({ candidate, outDir, wait, sourceSha, version }) {
  const platform = normalizePlatform();
  const startedAt = new Date();
  const runId = acceptanceRunId(startedAt);
  outDir ??= join(ROOT, "artifacts", "release-package-smoke", sourceSha.slice(0, 8), runId);
  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "plvs-package-smoke-"));
  const isolation = { dataRoot: join(work, "data"), webviewRoot: join(work, "webview") };
  const completed = [];
  const artifacts = [];
  const warnings = [];
  const cleanup = [];
  let cleanupFailed = false;
  let current = "package-staging";
  let failure = null;
  let packageRecord = null;
  let route = null;
  let player = null;
  let app = null;
  let display = null;
  let measurement = null;
  let selected = null;
  let liveStarted = false;
  let instanceId = null;
  const pass = (id, observations = []) => {
    completed.push({ id, status: "passed", observations });
    current = null;
  };

  const signal = join(work, "signal.wav");
  const awake = keepDisplayAwake(platform);
  awake?.on("error", (error) => warnings.push(`caffeinate did not start: ${error.message}`));
  try {
    const file = candidatePackage(platform, candidate, version);
    packageRecord = {
      file: file.split(/[\\/]/).pop(),
      bytes: statSync(file).size,
      sha256: sha256File(file),
    };
    const stageDir = join(work, "package");
    stagePackage(platform, file, stageDir);
    const layout = stagedLayout(platform, stageDir);
    for (const path of [layout.app, layout.cli]) {
      if (!existsSync(path))
        throw new Error(`The package has no ${path.slice(stageDir.length + 1)}.`);
    }
    pass("package-staging", [
      `Staged ${packageRecord.file} (${packageRecord.sha256}) without installing it.`,
    ]);

    current = "isolated-launch";
    // Create the rig route before launch, so the app's first device inventory already holds it.
    if (platform === "linux") route = resolveLinuxCaptureRoute();
    const playerTarget =
      platform === "windows"
        ? resolveRenderEndpointId()
        : platform === "macos"
          ? String(resolveMacRenderDevice().audioObjectId)
          : route.playerTarget;
    if (platform === "linux") display = await ensureLinuxDisplay();
    await writeJsonAtomic(join(isolation.dataRoot, "plvs-settings.json"), isolatedProfileSeed());
    const launch = launchCommand(platform, layout, isolation);
    launch.env = { ...launch.env, ...display?.env };
    app = launchApp(launch, join(outDir, "app.log"));
    const cliEnv = { PLVS_TEST_IDENTITY_ROOT: join(isolation.dataRoot, "multi-instance") };
    const cli = cliRunner(layout.cli, { ...cliEnv, ...display?.env });
    instanceId = await waitForInstance(cli, app);
    const store = join(isolation.dataRoot, "multi-instance", "migration-complete.json");
    if (!existsSync(store))
      throw new Error("The app did not create its store in the isolated data root.");
    if (platform === "windows" && listFiles(isolation.webviewRoot).length === 0) {
      throw new Error("WebView2 did not use the isolated user data folder.");
    }
    pass("isolated-launch", [`Instance ${instanceId} answered on the isolated profile.`]);

    current = null;
    const smokeDir = join(outDir, "agent-control");
    let smoke;
    try {
      smoke = await runAgentControlSmoke({
        executable: layout.cli,
        outDir: smokeDir,
        instanceId,
        sourceSha,
        env: { ...cliEnv, ...display?.env },
      });
    } catch (error) {
      const evidence = error.evidencePath
        ? JSON.parse(readFileSync(error.evidencePath, "utf8"))
        : null;
      for (const scenario of evidence?.scenarios ?? []) completed.push(scenario);
      artifacts.push(...(evidence?.artifacts ?? []));
      throw error;
    }
    const scenarios = requireRecordingScenario(platform, smoke.evidence.scenarios);
    for (const scenario of scenarios) completed.push(scenario);
    artifacts.push(...smoke.evidence.artifacts);
    warnings.push(...smoke.evidence.warnings);
    const recording = scenarios.find(({ id }) => id === "silent-recording");
    if (recording?.status === "rigUnavailable") {
      throw new RigError(recording.observations.join(" "));
    }
    if (recording?.status === "failed" && smoke.evidence.summary !== "failed") {
      throw new Error(recording.observations.join(" "));
    }
    if (smoke.evidence.summary !== "complete") {
      throw new Error(`Agent Control smoke is ${smoke.evidence.summary}.`);
    }

    const run = (label, args) => cli(label, [...args, "--instance", instanceId, "--json"]);
    current = "capture-device-selection";
    const inventory = run("device list", ["device", "list"]);
    const device = selectRigDevice(platform, inventory.devices, {
      linuxSinkName: route?.captureDevice,
    });
    const selectedResult = run("device select", [
      "device",
      "select",
      device.id,
      "--expected-revision",
      String(inventory.revision),
      "--expected-generation",
      String(inventory.generation),
    ]);
    if (selectedResult.state?.selection?.requestedId !== device.id) {
      throw new Error("device select did not take the rig device.");
    }
    selected = { id: device.id, label: device.label, kind: device.kind };
    pass("capture-device-selection", [`Selected ${device.label} (${device.kind}).`]);

    current = "live-capture-signal";
    await synthesizeSignal(signal);
    player = await startPlayer(playerTarget, signal, { wait });
    await sleep(CAPTURE_SETTLE_MS);
    const inspected = run("inspect", ["inspect"]);
    run("transport live start", [
      "transport",
      "live",
      "start",
      "--expected-revision",
      String(inspected.revision),
    ]);
    liveStarted = true;
    await sleep(MEASURE_SECONDS * 1000);
    measurement = run("measurement inspect", ["measurement", "inspect"]);
    const failures = judgeTone(measurement);
    if (failures.length > 0)
      throw new Error(`The Live reading is not the rig tone: ${failures.join("; ")}.`);
    const channels = measurement.levels.channels;
    pass("live-capture-signal", [
      `Integrated ${measurement.loudness.integratedLufs.toFixed(2)} LUFS, peaks ${channels[0].peakDbfs.toFixed(2)} / ${channels[1].peakDbfs.toFixed(2)} dBFS.`,
    ]);

    current = "metering-screenshot";
    const screenshotPath = join(outDir, "main-metering.png");
    const screenshot = await retryUnsettledRenderOnce(
      "metering screenshot",
      () =>
        run("visual screenshot", [
          "visual",
          "screenshot",
          "--target",
          "main",
          "--out",
          screenshotPath,
        ]),
      warnings
    );
    const check = verifyArtifactBuffer(
      "screenshot",
      await readFile(screenshotPath),
      screenshot.artifact
    );
    artifacts.push({
      id: "main-metering-screenshot",
      kind: "image/png",
      file: screenshotPath,
      ...check,
    });
    pass("metering-screenshot", [
      `Captured ${check.bytes} bytes with SHA-256 ${check.sha256} while metering.`,
    ]);
  } catch (error) {
    failure = error;
    if (current)
      completed.push({
        id: current,
        status: error instanceof RigError ? "rigUnavailable" : "failed",
        observations: [error.message],
      });
  } finally {
    if (liveStarted && app) {
      try {
        const cli = cliRunner(stagedLayout(platform, join(work, "package")).cli, {
          PLVS_TEST_IDENTITY_ROOT: join(isolation.dataRoot, "multi-instance"),
        });
        const inspected = cli("inspect", ["inspect", "--instance", instanceId, "--json"]);
        cli("transport live stop", [
          "transport",
          "live",
          "stop",
          "--instance",
          instanceId,
          "--expected-revision",
          String(inspected.revision),
          "--json",
        ]);
        cleanup.push("Stopped Live capture.");
      } catch (error) {
        warnings.push(`Live stop before shutdown failed: ${error.message}`);
      }
    }
    stopPlayer(player);
    if (player) cleanup.push("Stopped the rig player.");
    if (route?.release) {
      try {
        route.release();
        cleanup.push("Removed the private null sink.");
      } catch (error) {
        cleanupFailed = true;
        cleanup.push(error.message);
      }
    }
    if (app) {
      stopApp(app);
      app.saveLog();
      cleanup.push("Ended the staged PLVS process by PID.");
    }
    display?.stop();
    awake?.kill();
    // Windows releases file handles after the process tree ends; give it a moment.
    await sleep(1000);
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      cleanup.push("Removed the staged package and its isolated profile.");
    } catch (error) {
      warnings.push(`Could not remove ${work}: ${error.message}`);
    }
  }

  const coverage = completeScenarioCoverage(REQUIRED_SCENARIOS, completed);
  const evidence = {
    schemaVersion: 1,
    // The packaged app's Agent Control acceptance; tool.name tells it from the dev-app smoke.
    domain: "agent-control",
    runId,
    sourceSha,
    platform: hostPlatform(),
    tool: { name: "release-package-smoke", version: 1 },
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    summary: cleanupFailed ? "failed" : coverage.summary,
    scenarios: coverage.scenarios,
    // Relative to the evidence directory, which is what the workflow uploads.
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      file: relative(outDir, artifact.file).replaceAll("\\", "/"),
    })),
    cleanup: { status: cleanupFailed ? "failed" : "passed", observations: cleanup },
    warnings: failure ? [failure.message, ...warnings] : warnings,
    package: packageRecord && {
      file: packageRecord.file,
      bytes: packageRecord.bytes,
      sha256: packageRecord.sha256,
      version,
    },
    captureDevice: selected,
    expected: expectedTone(),
    measurement: measurement && {
      loudness: measurement.loudness,
      levels: measurement.levels,
      sample: measurement.sample,
    },
  };
  const evidencePath = join(outDir, "result.json");
  await writeJsonAtomic(evidencePath, evidence);
  return { evidence, evidencePath, failure };
}

async function main() {
  const { candidate, outDir, wait } = parseArgs(process.argv.slice(2));
  const sourceSha = resolveEvidenceSourceSha(ROOT);
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const { evidence, evidencePath, failure } = await runReleasePackageSmoke({
    candidate,
    outDir,
    wait,
    sourceSha,
    version,
  });
  for (const scenario of evidence.scenarios)
    console.log(`${scenario.status.padEnd(15)} ${scenario.id}`);
  console.log(`Evidence: ${evidencePath}`);
  if (evidence.summary === "complete") {
    console.log(
      `\nOK ${evidence.package.file} opened, answered Agent Control and metered the rig tone.`
    );
    return;
  }
  if (failure)
    console.error(`\n${failure instanceof RigError ? "RIG" : "FAIL"} ${failure.message}`);
  process.exitCode = evidence.summary === "failed" ? 1 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`TOOL ${error.message}`);
    process.exitCode = 2;
  });
}
