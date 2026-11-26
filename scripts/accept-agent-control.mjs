#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import manifest from "../src/agentControl/commandManifest.json" with { type: "json" };
import { buildPlvsCli } from "./build-plvs-cli.mjs";
import {
  acceptanceRunId,
  completeScenarioCoverage,
  hostPlatform,
  resolveEvidenceSourceSha,
  writeJsonAtomic,
} from "./acceptance-evidence.mjs";
import { scopeDevCliToWorktree } from "./dev-worktree.mjs";
import { runAgentControlSmoke, selectSmokeInstance } from "./smoke-agent-control.mjs";
import { runUiVisualWalkthrough } from "./ui-visual-walkthrough.mjs";
import { createRunJournalStore } from "./ui-walkthrough/journal.mjs";
import { runIsolatedAgentControl } from "./accept-isolated-agent-control.mjs";
import { withCaptureRig } from "./capture-rig.mjs";
import { LIVE_SOURCE_RECONNECT, runLiveSourceReconnect } from "./smoke-live-source-reconnect.mjs";
import { AGENT_CONTROL_ACCEPTANCE_SCENARIOS } from "./agent-control-acceptance-catalog.mjs";
import { runMcpContract } from "./mcp-acceptance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_SCENARIOS = [
  "offline-contract",
  "base-smoke",
  "read-contract",
  "product-walkthrough",
  "dock-platform-contract",
  "dialog-decisions",
  "revision-wait",
  "mcp-adapter",
];
export const ISOLATED_SCENARIOS = [
  "desktop",
  "file-dialogue-restart",
  "configuration-relaunch",
  "welcome-relaunch",
  "window-platform-contract",
  "tray-platform-contract",
  "workbench-platform-contract",
  LIVE_SOURCE_RECONNECT,
];

export function parseAgentControlAcceptanceArgs(args) {
  let instanceId;
  let outDir;
  let scenario;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !["--instance", "--out-dir", "--scenario"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      seen.has(flag)
    ) {
      throw new Error(
        `Usage: npm run acceptance:agent-control -- [--instance <id> | --scenario <${ISOLATED_SCENARIOS.join("|")}>] [--out-dir <directory>]`
      );
    }
    seen.add(flag);
    if (flag === "--instance") instanceId = value;
    else if (flag === "--scenario") scenario = value;
    else outDir = value;
  }
  if (scenario && !ISOLATED_SCENARIOS.includes(scenario))
    throw new Error(`Unknown isolated acceptance scenario: ${scenario}.`);
  if (scenario && instanceId) throw new Error(`The ${scenario} scenario starts its own instance.`);
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  return {
    instanceId,
    ...(scenario ? { scenario } : {}),
    outDir: resolve(
      root,
      outDir ?? join("artifacts", "agent-control-acceptance", `${stamp}-${process.platform}`)
    ),
  };
}

function parseEnvelope(args, child, { allowFailure = false } = {}) {
  const line =
    child.stdout
      ?.replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/)
      .at(-1) ?? "";
  let envelope;
  try {
    envelope = JSON.parse(line);
  } catch {
    throw new Error(`${args.join(" ")} produced invalid JSON: ${line || "(empty output)"}`);
  }
  if (envelope?.ok !== true || !envelope.result) {
    if (allowFailure) return { failed: true, envelope, status: child.status };
    throw new Error(
      `${args.join(" ")} failed (${envelope?.error?.code ?? "unknownError"}): ${envelope?.error?.message ?? "No result."}`
    );
  }
  if (child.status !== 0 && !allowFailure) {
    throw new Error(`${args.join(" ")} exited with status ${child.status}.`);
  }
  return { failed: child.status !== 0, envelope, status: child.status };
}

export function createAcceptanceInvoker(executable, run = spawnSync) {
  const spawn = (args) => {
    const child = run(executable, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 330_000,
    });
    if (child.error) throw new Error(`${args.join(" ")} could not run: ${child.error.message}`);
    return child;
  };
  const invoke = (args, options = {}) => {
    const child = spawn(args);
    const parsed = parseEnvelope(args, child, options);
    return options.raw ? parsed : parsed.envelope?.result;
  };
  return {
    success: (args) => invoke(args),
    outcome: (args) => invoke(args, { allowFailure: true, raw: true }),
    asyncOutcome: (args) =>
      new Promise((resolve, reject) => {
        execFile(executable, args, { cwd: root, timeout: 15_000 }, (error, stdout) => {
          if (error && typeof error.code !== "number") return reject(error);
          try {
            resolve(
              parseEnvelope(args, { status: error?.code ?? 0, stdout }, { allowFailure: true })
            );
          } catch (parseError) {
            reject(parseError);
          }
        });
      }),
    text: (args) => {
      const child = spawn(args);
      if (child.status !== 0)
        throw new Error(`${args.join(" ")} exited with status ${child.status}.`);
      return child.stdout;
    },
  };
}

async function withVerifiedCleanup(body, cleanup) {
  let proved = false;
  try {
    try {
      return await body();
    } finally {
      await cleanup();
      proved = true;
    }
  } catch (error) {
    error.cleanupVerified = proved;
    throw error;
  }
}

function uiTokens({ revision, uiGeneration }) {
  return [
    "--expected-revision",
    String(revision),
    "--expected-ui-generation",
    String(uiGeneration),
  ];
}

async function runDialogDecisions(run) {
  const initial = await run(["ui", "inspect", "--json"]);
  assert.equal(initial.surfaces.length, 0);
  let id;
  return withVerifiedCleanup(
    async () => {
      const shown = await run(["ui", "show", "feedback", ...uiTokens(initial), "--json"]);
      id = shown.surface.surfaceId;
      assert.ok(
        shown.ui.activeBlockingEditors.includes("feedback"),
        "Feedback open reply omitted its blocker."
      );
      const ui = await run(["ui", "inspect", "--json"]);
      const decisions = ui.surfaces.find(({ surfaceId }) => surfaceId === id).choices;
      assert.equal(decisions.find(({ id }) => id === "send")?.disabled, true);
      const decide = ["ui", "decide", "--surface-id", id, "--choice"];
      const disabled = await run([...decide, "send", ...uiTokens(ui), "--dry-run", "--json"], {
        allowFailure: true,
      });
      assert.equal(disabled.envelope.error?.code, "uiActionUnavailable");
      const stale = await run(
        [...decide, "cancel", ...uiTokens({ ...ui, uiGeneration: ui.uiGeneration - 1 }), "--json"],
        { allowFailure: true }
      );
      assert.equal(stale.envelope.error?.code, "uiGenerationConflict");
      const stillOpen = await run(["ui", "inspect", "--json"]);
      assert.equal(stillOpen.topSurfaceId, id);
      const reset = await run(
        [
          "config",
          "reset",
          "--dry-run",
          "--expected-revision",
          String(stillOpen.revision),
          "--json",
        ],
        { allowFailure: true }
      );
      assert.equal(reset.envelope.error?.code, "editorActive");
      const cancelled = await run(["ui", "cancel", id, ...uiTokens(stillOpen), "--json"]);
      assert.ok(
        !cancelled.ui.activeBlockingEditors.includes("feedback"),
        "Feedback cancel reply retained its blocker."
      );
      return ["Verified disabled and stale dialog choices, the blocking editor guard, and Cancel."];
    },
    async () => {
      const ui = await run(["ui", "inspect", "--json"]);
      if (ui.topSurfaceId === id && id)
        await run([
          "ui",
          "decide",
          "--surface-id",
          id,
          "--choice",
          "cancel",
          ...uiTokens(ui),
          "--json",
        ]);
      assert.equal((await run(["ui", "inspect", "--json"])).surfaces.length, 0);
    }
  );
}

async function runRevisionWait(run, wait) {
  const initial = await run(["settings", "inspect", "--json"]);
  const previous = initial.settings.fileDialogueDetection;
  const directory = await mkdtemp(join(tmpdir(), "plvs-revision-wait-"));
  const update = async (value, revision) => {
    const patch = join(directory, "settings.json");
    await writeFile(patch, JSON.stringify({ fileDialogueDetection: value }), { mode: 0o600 });
    return run(["settings", "update", patch, "--expected-revision", String(revision), "--json"]);
  };
  const argv = ["wait", "--after-revision", String(initial.revision)];
  const concurrentWaits = Array.from({ length: 5 }, () =>
    wait([...argv, "--timeout-ms", "8000", "--json"])
  );
  const waiting = Promise.allSettled(concurrentWaits);
  let wrote = false;
  return withVerifiedCleanup(
    async () => {
      // Registration order is independent of process launch order. Only the refused wait
      // should finish before the mutation.
      const refused = await Promise.race(concurrentWaits);
      assert.equal(refused.envelope.error?.code, "waitLimitReached");
      const current = await run(["settings", "inspect", "--json"]);
      assert.equal(current.revision, initial.revision);
      const changed = await update(!previous, initial.revision);
      wrote = changed.changed;
      assert.equal(wrote, true);
      let woke = 0;
      for (const outcome of await waiting) {
        assert.equal(outcome.status, "fulfilled");
        if (outcome.value === refused) continue;
        assert.deepEqual(outcome.value.envelope.result, {
          matchedImmediately: false,
          outcome: "changed",
          revision: changed.revision,
        });
        woke++;
      }
      assert.equal(woke, 4);
      const timeout = await wait([
        "wait",
        "--after-revision",
        String(changed.revision),
        "--timeout-ms",
        "100",
        "--json",
      ]);
      assert.equal(timeout.status, 5);
      assert.equal(timeout.envelope.error?.code, "timeout");
      return [
        "Four concurrent waits woke on one commit, a fifth was refused, and timeout returned exit 5.",
      ];
    },
    async () => {
      try {
        await waiting;
        if (wrote) {
          const current = await run(["settings", "inspect", "--json"]);
          if (current.settings.fileDialogueDetection !== previous)
            await update(previous, current.revision);
          assert.equal(
            (await run(["settings", "inspect", "--json"])).settings.fileDialogueDetection,
            previous
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
}

export async function runOfflineContract(invoke) {
  const listed = invoke.success(["schema", "list", "--json"]);
  const listedIds = listed.commands.map(({ id }) => id);
  const expectedIds = manifest.commands.map(({ id }) => id);
  if (JSON.stringify(listedIds) !== JSON.stringify(expectedIds)) {
    throw new Error("schema list differs from the checked-in command manifest.");
  }
  for (const id of expectedIds) {
    const described = invoke.success(["schema", "get", id, "--json"]);
    if (described.command?.id !== id)
      throw new Error(`schema get returned the wrong command: ${id}`);
  }
  for (const shell of ["bash", "zsh", "powershell"]) {
    const script = invoke.text(["completion", shell]);
    if (!script.includes("capabilities") || !script.includes("visual")) {
      throw new Error(`${shell} completion omits public Agent Control commands.`);
    }
  }
  const doctor = invoke.outcome(["doctor", "--json"]);
  if (!doctor.envelope?.result) throw new Error("doctor returned no structured result.");
  return [`Verified ${expectedIds.length} schemas, three completions, and doctor diagnostics.`];
}

export async function runReadContract(run) {
  const app = await run(["inspect", "--json"]);
  const modules = await run(["module", "list", "--json"]);
  for (const item of modules.modules ?? []) {
    await run(["module", "describe", item.moduleId, "--json"]);
  }
  for (const panel of app.workspace?.panels ?? []) {
    await run(["panel", "describe", panel.id, "--json"]);
    if (panel.moduleId !== "spectrum") continue;
    // A Spectrum in an inactive tab is not rendered and has nothing to read.
    const spectrum = await run(
      ["measurement", "spectrum", "--panel-id", panel.id, "--resolution", "octave", "--json"],
      { allowFailure: true }
    );
    if (spectrum?.failed && spectrum.envelope?.error?.code !== "panelNotFound") {
      throw new Error(`measurement spectrum failed for ${panel.id}.`);
    }
  }
  for (const family of ["preset", "theme", "loudness-profile"]) {
    const listed = await run([family, "list", "--json"]);
    const entries =
      listed[family === "preset" ? "presets" : family === "theme" ? "themes" : "profiles"] ?? [];
    for (const item of entries) await run([family, "describe", item.id, "--json"]);
  }
  for (const args of [
    ["window", "inspect"],
    ["update", "inspect"],
    ["measurement", "describe"],
    ["measurement", "inspect"],
    ["view", "describe"],
    ["view", "inspect"],
    ["axis", "describe"],
    ["axis", "inspect"],
    ["theme", "inspect"],
    ["settings", "describe"],
    ["settings", "inspect"],
    ["device", "list"],
    ["device", "inspect"],
    ["transport", "inspect"],
    ["dock", "describe"],
    ["dock", "inspect"],
    ["editor-draft", "describe", "theme"],
    ["editor-draft", "describe", "loudness-profile"],
    ["config", "export"],
  ]) {
    await run([...args, "--json"]);
  }
  return [
    "Enumerated live modules, panels, libraries, state families, transport, and Dock contract.",
  ];
}

async function runProductWalkthrough(invoke, instanceId, outDir) {
  await mkdir(outDir, { recursive: true });
  const template = JSON.parse(
    await readFile(join(root, "scripts", "ui-walkthrough", "product-surfaces.example.json"), "utf8")
  );
  const manifestForRun = {
    ...template,
    workbench: { instanceId },
    fixture: {
      audio: { ...template.fixture.audio, id: `agent-control-acceptance-${process.pid}` },
    },
  };
  const privateDir = await mkdtemp(join(tmpdir(), "plvs-agent-control-acceptance-"));
  try {
    const manifestPath = join(privateDir, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifestForRun)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const materialize = async (label, document) => {
      const path = join(privateDir, `${label}.json`);
      await writeFile(path, `${JSON.stringify(document)}\n`, { encoding: "utf8", mode: 0o600 });
      return path;
    };
    let report;
    try {
      report = await runUiVisualWalkthrough({
        manifest: manifestForRun,
        outDir,
        invoke,
        materialize,
        journalFactory: ({ manifest: runManifest, initial }) =>
          createRunJournalStore(join(outDir, "run.json"), {
            manifest: runManifest,
            manifestPath,
            initial,
          }),
      });
    } catch (error) {
      if (error.report) await writeJsonAtomic(join(outDir, "report.json"), error.report);
      throw error;
    }
    if (!report.restoration?.verified)
      throw new Error("Product walkthrough did not verify restoration.");
    await writeJsonAtomic(join(outDir, "report.json"), report);
    return report;
  } finally {
    await rm(privateDir, { recursive: true, force: true });
  }
}

export async function runDockPlatformContract(run, platform) {
  const described = await run(["dock", "describe", "--json"]);
  const inspected = await run(["dock", "inspect", "--json"]);
  const args = [
    "dock",
    "enter",
    "--dry-run",
    "--expected-revision",
    String(inspected.revision),
    "--json",
  ];
  if (platform.os === "linux" && described.supported === false) {
    const outcome = await run(args, { allowFailure: true });
    if (!outcome?.failed) throw new Error("Linux Dock dry-run unexpectedly succeeded.");
    const reason = outcome.envelope?.error?.details?.reason ?? outcome.envelope?.error?.code;
    if (!new Set(["controlUnavailable", "controlsUnavailable"]).has(reason)) {
      throw new Error(`Linux Dock failed for the wrong reason: ${reason ?? "unknown"}.`);
    }
    return ["Verified Linux advertises Dock as unsupported and rejects entry without mutation."];
  }
  if (described.supported !== true) throw new Error(`${platform.os} must declare Dock supported.`);
  await run(args);
  return [`Verified ${platform.os} advertises Dock support and accepts a guarded dry-run.`];
}

export async function runAgentControlAcceptance({
  executable,
  outDir,
  instanceId,
  sourceSha,
  platform = hostPlatform(),
  invoker = createAcceptanceInvoker(executable),
}) {
  const startedAt = new Date();
  await mkdir(outDir, { recursive: true });
  const completed = [];
  const artifacts = [];
  const warnings = [
    "Capture-rig commands remain owned by smoke:capture.",
    "Run the configuration, window, Workbench, and Tray contracts separately against isolated profiles.",
  ];
  let cleanupStatus = "passed";
  let failure = null;
  let selectedInstance = null;
  const pass = (id, observations) => completed.push({ id, status: "passed", observations });
  try {
    pass("offline-contract", await runOfflineContract(invoker));
    const discovered = invoker.success(["instances", "--json"]);
    selectedInstance = selectSmokeInstance(
      discovered.instances,
      instanceId ?? process.env.PLVS_INSTANCE_ID
    );
    const run = async (args, options = {}) => {
      const fullArgs = [...args, "--instance", selectedInstance];
      return options.allowFailure ? invoker.outcome(fullArgs) : invoker.success(fullArgs);
    };

    const smokeDir = join(outDir, "base-smoke");
    const smoke = await runAgentControlSmoke({
      executable,
      outDir: smokeDir,
      instanceId: selectedInstance,
      sourceSha,
      platform,
    });
    if (smoke.evidence.summary !== "complete") {
      throw Object.assign(new Error("Base Agent Control smoke was incomplete."), {
        evidencePath: smoke.evidencePath,
      });
    }
    for (const artifact of smoke.evidence.artifacts) {
      artifacts.push({ ...artifact, file: relative(outDir, artifact.file) });
    }
    pass("base-smoke", [
      "Completed screenshot, silent recording, semantic navigation, and cleanup.",
    ]);
    pass("read-contract", await runReadContract(run));
    const walkthrough = await runProductWalkthrough(
      (args) => invoker.success(args),
      selectedInstance,
      join(outDir, "product-walkthrough")
    );
    for (const artifact of walkthrough.artifacts) {
      artifacts.push({
        id: `walkthrough-${artifact.scenario}`,
        kind: "image/png",
        file: relative(outDir, artifact.path),
        ...(artifact.metadata?.bytes ? { bytes: artifact.metadata.bytes } : {}),
        ...(artifact.metadata?.sha256 ? { sha256: artifact.metadata.sha256 } : {}),
      });
    }
    pass("product-walkthrough", [
      `Completed ${walkthrough.scenarios.length} visible product scenarios with verified restoration.`,
    ]);
    pass("dock-platform-contract", await runDockPlatformContract(run, platform));
    pass("dialog-decisions", await runDialogDecisions(run));
    pass(
      "revision-wait",
      await runRevisionWait(run, (args) =>
        invoker.asyncOutcome([...args, "--instance", selectedInstance])
      )
    );
    pass("mcp-adapter", await runMcpContract({ executable, instanceId: selectedInstance }));
  } catch (error) {
    failure = error;
    const completedIds = new Set(completed.map(({ id }) => id));
    const id = REQUIRED_SCENARIOS.find((candidate) => !completedIds.has(candidate));
    if (id) completed.push({ id, status: "failed", observations: [error.message] });
    if (id === "base-smoke") {
      const smoke = error.evidencePath
        ? await readFile(error.evidencePath, "utf8")
            .then(JSON.parse)
            .catch(() => null)
        : null;
      if (smoke?.cleanup?.status !== "passed") cleanupStatus = "failed";
    }
    if (id === "product-walkthrough" && error.report?.restoration?.verified !== true)
      cleanupStatus = "failed";
    if (error.cleanupVerified === false) cleanupStatus = "failed";
  }
  const coverage = completeScenarioCoverage(REQUIRED_SCENARIOS, completed);
  const evidence = {
    schemaVersion: 1,
    domain: "agent-control",
    runId: acceptanceRunId(startedAt),
    sourceSha,
    platform,
    tool: { name: "agent-control-acceptance", version: 1 },
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    summary: cleanupStatus === "failed" ? "failed" : coverage.summary,
    scenarios: coverage.scenarios,
    catalogueScenarios: AGENT_CONTROL_ACCEPTANCE_SCENARIOS.map((id) => ({
      id,
      status: coverage.scenarios.find((scenario) => scenario.id === id)?.status ?? "notRun",
    })),
    artifacts,
    cleanup: {
      status: cleanupStatus,
      observations: [
        cleanupStatus === "passed"
          ? "Owned UI surfaces, drafts, file sessions, and settings were restored."
          : "The failed scenario could not prove complete restoration; inspect its evidence before retrying.",
      ],
    },
    warnings,
    instanceId: selectedInstance,
  };
  const evidencePath = join(outDir, "result.json");
  await writeJsonAtomic(evidencePath, evidence);
  if (failure) {
    failure.evidencePath = evidencePath;
    throw failure;
  }
  return { evidence, evidencePath };
}

async function main() {
  const options = parseAgentControlAcceptanceArgs(process.argv.slice(2));
  if (options.scenario) {
    const ffmpeg = spawnSync(process.execPath, ["scripts/fetch-ffmpeg-sidecar.mjs"], {
      cwd: root,
      stdio: "inherit",
    });
    if (ffmpeg.error || ffmpeg.status !== 0) {
      throw ffmpeg.error ?? new Error("Could not prepare the FFmpeg sidecars.");
    }
    const { executable } = buildPlvsCli({ identity: "dev" });
    if (options.scenario === LIVE_SOURCE_RECONNECT) {
      const sourceSha = resolveEvidenceSourceSha(root);
      const platform = hostPlatform();
      const result = await withCaptureRig(
        () => runLiveSourceReconnect({ executable, outDir: options.outDir, platform: platform.os }),
        { wait: true }
      );
      const evidencePath = join(options.outDir, "summary.json");
      await writeJsonAtomic(evidencePath, { sourceSha, platform, scenarios: [result] });
      console.log(`Evidence: ${evidencePath}`);
      if (result.status !== "passed") process.exitCode = 1;
      return;
    }
    const evidencePath = await runIsolatedAgentControl({
      executable,
      root,
      outDir: options.outDir,
      scenario: options.scenario,
      runDesktop: ({ instanceId, env }) => {
        const child = spawnSync(
          process.execPath,
          [fileURLToPath(import.meta.url), "--instance", instanceId, "--out-dir", options.outDir],
          { cwd: root, env, stdio: "inherit" }
        );
        if (child.error) throw child.error;
        if (child.status !== 0) throw new Error("The isolated desktop acceptance failed.");
      },
    });
    console.log(`Evidence: ${evidencePath}`);
    return;
  }
  const sourceSha = resolveEvidenceSourceSha(root);
  scopeDevCliToWorktree();
  const { executable } = buildPlvsCli({ identity: "dev" });
  const result = await runAgentControlAcceptance({ executable, sourceSha, ...options });
  console.log(`Evidence: ${result.evidencePath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    if (error.evidencePath) console.error(`Evidence: ${error.evidencePath}`);
    process.exitCode = 1;
  });
}
