import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { synthesizeSignal, compareMetrics, SIGNAL } from "./capture-rig.mjs";

describe("synthesizeSignal", () => {
  it("writes a WAV whose header matches the declared format", async () => {
    const path = join(tmpdir(), `plvs-rig-test-${Date.now()}.wav`);
    try {
      await synthesizeSignal(path);
      const buf = readFileSync(path);
      expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
      expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
      expect(buf.readUInt16LE(22)).toBe(2); // channels
      expect(buf.readUInt32LE(24)).toBe(SIGNAL.sampleRateHz);
      expect(buf.readUInt16LE(34)).toBe(16); // bits per sample
      const frames = SIGNAL.sampleRateHz * SIGNAL.seconds;
      expect(buf.readUInt32LE(40)).toBe(frames * 4); // data chunk size
      expect(buf.length).toBe(44 + frames * 4);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("puts a higher peak in L than in R, which is what makes a channel swap visible", async () => {
    // Equal-weight channels integrate identically under BS.1770, so only an
    // asymmetric signal can expose an L/R swap.
    const path = join(tmpdir(), `plvs-rig-asym-${Date.now()}.wav`);
    try {
      await synthesizeSignal(path);
      const buf = readFileSync(path);
      let peakL = 0;
      let peakR = 0;
      const frames = SIGNAL.sampleRateHz * SIGNAL.seconds;
      for (let i = 0; i < frames; i++) {
        peakL = Math.max(peakL, Math.abs(buf.readInt16LE(44 + i * 4)));
        peakR = Math.max(peakR, Math.abs(buf.readInt16LE(44 + i * 4 + 2)));
      }
      const dbL = 20 * Math.log10(peakL / 32767);
      const dbR = 20 * Math.log10(peakR / 32767);
      expect(dbL).toBeCloseTo(SIGNAL.peakLDb, 1);
      expect(dbR).toBeCloseTo(SIGNAL.peakRDb, 1);
      expect(dbL).toBeGreaterThan(dbR + 3);
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("compareMetrics", () => {
  const truth = {
    integratedLufs: -22.03,
    samplePeakMaxLDb: -20.0,
    samplePeakMaxRDb: -26.0,
  };

  it("accepts values inside tolerance", () => {
    const result = compareMetrics(truth, {
      integratedLufs: -22.4,
      samplePeakMaxLDb: -20.1,
      samplePeakMaxRDb: -25.9,
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects a value outside tolerance and names the field", () => {
    const result = compareMetrics(truth, {
      integratedLufs: -22.03,
      samplePeakMaxLDb: -20.0,
      samplePeakMaxRDb: -20.0,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].field).toBe("samplePeakMaxRDb");
  });

  it("catches a swapped channel map", () => {
    // The exact defect this whole check exists for: integrated is unchanged,
    // only the per-channel peaks move.
    const result = compareMetrics(truth, {
      integratedLufs: -22.03,
      samplePeakMaxLDb: -26.0,
      samplePeakMaxRDb: -20.0,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.field).sort()).toEqual([
      "samplePeakMaxLDb",
      "samplePeakMaxRDb",
    ]);
  });

  it("fails when ground truth is missing a field instead of passing silently", () => {
    // `Math.abs(got - undefined)` is NaN and `NaN > tolerance` is false, so an
    // unguarded expected value would pass unconditionally and forever. If analyze
    // ever renames a field, this check must go red rather than green.
    const result = compareMetrics({}, {
      integratedLufs: -22.03,
      samplePeakMaxLDb: -20.0,
      samplePeakMaxRDb: -26.0,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(3);
    expect(result.failures[0].reason).toBe("no ground truth for this field");
  });

  it("treats a null metric as a failure rather than passing it", () => {
    // Silence reports null. A comparison that skipped nulls would call a dead
    // capture path green.
    const result = compareMetrics(truth, {
      integratedLufs: null,
      samplePeakMaxLDb: null,
      samplePeakMaxRDb: null,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(3);
  });
});
