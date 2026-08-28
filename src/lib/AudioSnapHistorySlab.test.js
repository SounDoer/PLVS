import { describe, expect, it } from "vitest";
import { AudioSnapHistorySlab } from "./AudioSnapHistorySlab.js";

function snap(overrides = {}) {
  return {
    momentary: -20,
    shortTerm: -22,
    mMax: -18,
    stMax: -20,
    integrated: -23,
    lra: 5,
    dialogueIntegrated: -24,
    dialogueLra: 3,
    dialoguePercent: 70,
    dialogueActiveNow: true,
    truePeakL: -1,
    truePeakR: -1.5,
    tpMax: -1,
    samplePeak: -1,
    tpL: -3,
    tpR: -3.5,
    sampleL: -3,
    sampleR: -3.5,
    samplePeakMaxL: -2.5,
    samplePeakMaxR: -3,
    peakDb: [-6, -7],
    rmsDb: [-24, -25],
    correlation: 0.75,
    sideToMidDb: -8,
    vectorscopePairX: 0,
    vectorscopePairY: 1,
    ...overrides,
  };
}

describe("AudioSnapHistorySlab", () => {
  it("reads back every field of an appended row", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap(), 1000);
    const row = slab.rowAt(0);
    expect(row.momentary).toBeCloseTo(-20, 4);
    expect(row.integrated).toBeCloseTo(-23, 4);
    expect(row.dialogueActiveNow).toBe(true);
    expect(row.dialoguePercent).toBeCloseTo(70, 4);
    expect(Array.from(row.peakDb)).toEqual([-6, -7]);
    expect(Array.from(row.rmsDb)).toEqual([-24, -25]);
    expect(row.correlation).toBeCloseTo(0.75, 4);
    expect(slab.timestampAt(0)).toBe(1000);
  });

  it("round-trips -Infinity, which the audio snap uses for 'no value'", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap({ momentary: -Infinity, tpMax: -Infinity }), 0);
    const row = slab.rowAt(0);
    expect(row.momentary).toBe(-Infinity);
    expect(row.tpMax).toBe(-Infinity);
  });

  it("keeps a silent channel at -Infinity rather than full scale", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap({ peakDb: [-Infinity, -Infinity], rmsDb: [-Infinity, -24] }), 0);
    const row = slab.rowAt(0);
    expect(Array.from(row.peakDb)).toEqual([-Infinity, -Infinity]);
    expect(Array.from(row.rmsDb)).toEqual([-Infinity, -24]);
  });

  it("round-trips a null dialoguePercent", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap({ dialoguePercent: null }), 0);
    expect(slab.rowAt(0).dialoguePercent).toBeNull();
  });

  it("expires the oldest rows at capacity and keeps index 0 on the window start", () => {
    const slab = new AudioSnapHistorySlab(4);
    for (let i = 0; i < 6; i += 1) slab.push(snap({ momentary: -i }), i);
    expect(slab.length).toBe(4);
    expect(slab.rowAt(0).momentary).toBeCloseTo(-2, 4);
    expect(slab.rowAt(3).momentary).toBeCloseTo(-5, 4);
  });

  it("keeps a frozen view stable while the live slab keeps growing", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap({ momentary: -10 }), 0);
    const frozen = slab.freeze();
    slab.push(snap({ momentary: -11 }), 100);
    expect(frozen.length).toBe(1);
    expect(frozen.rowAt(0).momentary).toBeCloseTo(-10, 4);
    expect(slab.length).toBe(2);
  });

  it("reports copiedReferences so ScalarHistoryStore stats stay numeric", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap(), 0);
    const stats = slab.freeze().storageStats();
    expect(stats.copiedReferences).toBe(0);
    expect(typeof stats.copiedTailBytes).toBe("number");
  });
});
