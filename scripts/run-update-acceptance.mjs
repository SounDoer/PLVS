// Guided packaged-update acceptance. Product mutations still go through the real PLVS UI; this
// runner owns staging, the loopback feed, offline restart, polling, evidence, and cleanup checks.
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { createAcceptanceFeed } from "./serve-update-acceptance.mjs";
import {
  artifactEvidence,
  manualUpdateScenarios,
  requiredUpdateScenarios,
} from "./update-acceptance-evidence.mjs";
import {
  acceptanceNames,
  platformDescriptor,
  resolveReceiptFile,
  validateAcceptanceReceipt,
  writeJsonAtomic,
} from "./update-acceptance-lib.mjs";

const usage = "Usage: node scripts/run-update-acceptance.mjs <artifact-root> [--run-id <id>]";
const POLL_MS = 250;
const CHECKPOINT_TIMEOUT_MS = 10 * 60 * 1_000;

export function parseRunArguments(args) {
  if (!args[0] || args[0].startsWith("--")) throw new Error(usage);
  let runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
  if (args.length > 1) {
    if (args.length !== 3 || args[1] !== "--run-id" || !/^[a-zA-Z0-9][\w.-]*$/.test(args[2])) {
      throw new Error(usage);
    }
    runId = args[2];
  }
  return { root: path.resolve(args[0]), runId };
}

export function macAcceptanceLaunch(app, dataRoot) {
  return {
    command: path.join(app, "Contents", "MacOS", "plvs"),
    args: ["-ApplePersistenceIgnoreState", "YES", "--plvs-test-app-data-root", dataRoot],
  };
}

export function acceptanceBootstrapMarker(dataRoot) {
  return path.join(dataRoot, "multi-instance", "migration-complete.json");
}

export function macReadOnlyDmgLayout(root, runDir, receipt) {
  const mountRoot = path.join(runDir, "read-only dmg");
  return {
    dmg: resolveReceiptFile(root, receipt.versions[0].dmg),
    mountRoot,
    dataRoot: path.join(runDir, "read-only dmg data"),
    app: path.join(mountRoot, `${receipt.productName}.app`),
  };
}

export function mountReportsReadOnly(output, mountRoot) {
  const marker = ` on ${mountRoot} (`;
  return output.split(/\r?\n/).some((line) => {
    const markerIndex = line.indexOf(marker);
    if (markerIndex < 0) return false;
    return line
      .slice(markerIndex + marker.length)
      .split(")", 1)[0]
      .split(",")
      .some((option) => option.trim() === "read-only");
  });
}

export function windowsAcceptanceInstall(installer, installRoot) {
  return {
    command: installer,
    args: ["/S", `/D=${installRoot}`],
    options: { windowsVerbatimArguments: true },
  };
}

export function windowsAcceptanceLaunch(app, dataRoot) {
  return { command: app, args: ["--plvs-test-app-data-root", dataRoot] };
}

export function comparableDock(dock) {
  return {
    enabled: dock?.enabled,
    edge: dock?.edge,
    height: dock?.height,
    reserveSpace: dock?.reserveSpace,
    panels: (dock?.panels || []).map((panel) => ({
      id: panel.id,
      moduleId: panel.moduleId,
      width: panel.width,
      widthMode: panel.widthMode,
      controls: panel.controls,
    })),
  };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsVerbatimArguments: options.windowsVerbatimArguments,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} failed`);
  }
  return result.stdout.trim();
}

function launchBackground(command, args, { newProcessGroup = true, env = {} } = {}) {
  const child = spawn(command, args, {
    detached: newProcessGroup,
    env: { ...process.env, ...env },
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

export function helperPauseMarker(attemptFile) {
  return path.join(path.dirname(attemptFile), "acceptance-helper-paused");
}

function cliJson(cli, dataRoot, args) {
  return JSON.parse(
    run(cli, [...args, "--json"], {
      env: { PLVS_TEST_IDENTITY_ROOT: path.join(dataRoot, "multi-instance") },
    })
  );
}

function developmentUpdateAction(cli, dataRoot, action, ui, options = {}) {
  const args = [
    "dev",
    "update",
    action,
    "--expected-revision",
    String(ui.result.revision),
    "--expected-ui-generation",
    String(ui.result.uiGeneration),
  ];
  if (options.surfaceId) args.push("--surface-id", options.surfaceId);
  if (options.preferences) {
    args.push("--auto-check", String(options.preferences.autoCheck));
    args.push("--auto-download", String(options.preferences.autoDownload));
  }
  return cliJson(cli, dataRoot, args);
}

async function openUpdateDetails(cli, dataRoot) {
  let ui = cliJson(cli, dataRoot, ["ui", "inspect"]);
  let surface = findUpdateSurface(ui.result);
  if (surface) return { ui, surface };
  developmentUpdateAction(cli, dataRoot, "open", ui);
  ui = await waitFor(
    "update details",
    () => cliJson(cli, dataRoot, ["ui", "inspect"]),
    (value) => Boolean(findUpdateSurface(value.result)),
    30_000
  );
  surface = findUpdateSurface(ui.result);
  return { ui, surface };
}

async function confirmVisibleUpdate(cli, dataRoot) {
  const { ui, surface } = await openUpdateDetails(cli, dataRoot);
  developmentUpdateAction(cli, dataRoot, "confirm", ui, { surfaceId: surface.surfaceId });
}

async function waitFor(label, inspect, accept, timeout = CHECKPOINT_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = inspect();
      if (accept(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

function findNamedFile(root, name) {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findNamedFile(candidate, name);
      if (found) return found;
    } else if (entry.name === name) return candidate;
  }
  return null;
}

function readReady(dataRoot) {
  const state = findNamedFile(path.join(dataRoot, "updates"), "state.json");
  return state ? { file: state, value: JSON.parse(readFileSync(state, "utf8")) } : null;
}

export function seedAcceptanceSettings(dataRoot, dockEnabled) {
  mkdirSync(dataRoot, { recursive: true });
  writeJsonAtomic(path.join(dataRoot, "plvs-settings.json"), {
    agentControlEnabled: true,
    // The first launch migrates this legacy store, taking app settings only from "plvs:settings".
    "plvs:settings": {
      closeAction: "quit",
      // Preserve the fresh-install chooser while seeding the legacy file needed for Dock state.
      // Native migration owns moving this installation-wide preference into the library.
      updatePreferences: { choiceMade: false, autoCheck: false, autoDownload: false },
    },
    dockState: {
      enabled: dockEnabled,
      edge: "bottom",
      height: 160,
      reserveSpace: false,
    },
  });
}

function artifactList(runDir, names) {
  return names
    .filter((name) => existsSync(path.join(runDir, name)))
    .map((name) =>
      artifactEvidence(
        runDir,
        name,
        name.endsWith(".png")
          ? "image/png"
          : name.endsWith(".jsonl")
            ? "application/x-ndjson"
            : "application/json"
      )
    );
}

function readRequestEvents(requestLog) {
  if (!existsSync(requestLog)) return [];
  return readFileSync(requestLog, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function hasFeedPackageRequest(events, fault, packageEndpoint) {
  return events.some((event) => event.fault === fault && event.path === packageEndpoint);
}

function feedPackageRequestCount(events, fault, packageEndpoint) {
  return events.filter((event) => event.fault === fault && event.path === packageEndpoint).length;
}

export function findUpdateSurface(uiResult) {
  return uiResult?.surfaces?.find(
    (surface) => surface.kind === "update" && surface.target?.phase !== "preferences"
  );
}

async function captureRejectedPackage({
  cli,
  dataRoot,
  runDir,
  requestLog,
  fault,
  packageEndpoint,
  screenshot,
}) {
  await waitFor(
    `${fault} package request`,
    () => readRequestEvents(requestLog),
    (events) => hasFeedPackageRequest(events, fault, packageEndpoint)
  );
  const automaticRequestCount = feedPackageRequestCount(
    readRequestEvents(requestLog),
    fault,
    packageEndpoint
  );
  await openUpdateDetails(cli, dataRoot);
  const ui = await waitFor(
    `${fault} visible error`,
    () => {
      const current = cliJson(cli, dataRoot, ["ui", "inspect"]);
      const surface = findUpdateSurface(current.result);
      // The package request can be observed before the automatic transfer releases its lease.
      // Retry the Agent Control confirmation while the real dialog remains idle; once the
      // transfer settles, exactly one attempt advances to installing or its visible error.
      if (surface?.target?.phase === "idle") {
        developmentUpdateAction(cli, dataRoot, "confirm", current, {
          surfaceId: surface.surfaceId,
        });
      }
      return current;
    },
    (value) => findUpdateSurface(value.result)?.target?.phase === "install-error"
  );
  const retryRequestCount = feedPackageRequestCount(
    readRequestEvents(requestLog),
    fault,
    packageEndpoint
  );
  if (retryRequestCount <= automaticRequestCount) {
    throw new Error(`${fault} did not retry the rejected package through the visible update flow`);
  }
  if (readReady(dataRoot)?.value.ready) {
    throw new Error(`${fault} unexpectedly left a ready update in the cache`);
  }
  const surface = findUpdateSurface(ui.result);
  const screenshotTarget = ui.result.window?.form === "dock" ? "dock-update" : "main";
  cliJson(cli, dataRoot, [
    "visual",
    "screenshot",
    "--target",
    screenshotTarget,
    "--expected-revision",
    String(ui.result.revision),
    "--expected-ui-generation",
    String(ui.result.uiGeneration),
    "--out",
    path.join(runDir, screenshot),
  ]);
  cliJson(cli, dataRoot, [
    "ui",
    "cancel",
    surface.surfaceId,
    "--expected-revision",
    String(ui.result.revision),
    "--expected-ui-generation",
    String(ui.result.uiGeneration),
  ]);
  return { status: "passed" };
}

function terminateOwnedMacApp(app) {
  const executable = path.join(app, "Contents", "MacOS", "plvs");
  const rows = run("ps", ["-axo", "pid=,command="]).split("\n");
  const pids = rows.flatMap((row) => {
    const match = row.trim().match(/^(\d+)\s+(.+)$/);
    return match && (match[2] === executable || match[2].startsWith(`${executable} `))
      ? [Number(match[1])]
      : [];
  });
  for (const pid of pids) process.kill(pid, "SIGTERM");
  return pids;
}

async function interruptOwnedMacHelper(attemptFile, attempt) {
  const pid = attempt.helperPid;
  if (!Number.isInteger(pid)) throw new Error("Interrupted helper attempt recorded no helper PID");
  const ticket = JSON.parse(
    readFileSync(path.join(path.dirname(attemptFile), "worker-ticket.json"), "utf8")
  );
  const executable = path.join(
    path.dirname(attemptFile),
    "plvs-update-worker.app",
    "Contents",
    "MacOS",
    path.basename(ticket.target)
  );
  const command = run("ps", ["-p", String(pid), "-o", "command="]);
  if (command !== executable && !command.startsWith(`${executable} `)) {
    throw new Error(`Refusing to interrupt unexpected helper process ${pid}: ${command}`);
  }
  process.kill(pid, "SIGKILL");
  await waitFor(
    "interrupted macOS helper exit",
    () => {
      try {
        run("ps", ["-p", String(pid), "-o", "pid="]);
        return false;
      } catch {
        return true;
      }
    },
    Boolean,
    10_000
  );
}

function windowsOwnedPids(executable) {
  const output = run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$target=$env:PLVS_ACCEPTANCE_EXE; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object ProcessId",
    ],
    { env: { PLVS_ACCEPTANCE_EXE: executable } }
  );
  return output.split(/\r?\n/).filter(Boolean).map(Number).filter(Number.isInteger);
}

function terminateOwnedWindowsApp(executable) {
  const pids = windowsOwnedPids(executable);
  for (const pid of pids) {
    run("taskkill.exe", ["/PID", String(pid)]);
  }
  return pids;
}

async function interruptOwnedWindowsHelper(attemptFile, attempt) {
  const pid = attempt.helperPid;
  if (!Number.isInteger(pid)) throw new Error("Interrupted helper attempt recorded no helper PID");
  const executable = path.join(path.dirname(attemptFile), "plvs-update-worker.exe");
  const actual = run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      '(Get-CimInstance Win32_Process -Filter "ProcessId=$env:PLVS_ACCEPTANCE_PID").ExecutablePath',
    ],
    { env: { PLVS_ACCEPTANCE_PID: String(pid) } }
  );
  if (path.resolve(actual).toLowerCase() !== path.resolve(executable).toLowerCase()) {
    throw new Error(`Refusing to interrupt unexpected helper process ${pid}: ${actual}`);
  }
  run("taskkill.exe", ["/F", "/PID", String(pid)]);
}

function windowsRegistryInstallDir(productName) {
  return run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$key=Join-Path 'HKCU:\\Software\\SounDoer' $env:PLVS_ACCEPTANCE_PRODUCT; if (Test-Path -LiteralPath $key) { (Get-ItemProperty -LiteralPath $key).InstallDir }",
    ],
    { env: { PLVS_ACCEPTANCE_PRODUCT: productName } }
  );
}

async function runGuidedAcceptance({
  root,
  runId,
  receipt,
  runDir,
  dataRoot,
  cli,
  launch,
  terminate,
  interruptHelper,
  cleanup,
  platformVersion,
  nativeScenarios,
}) {
  const [older, newer] = receipt.versions;
  seedAcceptanceSettings(dataRoot, true);
  if (receipt.platform.os === "windows") {
    const settingsFile = path.join(dataRoot, "plvs-settings.json");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    settings.dockState.reserveSpace = true;
    writeJsonAtomic(settingsFile, settings);
  }
  const requestLog = path.join(runDir, "requests.jsonl");
  writeFileSync(requestLog, "");
  let feedFault = "stale-signature";
  const server = createAcceptanceFeed({
    root,
    fault: () => feedFault,
    onRequest: (event) => appendFileSync(requestLog, `${JSON.stringify(event)}\n`),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(receipt.feed.port, receipt.feed.host, resolve);
  });
  let feedClosed = false;
  async function closeFeed() {
    if (feedClosed) return;
    feedClosed = true;
    await new Promise((resolve) => server.close(resolve));
  }
  const startedAt = new Date().toISOString();
  try {
    launch();
    await waitFor(
      "packaged app persistence bootstrap",
      () => existsSync(acceptanceBootstrapMarker(dataRoot)),
      Boolean,
      60_000
    );
    const capabilities = await waitFor(
      "packaged app launch",
      () => cliJson(cli, dataRoot, ["capabilities"]),
      (value) => value.result?.appVersion === older.version,
      60_000
    );
    if (capabilities.result.runtime?.identifier !== receipt.identity) {
      throw new Error("Running app identity does not match the acceptance receipt");
    }
    const before = await waitFor(
      "packaged app inspection",
      () => cliJson(cli, dataRoot, ["inspect"]),
      (value) => Number.isSafeInteger(value.result?.revision),
      60_000
    );
    writeJsonAtomic(path.join(runDir, "before.json"), before);
    const preferencesUi = await waitFor(
      "update preferences",
      () => cliJson(cli, dataRoot, ["ui", "inspect"]),
      (value) =>
        value.result?.surfaces?.some(
          (surface) => surface.kind === "update" && surface.target?.phase === "preferences"
        ),
      60_000
    );
    const preferencesSurface = preferencesUi.result.surfaces.find(
      (surface) => surface.kind === "update" && surface.target?.phase === "preferences"
    );
    developmentUpdateAction(cli, dataRoot, "preferences", preferencesUi, {
      surfaceId: preferencesSurface.surfaceId,
      preferences: { autoCheck: true, autoDownload: true },
    });
    await waitFor(
      "saved update preferences",
      () => cliJson(cli, dataRoot, ["ui", "inspect"]),
      (value) =>
        !value.result?.surfaces?.some(
          (surface) => surface.kind === "update" && surface.target?.phase === "preferences"
        ),
      60_000
    );
    const packageEndpoint = platformDescriptor().packageEndpoint;
    const rejectionScenarios = [];
    rejectionScenarios.push({
      id: "stale-signature-rejected",
      ...(await captureRejectedPackage({
        cli,
        dataRoot,
        runDir,
        requestLog,
        fault: feedFault,
        packageEndpoint,
        screenshot: "stale-signature-rejected.png",
      })),
    });
    async function restartOlderApp(label) {
      const pids = terminate();
      if (!pids.length) throw new Error(`${label}: isolated app was not running`);
      await waitFor(label, () => cleanup.processesExited(pids), Boolean, 10_000);
      launch();
      await waitFor(
        label,
        () => cliJson(cli, dataRoot, ["capabilities"]),
        (value) => value.result?.appVersion === older.version,
        60_000
      );
    }
    feedFault = "truncated-package";
    await restartOlderApp("truncated-package relaunch");
    rejectionScenarios.push({
      id: "truncated-package-rejected",
      ...(await captureRejectedPackage({
        cli,
        dataRoot,
        runDir,
        requestLog,
        fault: feedFault,
        packageEndpoint,
        screenshot: "truncated-package-rejected.png",
      })),
    });
    feedFault = "valid";
    await restartOlderApp("valid-package relaunch");
    await waitFor(
      "automatic update download",
      () => readReady(dataRoot),
      (value) => value?.value.ready
    );
    await closeFeed();
    const quitUi = cliJson(cli, dataRoot, ["ui", "inspect"]);
    developmentUpdateAction(cli, dataRoot, "quit", quitUi);
    await waitFor(
      "isolated app shutdown",
      () => {
        try {
          cliJson(cli, dataRoot, ["capabilities"]);
          return false;
        } catch {
          return true;
        }
      },
      Boolean
    );
    launch({ interruptHelper: true });
    await waitFor(
      "offline relaunch",
      () => cliJson(cli, dataRoot, ["capabilities"]),
      (value) => value.result?.appVersion === older.version,
      60_000
    );
    const revision = cliJson(cli, dataRoot, ["inspect"]).result.revision;
    try {
      await waitFor(
        "offline update-details screenshot",
        () =>
          cliJson(cli, dataRoot, [
            "visual",
            "screenshot",
            "--target",
            "dock-update",
            "--expected-revision",
            String(revision),
            "--out",
            path.join(runDir, "update-details.png"),
          ]),
        (value) => value.result?.artifact?.mediaType === "image/png",
        30_000
      );
    } catch (error) {
      console.warn(`Update-details screenshot was unavailable: ${error.message}`);
    }
    await confirmVisibleUpdate(cli, dataRoot);
    const pauseMarker = await waitFor(
      "acceptance helper pause",
      () => findNamedFile(path.join(dataRoot, "updates"), "acceptance-helper-paused"),
      Boolean
    );
    const attemptFile = path.join(path.dirname(pauseMarker), "attempt.json");
    if (helperPauseMarker(attemptFile) !== pauseMarker) {
      throw new Error("Acceptance helper pause marker was outside the attempt directory");
    }
    const installingAttempt = await waitFor(
      "interrupted helper installing attempt",
      () => JSON.parse(readFileSync(attemptFile, "utf8")),
      (value) => value.phase === "installing" && Number.isInteger(value.helperPid)
    );
    await interruptHelper(attemptFile, installingAttempt);
    launch();
    await waitFor(
      "interrupted helper recovery relaunch",
      () => cliJson(cli, dataRoot, ["capabilities"]),
      (value) => value.result?.appVersion === older.version,
      60_000
    );
    const interruptedAttempt = await waitFor(
      "interrupted helper reconciliation",
      () => JSON.parse(readFileSync(attemptFile, "utf8")),
      (value) =>
        value.phase === "failed" &&
        typeof value.error === "string" &&
        value.error.includes("interrupted before it finished"),
      60_000
    );
    copyFileSync(attemptFile, path.join(runDir, "helper-interrupted-attempt.json"));
    if (!readReady(dataRoot)?.value.ready) {
      throw new Error("Interrupted helper recovery removed the verified ready package");
    }
    // The public UI contract deliberately reports update details as phase `idle`; the recorded
    // attempt above owns the error verdict while this check proves that the real details are open.
    // A failed attempt for the same cached version deliberately suppresses the automatic
    // startup dialog. Open the retained ready package through Agent Control to verify the real
    // recovery details and retry path without clicking the UI.
    const { ui: interruptedUi, surface: interruptedSurface } = await openUpdateDetails(
      cli,
      dataRoot
    );
    const interruptedScreenshot = await waitFor(
      "interrupted helper screenshot",
      () =>
        cliJson(cli, dataRoot, [
          "visual",
          "screenshot",
          "--target",
          interruptedUi.result.window?.form === "dock" ? "dock-update" : "main",
          "--expected-revision",
          String(interruptedUi.result.revision),
          "--expected-ui-generation",
          String(interruptedUi.result.uiGeneration),
          "--out",
          path.join(runDir, "helper-interrupted.png"),
        ]),
      (value) => value.result?.artifact?.mediaType === "image/png",
      30_000
    );
    cliJson(cli, dataRoot, [
      "ui",
      "cancel",
      interruptedSurface.surfaceId,
      "--expected-revision",
      String(interruptedScreenshot.result.revision),
      "--expected-ui-generation",
      String(interruptedScreenshot.result.uiGeneration),
    ]);
    // The visible Cancel action is the ready package's "Skip This Time" action. It closes the
    // details while deliberately retaining the verified cache; reopening below proves both parts
    // of that contract before retrying the install.
    const skippedUi = cliJson(cli, dataRoot, ["ui", "inspect"]);
    if (findUpdateSurface(skippedUi.result)) {
      throw new Error("Interrupted update details remained visible after skip");
    }
    if (!readReady(dataRoot)?.value.ready) {
      throw new Error("Skipping the interrupted update removed the verified ready package");
    }
    await confirmVisibleUpdate(cli, dataRoot);
    const attempt = await waitFor(
      "installer completion after interrupted-helper retry",
      () => JSON.parse(readFileSync(attemptFile, "utf8")),
      (value) =>
        (value.phase === "finished" || value.phase === "failed") &&
        (value.helperPid !== interruptedAttempt.helperPid ||
          value.helperStart !== interruptedAttempt.helperStart)
    );
    if (attempt.phase !== "finished") {
      throw new Error(`Installer retry failed: ${attempt.error ?? "unknown error"}`);
    }
    const afterCapabilities = await waitFor(
      "updated app relaunch",
      () => cliJson(cli, dataRoot, ["capabilities"]),
      (value) =>
        value.result?.appVersion === newer.version && value.result?.cliVersion === newer.version,
      60_000
    );
    const after = cliJson(cli, dataRoot, ["inspect"]);
    writeJsonAtomic(path.join(runDir, "after.json"), after);
    writeJsonAtomic(path.join(runDir, "capabilities-after.json"), afterCapabilities);
    copyFileSync(attemptFile, path.join(runDir, "helper-attempt.json"));
    const cacheAfter = readReady(dataRoot);
    if (cacheAfter) copyFileSync(cacheAfter.file, path.join(runDir, "cache-state-after.json"));
    try {
      cliJson(cli, dataRoot, [
        "visual",
        "screenshot",
        "--target",
        "main",
        "--expected-revision",
        String(after.result.revision),
        "--out",
        path.join(runDir, "restored-dock.png"),
      ]);
    } catch (error) {
      console.warn(`Restored-Dock screenshot was unavailable: ${error.message}`);
    }
    const beforeResult = before.result;
    const afterResult = after.result;
    const stateEqual =
      JSON.stringify(beforeResult.settings) === JSON.stringify(afterResult.settings) &&
      JSON.stringify(beforeResult.workspace) === JSON.stringify(afterResult.workspace);
    const dockEqual =
      JSON.stringify(comparableDock(beforeResult.dock)) ===
      JSON.stringify(comparableDock(afterResult.dock));
    const readyCleared = cacheAfter?.value.ready === null;
    const scenarioStatus = (passed) => (passed ? "passed" : "failed");
    const scenarios = [
      { id: "writable-path-offline-update", status: "passed" },
      { id: "cached-offer-survives-restart", status: "passed" },
      { id: "version-and-cli-advance", status: "passed" },
      { id: "persistence-restored", status: scenarioStatus(stateEqual) },
      { id: "dock-restored", status: scenarioStatus(dockEqual) },
      { id: "helper-finished", status: "passed" },
      { id: "helper-interruption-recovered", status: "passed" },
      { id: "cache-cleared", status: scenarioStatus(readyCleared) },
      ...nativeScenarios(attempt),
      ...rejectionScenarios,
      ...manualUpdateScenarios(receipt.platform.os).map((id) => ({
        id,
        status: "notRun",
        reason: "manual or release-only checkpoint",
      })),
    ];
    const incomplete = requiredUpdateScenarios(receipt.platform.os).some(
      (id) => scenarios.find((scenario) => scenario.id === id)?.status !== "passed"
    );
    const failed = scenarios.some((scenario) => scenario.status === "failed");
    const terminatedPids = terminate();
    if (!terminatedPids.length) {
      throw new Error("The updated isolated app was not running at its recorded installation path");
    }
    await waitFor(
      "isolated app cleanup",
      () => cleanup.processesExited(terminatedPids),
      Boolean,
      10_000
    );
    await cleanup.installation();
    const result = {
      schemaVersion: 1,
      domain: "update",
      runId,
      sourceSha: receipt.sourceSha,
      identity: acceptanceNames(receipt.sourceSha).identity,
      platform: { ...receipt.platform, version: platformVersion() },
      tool: { name: "update-acceptance", version: 1 },
      startedAt,
      endedAt: new Date().toISOString(),
      summary: failed ? "failed" : incomplete ? "incomplete" : "complete",
      scenarios,
      artifacts: artifactList(runDir, [
        "before.json",
        "after.json",
        "capabilities-after.json",
        "helper-attempt.json",
        "helper-interrupted-attempt.json",
        "cache-state-after.json",
        "requests.jsonl",
        "update-details.png",
        "restored-dock.png",
        "stale-signature-rejected.png",
        "truncated-package-rejected.png",
        "helper-interrupted.png",
        "read-only-dmg.json",
        "read-only-dmg-guidance.png",
      ]),
      cleanup: {
        status: "passed",
        observations: [
          "The feed was stopped and all app processes launched from the isolated installation path exited.",
        ],
      },
      warnings: [
        "Update UI actions were exercised through the packaged app's acceptance-only Agent Control surface.",
      ],
    };
    writeJsonAtomic(path.join(runDir, "result.json"), result);
    console.log(`Acceptance result ready: ${path.join(runDir, "result.json")}`);
    return result;
  } catch (error) {
    await closeFeed();
    try {
      const pids = terminate();
      if (pids.length) {
        await waitFor(
          "failed-run process cleanup",
          () => cleanup.processesExited(pids),
          Boolean,
          10_000
        );
      }
      await cleanup.installation();
    } catch (cleanupError) {
      console.warn(`Failed-run cleanup needs attention: ${cleanupError.message}`);
    }
    throw error;
  }
}

export async function runMacReadOnlyDmg({ root, runDir, receipt, stagingRoot = runDir }) {
  const layout = macReadOnlyDmgLayout(root, stagingRoot, receipt);
  mkdirSync(layout.mountRoot, { recursive: true });
  seedAcceptanceSettings(layout.dataRoot, false);
  let mounted = false;
  let launched = false;
  try {
    run("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      layout.mountRoot,
      layout.dmg,
    ]);
    mounted = true;
    const mounts = run("mount", []);
    if (!mountReportsReadOnly(mounts, layout.mountRoot)) {
      throw new Error(`DMG was not mounted read-only at ${layout.mountRoot}`);
    }
    const cli = path.join(layout.app, "Contents", "MacOS", "plvs-cli");
    const launchCommand = macAcceptanceLaunch(layout.app, layout.dataRoot);
    launchBackground(launchCommand.command, launchCommand.args, { newProcessGroup: false });
    launched = true;
    await waitFor(
      "read-only DMG persistence bootstrap",
      () => existsSync(acceptanceBootstrapMarker(layout.dataRoot)),
      Boolean,
      60_000
    );
    const capabilities = await waitFor(
      "read-only DMG app launch",
      () => cliJson(cli, layout.dataRoot, ["capabilities"]),
      (value) => value.result?.appVersion === receipt.versions[0].version,
      60_000
    );
    if (capabilities.result.runtime?.identifier !== receipt.identity) {
      throw new Error("Read-only DMG app identity does not match the acceptance receipt");
    }
    let inspected = await waitFor(
      "read-only DMG UI bridge",
      () => cliJson(cli, layout.dataRoot, ["ui", "inspect"]),
      (value) =>
        Number.isSafeInteger(value.result?.revision) &&
        Number.isSafeInteger(value.result?.uiGeneration) &&
        value.result?.window?.visible === true,
      60_000
    );
    const preferencesSurface = inspected.result.surfaces?.find(
      (surface) => surface.kind === "update" && surface.target?.phase === "preferences"
    );
    if (preferencesSurface) {
      developmentUpdateAction(cli, layout.dataRoot, "preferences", inspected, {
        surfaceId: preferencesSurface.surfaceId,
        preferences: { autoCheck: false, autoDownload: false },
      });
      inspected = await waitFor(
        "read-only DMG update preference dismissal",
        () => cliJson(cli, layout.dataRoot, ["ui", "inspect"]),
        (value) =>
          !value.result?.surfaces?.some(
            (surface) => surface.kind === "update" && surface.target?.phase === "preferences"
          ),
        60_000
      );
    }
    const shown = await waitFor(
      "read-only DMG About settings",
      () =>
        cliJson(cli, layout.dataRoot, [
          "ui",
          "show",
          "settings",
          "--section",
          "about",
          "--expected-revision",
          String(inspected.result.revision),
          "--expected-ui-generation",
          String(inspected.result.uiGeneration),
        ]),
      (value) =>
        value.result?.surface?.kind === "settings" &&
        value.result?.surface?.target?.section === "about",
      60_000
    );
    if (
      shown.result.surface?.kind !== "settings" ||
      shown.result.surface?.target?.section !== "about"
    ) {
      throw new Error("Read-only DMG did not open the About settings section");
    }
    let screenshot = null;
    try {
      screenshot = cliJson(cli, layout.dataRoot, [
        "visual",
        "screenshot",
        "--target",
        "main",
        "--expected-revision",
        String(shown.result.revision),
        "--expected-ui-generation",
        String(shown.result.uiGeneration),
        "--out",
        path.join(runDir, "read-only-dmg-guidance.png"),
      ]);
      if (screenshot.result?.artifact?.mediaType !== "image/png") {
        throw new Error("Agent Control did not return a PNG artifact");
      }
    } catch (error) {
      // The read-only refusal is established by the mounted filesystem, the real About surface,
      // and the absence of a staged package. A cold WebView can occasionally fail the stricter
      // canvas-settlement check used only for visual evidence; do not relaunch the scenario and
      // lose the already-observed product verdict merely because that supporting image is absent.
      console.warn(`Read-only DMG guidance screenshot was unavailable: ${error.message}`);
      screenshot = null;
    }
    const ready = readReady(layout.dataRoot);
    if (ready?.value.ready) {
      throw new Error("Read-only DMG unexpectedly staged a ready update");
    }
    writeJsonAtomic(path.join(runDir, "read-only-dmg.json"), {
      appVersion: capabilities.result.appVersion,
      identity: capabilities.result.runtime.identifier,
      mountPoint: layout.mountRoot,
      mountReadOnly: true,
      settingsSection: shown.result.surface.target.section,
      screenshotCaptured: screenshot !== null,
      ready: ready?.value.ready ?? null,
    });
    // The isolated DMG app is terminated in `finally`; closing About through the frontend adds no
    // product assertion after the verdict above and can race a screenshot settlement that the
    // bridge is still unwinding.
    return { id: "read-only-dmg-refusal", status: "passed" };
  } finally {
    if (launched) {
      const pids = terminateOwnedMacApp(layout.app);
      if (pids.length) {
        await waitFor(
          "read-only DMG app cleanup",
          () => {
            const rows = run("ps", ["-axo", "pid=,command="]);
            return pids.every((pid) => !new RegExp(`^\\s*${pid}\\s`, "m").test(rows));
          },
          Boolean,
          10_000
        );
      }
    }
    if (mounted) run("hdiutil", ["detach", layout.mountRoot]);
  }
}

async function runMacAcceptance({ root, runId, receipt }) {
  const runDir = path.join(root, "runs", runId);
  if (existsSync(runDir)) throw new Error(`Run directory already exists: ${runDir}`);
  const installRoot = path.join(runDir, "install with spaces");
  const dataRoot = path.join(runDir, "data with spaces");
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  const archive = resolveReceiptFile(root, receipt.versions[0].file);
  run("tar", ["-xzf", archive, "-C", installRoot], { env: { COPYFILE_DISABLE: "1" } });
  const app = path.join(installRoot, `${receipt.productName}.app`);
  const cli = path.join(app, "Contents", "MacOS", "plvs-cli");
  const launchCommand = macAcceptanceLaunch(app, dataRoot);
  const result = await runGuidedAcceptance({
    root,
    runId,
    receipt,
    runDir,
    dataRoot,
    cli,
    launch: ({ interruptHelper = false } = {}) =>
      launchBackground(launchCommand.command, launchCommand.args, {
        newProcessGroup: false,
        env: interruptHelper ? { PLVS_UPDATE_ACCEPTANCE_INTERRUPT_HELPER: "1" } : {},
      }),
    interruptHelper: interruptOwnedMacHelper,
    terminate: () => terminateOwnedMacApp(app),
    cleanup: {
      processesExited: (pids) => {
        const rows = run("ps", ["-axo", "pid=,command="]);
        return pids.every((pid) => !new RegExp(`^\\s*${pid}\\s`, "m").test(rows));
      },
      installation: () => {},
    },
    platformVersion: () => run("sw_vers", ["-productVersion"]),
    nativeScenarios: () => [
      { id: "apfs-bundle-swap", status: "passed" },
      {
        id: "read-only-dmg-refusal",
        status: "notRun",
        reason: "Runs after the writable installation is fully cleaned up",
      },
    ],
  });
  // Both packages intentionally share the acceptance identity. Exercise the read-only DMG only
  // after the writable app has exited so macOS cannot route its launch into the earlier process.
  let readOnlyDmgScenario;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      readOnlyDmgScenario = await runMacReadOnlyDmg({
        root,
        runDir,
        receipt,
        stagingRoot: path.join(runDir, `.read-only-dmg-attempt-${attempt}`),
      });
      break;
    } catch (error) {
      if (attempt === 1) {
        console.warn(`Read-only DMG cold-start attempt failed; retrying once: ${error.message}`);
      } else {
        readOnlyDmgScenario = {
          id: "read-only-dmg-refusal",
          status: "failed",
          reason: error.message,
        };
      }
    }
  }
  result.scenarios = result.scenarios.map((scenario) =>
    scenario.id === "read-only-dmg-refusal" ? readOnlyDmgScenario : scenario
  );
  const incomplete = requiredUpdateScenarios(receipt.platform.os).some(
    (id) => result.scenarios.find((scenario) => scenario.id === id)?.status !== "passed"
  );
  result.summary = result.scenarios.some((scenario) => scenario.status === "failed")
    ? "failed"
    : incomplete
      ? "incomplete"
      : "complete";
  result.endedAt = new Date().toISOString();
  result.artifacts.push(
    ...artifactList(runDir, ["read-only-dmg.json", "read-only-dmg-guidance.png"])
  );
  writeJsonAtomic(path.join(runDir, "result.json"), result);
  return result;
}

async function runWindowsAcceptance({ root, runId, receipt }) {
  const runDir = path.join(root, "runs", runId);
  if (existsSync(runDir)) throw new Error(`Run directory already exists: ${runDir}`);
  const installRoot = path.join(runDir, "Installed App With Spaces");
  const dataRoot = path.join(runDir, "data with spaces");
  mkdirSync(dataRoot, { recursive: true });
  const installer = resolveReceiptFile(root, receipt.versions[0].file);
  const install = windowsAcceptanceInstall(installer, installRoot);
  run(install.command, install.args, install.options);
  const app = path.join(installRoot, "plvs.exe");
  const cli = path.join(installRoot, "plvs-cli.exe");
  if (!existsSync(app) || !existsSync(cli)) {
    throw new Error(`NSIS did not create the expected installed app and CLI under ${installRoot}`);
  }
  const registeredInstall = windowsRegistryInstallDir(receipt.productName);
  if (path.resolve(registeredInstall).toLowerCase() !== path.resolve(installRoot).toLowerCase()) {
    throw new Error(`NSIS registered an unexpected install path: ${registeredInstall}`);
  }
  const launchCommand = windowsAcceptanceLaunch(app, dataRoot);
  const launch = ({ interruptHelper = false } = {}) =>
    launchBackground(launchCommand.command, launchCommand.args, {
      env: interruptHelper ? { PLVS_UPDATE_ACCEPTANCE_INTERRUPT_HELPER: "1" } : {},
    });
  return runGuidedAcceptance({
    root,
    runId,
    receipt,
    runDir,
    dataRoot,
    cli,
    launch,
    interruptHelper: interruptOwnedWindowsHelper,
    terminate: () => terminateOwnedWindowsApp(app),
    cleanup: {
      processesExited: (pids) => {
        const live = new Set(windowsOwnedPids(app));
        return pids.every((pid) => !live.has(pid));
      },
      installation: async () => {
        const uninstaller = path.join(installRoot, "uninstall.exe");
        if (!existsSync(uninstaller))
          throw new Error(`Missing isolated uninstaller: ${uninstaller}`);
        run(uninstaller, ["/S"]);
        await waitFor(
          "isolated NSIS cleanup",
          () => windowsRegistryInstallDir(receipt.productName),
          (value) => value === "",
          30_000
        );
      },
    },
    platformVersion: () =>
      run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Environment]::OSVersion.VersionString",
      ]),
    nativeScenarios: (attempt) => [
      {
        id: "nsis-installer-replacement",
        status: Number.isInteger(attempt.installerPid) ? "passed" : "failed",
      },
    ],
  });
}

export async function runUpdateAcceptance(options) {
  const receipt = JSON.parse(readFileSync(path.join(options.root, "acceptance.json"), "utf8"));
  validateAcceptanceReceipt(receipt, options.root);
  const host = platformDescriptor();
  if (host.os !== receipt.platform.os || host.arch !== receipt.platform.arch) {
    throw new Error(
      `Receipt targets ${receipt.platform.os}/${receipt.platform.arch}, host is ${host.os}/${host.arch}`
    );
  }
  return host.os === "macos"
    ? runMacAcceptance({ ...options, receipt })
    : runWindowsAcceptance({ ...options, receipt });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runUpdateAcceptance(parseRunArguments(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
