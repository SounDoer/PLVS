import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { acceptanceNames } from "./update-acceptance-lib.mjs";
import {
  artifactEvidence,
  UPDATE_MANUAL_SCENARIOS,
  UPDATE_REQUIRED_SCENARIOS,
  validateUpdateResult,
} from "./update-acceptance-evidence.mjs";

const sha = "a".repeat(40);

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "plvs-update-result-"));
  const runDir = path.join(root, "runs", "run-1");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "after.json"), "{}\n");
  const receipt = { sourceSha: sha, platform: { os: "macos", arch: "aarch64" } };
  const result = {
    schemaVersion: 1,
    domain: "update",
    runId: "run-1",
    sourceSha: sha,
    identity: acceptanceNames(sha).identity,
    platform: receipt.platform,
    summary: "complete",
    scenarios: [
      ...UPDATE_REQUIRED_SCENARIOS.map((id) => ({ id, status: "passed" })),
      ...UPDATE_MANUAL_SCENARIOS.map((id) => ({ id, status: "notRun", reason: "release-only" })),
    ],
    artifacts: [artifactEvidence(runDir, "after.json", "application/json")],
    cleanup: { status: "passed", observations: [] },
  };
  return { root, runDir, receipt, result };
}

describe("update acceptance evidence", () => {
  it("accepts complete automated evidence while retaining explicit manual gaps", () => {
    const value = fixture();
    expect(validateUpdateResult(value.result, value).automatedFailures).toEqual([]);
  });

  it("rejects a missing required scenario", () => {
    const value = fixture();
    value.result.scenarios.shift();
    expect(() => validateUpdateResult(value.result, value)).toThrow(/missing required scenario/);
  });

  it("rejects modified artifacts", () => {
    const value = fixture();
    writeFileSync(path.join(value.runDir, "after.json"), "changed\n");
    expect(() => validateUpdateResult(value.result, value)).toThrow(/artifact byte count changed/);
  });
});
