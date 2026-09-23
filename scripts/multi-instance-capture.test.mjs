import { describe, expect, it } from "vitest";
import { judgeConcurrentCaptures, judgeSoakSamples } from "./multi-instance-capture.mjs";

const truth = {
  integratedLufs: -22.03,
  samplePeakMaxLDb: -20,
  samplePeakMaxRDb: -26,
};

function report(overrides = {}) {
  return {
    status: "ok",
    summary: { ...truth },
    health: { droppedChunks: 0 },
    ...overrides,
  };
}

describe("judgeConcurrentCaptures", () => {
  it("accepts two independent reports that match the same ground truth", () => {
    expect(judgeConcurrentCaptures(truth, [report(), report()])).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("identifies the instance that dropped audio", () => {
    const result = judgeConcurrentCaptures(truth, [
      report(),
      report({ health: { droppedChunks: 3 } }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("instance 2 dropped 3 chunks");
  });

  it("rejects a missing final report instead of treating it as silence", () => {
    const result = judgeConcurrentCaptures(truth, [report(), null]);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("instance 2 did not produce a final report");
  });

  it("reports metric disagreement for the affected instance", () => {
    const broken = report({
      summary: { ...truth, samplePeakMaxRDb: -20 },
    });
    const result = judgeConcurrentCaptures(truth, [report(), broken]);

    expect(result.ok).toBe(false);
    expect(result.failures.some((message) => /instance 2 samplePeakMaxRDb/.test(message))).toBe(
      true
    );
  });
});

describe("judgeSoakSamples", () => {
  it("accepts stable independent series after warmup", () => {
    const result = judgeSoakSamples([
      [
        { t: 60, integratedLufs: -22.03, droppedChunks: 0 },
        { t: 70, integratedLufs: -22.031, droppedChunks: 0 },
      ],
      [
        { t: 60, integratedLufs: -22.03, droppedChunks: 0 },
        { t: 70, integratedLufs: -22.032, droppedChunks: 0 },
      ],
    ]);

    expect(result.ok).toBe(true);
  });

  it("rejects drift and dropped chunks per instance", () => {
    const result = judgeSoakSamples([
      [
        { t: 60, integratedLufs: -22.03, droppedChunks: 0 },
        { t: 70, integratedLufs: -22.06, droppedChunks: 2 },
      ],
      [
        { t: 60, integratedLufs: -22.03, droppedChunks: 0 },
        { t: 70, integratedLufs: -22.03, droppedChunks: 0 },
      ],
    ]);

    expect(result.ok).toBe(false);
    expect(result.failures.some((message) => /instance 1 drifted/.test(message))).toBe(true);
    expect(result.failures).toContain("instance 1 ended with 2 dropped chunks");
  });

  it("refuses a run too short to evaluate after warmup", () => {
    const result = judgeSoakSamples([[{ t: 10, integratedLufs: -22.03, droppedChunks: 0 }]]);

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatch(/too few settled samples/);
  });
});
