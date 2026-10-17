// Guided packaged-update acceptance. Product mutations still go through the real PLVS UI; this
// runner owns staging, the loopback feed, offline restart, polling, evidence, and cleanup checks.
import { spawnSync } from "node:child_process";
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
  UPDATE_MANUAL_SCENARIOS,
  UPDATE_REQUIRED_SCENARIOS,
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
    command: "open",
    args: ["-n", "-a", app, "--args", "--plvs-test-app-data-root", dataRoot],
  };
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
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} failed`);
  return result.stdout.trim();
}

function cliJson(cli, dataRoot, args) {
  return JSON.parse(
    run(cli, [...args, "--json"], {
      env: { PLVS_TEST_IDENTITY_ROOT: path.join(dataRoot, "multi-instance") },
    })
  );
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

async function runMacAcceptance({ root, runId, receipt }) {
  const runDir = path.join(root, "runs", runId);
  if (existsSync(runDir)) throw new Error(`Run directory already exists: ${runDir}`);
  const installRoot = path.join(runDir, "install with spaces");
  const dataRoot = path.join(runDir, "data with spaces");
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  const [older, newer] = receipt.versions;
  const archive = resolveReceiptFile(root, older.file);
  run("tar", ["-xzf", archive, "-C", installRoot], { env: { COPYFILE_DISABLE: "1" } });
  const app = path.join(installRoot, `${receipt.productName}.app`);
  const cli = path.join(app, "Contents", "MacOS", "plvs-cli");
  writeJsonAtomic(path.join(dataRoot, "plvs-settings.json"), {
    agentControlEnabled: true,
    dockState: { enabled: true, edge: "bottom", height: 160, reserveSpace: false },
  });
  const requestLog = path.join(runDir, "requests.jsonl");
  writeFileSync(requestLog, "");
  const server = createAcceptanceFeed({
    root,
    onRequest: (event) => appendFileSync(requestLog, `${JSON.stringify(event)}\n`),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(receipt.feed.port, receipt.feed.host, resolve);
  });
  const startedAt = new Date().toISOString();
  const launch = macAcceptanceLaunch(app, dataRoot);
  run(launch.command, launch.args);
  const capabilities = await waitFor(
    "packaged app launch",
    () => cliJson(cli, dataRoot, ["capabilities"]),
    (value) => value.result?.appVersion === older.version,
    60_000
  );
  if (capabilities.result.runtime?.identifier !== receipt.identity) {
    throw new Error("Running app identity does not match the acceptance receipt");
  }
  const before = cliJson(cli, dataRoot, ["inspect"]);
  writeJsonAtomic(path.join(runDir, "before.json"), before);
  console.log(
    "CHECKPOINT auto-download: In the isolated app, enable Auto Download in Settings. " +
      "The runner will continue when the signed package is ready."
  );
  await waitFor(
    "automatic update download",
    () => readReady(dataRoot),
    (value) => value?.value.ready
  );
  await new Promise((resolve) => server.close(resolve));
  console.log(
    "CHECKPOINT offline-restart: The feed is stopped. Quit the isolated app normally; the runner will relaunch it offline."
  );
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
  run(launch.command, launch.args);
  await waitFor(
    "offline relaunch",
    () => cliJson(cli, dataRoot, ["capabilities"]),
    (value) => value.result?.appVersion === older.version,
    60_000
  );
  const revision = cliJson(cli, dataRoot, ["inspect"]).result.revision;
  try {
    cliJson(cli, dataRoot, [
      "visual",
      "screenshot",
      "--target",
      "dock-update",
      "--expected-revision",
      String(revision),
      "--out",
      path.join(runDir, "update-details.png"),
    ]);
  } catch (error) {
    console.warn(`Update-details screenshot was unavailable: ${error.message}`);
  }
  console.log(
    "CHECKPOINT offline-install: Confirm Update Ready, exercise Skip This Time and reopen it from the Dock accessory, then click Update and Restart."
  );
  const attemptFile = await waitFor(
    "offline installation",
    () => findNamedFile(path.join(dataRoot, "updates"), "attempt.json"),
    Boolean
  );
  const attempt = await waitFor(
    "installer completion",
    () => JSON.parse(readFileSync(attemptFile, "utf8")),
    (value) => value.phase === "finished" || value.phase === "failed"
  );
  if (attempt.phase !== "finished")
    throw new Error(`Installer failed: ${attempt.error ?? "unknown error"}`);
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
    { id: "cache-cleared", status: scenarioStatus(readyCleared) },
    { id: "apfs-bundle-swap", status: "passed" },
    { id: "read-only-dmg-refusal", status: "notRun", reason: "planned automated scenario" },
    ...UPDATE_MANUAL_SCENARIOS.map((id) => ({
      id,
      status: "notRun",
      reason: "manual or release-only checkpoint",
    })),
  ];
  const failed = UPDATE_REQUIRED_SCENARIOS.some(
    (id) => scenarios.find((scenario) => scenario.id === id)?.status !== "passed"
  );
  const terminatedPids = terminateOwnedMacApp(app);
  await waitFor(
    "isolated app cleanup",
    () => {
      const rows = run("ps", ["-axo", "pid=,command="]);
      return terminatedPids.every((pid) => !new RegExp(`^\\s*${pid}\\s`, "m").test(rows));
    },
    Boolean,
    10_000
  );
  const result = {
    schemaVersion: 1,
    domain: "update",
    runId,
    sourceSha: receipt.sourceSha,
    identity: acceptanceNames(receipt.sourceSha).identity,
    platform: { ...receipt.platform, version: run("sw_vers", ["-productVersion"]) },
    tool: { name: "update-acceptance", version: 1 },
    startedAt,
    endedAt: new Date().toISOString(),
    summary: failed ? "failed" : "complete",
    scenarios,
    artifacts: artifactList(runDir, [
      "before.json",
      "after.json",
      "capabilities-after.json",
      "helper-attempt.json",
      "cache-state-after.json",
      "requests.jsonl",
      "update-details.png",
      "restored-dock.png",
    ]),
    cleanup: {
      status: "passed",
      observations: [
        "The feed was stopped and all app processes launched from the isolated installation path exited.",
      ],
    },
    warnings: [
      "Routine UI confirmations remain operator checkpoints; staging, offline transition, evidence, and verification are automated.",
    ],
  };
  writeJsonAtomic(path.join(runDir, "result.json"), result);
  console.log(`Acceptance result ready: ${path.join(runDir, "result.json")}`);
  return result;
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
  if (host.os !== "macos") {
    throw new Error("The Windows guided runner has not yet migrated to the shared contract");
  }
  return runMacAcceptance({ ...options, receipt });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runUpdateAcceptance(parseRunArguments(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
