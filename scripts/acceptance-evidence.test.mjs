import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  acceptanceReportMarkdown,
  buildAcceptanceReport,
  classifyEvidence,
  completeScenarioCoverage,
  resolveEvidenceSourceSha,
  validateAcceptanceEvidence,
} from "./acceptance-evidence.mjs";

const TARGET = "a".repeat(40);
const OTHER = "b".repeat(40);

function fixture(overrides = {}) {
  return {
    schemaVersion: 1,
    domain: "capture",
    runId: "run-1",
    sourceSha: TARGET,
    platform: { os: "macos", arch: "aarch64", version: "15.6.1" },
    tool: { name: "capture-smoke", version: 1 },
    startedAt: "2026-10-18T00:00:00.000Z",
    endedAt: "2026-10-18T00:01:00.000Z",
    summary: "complete",
    scenarios: [{ id: "live-file-agreement", status: "passed" }],
    artifacts: [],
    cleanup: { status: "passed", observations: [] },
    warnings: [],
    ...overrides,
  };
}

function item(value, file = "/repo/artifacts/evidence/result.json") {
  return { file, sha256: "c".repeat(64), value };
}

function report(evidence) {
  return buildAcceptanceReport({
    targetSha: TARGET,
    evidence,
    generatedAt: new Date("2026-10-18T01:00:00.000Z"),
    generatorSha: TARGET,
    generatorPlatform: { os: "macos", arch: "aarch64", version: "15.6.1" },
  });
}

describe("acceptance evidence", () => {
  it("marks omitted required scenarios notRun instead of calling the run complete", () => {
    expect(
      completeScenarioCoverage(
        ["top", "bottom", "display-ownership"],
        [
          { id: "top", status: "passed" },
          { id: "bottom", status: "passed" },
        ]
      )
    ).toEqual({
      summary: "incomplete",
      scenarios: [
        { id: "top", status: "passed" },
        { id: "bottom", status: "passed" },
        { id: "display-ownership", status: "notRun" },
      ],
    });
  });

  it("refuses to label dirty code with the clean HEAD SHA", () => {
    const clean = (command, args) => ({
      status: 0,
      stdout: args[0] === "rev-parse" ? `${TARGET}\n` : "",
    });
    const dirty = (command, args) => ({
      status: 0,
      stdout: args[0] === "rev-parse" ? `${TARGET}\n` : " M scripts/tool.mjs\n",
    });
    expect(resolveEvidenceSourceSha("/repo", clean)).toBe(TARGET);
    expect(() => resolveEvidenceSourceSha("/repo", dirty)).toThrow(/clean worktree/);
  });

  it("accepts the shared update/dock/capture envelope", () => {
    expect(validateAcceptanceEvidence(fixture())).toMatchObject({
      domain: "capture",
      summary: "complete",
    });
  });

  it("reports Linux as a base platform whose cells stay missing without evidence", () => {
    expect(
      validateAcceptanceEvidence(
        fixture({ platform: { os: "linux", arch: "x86_64", version: "6.12.0" } })
      )
    ).toMatchObject({ platform: { os: "linux" } });

    const value = report([]);
    expect(value.platforms).toEqual(["windows", "macos", "linux"]);
    expect(value.matrix).toHaveLength(15);
    const linux = value.matrix.filter((cell) => cell.platform === "linux");
    expect(linux).toHaveLength(5);
    expect(linux.every((cell) => cell.state === "missing")).toBe(true);
  });

  it("rejects duplicate scenarios and false complete evidence", () => {
    expect(() =>
      validateAcceptanceEvidence(
        fixture({
          scenarios: [
            { id: "same", status: "passed" },
            { id: "same", status: "passed" },
          ],
        })
      )
    ).toThrow(/unique/);
    expect(() =>
      validateAcceptanceEvidence(fixture({ scenarios: [{ id: "broken", status: "failed" }] }))
    ).toThrow(/complete evidence/);
  });

  it("classifies exact, stale, incomplete and failed evidence independently", () => {
    expect(classifyEvidence(fixture(), TARGET)).toBe("passed");
    expect(classifyEvidence(fixture(), OTHER)).toBe("stale");
    expect(classifyEvidence(fixture({ summary: "incomplete" }), TARGET)).toBe("incomplete");
    expect(
      classifyEvidence(
        fixture({
          summary: "failed",
          scenarios: [{ id: "broken", status: "failed" }],
        }),
        TARGET
      )
    ).toBe("failed");
  });

  it("keeps missing and stale platform coverage advisory and explicit", () => {
    const value = report([
      item(
        fixture({
          scenarios: [
            { id: "live-file-agreement", status: "passed" },
            { id: "operator-check", status: "notRun" },
          ],
        })
      ),
      item(fixture({ sourceSha: OTHER, domain: "update" })),
    ]);
    expect(value.ready).toBe(true);
    expect(value.verdict).toBe("incomplete");
    expect(value.matrix).toHaveLength(15);
    expect(
      value.matrix.find((cell) => cell.domain === "capture" && cell.platform === "macos")
    ).toMatchObject({ state: "passed" });
    expect(
      value.matrix.find((cell) => cell.domain === "update" && cell.platform === "macos")
    ).toMatchObject({ state: "stale", sourceSha: OTHER });
    expect(value.gaps.some((gap) => gap.platform === "windows")).toBe(true);
    expect(value.gaps.some((gap) => gap.platform === "linux")).toBe(true);
    expect(value.advisories).toContainEqual({
      domain: "capture",
      platform: "macos",
      scenario: "operator-check",
      status: "notRun",
    });
  });

  it("blocks readiness only for an actual target-SHA failure", () => {
    const value = report([
      item(
        fixture({
          domain: "dock",
          summary: "failed",
          scenarios: [{ id: "restore", status: "failed" }],
        })
      ),
    ]);
    expect(value.ready).toBe(false);
    expect(value.verdict).toBe("failed");
  });

  it("rejects ambiguous target-SHA evidence for one cell", () => {
    expect(() => report([item(fixture(), "/a.json"), item(fixture(), "/b.json")])).toThrow(
      /Ambiguous evidence/
    );
    expect(() =>
      report([
        item(fixture({ sourceSha: OTHER }), "/a.json"),
        item(fixture({ sourceSha: "c".repeat(40) }), "/b.json"),
      ])
    ).toThrow(/Ambiguous evidence/);
  });

  it("renders the same matrix and follow-up gaps in Markdown", () => {
    const value = report([item(fixture())]);
    const markdown = acceptanceReportMarkdown(
      value,
      join("/repo", "artifacts", "acceptance-report", "report.md")
    );
    expect(markdown).toContain("| capture | missing | [passed](../evidence/result.json) |");
    expect(markdown).toContain("update/windows: missing");
    expect(markdown).toContain("## Advisories");
    expect(markdown).toContain("not a stable-release approval");
  });

  it("adds a complete Linux column after the first Linux evidence is supplied", () => {
    const value = report([
      item(
        fixture({ platform: { os: "linux", arch: "x86_64", version: "6.12.0" } }),
        "/repo/artifacts/linux-capture/result.json"
      ),
    ]);
    expect(value.platforms).toEqual(["windows", "macos", "linux"]);
    expect(value.matrix).toHaveLength(15);
    expect(
      value.matrix.find((cell) => cell.domain === "capture" && cell.platform === "linux")
    ).toMatchObject({ state: "passed" });
    expect(
      value.matrix.find((cell) => cell.domain === "update" && cell.platform === "linux")
    ).toMatchObject({ state: "missing" });

    const markdown = acceptanceReportMarkdown(
      value,
      join("/repo", "artifacts", "acceptance-report", "report.md")
    );
    expect(markdown).toContain("| Domain | Windows | macOS | Linux |");
    expect(markdown).toContain(
      "| capture | missing | missing | [passed](../linux-capture/result.json) |"
    );
    expect(markdown).toContain("dock/linux: missing");
    expect(markdown).toContain("agent-control/linux: missing");
    expect(markdown).toContain("performance/linux: missing");
  });
});
