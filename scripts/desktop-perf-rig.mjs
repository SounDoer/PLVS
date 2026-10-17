import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  CAPTURE_DEVICE,
  RigError,
  ROOT,
  locateHarness,
  resolveCaptureRoute,
  resolveRenderEndpointId,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
} from "./capture-rig.mjs";
import { attachToMainWebView, wait } from "./webview-observability.mjs";

export const DEFAULT_EXE = join(ROOT, "src-tauri", "target", "release", "plvs.exe");
export const MACOS_DEFAULT_EXE = join(
  ROOT,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "PLVS Dev.app",
  "Contents",
  "MacOS",
  "plvs"
);
const DEV_APP_ID = "com.soundoer.plvs.dev";

export function defaultDesktopExecutable(platform = process.platform) {
  return platform === "darwin" ? MACOS_DEFAULT_EXE : DEFAULT_EXE;
}

export function conflictingMacDevPids(processList, executable) {
  const exact = resolve(executable);
  return String(processList)
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(Boolean)
    .filter((match) => {
      const command = match[2];
      return (
        command === exact ||
        command.startsWith(`${exact} `) ||
        command.includes("/PLVS Dev.app/Contents/MacOS/plvs")
      );
    })
    .map((match) => Number(match[1]));
}

export function macConsoleIsLocked(ioregOutput) {
  return /"IOConsoleLocked"\s*=\s*Yes/.test(String(ioregOutput));
}

function assertMacPerformanceIsolation(executable) {
  const consoleState = spawnSync("/usr/sbin/ioreg", ["-n", "Root", "-d1"], {
    encoding: "utf8",
  });
  if (consoleState.status === 0 && macConsoleIsLocked(consoleState.stdout)) {
    throw new RigError(
      "the macOS console is locked; unlock it before desktop performance acceptance"
    );
  }
  const list = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (list.status !== 0)
    throw new Error(list.stderr?.trim() || "could not inspect macOS processes");
  const conflicts = conflictingMacDevPids(list.stdout, executable);
  if (conflicts.length > 0) {
    throw new Error(
      `another PLVS Dev process is running (${conflicts.join(", ")}); close it before desktop performance acceptance`
    );
  }
}

export function parseRigArgs(argv, defaults = {}) {
  const options = {
    port: 9222,
    exe: defaultDesktopExecutable(),
    device: process.platform === "win32" ? CAPTURE_DEVICE : null,
    scenario: "default",
    ...defaults,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const take = () => {
      if (inline === undefined) i += 1;
      return inline ?? argv[i];
    };
    if (flag === "--port") options.port = Number(take());
    else if (flag === "--exe") options.exe = resolve(String(take()));
    else if (flag === "--device") options.device = String(take());
    else if (flag === "--scenario") options.scenario = String(take());
    else if (flag === "--seconds") options.seconds = Number(take());
    else if (flag === "--every") options.every = Number(take());
    else if (flag === "--stall-ms") options.stallMs = Number(take());
    else if (flag === "--browser-args") options.browserArgs = String(take());
    else if (flag === "--out") options.out = resolve(String(take()));
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(options.port) || options.port <= 0)
    throw new Error("--port must be a port");
  if (!new Set(["default", "heavy", "all"]).has(options.scenario)) {
    throw new Error('--scenario must be "default", "heavy", or "all"');
  }
  for (const key of ["seconds", "every", "stallMs"]) {
    if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] <= 0)) {
      throw new Error(`--${key === "stallMs" ? "stall-ms" : key} must be positive`);
    }
  }
  return options;
}

function terminateWindowsProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function terminateOwnedApp(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    terminateWindowsProcessTree(child.pid);
    return;
  }
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process exited after the timeout fired.
      }
      resolveExit();
    }, 1_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timer);
      resolveExit();
    }
  });
}

function safeTemporaryUserDataFolder(path) {
  const absolute = resolve(path);
  return (
    dirname(absolute).toLowerCase() === resolve(tmpdir()).toLowerCase() &&
    basename(absolute).startsWith("plvs-desktop-perf-")
  );
}

export async function launchDesktopPerfRig(options) {
  if (process.platform === "darwin") assertMacPerformanceIsolation(options.exe);
  const userDataFolder = await mkdtemp(join(tmpdir(), "plvs-desktop-perf-"));
  const wav = join(userDataFolder, "signal.wav");
  await synthesizeSignal(wav);
  const route =
    process.platform === "darwin"
      ? resolveCaptureRoute(locateHarness())
      : {
          platform: "win32",
          label: "VB-Cable",
          captureDevice: options.device ?? CAPTURE_DEVICE,
          playerTarget: resolveRenderEndpointId(),
        };
  const player = await startPlayer(route.playerTarget, wav);
  const identityRoot = join(userDataFolder, "multi-instance");
  const app = spawn(
    options.exe,
    process.platform === "darwin"
      ? ["-ApplePersistenceIgnoreState", "YES", "--plvs-test-app-data-root", userDataFolder]
      : [],
    {
      env: {
        ...process.env,
        ...(process.platform === "win32"
          ? {
              WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
                `--remote-debugging-port=${options.port} ${options.browserArgs ?? ""}`.trim(),
              WEBVIEW2_USER_DATA_FOLDER: userDataFolder,
            }
          : { PLVS_TEST_IDENTITY_ROOT: identityRoot }),
      },
      stdio: "ignore",
      windowsHide: false,
    }
  );
  let session = null;
  try {
    session =
      process.platform === "darwin"
        ? await attachToMacAgentControl(options.exe, identityRoot)
        : await attachToMainWebView(options.port);
    session.route = route;
    if (process.platform === "darwin") {
      await focusMacSession(session, app.pid);
    }
    return { app, player, session, userDataFolder, route };
  } catch (error) {
    await terminateOwnedApp(app);
    stopPlayer(player);
    if (safeTemporaryUserDataFolder(userDataFolder))
      await rm(userDataFolder, { recursive: true, force: true });
    throw error;
  }
}

export async function stopDesktopPerfRig(rig) {
  try {
    if (rig.session?.platform === "darwin") {
      await stopMacLiveCapture(rig.session).catch(() => {});
    } else {
      await rig.session
        ?.evaluate('window.__TAURI_INTERNALS__.invoke("audio_stop")')
        .catch(() => {});
    }
    if (rig.session?.platform !== "darwin" && rig.session?.captureDeviceRestoreLabel) {
      await clickByLabel(rig.session, "Devices").catch(() => {});
      await wait(150);
      await rig.session
        .evaluate(
          `(()=>{const label=${JSON.stringify(rig.session.captureDeviceRestoreLabel)};
          const hit=[...document.querySelectorAll("button")].find(button=>button.getAttribute("aria-label")===label);
          if(!hit)return false;hit.click();return true;})()`
        )
        .catch(() => {});
      await wait(250);
    }
  } finally {
    rig.session?.close();
    await terminateOwnedApp(rig.app);
    stopPlayer(rig.player);
    if (!safeTemporaryUserDataFolder(rig.userDataFolder)) {
      throw new Error(`refusing to remove unexpected temporary path: ${rig.userDataFolder}`);
    }
    await rm(rig.userDataFolder, { recursive: true, force: true });
  }
}

function parseControlReport(result, label) {
  const line = result.stdout?.trim().split(/\r?\n/).filter(Boolean).at(-1);
  let report;
  try {
    report = JSON.parse(line);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${line || "<empty>"}`);
  }
  if (result.status !== 0 || report?.ok !== true) {
    throw new Error(
      `${label} failed: ${report?.error?.message || result.stderr?.trim() || "unknown error"}`
    );
  }
  return report.result;
}

function macControl(executable, identityRoot, args) {
  const result = spawnSync(executable, ["--cli", DEV_APP_ID, ...args], {
    encoding: "utf8",
    env: { ...process.env, PLVS_TEST_IDENTITY_ROOT: identityRoot },
  });
  return parseControlReport(result, `plvs-cli ${args.slice(0, -1).join(" ")}`);
}

async function attachToMacAgentControl(executable, identityRoot, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const instances = macControl(executable, identityRoot, ["instances", "--json"]).instances;
      if (instances.length === 1) {
        macControl(executable, identityRoot, ["inspect", "--json"]);
        return {
          platform: "darwin",
          appPid: null,
          control: (args) => macControl(executable, identityRoot, args),
          inspect: () => macControl(executable, identityRoot, ["inspect", "--json"]),
          readPerformanceSnapshot: () =>
            macControl(executable, identityRoot, ["dev", "performance", "inspect", "--json"]),
          stall: (milliseconds) =>
            macControl(executable, identityRoot, [
              "dev",
              "performance",
              "stall",
              String(milliseconds),
              "--json",
            ]),
          close: () => {},
        };
      }
      if (instances.length > 1) throw new Error("isolated performance root has several instances");
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(
    `no isolated macOS Agent Control instance appeared` +
      (lastError ? ` (${lastError.message})` : "")
  );
}

async function focusMacSession(session, appPid) {
  if (!Number.isInteger(appPid) || appPid <= 0) throw new RigError("macOS app PID is invalid");
  const source = [
    "import AppKit",
    "import Foundation",
    `guard let app = NSRunningApplication(processIdentifier: ${appPid}) else { exit(2) }`,
    "var active = false",
    "for _ in 0..<15 {",
    "  _ = app.unhide()",
    "  _ = app.activate(options: [.activateAllWindows])",
    "  Thread.sleep(forTimeInterval: 0.2)",
    "  if app.isActive { active = true; break }",
    "}",
    'print(active ? "active" : "inactive")',
  ].join("\n");
  const activation = spawnSync("/usr/bin/xcrun", ["swift", "-e", source], { encoding: "utf8" });
  if (activation.status !== 0 || activation.stdout.trim() !== "active") {
    throw new RigError(
      `could not activate the isolated macOS app: ${activation.stderr?.trim() || activation.stdout?.trim() || "unknown error"}`
    );
  }
  const before = session.readPerformanceSnapshot().renderer.animationFrame.count;
  await wait(300);
  const after = session.readPerformanceSnapshot().renderer.animationFrame;
  if (after.count <= before || !Number.isFinite(after.latestAgeMs) || after.latestAgeMs > 250) {
    throw new RigError("the activated macOS renderer did not produce fresh animation frames");
  }
}

async function clickByLabel(session, label) {
  const found = await waitForValue(
    () =>
      session.evaluate(`(()=>{const hit=[...document.querySelectorAll("button")]
        .find(button=>button.getAttribute("aria-label")===${JSON.stringify(label)}||(button.innerText||"").trim()===${JSON.stringify(label)});
        if(!hit)return false;(hit.closest("[data-slot=popover-trigger]")||hit).click();return true;})()`),
    3_000
  );
  if (!found) {
    const available = await session.evaluate(
      '[...document.querySelectorAll("button")].map(button=>button.getAttribute("aria-label")||(button.innerText||"").trim()).filter(Boolean).slice(0,40)'
    );
    throw new Error(`button not found: ${label}; available: ${available.join(", ")}`);
  }
}

export async function configureScenario(session, scenario) {
  if (scenario === "default") return;
  if (session.platform === "darwin") {
    const inspection = session.inspect();
    const panels = inspection.workspace?.panels ?? [];
    const layout = {
      leafCount: panels.length,
      titles: panels.map((panel) => panel.title),
      moduleIds: panels.map((panel) => panel.moduleId),
    };
    if (layout.leafCount < 8 || !layout.moduleIds.includes("stereo-map")) {
      throw new Error(
        `heavy preset is not active: ${layout.leafCount} panels (${layout.titles.join(", ")})`
      );
    }
    return layout;
  }
  const ready = await waitUntil(
    () =>
      session.evaluate(
        'Boolean([...document.querySelectorAll("button")].find(button=>button.getAttribute("aria-label")==="Modules"))'
      ),
    15_000
  );
  if (!ready) throw new Error("PLVS frontend did not expose the Modules control");
  const layout =
    await session.evaluate(`(()=>{const leaves=[...document.querySelectorAll("[data-leaf-path]")];
    return {leafCount:leaves.length,titles:leaves.map(leaf=>(leaf.innerText||"").split("\\n")[0].trim())};})()`);
  if (layout.leafCount < 8 || !layout.titles.some((title) => /Stereo Map/i.test(title))) {
    throw new Error(
      `heavy preset is not active: ${layout.leafCount} visible leaves (${layout.titles.join(", ")})`
    );
  }
  return layout;
}

export async function startLiveCapture(session, device) {
  if (session.platform === "darwin") return startMacLiveCapture(session, device);
  const appLoaded = await waitUntil(
    () =>
      session.evaluate(
        'Boolean(document.querySelector("button[aria-label=Devices]") || [...document.querySelectorAll("button")].some(button=>(button.innerText||"").trim()==="START"))'
      ),
    15_000
  );
  if (!appLoaded) {
    const body = await session.evaluate("document.body?.innerText?.slice(0, 200) ?? ''");
    throw new Error(`PLVS frontend did not load${body ? `: ${body}` : ""}`);
  }
  const ready = await waitUntil(async () => {
    return session.evaluate(
      '[...document.querySelectorAll("button")].some(button=>button.getAttribute("aria-label")==="Devices"&&!button.disabled)'
    );
  }, 20_000);
  if (!ready) throw new Error("audio device list did not become available");

  await clickByLabel(session, "Devices");
  const selection = await waitForValue(
    () =>
      session.evaluate(`(()=>{const buttons=[...document.querySelectorAll("button")];
        const hit=buttons.find(button=>(button.getAttribute("aria-label")||"").startsWith(${JSON.stringify(device)}));
        if(!hit)return null;const previous=buttons.find(button=>button.querySelector(".bg-primary"))?.getAttribute("aria-label")??null;
        const selected=hit.getAttribute("aria-label");hit.click();return {previous,selected};})()`),
    3_000
  );
  if (!selection) throw new Error(`capture device not offered: ${device}`);
  if (selection.previous && selection.previous !== selection.selected) {
    session.captureDeviceRestoreLabel = selection.previous;
  }
  await wait(250);

  const started = await session.evaluate(`(()=>{const hit=[...document.querySelectorAll("button")]
    .find(button=>(button.innerText||"").trim()==="START");if(!hit)return false;hit.click();return true;})()`);
  if (!started) throw new Error("START button not found");
  await wait(2_000);
  return selection.selected;
}

async function startMacLiveCapture(session, requestedDevice) {
  const before = session.inspect();
  const device = requestedDevice ?? session.route.captureDevice;
  session.captureDeviceRestoreId = before.device.selection.requestedId;
  let revision = before.revision;
  if (before.device.selection.requestedId !== device) {
    const selected = session.control([
      "device",
      "select",
      device,
      "--expected-revision",
      String(revision),
      "--expected-generation",
      String(before.device.generation),
      "--json",
    ]);
    revision = selected.revision;
  }
  const started = session.control([
    "transport",
    "live",
    "start",
    "--expected-revision",
    String(revision),
    "--json",
  ]);
  session.liveRevision = started.revision;
  await wait(2_000);
  const running = session.inspect();
  if (running.transport.live.state !== "running") {
    throw new Error(
      `Live capture did not start: ${running.transport.live.error || "unknown error"}`
    );
  }
  return running.device.selection.resolved?.label ?? device;
}

async function stopMacLiveCapture(session) {
  let inspection = session.inspect();
  if (inspection.transport.live.state === "running") {
    const stopped = session.control([
      "transport",
      "live",
      "stop",
      "--expected-revision",
      String(inspection.revision),
      "--json",
    ]);
    inspection = session.inspect();
    if (stopped.revision !== inspection.revision) inspection = session.inspect();
  }
  const restoreId = session.captureDeviceRestoreId;
  if (restoreId && inspection.device.selection.requestedId !== restoreId) {
    session.control([
      "device",
      "select",
      restoreId,
      "--expected-revision",
      String(inspection.revision),
      "--expected-generation",
      String(inspection.device.generation),
      "--json",
    ]);
  }
}

async function waitUntil(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await wait(250);
  }
  return false;
}

async function waitForValue(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(100);
  }
  return null;
}
