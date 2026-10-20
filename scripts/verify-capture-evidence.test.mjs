import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCaptureEvidence } from "./verify-capture-evidence.mjs";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "plvs-capture-evidence-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function writeRun(runId, { sha = SHA, os = "linux", summary = "complete", endedAt } = {}) {
  const directory = join(root, "artifacts", "capture-smoke", sha.slice(0, 8), runId);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "result.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      domain: "capture",
      runId,
      sourceSha: sha,
      platform: { os, arch: "x86_64", version: "1" },
      summary,
      endedAt: endedAt ?? "2026-10-20T10:00:00.000Z",
    })
  );
  return path;
}

describe("findCaptureEvidence", () => {
  it("selects the exact SHA and platform among older runs", () => {
    writeRun("other-sha", { sha: OTHER });
    writeRun("other-platform", { os: "macos" });
    const expected = writeRun("match");
    expect(findCaptureEvidence({ root, sha: SHA, platform: "linux" }).path).toBe(expected);
  });

  it("fails when only another platform's evidence exists", () => {
    writeRun("mac", { os: "macos" });
    expect(() => findCaptureEvidence({ root, sha: SHA, platform: "linux" })).toThrow(
      `No capture evidence for linux at ${SHA}`
    );
  });

  it("fails when there is no evidence directory at all", () => {
    expect(() => findCaptureEvidence({ root, sha: SHA, platform: "windows" })).toThrow(
      `No capture evidence for windows at ${SHA}`
    );
  });

  it("fails when the newest exact run is incomplete", () => {
    writeRun("old", { endedAt: "2026-10-20T09:00:00.000Z" });
    writeRun("new", { summary: "incomplete", endedAt: "2026-10-20T11:00:00.000Z" });
    expect(() => findCaptureEvidence({ root, sha: SHA, platform: "linux" })).toThrow(
      `Capture evidence for linux at ${SHA} is incomplete`
    );
  });

  it("ignores evidence without a readable endedAt instead of letting it sort anywhere", () => {
    const dated = writeRun("b-dated", { endedAt: "2026-10-20T09:00:00.000Z" });
    writeRun("a-undated", { summary: "incomplete", endedAt: "not a date" });
    expect(findCaptureEvidence({ root, sha: SHA, platform: "linux" }).path).toBe(dated);
  });

  it("prefers the newest exact run by endedAt", () => {
    writeRun("old", { endedAt: "2026-10-20T09:00:00.000Z" });
    const newest = writeRun("new", { endedAt: "2026-10-20T11:00:00.000Z" });
    expect(findCaptureEvidence({ root, sha: SHA, platform: "linux" }).path).toBe(newest);
  });
});
