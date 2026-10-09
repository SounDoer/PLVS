import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const RUN_TRANSITIONS = Object.freeze({
  planned: new Set(["preparing", "needsRecovery", "preserved"]),
  preparing: new Set(["running", "cleaning", "needsRecovery", "preserved"]),
  running: new Set(["cleaning", "needsRecovery", "preserved"]),
  cleaning: new Set(["verifying", "needsRecovery", "preserved", "recoveryFailed"]),
  verifying: new Set(["complete", "needsRecovery", "preserved", "recoveryFailed"]),
  needsRecovery: new Set(["cleaning", "preserved", "recoveryFailed"]),
  recoveryFailed: new Set(["cleaning", "preserved"]),
  preserved: new Set(),
  complete: new Set(),
});

const SCENARIO_TRANSITIONS = Object.freeze({
  planned: new Set(["preparing"]),
  preparing: new Set(["running", "cleaning"]),
  running: new Set(["cleaning"]),
  cleaning: new Set(["verifying"]),
  verifying: new Set(["complete"]),
  complete: new Set(),
});
const RESOURCE_TYPES = new Set(["field", "surface", "eventFixture", "draft", "transportFile"]);
const RESOURCE_STATUSES = new Set(["intent", "owned", "restored", "alreadyRestored", "diverged"]);

function clone(value) {
  return structuredClone(value);
}

function transition(document, transitions, nextPhase, label) {
  const allowed = transitions[document.phase];
  if (!allowed?.has(nextPhase)) {
    throw new Error(`Invalid ${label} phase transition: ${document.phase} -> ${nextPhase}.`);
  }
  document.phase = nextPhase;
}

export function manifestSha256(manifest) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export function createRunJournal({ manifest, manifestPath, initial }) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId: randomUUID(),
    phase: "planned",
    createdAt: now,
    updatedAt: now,
    manifest: { path: manifestPath, sha256: manifestSha256(manifest) },
    workbench: {
      instanceId: manifest.workbench.instanceId,
      applicationIdentity: initial.applicationIdentity ?? null,
      protocolVersion: initial.protocolVersion ?? null,
    },
    initial: {
      revision: initial.revision,
      uiGeneration: initial.uiGeneration,
    },
    suite: { resources: [] },
    scenarios: manifest.scenarios.map((scenario) => ({
      id: scenario.id,
      phase: "planned",
      resources: [],
      artifact: null,
    })),
    failure: null,
  };
}

export function validateRunJournal(journal) {
  const issues = [];
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) {
    return ["Journal must be an object."];
  }
  if (journal.schemaVersion !== 1) issues.push("schemaVersion must be 1.");
  if (typeof journal.runId !== "string" || journal.runId.length === 0)
    issues.push("runId is required.");
  if (!RUN_TRANSITIONS[journal.phase]) issues.push("phase is invalid.");
  if (typeof journal.manifest?.sha256 !== "string") issues.push("manifest.sha256 is required.");
  if (typeof journal.workbench?.instanceId !== "string")
    issues.push("workbench.instanceId is required.");
  if (!Number.isInteger(journal.initial?.revision)) issues.push("initial.revision is required.");
  if (!Number.isInteger(journal.initial?.uiGeneration))
    issues.push("initial.uiGeneration is required.");
  if (!Array.isArray(journal.scenarios)) issues.push("scenarios must be an array.");
  for (const scenario of journal.scenarios ?? []) {
    if (typeof scenario.id !== "string" || !SCENARIO_TRANSITIONS[scenario.phase])
      issues.push("scenario identity or phase is invalid.");
    if (!Array.isArray(scenario.resources)) issues.push("scenario.resources must be an array.");
    for (const resource of scenario.resources ?? []) {
      if (!RESOURCE_TYPES.has(resource?.type)) issues.push("scenario resource type is invalid.");
      if (!RESOURCE_STATUSES.has(resource?.status))
        issues.push("scenario resource status is invalid.");
      if (
        resource?.type === "field" &&
        (typeof resource.family !== "string" ||
          typeof resource.key !== "string" ||
          !Object.hasOwn(resource, "before") ||
          !Object.hasOwn(resource, "applied"))
      ) {
        issues.push("field resource ownership evidence is incomplete.");
      }
    }
  }
  if (!Array.isArray(journal.suite?.resources)) issues.push("suite.resources must be an array.");
  for (const resource of journal.suite?.resources ?? []) {
    if (resource?.type !== "transportFile" || !RESOURCE_STATUSES.has(resource?.status)) {
      issues.push("suite resource is invalid.");
    }
  }
  return issues;
}

export function transitionRunJournal(journal, nextPhase) {
  const result = clone(journal);
  transition(result, RUN_TRANSITIONS, nextPhase, "run");
  result.updatedAt = new Date().toISOString();
  return result;
}

export function transitionScenarioJournal(journal, scenarioId, nextPhase) {
  const result = clone(journal);
  const scenario = result.scenarios.find(({ id }) => id === scenarioId);
  if (!scenario) throw new Error(`Unknown journal scenario: ${scenarioId}.`);
  transition(scenario, SCENARIO_TRANSITIONS, nextPhase, "scenario");
  result.updatedAt = new Date().toISOString();
  return result;
}

export function updateRunJournal(journal, update) {
  const result = clone(journal);
  update(result);
  result.updatedAt = new Date().toISOString();
  const issues = validateRunJournal(result);
  if (issues.length > 0) throw new Error(`Invalid run journal: ${issues.join(" ")}`);
  return result;
}

export async function writeRunJournal(path, journal) {
  const issues = validateRunJournal(journal);
  if (issues.length > 0) throw new Error(`Invalid run journal: ${issues.join(" ")}`);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600).catch(() => {});
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export async function readRunJournal(path) {
  const journal = JSON.parse(await readFile(path, "utf8"));
  const issues = validateRunJournal(journal);
  if (issues.length > 0) throw new Error(`Invalid run journal: ${issues.join(" ")}`);
  return journal;
}

export async function createRunJournalStore(path, options) {
  let current = createRunJournal(options);
  await writeRunJournal(path, current);
  return {
    get current() {
      return clone(current);
    },
    async update(update) {
      current = updateRunJournal(current, update);
      await writeRunJournal(path, current);
      return clone(current);
    },
    async transitionRun(nextPhase) {
      current = transitionRunJournal(current, nextPhase);
      await writeRunJournal(path, current);
      return clone(current);
    },
    async transitionScenario(scenarioId, nextPhase) {
      current = transitionScenarioJournal(current, scenarioId, nextPhase);
      await writeRunJournal(path, current);
      return clone(current);
    },
  };
}

export async function openRunJournalStore(path) {
  let current = await readRunJournal(path);
  return {
    get current() {
      return clone(current);
    },
    async update(update) {
      current = updateRunJournal(current, update);
      await writeRunJournal(path, current);
      return clone(current);
    },
    async transitionRun(nextPhase) {
      current = transitionRunJournal(current, nextPhase);
      await writeRunJournal(path, current);
      return clone(current);
    },
    async transitionScenario(scenarioId, nextPhase) {
      current = transitionScenarioJournal(current, scenarioId, nextPhase);
      await writeRunJournal(path, current);
      return clone(current);
    },
  };
}
