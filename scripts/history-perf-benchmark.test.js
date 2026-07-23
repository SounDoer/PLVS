import { describe, expect, it } from "vitest";
import { parseBenchmarkArgs, projectedVisualBytes } from "./history-perf-benchmark.mjs";

describe("history performance benchmark options", () => {
  it("keeps full visual allocation opt-in", () => {
    expect(parseBenchmarkArgs([])).toEqual({ fullVisual: false });
    expect(parseBenchmarkArgs(["--full-visual"])).toEqual({ fullVisual: true });
  });

  it("projects production-width payload without allocating it", () => {
    expect(projectedVisualBytes()).toEqual({
      spectrumPrimary: 360_000 * 958 * 4,
      vectorscopePairs: 360_000 * 200 * 4,
      total: 360_000 * (958 + 200) * 4,
    });
  });
});
