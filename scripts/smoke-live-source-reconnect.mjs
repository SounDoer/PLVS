#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { runIsolatedAgentControl } from "./accept-isolated-agent-control.mjs";
import { hostPlatform, resolveEvidenceSourceSha, writeJsonAtomic } from "./acceptance-evidence.mjs";
import { DEV_IDENTITY_TARGET_DIRECTORY } from "./build-plvs-cli.mjs";
import {
  ROOT,
  RigError,
  resolveLinuxCaptureRoute,
  resolveRenderEndpointId,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
  withCaptureRig,
} from "./capture-rig.mjs";
import { ensureLinuxDisplay, judgeTone, selectRigDevice } from "./release-package-smoke.mjs";

const SCENARIO = "live-source-reconnect";
const CHECKS = [
  "test-endpoint-ready",
  "exact-source-measures",
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
  if (!out || (mode && mode !== "--restore-windows") || extra.length) {
    throw new Error(
      "Usage: node scripts/smoke-live-source-reconnect.mjs <output-directory> [--restore-windows]"
    );
  }
  const outDir = resolve(out);
  const stateFile = join(outDir, "windows-endpoint.json");
  if (mode) {
    if (process.platform !== "win32") throw new Error("Endpoint restoration is Windows only.");
    if (existsSync(stateFile)) {
      try {
        await withCaptureRig(() => restoreWindowsEndpoint(stateFile), { wait: true });
      } catch (error) {
        await writeJsonAtomic(join(outDir, "restore-failure.json"), { message: error.message });
        throw new Error(
          "Could not restore the Windows rig endpoint. Inspect the runner's recovery log."
        );
      }
    }
    return;
  }
  const platform = hostPlatform().os;
  if (!["windows", "linux"].includes(platform)) {
    throw new Error("This smoke requires a Windows or Linux desktop rig.");
  }
  const sourceSha = resolveEvidenceSourceSha(ROOT);
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const summary = {
    sourceSha,
    platform: hostPlatform(),
    scenarios: [
      { id: SCENARIO, status: "failed", checks: CHECKS.map((id) => ({ id, status: "notRun" })) },
    ],
  };
  const result = summary.scenarios[0];
  const summaryPath = join(outDir, "summary.json");
  const pass = (id) => {
    result.checks.find((check) => check.id === id).status = "passed";
    console.log(`${id}: passed`);
  };
  await writeJsonAtomic(summaryPath, summary);
  try {
    await withCaptureRig(
      async () => {
        let route;
        let display;
        let player;
        let failure;
        let playbackError;
        const tone = join(outDir, "details", "reconnect.wav");
        try {
          const linux = platform === "linux";
          if (linux) {
            route = resolveLinuxCaptureRoute();
            display = await ensureLinuxDisplay();
          } else {
            windowsEndpoint("snapshot", stateFile);
          }
          const playerTarget = linux ? route.playerTarget : resolveRenderEndpointId();
          const captureDevice = route?.captureDevice;
          const executable = join(
            DEV_IDENTITY_TARGET_DIRECTORY,
            "debug",
            linux ? "plvs-cli" : "plvs-cli.exe"
          );
          await mkdir(join(outDir, "details"), { recursive: true, mode: 0o700 });
          await synthesizeSignal(tone);
          const play = async () => {
            player = await startPlayer(playerTarget, tone);
            player.on("error", (error) => {
              playbackError = error;
            });
          };
          await play();
          const evidencePath = await runIsolatedAgentControl({
            executable,
            root: ROOT,
            outDir: join(outDir, "details"),
            scenario: SCENARIO,
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
                    route.release();
                  } else {
                    windowsEndpoint("disconnect", stateFile);
                  }
                },
                reconnect: async () => {
                  if (linux) {
                    route = resolveLinuxCaptureRoute({ sinkName: captureDevice });
                    await play();
                  } else {
                    windowsEndpoint("restore", stateFile);
                  }
                },
              }),
          });
          assert.ok(existsSync(evidencePath));
        } catch (error) {
          failure = playbackError ?? error;
        } finally {
          try {
            stopPlayer(player, { keepLease: true });
            if (platform === "windows") await restoreWindowsEndpoint(stateFile);
            else route?.release();
            await rm(tone, { force: true });
            pass("rig-restored");
          } catch (error) {
            result.checks.find(({ id }) => id === "rig-restored").status = "failed";
            failure ??= error;
          } finally {
            display?.stop();
          }
        }
        if (failure) throw failure;
      },
      { wait: true }
    );
    assert.ok(result.checks.every(({ status }) => status === "passed"));
    result.status = "passed";
  } catch (error) {
    const pending = result.checks.find(({ status }) => status === "notRun");
    if (pending) pending.status = "failed";
    result.diagnostic = {
      code: [
        "acceptanceTimeout",
        "ERR_ASSERTION",
        "windows-endpoint-snapshot",
        "windows-endpoint-disconnect",
        "windows-endpoint-restore",
      ].includes(error.code)
        ? error.code
        : "scenarioFailed",
      ...(error.hresult ? { hresult: error.hresult } : {}),
    };
    await writeJsonAtomic(join(outDir, "failure.json"), { message: error.message });
    console.error(`${SCENARIO}: failed (${result.diagnostic.code})`);
    process.exitCode = 1;
  } finally {
    await writeJsonAtomic(summaryPath, summary);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
