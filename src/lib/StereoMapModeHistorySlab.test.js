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
  it("stores selected modes in 12-bit planes and shared relative energy in Uint8", () => {
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
      arrayTypes: { values: "Uint8Array (12-bit)", energy: "Uint8Array" },
    });
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
