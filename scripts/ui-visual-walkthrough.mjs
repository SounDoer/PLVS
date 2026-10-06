#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { buildPlvsCli } from "./build-plvs-cli.mjs";
import {
  assertWalkthroughStart,
  buildRestorationLedger,
  uiShowArguments,
  validateWalkthroughManifest,
} from "./ui-visual-walkthrough-lib.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function actionTokens(result) {
  return [
    "--expected-revision",
    String(result.revision),
    "--expected-ui-generation",
    String(result.uiGeneration),
    "--json",
  ];
}

function withInstance(args, instanceId) {
  return [...args, "--instance", instanceId];
}

export async function runUiVisualWalkthrough({ manifest, outDir, invoke, materialize }) {
  const issues = validateWalkthroughManifest(manifest);
  if (issues.length > 0) throw new Error(`Invalid walkthrough manifest:\n${issues.join("\n")}`);
  const instanceId = manifest.workbench.instanceId;
  const run = (args) => invoke(withInstance(args, instanceId));
  const capabilities = await run(["capabilities", "--json"]);
  const initialApp = await run(["inspect", "--json"]);
  const initialUi = await run(["ui", "inspect", "--json"]);
  assertWalkthroughStart(manifest, capabilities, initialUi);

  const families = new Set(
    manifest.scenarios.flatMap((scenario) => scenario.durable.map((step) => step.family))
  );
  const initialFamilies = {};
  for (const family of families) initialFamilies[family] = await run([family, "inspect", "--json"]);
  const restoration = buildRestorationLedger(manifest, initialFamilies);
  const report = {
    schemaVersion: 1,
    workbench: { instanceId },
    scenarios: [],
    artifacts: [],
    initial: { revision: initialApp.revision, uiGeneration: initialUi.uiGeneration },
    final: null,
    restoration: { attempted: false, verified: false, fields: restoration.length },
  };
  let latestApp = initialApp;
  let latestUi = initialUi;
  const applyPatch = async ({ family, patch }, label) => {
    if (!materialize) throw new Error("Durable walkthrough steps require a private input writer.");
    const inputPath = await materialize(label, patch);
    await run([
      family,
      "update",
      inputPath,
      "--expected-revision",
      String(latestApp.revision),
      "--json",
    ]);
    latestApp = await run(["inspect", "--json"]);
    latestUi = await run(["ui", "inspect", "--json"]);
  };

  let primaryFailure = null;
  try {
    for (const scenario of manifest.scenarios) {
      for (const [index, step] of scenario.durable.entries()) {
        await applyPatch(step, `${scenario.id}-setup-${index}`);
      }
      const shown = await run([...uiShowArguments(scenario.ui), ...actionTokens(latestUi)]);
      const surface = shown.surface;
      if (!surface?.surfaceId || surface.kind !== scenario.ui.kind)
        throw new Error(`Scenario ${scenario.id} opened the wrong UI surface.`);
      latestApp = { ...latestApp, revision: shown.revision };
      latestUi = { ...shown.ui, revision: shown.revision, uiGeneration: shown.uiGeneration };

      const screenshotPath = join(outDir, scenario.screenshot.output);
      const screenshotArgs = ["visual", "screenshot", "--target", scenario.screenshot.target];
      if (scenario.screenshot.panelId)
        screenshotArgs.push("--panel-id", scenario.screenshot.panelId);
      screenshotArgs.push(
        "--expected-revision",
        String(shown.revision),
        "--expected-ui-generation",
        String(shown.uiGeneration),
        "--out",
        screenshotPath,
        "--json"
      );
      const captured = await run(screenshotArgs);
      report.artifacts.push({
        scenario: scenario.id,
        path: screenshotPath,
        metadata: captured.artifact,
      });
      const dismiss = ["settings", "panelSettings"].includes(scenario.ui.kind) ? "close" : "cancel";
      const dismissed = await run([
        "ui",
        dismiss,
        surface.surfaceId,
        "--expected-revision",
        String(captured.revision),
        "--expected-ui-generation",
        String(captured.uiGeneration),
        "--json",
      ]);
      latestApp = { ...latestApp, revision: dismissed.revision };
      latestUi = await run(["ui", "inspect", "--json"]);
      if (latestUi.surfaces.some(({ surfaceId }) => surfaceId === surface.surfaceId))
        throw new Error(`Scenario ${scenario.id} did not dismiss its exact surface.`);
      report.scenarios.push({ id: scenario.id, surfaceId: surface.surfaceId, restored: false });
    }
  } catch (error) {
    primaryFailure = error;
    report.failure = {
      reason: error.reason ?? error.code ?? "walkthroughFailed",
      message: String(error.message).slice(0, 500),
      preservationRequired: [
        "revisionConflict",
        "uiGenerationConflict",
        "uiSurfaceNotFound",
        "stateCommitted",
      ].includes(error.reason ?? error.code),
    };
  }
  if (!report.failure?.preservationRequired) {
    report.restoration.attempted = true;
    try {
      for (const [index, entry] of restoration.entries())
        await applyPatch(entry, `restore-${index}`);
    } catch (error) {
      report.restoration.error = String(error.message).slice(0, 500);
      error.report = report;
      throw error;
    }
  }

  if (primaryFailure) {
    primaryFailure.report = report;
    throw primaryFailure;
  }

  for (const [family, initial] of Object.entries(initialFamilies)) {
    const final = await run([family, "inspect", "--json"]);
    for (const entry of restoration.filter((candidate) => candidate.family === family)) {
      for (const [key, value] of Object.entries(entry.verify)) {
        if (!sameJson(final[key], value))
          throw new Error(`Restoration verification failed for ${family}.${key}.`);
      }
    }
    void initial;
  }
  const finalApp = await run(["inspect", "--json"]);
  const finalUi = await run(["ui", "inspect", "--json"]);
  if (
    finalUi.activeBlockingEditors.length > 0 ||
    finalUi.surfaces.length !== initialUi.surfaces.length
  )
    throw new Error("Final transient UI does not match the initial walkthrough state.");
  report.final = { revision: finalApp.revision, uiGeneration: finalUi.uiGeneration };
  report.restoration.verified = true;
  for (const scenario of report.scenarios) scenario.restored = true;
  return report;
}

function parseEnvelope(args, output) {
  const line = output
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .pop();
  const envelope = JSON.parse(line || "null");
  if (envelope?.ok !== true || !envelope.result) {
    const code = envelope?.error?.code ?? "unknownError";
    const error = new Error(
      `${args.join(" ")} failed (${code}): ${envelope?.error?.message ?? "No result."}`
    );
    error.code = code;
    error.reason = envelope?.error?.details?.reason ?? code;
    error.details = envelope?.error?.details;
    throw error;
  }
  return envelope.result;
}

async function main(args) {
  let manifestPath;
  let outDir;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--manifest" && args[index + 1]) manifestPath = args[(index += 1)];
    else if (args[index] === "--out-dir" && args[index + 1]) outDir = args[(index += 1)];
    else
      throw new Error(
        "Usage: node scripts/ui-visual-walkthrough.mjs --manifest <file> --out-dir <directory>"
      );
  }
  if (!manifestPath || !outDir) throw new Error("Both --manifest and --out-dir are required.");
  const resolvedOut = resolve(repositoryRoot, outDir);
  await mkdir(resolvedOut, { recursive: true });
  const privateDir = await mkdtemp(join(tmpdir(), "plvs-ui-walkthrough-"));
  try {
    const manifest = JSON.parse(await readFile(resolve(repositoryRoot, manifestPath), "utf8"));
    const executable = await buildPlvsCli();
    const invoke = async (commandArgs) => {
      const child = spawnSync(executable, commandArgs, {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 330_000,
      });
      if (child.error) throw child.error;
      return parseEnvelope(commandArgs, child.stdout);
    };
    const materialize = async (label, document) => {
      const path = join(privateDir, `${label}.json`);
      await writeFile(path, `${JSON.stringify(document)}\n`, { encoding: "utf8", mode: 0o600 });
      return path;
    };
    try {
      const report = await runUiVisualWalkthrough({
        manifest,
        outDir: resolvedOut,
        invoke,
        materialize,
      });
      await writeFile(join(resolvedOut, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify(report));
    } catch (error) {
      if (error.report) {
        await writeFile(
          join(resolvedOut, "report.json"),
          `${JSON.stringify(error.report, null, 2)}\n`
        );
      }
      throw error;
    }
  } finally {
    await rm(privateDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
