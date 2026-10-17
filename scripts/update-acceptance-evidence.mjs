import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { acceptanceNames, resolveReceiptFile, sha256File } from "./update-acceptance-lib.mjs";

export const UPDATE_RESULT_SCHEMA_VERSION = 1;
export const UPDATE_REQUIRED_SCENARIOS = [
  "writable-path-offline-update",
  "cached-offer-survives-restart",
  "version-and-cli-advance",
  "persistence-restored",
  "dock-restored",
  "helper-finished",
  "cache-cleared",
];
export const UPDATE_MANUAL_SCENARIOS = [
  "privileged-applications-replacement",
  "authorization-cancellation",
  "gatekeeper-and-notarization",
];
const STATUSES = new Set(["passed", "failed", "rigUnavailable", "manual", "notRun", "unsupported"]);

function invalid(message) {
  throw new Error(`Invalid update acceptance result: ${message}`);
}

export function artifactEvidence(runDir, file, mediaType) {
  const resolved = resolveReceiptFile(runDir, file);
  const stat = statSync(resolved);
  return { file, mediaType, bytes: stat.size, sha256: sha256File(resolved) };
}

export function validateUpdateResult(result, { root, runDir, receipt }) {
  if (!result || typeof result !== "object") invalid("result must be an object");
  if (result.schemaVersion !== UPDATE_RESULT_SCHEMA_VERSION) invalid("unsupported schemaVersion");
  if (result.domain !== "update") invalid("domain must be update");
  if (result.sourceSha !== receipt.sourceSha) invalid("sourceSha does not match the receipt");
  if (
    result.platform?.os !== receipt.platform.os ||
    result.platform?.arch !== receipt.platform.arch
  ) {
    invalid("platform does not match the receipt");
  }
  if (!Array.isArray(result.scenarios)) invalid("scenarios must be an array");
  const scenarios = new Map();
  for (const scenario of result.scenarios) {
    if (!scenario?.id || scenarios.has(scenario.id))
      invalid("scenario IDs must be present and unique");
    if (!STATUSES.has(scenario.status)) invalid(`unknown status for ${scenario.id}`);
    scenarios.set(scenario.id, scenario);
  }
  for (const id of UPDATE_REQUIRED_SCENARIOS) {
    if (!scenarios.has(id)) invalid(`missing required scenario ${id}`);
  }
  if (!Array.isArray(result.artifacts)) invalid("artifacts must be an array");
  for (const artifact of result.artifacts) {
    const file = resolveReceiptFile(runDir, artifact?.file);
    if (statSync(file).size !== artifact.bytes)
      invalid(`artifact byte count changed: ${artifact.file}`);
    if (sha256File(file) !== artifact.sha256) invalid(`artifact hash changed: ${artifact.file}`);
  }
  const names = acceptanceNames(receipt.sourceSha);
  if (!path.resolve(runDir).startsWith(`${path.resolve(root, "runs")}${path.sep}`)) {
    invalid("run directory is outside the receipt's runs directory");
  }
  if (result.identity !== names.identity) invalid("identity does not match sourceSha");
  const automatedFailures = UPDATE_REQUIRED_SCENARIOS.filter(
    (id) => scenarios.get(id)?.status !== "passed"
  );
  const expectedSummary = automatedFailures.length ? "incomplete" : "complete";
  if (result.summary !== expectedSummary && result.summary !== "failed") {
    invalid(`summary must be ${expectedSummary} or failed`);
  }
  if (result.cleanup?.status !== "passed") invalid("cleanup must be passed");
  return { scenarios, automatedFailures };
}

export function loadUpdateResult(runDir) {
  return JSON.parse(readFileSync(path.join(runDir, "result.json"), "utf8"));
}
