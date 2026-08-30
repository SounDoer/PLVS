import { describe, expect, it } from "vitest";
import packageInfo from "../package.json";
import {
  parseBenchmarkArgs,
  projectedScalarSnapshotCopyBounds,
  projectedStereoMapBytes,
  projectedVisualBytes,
  scalarLiveHeapBudgetBytes,
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

describe("scalarLiveHeapBudgetBytes", () => {
  it("budgets 40 MiB at four-hour retention", () => {
    expect(scalarLiveHeapBudgetBytes(144_000)).toBe(40 * 1024 * 1024);
  });

  it("scales with retained rows", () => {
    expect(scalarLiveHeapBudgetBytes(72_000)).toBe(20 * 1024 * 1024);
  });

  it("leaves headroom over the measured cost of the packed layer", () => {
    // 13 MiB measured at 144,000 rows after packing; the budget must catch a regression toward
    // the 207.6 MiB the object-per-row storage cost, without tripping on ordinary variation.
    expect(scalarLiveHeapBudgetBytes(144_000)).toBeGreaterThan(13 * 1024 * 1024);
    expect(scalarLiveHeapBudgetBytes(144_000)).toBeLessThan(207 * 1024 * 1024);
  });
});

describe("projectedStereoMapBytes", () => {
  it("projects one byte of relative energy per retained band", () => {
    const rows = 360_000;
    const bands = 958;
    const projection = projectedStereoMapBytes(rows, { bands });
    expect(projection.energy).toBe(rows * bands * Uint8Array.BYTES_PER_ELEMENT);
    expect(projection.perKeyTotal).toBe(1_039_952_696);
  });
});
