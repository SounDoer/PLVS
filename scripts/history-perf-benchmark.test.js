import { describe, expect, it } from "vitest";
import packageInfo from "../package.json";
import {
  parseBenchmarkArgs,
  projectedScalarSnapshotCopyBounds,
  projectedVisualBytes,
} from "./history-perf-benchmark.mjs";

describe("history performance benchmark options", () => {
  it("keeps full visual allocation opt-in", () => {
    expect(parseBenchmarkArgs([])).toEqual({ fullVisual: false });
    expect(parseBenchmarkArgs(["--full-visual"])).toEqual({ fullVisual: true });
  });

  it("provides a reliable dedicated full visual package command", () => {
    expect(packageInfo.scripts["benchmark:history"]).toBe(
      "node scripts/history-perf-benchmark.mjs"
    );
    expect(packageInfo.scripts["benchmark:history:full"]).toBe(
      "node scripts/history-perf-benchmark.mjs --full-visual"
    );
  });

  it("projects production-width payload without allocating it", () => {
    expect(projectedVisualBytes()).toEqual({
      spectrumPrimary: 360_000 * 958 * 2,
      vectorscopePairs: 360_000 * 200 * 2,
      total: 360_000 * (958 + 200) * 2,
    });
  });

  it("bounds scalar snapshot copying by chunk tails and index levels, not retained rows", () => {
    const short = projectedScalarSnapshotCopyBounds(14_400);
    const fourHours = projectedScalarSnapshotCopyBounds(144_000);

    expect(short.retainedRows).toBe(14_400);
    expect(fourHours.retainedRows).toBe(144_000);
    expect(fourHours.denseCopiedReferences).toBe(3 * 1024);
    expect(fourHours.indexLevels).toBe(Math.floor(Math.log2(144_000)));
    expect(fourHours.maxCopiedReferences).toBeLessThan(50_000);
    expect(fourHours.maxCopiedReferences / short.maxCopiedReferences).toBeLessThan(1.5);
  });
});
