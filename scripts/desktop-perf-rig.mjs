import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  CAPTURE_DEVICE,
  ROOT,
  resolveRenderEndpointId,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
} from "./capture-rig.mjs";
import { attachToMainWebView, wait } from "./webview-observability.mjs";

export const DEFAULT_EXE = join(ROOT, "src-tauri", "target", "release", "plvs.exe");

export function parseRigArgs(argv, defaults = {}) {
  const options = {
    port: 9222,
    exe: DEFAULT_EXE,
    device: CAPTURE_DEVICE,
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
  if (!new Set(["default", "heavy"]).has(options.scenario)) {
    throw new Error('--scenario must be "default" or "heavy"');
  }
  for (const key of ["seconds", "every", "stallMs"]) {
    if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] <= 0)) {
      throw new Error(`--${key === "stallMs" ? "stall-ms" : key} must be positive`);
    }
  }
  return options;
}

function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
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
  const userDataFolder = await mkdtemp(join(tmpdir(), "plvs-desktop-perf-"));
  const wav = join(userDataFolder, "signal.wav");
  await synthesizeSignal(wav);
  const player = startPlayer(resolveRenderEndpointId(), wav);
  const app = spawn(options.exe, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        `--remote-debugging-port=${options.port} ${options.browserArgs ?? ""}`.trim(),
      WEBVIEW2_USER_DATA_FOLDER: userDataFolder,
    },
    stdio: "ignore",
    windowsHide: false,
  });
  let session = null;
  try {
    session = await attachToMainWebView(options.port);
    return { app, player, session, userDataFolder };
  } catch (error) {
    terminateProcessTree(app.pid);
    stopPlayer(player);
    if (safeTemporaryUserDataFolder(userDataFolder))
      await rm(userDataFolder, { recursive: true, force: true });
    throw error;
  }
}

export async function stopDesktopPerfRig(rig) {
  try {
    await rig.session?.evaluate('window.__TAURI_INTERNALS__.invoke("audio_stop")').catch(() => {});
    if (rig.session?.captureDeviceRestoreLabel) {
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
    terminateProcessTree(rig.app?.pid);
    stopPlayer(rig.player);
    if (!safeTemporaryUserDataFolder(rig.userDataFolder)) {
      throw new Error(`refusing to remove unexpected temporary path: ${rig.userDataFolder}`);
    }
    await rm(rig.userDataFolder, { recursive: true, force: true });
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
