import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateDialogueBenchmark,
  parseDialogueBenchmarkArgs,
  renderDialogueBenchmarkSummary,
} from "./dialogue-benchmark.mjs";

const report = {
  corpusId: "fixture",
  corpusManifestSha256: "abc",
  blockDurationMs: 100,
  runs: [
    {
      engine: "engine-a",
      fusion: "fusion-a",
      confusion: {
        truePositiveBlocks: 8,
        falsePositiveBlocks: 2,
        falseNegativeBlocks: 2,
        trueNegativeBlocks: 8,
      },
      metrics: {
        dialogueLoudnessErrorLu: -1,
        loudnessToDialogueRatioErrorLu: 1,
        dialogueCoverageErrorPercentagePoints: 5,
        dialogueRangeErrorLu: -2,
      },
      readinessExcludedMs: 100,
      meanBoundaryErrorMs: 50,
      realtimeFactor: 0.25,
    },
  ],
};

describe("dialogue benchmark report", () => {
  it("aggregates block confusion and downstream error", () => {
    expect(aggregateDialogueBenchmark(report)).toEqual([
      expect.objectContaining({
        engine: "engine-a",
        fusion: "fusion-a",
        precision: 0.8,
        recall: 0.8,
        f1: 0.8000000000000002,
        falsePositiveDurationMs: 200,
        falseNegativeDurationMs: 200,
        meanBoundaryErrorMs: 50,
        meanAbsoluteDialogueLoudnessErrorLu: 1,
        meanAbsoluteLoudnessToDialogueRatioErrorLu: 1,
        meanAbsoluteCoverageErrorPercentagePoints: 5,
        meanAbsoluteDialogueRangeErrorLu: 2,
        meanReadinessExcludedMs: 100,
      }),
    ]);
  });

  it("accepts an explicit local manifest path", () => {
    expect(parseDialogueBenchmarkArgs(["--manifest", "D:/private/manifest.json"])).toEqual({
      manifestPath: resolve("D:/private/manifest.json"),
    });
  });

  it("renders the reproducibility identity and compact comparison table", () => {
    const summary = renderDialogueBenchmarkSummary(report);
    expect(summary).toContain("Corpus: `fixture`");
    expect(summary).toContain("| engine-a | fusion-a | 0.800 | 0.800 | 0.800 |");
  });
});
