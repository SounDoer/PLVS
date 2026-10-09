#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import { buildPlvsCli } from "./build-plvs-cli.mjs";
import { createStereoFixtureWav } from "./theme-gallery-lib.mjs";
import {
  createRunJournalStore,
  manifestSha256,
  openRunJournalStore,
  readRunJournal,
} from "./ui-walkthrough/journal.mjs";
import { recoverUiVisualWalkthrough, summarizeRunJournal } from "./ui-walkthrough/recovery.mjs";
import {
  assertWalkthroughStart,
  buildScenarioRestorationLedger,
  classifyRestorationField,
  requiredWalkthroughMethods,
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

function fileSessions(transport) {
  return transport.files?.sessions ?? transport.fileSessions ?? [];
}

function comparablePath(path) {
  return resolve(String(path ?? "").replace(/^\\\\\?\\/, ""));
}

async function waitForFileAnalysis(run, fixturePath, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const transport = await run(["transport", "inspect", "--json"]);
    const session = fileSessions(transport).find(
      (item) => comparablePath(item.path) === comparablePath(fixturePath)
    );
    if (session?.state === "complete" || session?.state === "completed") return session;
    if (session?.state === "failed") {
      throw new Error(`Fixture analysis failed: ${session.error ?? "unknown error"}`);
    }
    try {
      await run([
        "wait",
        "--after-revision",
        String(transport.revision),
        "--timeout-ms",
        "5000",
        "--json",
      ]);
    } catch {
      // A wait timeout is expected while the native analysis is still running.
    }
  }
  throw new Error("Timed out waiting for the deterministic fixture analysis.");
}

export async function runUiVisualWalkthrough({
  manifest,
  outDir,
  invoke,
  materialize,
  journalFactory,
}) {
  const issues = validateWalkthroughManifest(manifest);
  if (issues.length > 0) throw new Error(`Invalid walkthrough manifest:\n${issues.join("\n")}`);
  const instanceId = manifest.workbench.instanceId;
  const run = (args) => invoke(withInstance(args, instanceId));
  const capabilities = await run(["capabilities", "--json"]);
  const initialApp = await run(["inspect", "--json"]);
  const initialUi = await run(["ui", "inspect", "--json"]);
  assertWalkthroughStart(manifest, capabilities, initialUi);
  const journal = journalFactory
    ? await journalFactory({
        manifest,
        initial: {
          revision: initialApp.revision,
          uiGeneration: initialUi.uiGeneration,
          applicationIdentity: capabilities.applicationIdentity,
          protocolVersion: capabilities.protocolVersion,
        },
      })
    : null;
  await journal?.transitionRun("preparing");
  const initialTransport = manifest.fixture?.audio
    ? await run(["transport", "inspect", "--json"])
    : null;

  const report = {
    schemaVersion: 1,
    workbench: { instanceId },
    scenarios: [],
    artifacts: [],
    initial: { revision: initialApp.revision, uiGeneration: initialUi.uiGeneration },
    final: null,
    restoration: {
      attempted: false,
      verified: false,
      fields: manifest.scenarios.reduce(
        (total, scenario) => total + new Set(scenario.touches).size,
        0
      ),
    },
    fixture: null,
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
  const restoreOwnedEntries = async (entries, label) => {
    const statuses = new Map();
    for (const [index, entry] of entries.entries()) {
      const inspected = await run([entry.family, "inspect", "--json"]);
      const state = inspected[entry.family] ?? inspected;
      const patch = {};
      for (const field of entry.fields) {
        const status = classifyRestorationField(field, state[field.key]);
        statuses.set(`${entry.family}.${field.key}`, status);
        if (status === "owned") patch[field.key] = field.before;
        if (status === "diverged") {
          const error = new Error(
            `Restoration preserved externally changed field ${entry.family}.${field.key}.`
          );
          error.reason = "recoveryDiverged";
          throw error;
        }
      }
      if (Object.keys(patch).length > 0) {
        await applyPatch({ family: entry.family, patch }, `${label}-${index}`);
        for (const key of Object.keys(patch)) statuses.set(`${entry.family}.${key}`, "restored");
      }
    }
    return statuses;
  };

  let primaryFailure = null;
  let createdSessionId = null;
  let fixturePath = null;
  let activeEventFixtureId = null;
  let pendingRestoration = [];
  try {
    if (manifest.fixture?.audio) {
      fixturePath = join(outDir, `${manifest.fixture.audio.id}.wav`);
      await journal?.update((draft) => {
        draft.suite.resources.push({
          type: "transportFile",
          path: fixturePath,
          sessionId: null,
          before: {
            source: initialTransport.source,
            liveState: initialTransport.live?.state ?? null,
            activeId: initialTransport.files?.activeId ?? null,
          },
          applied: null,
          status: "intent",
        });
      });
      const contents = createStereoFixtureWav(manifest.fixture.audio);
      await writeFile(fixturePath, contents);
      await run([
        "transport",
        "file",
        "analyze",
        fixturePath,
        "--expected-revision",
        String(latestApp.revision),
        "--json",
      ]);
      const session = await waitForFileAnalysis(run, fixturePath);
      createdSessionId = session.id;
      const preparedTransport = await run(["transport", "inspect", "--json"]);
      await journal?.update((draft) => {
        Object.assign(draft.suite.resources.at(-1), {
          sessionId: session.id,
          applied: {
            source: preparedTransport.source,
            liveState: preparedTransport.live?.state ?? null,
            activeId: preparedTransport.files?.activeId ?? null,
          },
          status: "owned",
        });
      });
      latestApp = await run(["inspect", "--json"]);
      latestUi = await run(["ui", "inspect", "--json"]);
      report.fixture = {
        ...manifest.fixture.audio,
        path: fixturePath,
        sha256: createHash("sha256").update(contents).digest("hex"),
        sessionId: session.id,
      };
    }
    await journal?.transitionRun("running");
    for (const scenario of manifest.scenarios) {
      await journal?.transitionScenario(scenario.id, "preparing");
      const scenarioFamilies = {};
      for (const family of new Set(scenario.durable.map((step) => step.family))) {
        scenarioFamilies[family] = await run([family, "inspect", "--json"]);
      }
      pendingRestoration = buildScenarioRestorationLedger(scenario, scenarioFamilies);
      await journal?.update((draft) => {
        const scenarioJournal = draft.scenarios.find(({ id }) => id === scenario.id);
        scenarioJournal.resources.push(
          ...pendingRestoration.flatMap((entry) =>
            entry.fields.map((field) => ({
              type: "field",
              family: entry.family,
              key: field.key,
              before: field.before,
              applied: field.applied,
              status: "intent",
            }))
          )
        );
      });
      for (const [index, step] of scenario.durable.entries()) {
        await applyPatch(step, `${scenario.id}-setup-${index}`);
      }
      await journal?.update((draft) => {
        const resources = draft.scenarios.find(({ id }) => id === scenario.id).resources;
        for (const resource of resources.filter(({ type }) => type === "field")) {
          resource.status = "owned";
        }
      });
      await journal?.transitionScenario(scenario.id, "running");
      const showArgs = uiShowArguments(scenario.ui);
      let fixtureId = null;
      let shown;
      if (scenario.ui.kind !== "workspace") {
        await journal?.update((draft) => {
          draft.scenarios
            .find(({ id }) => id === scenario.id)
            .resources.push({
              type: scenario.ui.kind === "eventFixture" ? "eventFixture" : "surface",
              kind: scenario.ui.kind,
              dismiss: ["settings", "panelSettings"].includes(scenario.ui.kind)
                ? "close"
                : scenario.ui.kind === "eventFixture"
                  ? scenario.ui.action
                  : "cancel",
              surfaceId: null,
              fixtureId: null,
              status: "intent",
            });
        });
      }
      if (scenario.ui.kind === "eventFixture") {
        const established = await run([
          "dev",
          "fixture",
          "establish",
          scenario.ui.name,
          ...actionTokens({ ...latestUi, revision: latestApp.revision }),
        ]);
        fixtureId = established.fixtureId;
        activeEventFixtureId = fixtureId;
        latestApp = { ...latestApp, revision: established.revision };
        const inspected = await run(["ui", "inspect", "--json"]);
        const surface = inspected.surfaces?.find(
          (candidate) =>
            candidate.kind === scenario.ui.surfaceKind &&
            candidate.target?.phase === scenario.ui.phase
        );
        shown = {
          revision: established.revision,
          uiGeneration: inspected.uiGeneration,
          ui: inspected,
          surface,
        };
      } else {
        shown = showArgs
          ? await run([...showArgs, ...actionTokens(latestUi)])
          : { ...latestUi, revision: latestApp.revision };
      }
      const surface =
        shown.surface ?? (scenario.ui.kind === "eventFixture" ? null : latestUi.surfaces?.at(-1));
      if (showArgs && (!surface?.surfaceId || surface.kind !== scenario.ui.kind)) {
        throw new Error(`Scenario ${scenario.id} opened the wrong UI surface.`);
      }
      if (
        scenario.ui.kind === "eventFixture" &&
        (!surface ||
          surface.kind !== scenario.ui.surfaceKind ||
          surface.target?.phase !== scenario.ui.phase ||
          (scenario.ui.action !== "reset" &&
            !surface.supportedActions?.includes(scenario.ui.action)))
      ) {
        throw new Error(`Scenario ${scenario.id} found the wrong development fixture surface.`);
      }
      latestApp = { ...latestApp, revision: shown.revision };
      latestUi = {
        ...(shown.ui ?? latestUi),
        revision: shown.revision,
        uiGeneration: shown.uiGeneration,
      };
      if (surface) {
        await journal?.update((draft) => {
          const resource = draft.scenarios
            .find(({ id }) => id === scenario.id)
            .resources.find(
              ({ type, status }) =>
                ["surface", "eventFixture"].includes(type) && status === "intent"
            );
          Object.assign(resource, {
            surfaceId: surface.surfaceId,
            fixtureId,
            status: "owned",
          });
        });
      }
      let draftState = null;
      let draftKind = null;
      if (scenario.draft) {
        if (!materialize)
          throw new Error("Draft walkthrough steps require a private input writer.");
        draftKind = scenario.ui.kind === "themeEditor" ? "theme" : "loudness-profile";
        const inspectedDraft = await run([
          "editor-draft",
          "inspect",
          draftKind,
          surface.surfaceId,
          "--json",
        ]);
        await journal?.update((draft) => {
          draft.scenarios
            .find(({ id }) => id === scenario.id)
            .resources.push({
              type: "draft",
              kind: draftKind,
              surfaceId: surface.surfaceId,
              draftGeneration: inspectedDraft.draftGeneration,
              decisionSurfaceId: null,
              status: "intent",
            });
        });
        const inputPath = await materialize(`${scenario.id}-draft`, scenario.draft);
        draftState = await run([
          "editor-draft",
          "patch",
          draftKind,
          surface.surfaceId,
          inputPath,
          "--expected-revision",
          String(inspectedDraft.revision),
          "--expected-ui-generation",
          String(inspectedDraft.uiGeneration),
          "--expected-draft-generation",
          String(inspectedDraft.draftGeneration),
          "--json",
        ]);
        if (!draftState.changed || !draftState.dirty) {
          throw new Error(`Scenario ${scenario.id} did not establish a dirty editor draft.`);
        }
        await journal?.update((draft) => {
          const resource = draft.scenarios
            .find(({ id }) => id === scenario.id)
            .resources.find(({ type }) => type === "draft");
          resource.draftGeneration = draftState.draftGeneration;
          resource.status = "owned";
        });
        latestApp = { ...latestApp, revision: draftState.revision };
        latestUi = await run(["ui", "inspect", "--json"]);
      }

      const screenshotPath = join(outDir, scenario.screenshot.output);
      const screenshotArgs = ["visual", "screenshot", "--target", scenario.screenshot.target];
      if (scenario.screenshot.panelId)
        screenshotArgs.push("--panel-id", scenario.screenshot.panelId);
      screenshotArgs.push(
        "--expected-revision",
        String(latestApp.revision),
        "--expected-ui-generation",
        String(latestUi.uiGeneration),
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
      await journal?.update((draft) => {
        draft.scenarios.find(({ id }) => id === scenario.id).artifact = {
          path: screenshotPath,
          metadata: captured.artifact,
        };
      });
      await journal?.transitionScenario(scenario.id, "cleaning");
      if (surface) {
        if (draftState) {
          await run([
            "ui",
            "cancel",
            surface.surfaceId,
            "--expected-revision",
            String(captured.revision),
            "--expected-ui-generation",
            String(captured.uiGeneration),
            "--json",
          ]);
          const decisionUi = await run(["ui", "inspect", "--json"]);
          const decision = decisionUi.surfaces.find(
            (candidate) =>
              candidate.target?.purpose === "discardDraft" &&
              candidate.target?.editorSurfaceId === surface.surfaceId
          );
          if (!decision || decisionUi.topSurfaceId !== decision.surfaceId) {
            throw new Error(`Scenario ${scenario.id} did not open its linked discard decision.`);
          }
          await journal?.update((draft) => {
            const resource = draft.scenarios
              .find(({ id }) => id === scenario.id)
              .resources.find(({ type }) => type === "draft");
            resource.decisionSurfaceId = decision.surfaceId;
          });
          const discarded = await run([
            "editor-draft",
            "discard",
            draftKind,
            surface.surfaceId,
            "--decision-surface-id",
            decision.surfaceId,
            "--expected-revision",
            String(captured.revision),
            "--expected-ui-generation",
            String(decisionUi.uiGeneration),
            "--expected-draft-generation",
            String(draftState.draftGeneration),
            "--json",
          ]);
          latestApp = { ...latestApp, revision: discarded.revision };
          latestUi = await run(["ui", "inspect", "--json"]);
          await journal?.update((draft) => {
            const resources = draft.scenarios.find(({ id }) => id === scenario.id).resources;
            for (const resource of resources.filter(({ type }) =>
              ["draft", "surface"].includes(type)
            )) {
              resource.status = "restored";
            }
          });
        } else {
          const dismiss = ["settings", "panelSettings"].includes(scenario.ui.kind)
            ? "close"
            : scenario.ui.kind === "eventFixture"
              ? scenario.ui.action
              : "cancel";
          const dismissed =
            dismiss === "reset"
              ? await run([
                  "dev",
                  "fixture",
                  "reset",
                  fixtureId,
                  "--expected-revision",
                  String(captured.revision),
                  "--expected-ui-generation",
                  String(captured.uiGeneration),
                  "--json",
                ])
              : await run([
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
          await journal?.update((draft) => {
            const resource = draft.scenarios
              .find(({ id }) => id === scenario.id)
              .resources.find(({ type }) => ["surface", "eventFixture"].includes(type));
            resource.status = "restored";
          });
        }
        if (latestUi.surfaces.some(({ surfaceId }) => surfaceId === surface.surfaceId)) {
          throw new Error(`Scenario ${scenario.id} did not dismiss its exact surface.`);
        }
        activeEventFixtureId = null;
      }
      report.scenarios.push({
        id: scenario.id,
        surfaceId: surface?.surfaceId ?? null,
        ...(fixtureId ? { fixtureId } : {}),
        restored: false,
      });
      report.restoration.attempted ||= pendingRestoration.length > 0;
      const fieldStatuses = await restoreOwnedEntries(pendingRestoration, `${scenario.id}-restore`);
      await journal?.update((draft) => {
        const resources = draft.scenarios.find(({ id }) => id === scenario.id).resources;
        for (const resource of resources.filter(({ type }) => type === "field")) {
          resource.status = fieldStatuses.get(`${resource.family}.${resource.key}`);
        }
      });
      await journal?.transitionScenario(scenario.id, "verifying");
      for (const entry of pendingRestoration) {
        const final = await run([entry.family, "inspect", "--json"]);
        const finalState = final[entry.family] ?? final;
        for (const [key, value] of Object.entries(entry.verify)) {
          if (!sameJson(finalState[key], value)) {
            throw new Error(`Restoration verification failed for ${entry.family}.${key}.`);
          }
        }
      }
      report.scenarios.at(-1).restored = true;
      pendingRestoration = [];
      await journal?.transitionScenario(scenario.id, "complete");
    }
  } catch (error) {
    primaryFailure = error;
    report.failure = {
      reason: error.reason ?? error.code ?? "walkthroughFailed",
      message: String(error.message).slice(0, 500),
      preservationRequired:
        [
          "revisionConflict",
          "uiGenerationConflict",
          "uiSurfaceNotFound",
          "stateCommitted",
          "recoveryDiverged",
        ].includes(error.reason ?? error.code) || activeEventFixtureId !== null,
      ...(activeEventFixtureId ? { fixtureId: activeEventFixtureId } : {}),
    };
    await journal?.update((draft) => {
      draft.failure = report.failure;
    });
    if (journal) await journal.transitionRun("needsRecovery");
  }
  if (primaryFailure && journal) {
    report.restoration.attempted = true;
    try {
      const recovery = await recoverUiVisualWalkthrough({
        journalStore: journal,
        invoke,
        materialize,
      });
      report.restoration.verified = recovery.phase === "complete";
    } catch (recoveryError) {
      report.restoration.error = String(recoveryError.message).slice(0, 500);
      report.failure.preservationRequired = true;
    }
    primaryFailure.report = report;
    throw primaryFailure;
  }
  if (!report.failure?.preservationRequired) {
    report.restoration.attempted = true;
    try {
      await journal?.transitionRun("cleaning");
      await restoreOwnedEntries(pendingRestoration, "failed-scenario-restore");
      pendingRestoration = [];
      if (initialTransport) {
        latestApp = await run(["inspect", "--json"]);
        if (!createdSessionId && fixturePath) {
          const currentTransport = await run(["transport", "inspect", "--json"]);
          createdSessionId = fileSessions(currentTransport).find(
            (session) => comparablePath(session.path) === comparablePath(fixturePath)
          )?.id;
        }
        if (
          createdSessionId &&
          !fileSessions(initialTransport).some(({ id }) => id === createdSessionId)
        ) {
          await run([
            "transport",
            "file",
            "remove",
            createdSessionId,
            "--expected-revision",
            String(latestApp.revision),
            "--json",
          ]);
          latestApp = await run(["inspect", "--json"]);
        }
        if (initialTransport.source === "live") {
          await run([
            "transport",
            "source",
            "live",
            "--expected-revision",
            String(latestApp.revision),
            "--json",
          ]);
          latestApp = await run(["inspect", "--json"]);
          if (initialTransport.live?.state === "running") {
            await run([
              "transport",
              "live",
              "start",
              "--expected-revision",
              String(latestApp.revision),
              "--json",
            ]);
          }
        } else if (initialTransport.files?.activeId) {
          await run([
            "transport",
            "file",
            "select",
            initialTransport.files.activeId,
            "--expected-revision",
            String(latestApp.revision),
            "--json",
          ]);
        } else {
          await run([
            "transport",
            "source",
            "file",
            "--expected-revision",
            String(latestApp.revision),
            "--json",
          ]);
        }
        await journal?.update((draft) => {
          const resource = draft.suite.resources.find(({ type }) => type === "transportFile");
          if (resource) resource.status = "restored";
        });
      }
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

  const finalApp = await run(["inspect", "--json"]);
  const finalUi = await run(["ui", "inspect", "--json"]);
  await journal?.transitionRun("verifying");
  if (
    finalUi.activeBlockingEditors.length > 0 ||
    finalUi.surfaces.length !== initialUi.surfaces.length
  )
    throw new Error("Final transient UI does not match the initial walkthrough state.");
  if (
    manifest.scenarios.some((scenario) => scenario.draft) &&
    (!sameJson(finalApp.appearance, initialApp.appearance) ||
      !sameJson(finalApp.loudnessProfile, initialApp.loudnessProfile))
  ) {
    throw new Error("Discarded editor drafts changed durable Theme/Profile selection state.");
  }
  if (initialTransport) {
    const finalTransport = await run(["transport", "inspect", "--json"]);
    if (
      finalTransport.source !== initialTransport.source ||
      finalTransport.live?.state !== initialTransport.live?.state ||
      !sameJson(
        fileSessions(finalTransport).map(({ id }) => id),
        fileSessions(initialTransport).map(({ id }) => id)
      )
    ) {
      throw new Error("Final transport state does not match the initial walkthrough state.");
    }
  }
  report.final = { revision: finalApp.revision, uiGeneration: finalUi.uiGeneration };
  report.restoration.verified = true;
  await journal?.transitionRun("complete");
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
  let plan = false;
  let statusPath;
  let recoverPath;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--manifest" && args[index + 1]) manifestPath = args[(index += 1)];
    else if (args[index] === "--out-dir" && args[index + 1]) outDir = args[(index += 1)];
    else if (args[index] === "--plan") plan = true;
    else if (args[index] === "--status" && args[index + 1]) statusPath = args[(index += 1)];
    else if (args[index] === "--recover" && args[index + 1]) recoverPath = args[(index += 1)];
    else
      throw new Error(
        "Usage: node scripts/ui-visual-walkthrough.mjs --manifest <file> --out-dir <directory> [--plan] | --status <run.json> | --recover <run.json>"
      );
  }
  if (statusPath && recoverPath) throw new Error("Choose either --status or --recover.");
  const containedPath = (value) => {
    const path = resolve(repositoryRoot, value);
    const relation = relative(repositoryRoot, path);
    if (relation === ".." || relation.startsWith(`..${sep}`)) {
      throw new Error("The journal must be contained in the repository.");
    }
    return path;
  };
  if (statusPath) {
    if (manifestPath || outDir || plan) throw new Error("--status does not accept run options.");
    console.log(
      JSON.stringify(summarizeRunJournal(await readRunJournal(containedPath(statusPath))))
    );
    return;
  }
  const createInvoke = () => {
    const { executable } = buildPlvsCli({ identity: "development" });
    return async (commandArgs) => {
      const child = spawnSync(executable, commandArgs, {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 330_000,
      });
      if (child.error) throw child.error;
      return parseEnvelope(commandArgs, child.stdout);
    };
  };
  if (recoverPath) {
    if (manifestPath || outDir || plan) throw new Error("--recover does not accept run options.");
    const resolvedJournal = containedPath(recoverPath);
    const recoveryJournal = await readRunJournal(resolvedJournal);
    const recordedManifestPath = containedPath(recoveryJournal.manifest.path);
    const recordedManifest = JSON.parse(await readFile(recordedManifestPath, "utf8"));
    if (manifestSha256(recordedManifest) !== recoveryJournal.manifest.sha256) {
      throw new Error("Recovery refused because the recorded manifest changed.");
    }
    const privateDir = await mkdtemp(join(tmpdir(), "plvs-ui-walkthrough-recover-"));
    try {
      const materialize = async (label, document) => {
        const path = join(privateDir, `${label}.json`);
        await writeFile(path, `${JSON.stringify(document)}\n`, { encoding: "utf8", mode: 0o600 });
        return path;
      };
      const summary = await recoverUiVisualWalkthrough({
        journalStore: await openRunJournalStore(resolvedJournal),
        invoke: createInvoke(),
        materialize,
      });
      await writeFile(
        join(dirname(resolvedJournal), "report.json"),
        `${JSON.stringify({ schemaVersion: 1, recovery: summary }, null, 2)}\n`
      );
      console.log(JSON.stringify(summary));
      return;
    } finally {
      await rm(privateDir, { recursive: true, force: true });
    }
  }
  if (!manifestPath || !outDir) throw new Error("Both --manifest and --out-dir are required.");
  const resolvedOut = resolve(repositoryRoot, outDir);
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, manifestPath), "utf8"));
  if (plan) {
    const issues = validateWalkthroughManifest(manifest);
    if (issues.length > 0) throw new Error(`Invalid walkthrough manifest:\n${issues.join("\n")}`);
    const invoke = createInvoke();
    const instanceId = manifest.workbench.instanceId;
    const run = (commandArgs) => invoke(withInstance(commandArgs, instanceId));
    const capabilities = await run(["capabilities", "--json"]);
    const app = await run(["inspect", "--json"]);
    const ui = await run(["ui", "inspect", "--json"]);
    assertWalkthroughStart(manifest, capabilities, ui);
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        mode: "plan",
        workbench: { instanceId },
        initial: { revision: app.revision, uiGeneration: ui.uiGeneration },
        requiredMethods: requiredWalkthroughMethods(manifest),
        scenarios: manifest.scenarios.map(({ id, touches, ui: target, screenshot }) => ({
          id,
          touches,
          target,
          screenshot,
        })),
      })
    );
    return;
  }
  await mkdir(resolvedOut, { recursive: true });
  const privateDir = await mkdtemp(join(tmpdir(), "plvs-ui-walkthrough-"));
  try {
    for (const scenario of manifest.scenarios ?? []) {
      if (typeof scenario.screenshot?.output === "string") {
        await mkdir(dirname(join(resolvedOut, scenario.screenshot.output)), { recursive: true });
      }
    }
    const invoke = createInvoke();
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
        journalFactory: ({ manifest: runManifest, initial }) =>
          createRunJournalStore(join(resolvedOut, "run.json"), {
            manifest: runManifest,
            manifestPath: resolve(repositoryRoot, manifestPath),
            initial,
          }),
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
