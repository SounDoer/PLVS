#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { runIsolatedAgentControl } from "./accept-isolated-agent-control.mjs";
import { writeJsonAtomic } from "./acceptance-evidence.mjs";
import {
  ROOT,
  SIGNAL,
  RigError,
  resolveLinuxCaptureRoute,
  resolveMacRenderDevice,
  resolveRenderEndpointId,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
  withCaptureRig,
} from "./capture-rig.mjs";
import { ensureLinuxDisplay, judgeTone, selectRigDevice } from "./release-package-smoke.mjs";

export const LIVE_SOURCE_RECONNECT = "live-source-reconnect";
const CHECKS = [
  "test-endpoint-ready",
  "exact-source-measures",
  "live-history-spectrum",
  "disconnected-and-stopped",
  "start-while-disconnected-refused",
  "reconnected-and-still-stopped",
  "explicit-start-measures-again",
  "rig-restored",
];

function windowsEndpoint(action, stateFile) {
  const child = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(ROOT, "scripts", "windows", "capture-rig-endpoint.ps1"),
      "-Action",
      action,
      "-StateFile",
      stateFile,
    ],
    { encoding: "utf8", timeout: 30_000, windowsHide: true }
  );
  if (child.status !== 0 || child.error) {
    const detail =
      child.stderr?.trim() || child.error?.message || "PowerShell exited without diagnostics";
    const error = new RigError(`VB-Cable endpoint ${action} failed: ${detail}`);
    error.code = "windows-endpoint-" + action;
    error.hresult = detail.match(/0x[0-9a-f]{8}\b/i)?.[0];
    throw error;
  }
}

const MAC_ENDPOINT_STATE = "macos-endpoint.json";

function runMacHelper(command, args) {
  const child = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
  if (child.error || child.status !== 0) {
    throw Object.assign(
      new RigError(
        child.stderr?.trim() || child.error?.message || "The Core Audio aggregate helper failed."
      ),
      { code: "macos-aggregate" }
    );
  }
}

async function macAggregate(outDir) {
  const blackHole = resolveMacRenderDevice();
  const binary = join(outDir, "capture-rig-aggregate");
  const suffix = randomUUID().toUpperCase();
  const uid = "com.soundoer.plvs.reconnect." + suffix;
  runMacHelper("/usr/bin/xcrun", [
    "swiftc",
    join(ROOT, "scripts", "macos", "capture-rig-aggregate.swift"),
    "-o",
    binary,
  ]);
  await writeJsonAtomic(join(outDir, MAC_ENDPOINT_STATE), { uid });
  return {
    captureDevice: "PLVS Reconnect " + suffix.slice(-8),
    playerTarget: String(blackHole.audioObjectId),
    create: () => runMacHelper(binary, ["create", uid, blackHole.uid]),
    release: () => runMacHelper(binary, ["destroy", uid]),
  };
}

async function restoreMacEndpoint(outDir) {
  const stateFile = join(outDir, MAC_ENDPOINT_STATE);
  if (!existsSync(stateFile)) return;
  const { uid } = JSON.parse(await readFile(stateFile, "utf8"));
  runMacHelper(join(outDir, "capture-rig-aggregate"), ["destroy", uid]);
  await rm(stateFile);
}

function validateSelection(selection, id, available) {
  assert.equal(selection.requestedId, id, "PLVS changed the requested Source.");
  assert.equal(selection.mode, "exact", "PLVS fell back to Automatic.");
  assert.equal(selection.available, available, "PLVS reported the wrong Source availability.");
  assert.equal(selection.resolved?.id ?? null, available ? id : null);
}

function validateStopped(measurement, transport) {
  assert.ok(["stopped", "error"].includes(measurement.source.state), "Live did not stay stopped.");
  assert.notEqual(measurement.sample.freshness, "fresh", "The old reading is still marked fresh.");
  assert.equal(transport.live.resolvedDeviceId, null, "Live still has an active Source.");
}

async function exercise({ invoke, until, disconnect, reconnect, captureDevice, platform, pass }) {
  const inventory = await until(() => {
    const current = invoke(["device", "list"]);
    try {
      if (platform === "macos") {
        const selected = current.devices.find(
          ({ label, direction }) => direction === "input" && label === captureDevice
        );
        return selected ? { current, selected } : null;
      }
      return {
        current,
        selected: selectRigDevice(platform, current.devices, { linuxSinkName: captureDevice }),
      };
    } catch (error) {
      if (!(error instanceof RigError)) throw error;
      return null;
    }
  }, "the rig endpoint in PLVS");
  const { id } = inventory.selected;
  pass("test-endpoint-ready");

  invoke([
    "device",
    "select",
    id,
    "--expected-revision",
    String(inventory.current.revision),
    "--expected-generation",
    String(inventory.current.generation),
  ]);
  const readSelection = () => invoke(["device", "inspect"]).selection;
  const measure = () => invoke(["measurement", "inspect"]);
  const transport = () => invoke(["transport", "inspect"]);
  const start = (options) =>
    invoke(
      ["transport", "live", "start", "--expected-revision", String(invoke(["inspect"]).revision)],
      options
    );
  const measureTone = (previousGeneration, description) =>
    until(() => {
      const measurement = measure();
      return (
        measurement.source.sessionGeneration > previousGeneration &&
        !judgeTone(measurement).length &&
        measurement
      );
    }, description);

  validateSelection(readSelection(), id, true);
  start();
  await measureTone(-1, "the original rig tone");
  assert.equal(transport().live.resolvedDeviceId, id);
  pass("exact-source-measures");

  await until(() => measure().sample.elapsedMs >= 1500, "enough Live history for a snapshot");
  const snapshot = (action, args = []) =>
    invoke([
      "transport",
      "snapshot",
      action,
      ...args,
      "--expected-revision",
      String(transport().revision),
    ]);
  snapshot("select", ["--offset-sec", "0.5"]);
  try {
    // Transport settles before the Spectrum panel necessarily draws the selected snapshot.
    const spectrum = await until(() => {
      const readout = invoke(["measurement", "spectrum", "--panel-id", "spectrum"]);
      return readout.displaySource.kind === "snapshot" && readout;
    }, "the Spectrum panel to render the snapshot");
    assert.deepEqual(spectrum.displaySource, { kind: "snapshot", offsetSec: 0.5 });
    assert.equal(spectrum.sample.freshness, "historical");
    assert.ok(spectrum.bands.length > 0);
    assert.ok(spectrum.peaks.some(({ frequencyHz }) => Math.abs(frequencyHz - SIGNAL.freqHz) < 12));
    pass("live-history-spectrum");
  } finally {
    snapshot("clear");
  }

  await disconnect();
  await until(() => {
    const selection = readSelection();
    assert.equal(selection.requestedId, id, "PLVS changed the requested Source on disconnect.");
    const status = invoke(["ui", "inspect"]).status;
    const current = measure();
    return (
      !selection.available &&
      ["stopped", "error"].includes(current.source.state) &&
      status.some(
        (item) =>
          item.id === "notice" && item.kind === "warning" && item.helpTopic === "audio-capture"
      )
    );
  }, "the Source Disconnected warning and stopped measurement");
  validateSelection(readSelection(), id, false);
  const stopped = measure();
  const stoppedTransport = transport();
  validateStopped(stopped, stoppedTransport);
  assert.equal(stoppedTransport.live.error?.message, "Source Disconnected");
  pass("disconnected-and-stopped");

  start({ expectedError: "applicationFailed" });
  validateSelection(readSelection(), id, false);
  validateStopped(measure(), transport());
  pass("start-while-disconnected-refused");

  await reconnect();
  await until(() => readSelection().available, "the original Source to return");
  // Device inventory polls every two seconds. Observe more than two polls after reappearance.
  const deadline = Date.now() + 4500;
  do {
    validateSelection(readSelection(), id, true);
    const current = measure();
    validateStopped(current, transport());
    assert.equal(
      current.source.sessionGeneration,
      stopped.source.sessionGeneration,
      "Reconnecting started a new measurement without Start."
    );
    await delay(250);
  } while (Date.now() < deadline);
  pass("reconnected-and-still-stopped");

  start();
  await measureTone(
    stopped.source.sessionGeneration,
    "a new measurement on the reconnected endpoint"
  );
  assert.equal(transport().live.resolvedDeviceId, id);
  pass("explicit-start-measures-again");
}

async function restoreWindowsEndpoint(stateFile) {
  if (!existsSync(stateFile)) return;
  windowsEndpoint("restore", stateFile);
  await rm(stateFile);
}

async function main([out, mode, ...extra]) {
  if (!out || mode !== "--restore-rig" || extra.length || process.platform === "linux") {
    throw new Error(
      "Usage: node scripts/smoke-live-source-reconnect.mjs <output-directory> --restore-rig"
    );
  }
  const outDir = resolve(out);
  const restore =
    process.platform === "win32"
      ? () => restoreWindowsEndpoint(join(outDir, "windows-endpoint.json"))
      : () => restoreMacEndpoint(outDir);
  try {
    await withCaptureRig(restore, { wait: true });
  } catch (error) {
    await writeJsonAtomic(join(outDir, "restore-failure.json"), { message: error.message });
    throw new Error(
      "Could not restore the capture rig endpoint. Inspect the runner's recovery log."
    );
  }
}

/** Run under the caller's machine-wide capture lease, including device restoration. */
export async function runLiveSourceReconnect({ outDir, platform, executable }) {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const stateFile = join(outDir, "windows-endpoint.json");
  const tone = join(outDir, "reconnect.wav");
  const result = {
    id: LIVE_SOURCE_RECONNECT,
    status: "failed",
    checks: CHECKS.map((id) => ({ id, status: "notRun" })),
  };
  const pass = (id) => {
    result.checks.find((check) => check.id === id).status = "passed";
    console.log(`${id}: passed`);
  };

  let route;
  let display;
  let player;
  let failure;
  let playbackError;
  const linux = platform === "linux";
  const macos = platform === "macos";
  try {
    if (linux) {
      route = resolveLinuxCaptureRoute();
      display = await ensureLinuxDisplay();
    } else if (macos) {
      route = await macAggregate(outDir);
      route.create();
    } else {
      windowsEndpoint("snapshot", stateFile);
    }
    const playerTarget = route?.playerTarget ?? resolveRenderEndpointId();
    const captureDevice = route?.captureDevice;
    await synthesizeSignal(tone);
    const play = async () => {
      player = await startPlayer(playerTarget, tone);
      player.on("error", (error) => {
        playbackError = error;
      });
    };
    await play();
    await runIsolatedAgentControl({
      executable,
      root: ROOT,
      outDir,
      scenario: LIVE_SOURCE_RECONNECT,
      environment: { ...display?.env, PLVS_ACCEPTANCE_OWN_VITE: "1" },
      runLiveReconnect: ({ invoke, until }) =>
        exercise({
          invoke,
          until,
          pass,
          platform,
          captureDevice,
          disconnect: () => {
            if (linux) {
              // Stop playback before removing the sink so Pulse cannot move the tone elsewhere.
              stopPlayer(player, { keepLease: true });
              player = null;
            }
            if (route) route.release();
            else windowsEndpoint("disconnect", stateFile);
          },
          reconnect: async () => {
            if (linux) {
              route = resolveLinuxCaptureRoute({ sinkName: captureDevice });
              await play();
            } else if (macos) {
              route.create();
            } else {
              windowsEndpoint("restore", stateFile);
            }
          },
        }),
    });
  } catch (error) {
    failure = playbackError ?? error;
  } finally {
    try {
      stopPlayer(player, { keepLease: true });
      if (macos) await restoreMacEndpoint(outDir);
      else if (linux) route?.release();
      else await restoreWindowsEndpoint(stateFile);
      await rm(tone, { force: true });
      pass("rig-restored");
    } catch (error) {
      result.checks.find(({ id }) => id === "rig-restored").status = "failed";
      failure = failure
        ? new AggregateError([failure, error], failure.message, { cause: failure })
        : error;
    } finally {
      display?.stop();
    }
  }
  if (!failure) {
    assert.ok(result.checks.every(({ status }) => status === "passed"));
    result.status = "passed";
  } else {
    const pending = result.checks.find(({ status }) => status === "notRun");
    if (pending) pending.status = "failed";
    const rootError = failure.cause ?? failure;
    const knownCodes = [
      "acceptanceTimeout",
      "ERR_ASSERTION",
      "macos-aggregate",
      "windows-endpoint-snapshot",
      "windows-endpoint-disconnect",
      "windows-endpoint-restore",
    ];
    result.diagnostic = {
      code: knownCodes.includes(rootError.code) ? rootError.code : "scenarioFailed",
      ...(rootError.hresult ? { hresult: rootError.hresult } : {}),
    };
    await writeJsonAtomic(join(outDir, "failure.json"), {
      message: failure.message,
      ...(failure instanceof AggregateError ? { cleanup: failure.errors[1].message } : {}),
    });
    console.error(`${LIVE_SOURCE_RECONNECT}: failed (${result.diagnostic.code})`);
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
