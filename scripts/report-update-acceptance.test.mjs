import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  classifyUpdateAcceptance,
  formatUpdateAcceptanceAdvisory,
  formatRequiredUpdateAcceptance,
  incompleteUpdateAcceptancePlatforms,
  updateAcceptanceAdvisory,
} from "./report-update-acceptance.mjs";

describe("update acceptance release advisory", () => {
  const temporaryDirectories = [];

  function temporaryRepository() {
    const repository = mkdtempSync(path.join(tmpdir(), "plvs-update-acceptance-advisory-"));
    temporaryDirectories.push(repository);
    return repository;
  }

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports both platforms prominently without treating missing evidence as success", () => {
    const repository = temporaryRepository();
    const report = updateAcceptanceAdvisory({
      repository,
      sourceSha: "a".repeat(40),
      now: new Date("2026-10-17T00:00:00Z"),
    });
    expect(report.platforms).toEqual([
      { platform: "windows", status: "missing", reason: "no exact-SHA evidence" },
      { platform: "macos", status: "missing", reason: "no exact-SHA evidence" },
    ]);
    expect(formatUpdateAcceptanceAdvisory(report)).toContain(
      "Release is proceeding without complete cross-platform update acceptance evidence."
    );
  });

  it("ignores a receipt for another source SHA", () => {
    const repository = temporaryRepository();
    const root = path.join(repository, "artifacts", "update-acceptance", "bbbbbbbb");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, "acceptance.json"),
      JSON.stringify({ sourceSha: "b".repeat(40), platform: { os: "macos" } })
    );
    const report = updateAcceptanceAdvisory({ repository, sourceSha: "a".repeat(40) });
    expect(report.platforms.every((platform) => platform.status === "missing")).toBe(true);
  });

  it("classifies incomplete and stale evidence before accepting fresh evidence", () => {
    expect(
      classifyUpdateAcceptance({
        summary: "complete",
        automatedFailures: ["cached-offline-update"],
        ageDays: 1,
        maxAgeDays: 14,
      })
    ).toBe("incomplete");
    expect(
      classifyUpdateAcceptance({
        summary: "complete",
        automatedFailures: [],
        ageDays: 14.1,
        maxAgeDays: 14,
      })
    ).toBe("stale");
    expect(
      classifyUpdateAcceptance({
        summary: "complete",
        automatedFailures: [],
        ageDays: 14,
        maxAgeDays: 14,
      })
    ).toBe("complete");
  });

  it("is wired into release preflight as an explicit advisory", () => {
    const releaseGate = readFileSync(new URL("./run-release-gate.mjs", import.meta.url), "utf8");
    expect(releaseGate).toContain("updateAcceptanceChangesSinceLastTag");
    expect(releaseGate).toContain("will run automatically on the self-hosted runners");
    expect(releaseGate).not.toContain('"--require-complete"');
    expect(releaseGate).toContain('run("Update acceptance evidence (advisory)", "node", [');
    expect(releaseGate).toContain('"scripts/report-update-acceptance.mjs"');
  });

  it("blocks a guarded release until every platform has complete exact-SHA evidence", () => {
    const report = {
      sourceSha: "a".repeat(40),
      platforms: [
        { platform: "windows", status: "complete", reason: "complete" },
        { platform: "macos", status: "missing", reason: "no exact-SHA evidence" },
      ],
    };
    expect(incompleteUpdateAcceptancePlatforms(report)).toEqual([report.platforms[1]]);
    expect(formatRequiredUpdateAcceptance(report)).toContain(
      "Release blocked: complete exact-SHA evidence is required for macos."
    );
  });
});
