import { describe, expect, it } from "vitest";
import { StereoMapModeHistorySlab } from "./StereoMapModeHistorySlab.js";

const centers = new Float32Array([100, 1000]);

function append(slab, timestampMs, { pl = [1, 1], pr = [0.25, 1], c = [0.25, 0] } = {}) {
  slab.append({
    timestampMs,
    sampleRateHz: 48_000,
    bandCentersHz: centers,
    pl: new Float32Array(pl),
    pr: new Float32Array(pr),
    c: new Float32Array(c),
  });
}

describe("StereoMapModeHistorySlab", () => {
  it("stores selected modes in 12-bit planes and shared visibility in 4-bit", () => {
    const slab = new StereoMapModeHistorySlab(10, ["position"]);
    append(slab, 1);

    const row = slab.rowAt(0);
    expect(row.derivedForMode("position", { lowerBound: -1, upperBound: 1 }).values[0]).toBeCloseTo(
      0.6,
      3
    );
    expect(row.derivedForMode("correlation", { lowerBound: -1, upperBound: 1 })).toBeNull();
    expect(slab.storageStats()).toMatchObject({
      retainedModes: ["position"],
      arrayTypes: { values: "Uint8Array (12-bit)", opacity: "Uint8Array (4-bit)" },
    });
  });

  it("resolves a scrubbed row's visibility from the stored plane", () => {
    // Band 1 sits about 60 dB under band 0, which puts it below the gate. A gated band carries no
    // value at all -- that is how the live path marks it too -- so it comes back invalid rather
    // than as a fully transparent point.
    const slab = new StereoMapModeHistorySlab(10, ["position"]);
    append(slab, 1, { pl: [1, 1e-9], pr: [1, 1e-9], c: [0, 0] });

    const derived = slab.rowAt(0).derivedForMode("position", { lowerBound: -1, upperBound: 1 });

    expect(derived.points[0].opacity).toBe(1);
    expect(derived.points[1].state).toBe("invalid");
  });

  it("round-trips a band sitting inside the fade as a partial opacity", () => {
    // The ramp is the only place the 4-bit plane quantizes, so it is the only place worth pinning.
    // Band 1 is placed about 6 dB above the gate, half way up the 12 dB fade.
    const slab = new StereoMapModeHistorySlab(10, ["position"]);
    append(slab, 1, { pl: [1, 4e-6], pr: [1, 4e-6], c: [0, 0] });

    const derived = slab.rowAt(0).derivedForMode("position", { lowerBound: -1, upperBound: 1 });

    expect(derived.points[0].opacity).toBe(1);
    expect(derived.points[1].opacity).toBeGreaterThan(0.4);
    expect(derived.points[1].opacity).toBeLessThan(0.6);
  });

  it("does not report a band as hidden before its row has been written", () => {
    // Hidden is a real state, so an unwritten band has to be distinguishable from a gated one.
    const slab = new StereoMapModeHistorySlab(10, ["position"]);
    append(slab, 1);

    const derived = slab.rowAt(0).derivedForMode("position", { lowerBound: -1, upperBound: 1 });
    expect(derived.points[0].opacity).not.toBeUndefined();
    expect(slab.rowAt(1)).toBeUndefined();
  });

  it("no longer reports an energy figure with a scrubbed row", () => {
    // The plane stores how visible a band is, not how much energy it carries; there is no dB value
    // left to hand back, and a caller must not silently read `undefined` as a level.
    const slab = new StereoMapModeHistorySlab(10, ["position"]);
    append(slab, 1);

    const derived = slab.rowAt(0).derivedForMode("position", { lowerBound: -1, upperBound: 1 });
    expect(derived).not.toHaveProperty("energyDb");
    expect(derived).not.toHaveProperty("fullGridPeakDb");
  });

  it("drops a deselected mode immediately and does not backfill a newly selected mode", () => {
    const slab = new StereoMapModeHistorySlab(10, ["position"]);
    append(slab, 1);
    slab.setRetainedModes(["correlation"]);
    append(slab, 2);

    expect(slab.rowAt(0).derivedForMode("position", { lowerBound: -1, upperBound: 1 })).toBeNull();
    expect(
      slab.rowAt(0).derivedForMode("correlation", { lowerBound: -1, upperBound: 1 })
    ).toBeNull();
    expect(
      slab.rowAt(1).derivedForMode("correlation", { lowerBound: -1, upperBound: 1 }).values[0]
    ).toBeCloseTo(0.5, 3);
  });

  it("freezes packed rows and answers Hold from incremental chunk summaries", () => {
    const slab = new StereoMapModeHistorySlab(10, ["position", "correlation"]);
    append(slab, 1);
    append(slab, 2, { pl: [0.25, 1], pr: [1, 1], c: [-0.25, 0] });
    const frozen = slab.freeze();
    const held = frozen.holdAt(1);

    expect(held.values.position.minimum[0]).toBeCloseTo(-0.6, 3);
    expect(held.values.position.maximum[0]).toBeCloseTo(0.6, 3);
    expect(held.values.correlation[0]).toBeCloseTo(-0.5, 3);
    expect(frozen.storageStats()).toMatchObject({ retainedRows: 2, copiedTailRows: 2 });
  });
});
