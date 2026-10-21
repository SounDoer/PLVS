#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPlvsCli } from "./build-plvs-cli.mjs";
import {
  acceptanceRunId,
  completeScenarioCoverage,
  hostPlatform,
  resolveEvidenceSourceSha,
  writeJsonAtomic,
} from "./acceptance-evidence.mjs";
import { scopeDevCliToWorktree } from "./dev-worktree.mjs";
import { assertWalkthroughStart } from "./ui-visual-walkthrough-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_METHODS = [
  "app.capabilities",
  "app.inspect",
  "ui.inspect",
  "ui.show.settings",
  "ui.close",
  "visual.screenshot",
  "visual.recording.start",
  "visual.recording.wait",
];
const REQUIRED_SCENARIOS = [
  "discovery-and-capabilities",
  "inspect-and-safe-start",
  "settings-navigation",
  "screenshot",
  "settings-cleanup",
  "silent-recording",
];

export function parseJsonEnvelope(label, output) {
  const line = output.replace(/^﻿/, "").trim();
  let envelope;
  try {
    envelope = JSON.parse(line);
  } catch {
    throw new Error(`${label} produced invalid JSON: ${line || "(empty output)"}`);
  }
  if (!envelope || envelope.ok !== true || !envelope.result) {
    const code = envelope?.error?.code ?? "unknownError";
    const message = envelope?.error?.message ?? "The command returned no result.";
    throw Object.assign(new Error(`${label} failed (${code}): ${message}`), { code });
  }
  return envelope;
}

/**
 * Run a visual capture, retrying once when the window did not render in time. A hidden, occluded
 * or sleeping display stops WebView animation frames, which is the machine's state rather than a
 * product defect; every other failure, and a second unsettled render, still fails.
 */
export async function retryUnsettledRenderOnce(label, capture, warnings) {
  try {
    return await capture();
  } catch (error) {
    if (error.code !== "renderNotSettled") throw error;
    warnings.push(`${label}: the render did not settle; retried once (${error.message})`);
    return await capture();
  }
}

export function verifyArtifactBuffer(label, contents, artifact) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(`${label} returned no artifact metadata.`);
  }
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (contents.length !== artifact.bytes) {
    throw new Error(
      `${label} byte count differs: expected ${artifact.bytes}, got ${contents.length}.`
    );
  }
  if (sha256.toLowerCase() !== artifact.sha256?.toLowerCase()) {
    throw new Error(`${label} SHA-256 differs from the returned metadata.`);
  }
  if (
    label === "screenshot" &&
    !contents.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  ) {
    throw new Error("screenshot is not a PNG file.");
  }
  if (label === "recording" && contents.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw new Error("recording is not an MP4 file.");
  }
  return { bytes: contents.length, sha256 };
}

export function verifyUiSurface(result, { kind, target }) {
  const surface = result?.surface;
  if (!surface || surface.kind !== kind || typeof surface.surfaceId !== "string") {
    throw new Error(`UI navigation returned no ${kind} surface.`);
  }
  for (const [key, value] of Object.entries(target)) {
    if (surface.target?.[key] !== value) {
      throw new Error(`UI navigation returned the wrong ${kind} target.`);
    }
  }
  if (!Number.isSafeInteger(result.uiGeneration) || result.uiGeneration < 0) {
    throw new Error("UI navigation returned an invalid UI generation.");
  }
  return surface;
}

export function parseArgs(args) {
  let outDir;
  let instanceId;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !["--out-dir", "--instance"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      seen.has(flag)
    ) {
      throw new Error(
        "Usage: npm run smoke:agent-control -- [--instance <id>] [--out-dir <directory>]"
      );
    }
    seen.add(flag);
    if (flag === "--out-dir") outDir = value;
    else instanceId = value;
  }
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  const fallback = join(root, "artifacts", "agent-control-smoke", `${stamp}-${process.platform}`);
  return { outDir: resolve(root, outDir ?? fallback), instanceId };
}

export function selectSmokeInstance(instances, selector) {
  if (!Array.isArray(instances)) throw new Error("instances returned no instance list.");
  if (selector) {
    if (!instances.some((instance) => instance.instanceId === selector))
      throw new Error(`Smoke instance was not found: ${selector}.`);
    return selector;
  }
  if (instances.length !== 1)
    throw new Error(
      "Smoke requires one running dev app instance or an explicit --instance / PLVS_INSTANCE_ID."
    );
  return instances[0].instanceId;
}

function createRunner(executable, env) {
  return (label, args, { allowFailure = false } = {}) => {
    const result = spawnSync(executable, args, {
      cwd: root,
      env: env ? { ...process.env, ...env } : undefined,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 330_000,
    });
    if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
    if (allowFailure && result.status !== 0) return null;
    let envelope;
    try {
      envelope = parseJsonEnvelope(label, result.stdout);
    } catch (error) {
      const stderr = result.stderr?.trim();
      throw Object.assign(new Error(stderr ? `${error.message}\n${stderr}` : error.message), {
        code: error.code,
      });
    }
    if (result.status !== 0) {
      throw new Error(`${label} exited with status ${result.status}.`);
    }
    return envelope;
  };
}

export async function runAgentControlSmoke({
  executable,
  outDir,
  instanceId,
  sourceSha,
  platform = hostPlatform(),
  env,
  invoke = createRunner(executable, env),
}) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error("Agent Control smoke requires an exact lowercase source SHA.");
  }
  const startedAt = new Date();
  await mkdir(outDir, { recursive: true });
  const completedScenarios = [];
  const evidenceArtifacts = [];
  const cleanupObservations = [];
  let currentScenario = "discovery-and-capabilities";
  let selectedInstance = null;
  let activeRecordingId = null;
  let activeUiSurface = null;
  let capabilities = null;
  let revision = null;
  let legacyReport = null;
  let failure = null;
  let cleanupStatus = "passed";
  const warnings = [];
  const pass = (id, observations = []) => {
    completedScenarios.push({ id, status: "passed", observations });
    currentScenario = null;
  };
  const begin = (id) => {
    currentScenario = id;
  };
  const run = (label, args, options) => {
    if (!selectedInstance) throw new Error("Agent Control smoke has no selected instance.");
    return invoke(label, [...args, "--instance", selectedInstance], options);
  };
  try {
    const discovered = invoke("instances", ["instances", "--json"]);
    selectedInstance = selectSmokeInstance(
      discovered.result.instances,
      instanceId ?? process.env.PLVS_INSTANCE_ID
    );
    capabilities = run("capabilities", ["capabilities", "--json"]);
    const methods = capabilities.result.methods;
    if (!Array.isArray(methods)) throw new Error("capabilities returned no method list.");
    const visualFeatures = capabilities.result.features?.visual;
    const missing = REQUIRED_METHODS.filter((method) => {
      if (method === "visual.screenshot" && visualFeatures?.screenshot === false) return false;
      if (
        (method === "visual.recording.start" || method === "visual.recording.wait") &&
        visualFeatures?.recording === false
      ) {
        return false;
      }
      return !methods.includes(method);
    });
    if (missing.length > 0) {
      throw new Error(`This desktop does not advertise required methods: ${missing.join(", ")}.`);
    }
    pass("discovery-and-capabilities", [`Pinned instance ${selectedInstance}.`]);

    begin("inspect-and-safe-start");
    const inspected = run("inspect", ["inspect", "--json"]);
    revision = inspected.result.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("inspect returned an invalid global revision.");
    }
    const uiInspected = run("ui inspect", ["ui", "inspect", "--json"]);
    assertWalkthroughStart({ scenarios: [] }, capabilities.result, uiInspected.result, {
      requireVisualScreenshot: visualFeatures?.screenshot !== false,
    });
    if (uiInspected.result.window?.form !== "normal" || uiInspected.result.window?.visible !== true)
      throw new Error("Smoke requires a visible normal window; restore it before running.");
    pass("inspect-and-safe-start");

    begin("settings-navigation");
    const shown = run("ui show settings", [
      "ui",
      "show",
      "settings",
      "--section",
      "appearance",
      "--expected-revision",
      String(uiInspected.result.revision),
      "--expected-ui-generation",
      String(uiInspected.result.uiGeneration),
      "--json",
    ]);
    if (shown.result.changed !== true)
      throw new Error(
        "Smoke did not create a new Settings surface; leaving the existing surface untouched."
      );
    activeUiSurface = shown.result.surface;
    verifyUiSurface(shown.result, {
      kind: "settings",
      target: { section: "appearance" },
    });
    pass("settings-navigation");

    begin("screenshot");
    const described = run("visual describe", ["visual", "describe", "--json"]);
    const screenshotAvailable = described.result?.screenshot?.available === true;
    const recordingAvailable = described.result?.recording?.available === true;
    let navigationRevision = shown.result.revision;
    let navigationGeneration = shown.result.uiGeneration;
    let screenshotPath = null;
    let screenshotCheck = null;
    let screenshotMetadata = null;
    if (!screenshotAvailable) {
      completedScenarios.push({
        id: "screenshot",
        status: "unsupported",
        observations: ["This platform reports visual screenshots as unavailable."],
      });
      currentScenario = null;
    } else {
      screenshotPath = join(outDir, "main.png");
      const screenshot = await retryUnsettledRenderOnce(
        "visual screenshot",
        () =>
          run("visual screenshot", [
            "visual",
            "screenshot",
            "--target",
            "main",
            "--expected-revision",
            String(navigationRevision),
            "--expected-ui-generation",
            String(navigationGeneration),
            "--out",
            screenshotPath,
            "--json",
          ]),
        warnings
      );
      screenshotCheck = verifyArtifactBuffer(
        "screenshot",
        await readFile(screenshotPath),
        screenshot.result.artifact
      );
      screenshotMetadata = screenshot.result.artifact;
      navigationRevision = screenshot.result.revision;
      navigationGeneration = screenshot.result.uiGeneration;
      evidenceArtifacts.push({
        id: "main-screenshot",
        kind: "image/png",
        file: screenshotPath,
        ...screenshotCheck,
      });
      pass("screenshot", [
        `Captured ${screenshotCheck.bytes} bytes with SHA-256 ${screenshotCheck.sha256}.`,
      ]);
    }

    begin("settings-cleanup");
    run("ui close", [
      "ui",
      "close",
      activeUiSurface.surfaceId,
      "--expected-revision",
      String(navigationRevision),
      "--expected-ui-generation",
      String(navigationGeneration),
      "--json",
    ]);
    const finalUi = run("ui inspect final", ["ui", "inspect", "--json"]);
    if (finalUi.result.surfaces.some(({ surfaceId }) => surfaceId === activeUiSurface.surfaceId)) {
      throw new Error("UI close left the Settings surface mounted.");
    }
    activeUiSurface = null;
    pass("settings-cleanup");

    begin("silent-recording");
    let recordingPath = null;
    let recordingCheck = null;
    let recording = null;
    if (!recordingAvailable) {
      completedScenarios.push({
        id: "silent-recording",
        status: "unsupported",
        observations: ["This platform reports visual recording as unavailable."],
      });
      currentScenario = null;
    } else {
    const started = await retryUnsettledRenderOnce(
      "visual recording start",
      () =>
        run("visual recording start", [
          "visual",
          "recording",
          "start",
          "--target",
          "main",
          "--audio",
          "none",
          "--max-duration-seconds",
          "3",
          "--expected-revision",
          String(finalUi.result.revision),
          "--json",
        ]),
      warnings
    );
    activeRecordingId = started.result.recording?.recordingId;
    if (typeof activeRecordingId !== "string" || activeRecordingId.length === 0) {
      throw new Error("visual recording start returned no recording ID.");
    }

    recordingPath = join(outDir, "main-3s.mp4");
    const completed = run("visual recording wait", [
      "visual",
      "recording",
      "wait",
      activeRecordingId,
      "--timeout-ms",
      "30000",
      "--out",
      recordingPath,
      "--json",
    ]);
    if (
      completed.result.outcome !== "terminal" ||
      completed.result.recording?.state !== "completed"
    ) {
      throw new Error(
        `recording wait ended with outcome ${completed.result.outcome ?? "unknown"}.`
      );
    }
    recording = completed.result.recording;
    recordingCheck = verifyArtifactBuffer(
      "recording",
      await readFile(recordingPath),
      recording?.artifact
    );
    evidenceArtifacts.push({
      id: "main-silent-recording",
      kind: "video/mp4",
      file: recordingPath,
      ...recordingCheck,
    });
    activeRecordingId = null;
    pass("silent-recording", [
      `Captured ${recordingCheck.bytes} bytes with SHA-256 ${recordingCheck.sha256}.`,
    ]);
    }

    legacyReport = {
      ok: screenshotAvailable && recordingAvailable,
      createdAt: new Date().toISOString(),
      platform: process.platform,
      revision,
      instanceId: selectedInstance,
      runtime: capabilities.result.runtime,
      artifacts: {
        ...(screenshotCheck
          ? {
              screenshot: {
                path: screenshotPath,
                ...screenshotCheck,
                metadata: screenshotMetadata,
              },
            }
          : {}),
        ...(recordingAvailable
          ? {
              recording: { path: recordingPath, ...recordingCheck, metadata: recording.artifact },
            }
          : {}),
      },
    };
  } catch (error) {
    failure = error;
    if (currentScenario) {
      completedScenarios.push({
        id: currentScenario,
        status: "failed",
        observations: [error.message],
      });
      currentScenario = null;
    }
    if (activeUiSurface) {
      try {
        const current = run("ui inspect cleanup", ["ui", "inspect", "--json"]);
        const cleaned = run(
          "ui close cleanup",
          [
            "ui",
            "close",
            activeUiSurface.surfaceId,
            "--expected-revision",
            String(current.result.revision),
            "--expected-ui-generation",
            String(current.result.uiGeneration),
            "--json",
          ],
          { allowFailure: true }
        );
        if (!cleaned) throw new Error("Settings cleanup command failed.");
        activeUiSurface = null;
        cleanupObservations.push("Closed the Settings surface created by this smoke.");
      } catch (cleanupError) {
        cleanupStatus = "failed";
        cleanupObservations.push(`Settings cleanup failed: ${cleanupError.message}`);
      }
    }
    if (activeRecordingId) {
      try {
        const cleaned = run(
          "visual recording cleanup",
          ["visual", "recording", "stop", activeRecordingId, "--json"],
          { allowFailure: true }
        );
        if (!cleaned) throw new Error("Recording cleanup command failed.");
        activeRecordingId = null;
        cleanupObservations.push("Stopped the recording created by this smoke.");
      } catch (cleanupError) {
        cleanupStatus = "failed";
        cleanupObservations.push(`Recording cleanup failed: ${cleanupError.message}`);
      }
    }
  }

  if (cleanupObservations.length === 0) {
    cleanupObservations.push("No owned UI surface or recording remained after the smoke.");
  }
  const coverage = completeScenarioCoverage(REQUIRED_SCENARIOS, completedScenarios);
  const summary = cleanupStatus === "failed" ? "failed" : coverage.summary;
  const evidence = {
    schemaVersion: 1,
    domain: "agent-control",
    runId: acceptanceRunId(startedAt),
    sourceSha,
    platform,
    tool: { name: "agent-control-smoke", version: 1 },
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    summary,
    scenarios: coverage.scenarios,
    artifacts: evidenceArtifacts,
    cleanup: { status: cleanupStatus, observations: cleanupObservations },
    warnings,
    instanceId: selectedInstance,
    revision,
    runtime: capabilities?.result.runtime ?? null,
  };
  const evidencePath = join(outDir, "result.json");
  await writeJsonAtomic(evidencePath, evidence);
  if (failure) {
    failure.evidencePath = evidencePath;
    throw failure;
  }
  const reportPath = join(outDir, "smoke-report.json");
  await writeJsonAtomic(reportPath, legacyReport);
  return { report: legacyReport, reportPath, evidence, evidencePath };
}

async function main() {
  const { outDir, instanceId } = parseArgs(process.argv.slice(2));
  const sourceSha = resolveEvidenceSourceSha(root);
  scopeDevCliToWorktree();
  const { executable } = buildPlvsCli({ identity: "dev" });
  const { report, reportPath, evidence, evidencePath } = await runAgentControlSmoke({
    executable,
    outDir,
    instanceId,
    sourceSha,
  });
  console.log(`Report    : ${reportPath}`);
  console.log(`Evidence  : ${evidencePath}`);
  if (evidence.summary !== "complete") {
    for (const scenario of evidence.scenarios) {
      if (scenario.status !== "passed") console.log(`${scenario.id}: ${scenario.status}`);
    }
    console.error(`Agent Control smoke is ${evidence.summary}; unsupported scenarios are not passes.`);
    process.exitCode = evidence.summary === "failed" ? 1 : 2;
    return;
  }
  console.log(`OK Agent Control smoke passed on ${report.platform}.`);
  console.log(`Screenshot: ${report.artifacts.screenshot.path}`);
  console.log(`Recording : ${report.artifacts.recording.path}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Agent Control smoke failed: ${error.message}`);
    if (error.evidencePath) console.error(`Evidence: ${error.evidencePath}`);
    console.error(
      "Start the dev app with `npm run desktop:dev`, keep Agent Control enabled, and retry."
    );
    process.exitCode = 1;
  });
}
