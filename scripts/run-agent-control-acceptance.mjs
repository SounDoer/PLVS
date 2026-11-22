#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import manifest from "../src/agentControl/commandManifest.json" with { type: "json" };
import { ISOLATED_SCENARIOS } from "./accept-agent-control.mjs";
import { hostPlatform, resolveEvidenceSourceSha, writeJsonAtomic } from "./acceptance-evidence.mjs";
import { DEV_IDENTITY_TARGET_DIRECTORY } from "./build-plvs-cli.mjs";
import { withCaptureRig } from "./capture-rig.mjs";
import { LIVE_SOURCE_RECONNECT, runLiveSourceReconnect } from "./smoke-live-source-reconnect.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const acceptance = join(root, "scripts", "accept-agent-control.mjs");
const commandsBySpecificity = [...manifest.commands].sort((a, b) => b.path.length - a.path.length);

async function readEvidence(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function resizeDiagnostic(history) {
  const sizing = history.findLast(({ response }) => response.error?.details?.requestedSize)
    ?.response.error.details;
  if (!sizing) return undefined;
  const names = [
    "requestedSize",
    "viewport",
    "nativeInner",
    "nativeOuter",
    "originalViewport",
    "originalNativeInner",
  ];
  return {
    ...Object.fromEntries(
      names.map((name) => [
        name,
        {
          width: sizing[name]?.width,
          height: sizing[name]?.height,
        },
      ])
    ),
    scale: sizing.scale,
  };
}

function moveDiagnostic(history) {
  const details = history.findLast(({ response }) => response.error?.details?.requestedPosition)
    ?.response.error.details;
  if (!details) return undefined;
  const position = (value) => (value ? { x: value.x, y: value.y } : null);
  const size = (value) => ({ width: value?.width, height: value?.height });
  return {
    requestedPosition: position(details.requestedPosition),
    reportedPosition: position(details.reportedPosition),
    originalPosition: position(details.originalPosition),
    monitorMatched: details.monitorMatched === true,
    viewport: size(details.viewport),
    originalViewport: size(details.originalViewport),
  };
}

function renderDiagnostic(history) {
  const details = history.findLast(({ response }) => response.error?.code === "renderNotSettled")
    ?.response.error.details;
  if (
    !details ||
    !["fonts", "firstFrame", "target", "transition", "canvas", "bounds"].includes(details.stage)
  ) {
    return undefined;
  }
  const { stage, frames, visible, focused, canvas } = details;
  return {
    stage,
    ...(Number.isSafeInteger(frames) ? { frames } : {}),
    visible: visible === true,
    focused: focused === true,
    ...(canvas
      ? {
          canvas: Object.fromEntries(
            ["width", "height", "clientWidth", "clientHeight", "backingWidth", "backingHeight"]
              .filter((key) => Number.isFinite(canvas[key]))
              .map((key) => [key, canvas[key]])
          ),
        }
      : {}),
  };
}

function publicDiagnostic(trace) {
  const { cliCount, code } = trace.failure ?? {};
  const history = (trace.cli ?? []).slice(0, cliCount);
  const commandHistory = history.slice(-5).flatMap((entry) => {
    const args = entry.args[0] === "--instance" ? entry.args.slice(2) : entry.args;
    const command = commandsBySpecificity.find(({ path }) =>
      path.every((part, index) => part === args[index])
    );
    if (!command) return [];
    const { result, error } = entry.response;
    return [
      {
        command: command.id,
        exitCode: entry.status,
        ...(typeof error?.code === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(error.code)
          ? { code: error.code }
          : {}),
        ...(command.id === "instances.list" && Array.isArray(result?.instances)
          ? { instanceCount: result.instances.length }
          : {}),
      },
    ];
  });
  return {
    completedSteps: trace.steps?.length ?? 0,
    ...(code === "ERR_ASSERTION" || code === "acceptanceTimeout" ? { code } : {}),
    commandHistory,
    render: renderDiagnostic(history),
    ...(trace.scenario === "window-platform-contract"
      ? { resize: resizeDiagnostic(history), move: moveDiagnostic(history) }
      : {}),
    ...(Array.isArray(trace.failure?.workbenches)
      ? {
          workbenches: trace.failure.workbenches.map(({ state, reachable, closeConfirmation }) => ({
            state: ["R", "S", "D", "T", "Z", "X", "I", "missing"].includes(state) ? state : "other",
            ...(typeof reachable === "boolean"
              ? { reachable, closeConfirmation: closeConfirmation === true }
              : {}),
          })),
        }
      : {}),
    ...(trace.cleanupError ? { cleanupFailed: true } : {}),
  };
}

// This is the only output copied to Actions. Detailed traces may contain local paths,
// display or device names, and window pixels.
export function summarizeScenario(scenario, sourceSha, exitCode, trace, desktop) {
  const validTrace =
    trace?.scenario === scenario && trace.head === sourceSha && trace.workingTreeDirty === false;
  const validDesktop = desktop?.sourceSha === sourceSha && Array.isArray(desktop.scenarios);
  const passed =
    exitCode === 0 &&
    validTrace &&
    trace.status === "passed" &&
    (scenario !== "desktop" || (validDesktop && desktop.summary === "complete"));
  return {
    id: scenario,
    status: passed ? "passed" : "failed",
    exitCode,
    ...(!passed && validTrace && trace.failure ? { diagnostic: publicDiagnostic(trace) } : {}),
    ...(scenario === "window-platform-contract" && validTrace && trace.window
      ? {
          window: {
            backend: ["win32", "darwin", "x11-compatible", "wayland"].includes(trace.window.backend)
              ? trace.window.backend
              : "unknown",
            recording: ["passed", "unavailable"].includes(trace.window.recording)
              ? trace.window.recording
              : "notRun",
            ...Object.fromEntries(
              ["minimizedScreenshot", "minimizedRecording"].map((key) => [
                key,
                ["passed", "unsupported", "unavailable"].includes(trace.window[key])
                  ? trace.window[key]
                  : "notRun",
              ])
            ),
            ...([
              "recordingEncoderUnavailable",
              "screenCapturePermissionRequired",
              "visualUnavailable",
            ].includes(trace.window.recordingReason) && {
              recordingReason: trace.window.recordingReason,
            }),
          },
        }
      : {}),
    ...(scenario === "desktop" && validDesktop
      ? { checks: desktop.scenarios.map(({ id, status }) => ({ id, status })) }
      : {}),
  };
}

async function main([out, ...extra]) {
  if (!out || extra.length) {
    throw new Error("Usage: node scripts/run-agent-control-acceptance.mjs <output-directory>");
  }

  const sourceSha = resolveEvidenceSourceSha(root);
  const outDir = resolve(out);
  const report = {
    sourceSha,
    platform: hostPlatform(),
    scenarios: ISOLATED_SCENARIOS.map((id) => ({ id, status: "notRun" })),
  };
  await mkdir(dirname(outDir), { recursive: true });
  await mkdir(outDir, { mode: 0o700 });
  const summaryPath = join(outDir, "summary.json");
  await writeJsonAtomic(summaryPath, report);
  await withCaptureRig(
    async () => {
      for (const [index, scenario] of ISOLATED_SCENARIOS.entries()) {
        const directory = join(outDir, "details", scenario);
        await mkdir(directory, { recursive: true });
        if (scenario === LIVE_SOURCE_RECONNECT) {
          const executable = join(
            DEV_IDENTITY_TARGET_DIRECTORY,
            "debug",
            report.platform.os === "windows" ? "plvs-cli.exe" : "plvs-cli"
          );
          report.scenarios[index] = await runLiveSourceReconnect({
            executable,
            outDir: directory,
            platform: report.platform.os,
          });
          console.log(`${scenario}: ${report.scenarios[index].status}`);
          await writeJsonAtomic(summaryPath, report);
          continue;
        }
        const log = openSync(join(directory, "command.log"), "w", 0o600);
        let child;
        try {
          child = spawnSync(
            process.execPath,
            [acceptance, "--scenario", scenario, "--out-dir", directory],
            {
              cwd: root,
              env: { ...process.env, PLVS_ACCEPTANCE_OWN_VITE: "1" },
              stdio: ["ignore", log, log],
            }
          );
        } finally {
          closeSync(log);
        }
        if (child.error) throw child.error;
        const trace = await readEvidence(join(directory, `${scenario}.json`));
        const desktop =
          scenario === "desktop" ? await readEvidence(join(directory, "result.json")) : null;
        const summary = summarizeScenario(scenario, sourceSha, child.status, trace, desktop);
        report.scenarios[index] = summary;
        process.stdout.write(`${scenario}: ${summary.status}\n`);
        await writeJsonAtomic(summaryPath, report);
        // A failed cleanup may have left a workbench still running. Leave subsequent scenarios unrun.
        if (trace?.cleanupError) break;
      }
      if (report.scenarios.some(({ status }) => status !== "passed")) {
        process.exitCode = 1;
      }
    },
    { wait: true }
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
