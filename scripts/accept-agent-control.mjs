#!/usr/bin/env node

import { spawnSync } from "node:child_process";
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_SCENARIOS = [
  "offline-contract",
  "base-smoke",
  "read-contract",
  "product-walkthrough",
  "dock-platform-contract",
];

export function parseAgentControlAcceptanceArgs(args) {
  let instanceId;
  let outDir;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !["--instance", "--out-dir"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      seen.has(flag)
    ) {
      throw new Error(
        "Usage: npm run acceptance:agent-control -- [--instance <id>] [--out-dir <directory>]"
      );
    }
    seen.add(flag);
    if (flag === "--instance") instanceId = value;
    else outDir = value;
  }
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  return {
    instanceId,
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
    text: (args) => {
      const child = spawn(args);
      if (child.status !== 0)
        throw new Error(`${args.join(" ")} exited with status ${child.status}.`);
      return child.stdout;
    },
  };
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
  }
  for (const family of ["preset", "theme", "loudness-profile"]) {
    const listed = await run([family, "list", "--json"]);
    const entries =
      listed[family === "preset" ? "presets" : family === "theme" ? "themes" : "profiles"] ?? [];
    for (const item of entries) await run([family, "describe", item.id, "--json"]);
  }
  for (const args of [
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
    const materialize = async (label, document) => {
      const path = join(privateDir, `${label}.json`);
      await writeFile(path, `${JSON.stringify(document)}\n`, { encoding: "utf8", mode: 0o600 });
      return path;
    };
    const report = await runUiVisualWalkthrough({
      manifest: manifestForRun,
      outDir,
      invoke,
      materialize,
    });
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
  if (platform.os === "linux") {
    if (described.supported !== false) throw new Error("Linux must declare Dock unsupported.");
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
    "config.import remains owned by update acceptance because it relaunches the app.",
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
    if (smoke.evidence.summary !== "complete")
      throw new Error("Base Agent Control smoke was incomplete.");
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
  } catch (error) {
    failure = error;
    const completedIds = new Set(completed.map(({ id }) => id));
    const id = REQUIRED_SCENARIOS.find((candidate) => !completedIds.has(candidate));
    if (id) completed.push({ id, status: "failed", observations: [error.message] });
    cleanupStatus = "failed";
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
