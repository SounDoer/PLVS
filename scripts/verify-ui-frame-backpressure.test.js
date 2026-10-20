import { describe, expect, it } from "vitest";

import { validateAcceptanceEvidence } from "./acceptance-evidence.mjs";
import {
  buildPerformanceEvidence,
  deriveStallDurationMs,
  PERFORMANCE_PHASES,
  PERFORMANCE_SCENARIOS,
} from "./verify-ui-frame-backpressure.mjs";

const SHA = "a".repeat(40);

describe("adaptive backpressure stall", () => {
  const diagnostics = (sentFrames, overrides = {}) => ({
    sentFrames,
    currentInflightFrames: 0,
    inflightLimit: 120,
    ...overrides,
  });

  it("keeps the requested minimum when the observed cadence can fill the cap", () => {
    expect(
      deriveStallDurationMs({
        normalStart: diagnostics(10),
        normalEnd: diagnostics(70),
        minimumMs: 4_000,
      })
    ).toBe(4_000);
  });

  it("extends the stall for Linux's 100 ms meter batches", () => {
    expect(
      deriveStallDurationMs({
        normalStart: diagnostics(20),
        normalEnd: diagnostics(35),
        minimumMs: 4_000,
      })
    ).toBe(13_000);
  });

  it("keeps the requested duration when normal flow produced no measurable cadence", () => {
    expect(
      deriveStallDurationMs({
        normalStart: diagnostics(20),
        normalEnd: diagnostics(20),
        minimumMs: 4_000,
      })
    ).toBe(4_000);
  });

  it("bounds an unusually slow cadence", () => {
    expect(
      deriveStallDurationMs({
        normalStart: diagnostics(20),
        normalEnd: diagnostics(21),
        minimumMs: 4_000,
      })
    ).toBe(30_000);
  });
});

function phase(ok = true, failures = []) {
  return { ok, failures };
}

function run(overrides = {}) {
  return {
    report: {
      verdict: {
        phases: {
          normal: phase(),
          stalled: phase(),
          recovered: phase(),
        },
      },
    },
    ...overrides,
  };
}

function evidence(runs, overrides = {}) {
  return buildPerformanceEvidence({
    sourceSha: SHA,
    runId: "performance-run",
    startedAt: "2026-10-18T00:00:00.000Z",
    endedAt: "2026-10-18T00:01:00.000Z",
    runs,
    ...overrides,
  });
}

describe("desktop performance evidence", () => {
  it("requires all default and heavy phases for complete evidence", () => {
    const value = evidence({ default: run(), heavy: run() });

    expect(validateAcceptanceEvidence(value)).toBe(value);
    expect(value.summary).toBe("complete");
    expect(value.scenarios).toEqual(PERFORMANCE_SCENARIOS.map((id) => ({ id, status: "passed" })));
  });

  it("keeps an omitted scenario explicit instead of calling a partial run complete", () => {
    const value = evidence({ default: run() });

    expect(value.summary).toBe("incomplete");
    expect(value.scenarios.filter(({ status }) => status === "notRun")).toHaveLength(3);
  });

  it("marks every blocked phase when a scenario rig is unavailable", () => {
    const value = evidence({
      default: { rigUnavailable: true, error: "capture device missing", report: null },
    });

    expect(value.summary).toBe("incomplete");
    expect(value.scenarios.slice(0, 3)).toEqual(
      PERFORMANCE_PHASES.map((phase) => ({
        id: `performance.default.${phase}`,
        status: "rigUnavailable",
        observation: "capture device missing",
      }))
    );
  });

  it("preserves phase and cleanup failures in the shared verdict", () => {
    const heavy = run();
    heavy.report.verdict.phases.recovered = phase(false, ["renderer remained backlogged"]);
    const value = evidence(
      { default: run(), heavy },
      { cleanupStatus: "failed", warnings: ["cleanup failed"] }
    );

    expect(validateAcceptanceEvidence(value)).toBe(value);
    expect(value.summary).toBe("failed");
    expect(value.cleanup.status).toBe("failed");
    expect(value.scenarios).toContainEqual({
      id: "performance.heavy.recovered",
      status: "failed",
      observation: ["renderer remained backlogged"],
    });
  });
});
