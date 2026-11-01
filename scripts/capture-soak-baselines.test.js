import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  BASELINES,
  analyzeSeries,
  captureContract,
  compareRun,
  loadBaselines,
  renderReport,
} from "./capture-soak-baselines.mjs";

const baseline = loadBaselines().find((run) => run.platform === "windows");
function series(spread = 0) {
  const metric = {
    integratedLufs: -22,
    lra: 0,
    mMaxLufs: -22,
    stMaxLufs: -22,
    truePeakMaxDbtp: -20,
  };
  const rows = Array.from({ length: 1440 }, (_, index) => ({
    t: (index + 1) * 10,
    ...metric,
    integratedLufs: -22 + (index === 1439 ? spread : 0),
    droppedChunks: 0,
  }));
  rows.push({
    command: "capture",
    status: "ok",
    source: { capturedMs: 14400000, sampleRateHz: 48000, channelCount: 2 },
    summary: metric,
    health: { droppedChunks: 0 },
  });
  return rows;
}
const encode = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const identity = () => ({
  ...baseline,
  runId: "999999",
  runAttempt: "1",
  contract: captureContract(),
});

describe("archived capture soak baselines", () => {
  it("verifies all three checksum-pinned full-duration recordings", () => {
    const runs = loadBaselines();
    expect([...new Set(runs.map((run) => run.platform))].sort()).toEqual([
      "linux",
      "macos",
      "windows",
    ]);
    expect(runs.every((run) => run.analysis.samples === 1440)).toBe(true);
    expect(runs.every((run) => run.rssMb.seriesAvailable === false)).toBe(true);
  });

  it("rejects tampered compressed data", () => {
    const root = mkdtempSync(join(tmpdir(), "plvs-soak-baseline-"));
    try {
      cpSync(BASELINES, root, { recursive: true });
      const file = join(root, baseline.file);
      const bytes = readFileSync(file);
      bytes[bytes.length - 1] ^= 1;
      writeFileSync(file, bytes);
      expect(() => loadBaselines(root)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    "short",
    "duplicate-time",
    "missing-final",
    "null-metric",
    "drops",
    "wrong-duration",
    "failed",
    "drift",
  ])("rejects %s evidence", (kind) => {
    const rows = series();
    if (kind === "short") rows.splice(100, 1);
    if (kind === "duplicate-time") rows[100].t = rows[99].t;
    if (kind === "missing-final") rows.pop();
    if (kind === "null-metric") rows[100].integratedLufs = null;
    if (kind === "drops") rows[100].droppedChunks = 1;
    if (kind === "wrong-duration") rows.at(-1).source.capturedMs = 1000;
    if (kind === "failed") rows.at(-1).status = "error";
    if (kind === "drift") rows[100].integratedLufs += 0.02;
    expect(() => analyzeSeries(encode(rows))).toThrow();
  });

  it("treats a larger spread below the hard limit as an advisory single-reference comparison", () => {
    const report = compareRun(identity(), encode(series(0.001)), [baseline]);
    expect(report.status).toBe("single-reference");
    expect(report.baselineCount).toBe(1);
    expect(report.increasedMetrics).toContain("integratedLufs");
    expect(renderReport(report)).toContain("Insufficient reference runs");
  });

  it.each(["platform", "runnerName", "rigRevision", "contract"])(
    "does not mix a different %s",
    (field) => {
      const current = identity();
      current[field] =
        field === "contract" ? { ...current.contract, revision: "different" } : "different";
      expect(compareRun(current, encode(series()), [baseline]).status).toBe(
        "no-comparable-baseline"
      );
    }
  );

  it("does not compare a recording with itself", () => {
    expect(compareRun(baseline, encode(series()), [baseline]).baselineCount).toBe(0);
  });

  it("validates historical data under its recorded policy without changing today's gate", () => {
    const recording = encode(series(0.02));
    expect(() => analyzeSeries(recording)).toThrow();
    expect(
      analyzeSeries(recording, { ...captureContract(), driftLimitDb: 0.03 }).spreads.integratedLufs
    ).toBeCloseTo(0.02);
  });

  it("recomputes a range from multiple comparable complete runs", () => {
    const refs = [0, 0.001].map((spread, index) => ({
      ...baseline,
      runId: String(index),
      analysis: analyzeSeries(encode(series(spread))),
    }));
    const report = compareRun(identity(), encode(series(0.0005)), refs);
    expect(report.status).toBe("historical-range");
    expect(report.ranges.integratedLufs.minimum).toBe(0);
    expect(report.ranges.integratedLufs.maximum).toBeCloseTo(0.001);
    expect(report.increasedMetrics).toEqual([]);
  });
});
