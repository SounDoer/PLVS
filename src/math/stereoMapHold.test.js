import { describe, expect, it } from "vitest";
import { STEREO_MAP_MODES } from "./stereoMapMath.js";
import { StereoMapHoldAccumulator } from "./stereoMapHold.js";

const centers = [100, 200];

function row(pl, pr, c) {
  return { bandCentersHz: centers.slice(0, pl.length), pl, pr, c };
}

describe("StereoMapHoldAccumulator", () => {
  it("derives one primitive row and updates exact extrema for every mode", () => {
    const hold = new StereoMapHoldAccumulator();

    hold.consumePrimitiveRow(row([9], [1], [0]));
    hold.consumePrimitiveRow(row([1], [9], [0]));
    hold.consumePrimitiveRow(row([1], [1], [-1]));

    const position = hold.valuesFor(STEREO_MAP_MODES.POSITION);
    expect(position.minimum[0]).toBeCloseTo(-0.8);
    expect(position.maximum[0]).toBeCloseTo(0.8);
    expect(hold.valuesFor(STEREO_MAP_MODES.CORRELATION)).toEqual([-1]);
    expect(hold.valuesFor(STEREO_MAP_MODES.MONO_LOSS_DB)).toEqual([-Infinity]);
    expect(hold.valuesFor(STEREO_MAP_MODES.MS_RATIO_DB)).toEqual([Infinity]);
  });

  it("does not update from gate-invalid or partially faded points", () => {
    const hold = new StereoMapHoldAccumulator();
    const quiet = 1e-6;

    hold.consumePrimitiveRow(row([1, quiet], [1, quiet], [0, quiet * 10 ** (6 / 10)]));

    expect(hold.valuesFor(STEREO_MAP_MODES.POSITION)).toEqual({
      minimum: [0, null],
      maximum: [0, null],
    });
    expect(hold.valuesFor(STEREO_MAP_MODES.CORRELATION)).toEqual([0, null]);
    expect(hold.valuesFor(STEREO_MAP_MODES.MONO_LOSS_DB)[0]).toBeCloseTo(10 * Math.log10(0.5));
    expect(hold.valuesFor(STEREO_MAP_MODES.MONO_LOSS_DB)[1]).toBeNull();
    expect(hold.valuesFor(STEREO_MAP_MODES.MS_RATIO_DB)).toEqual([0, null]);
  });

  it("accumulates all modes without selected-mode or visibility inputs", () => {
    const hold = new StereoMapHoldAccumulator();

    expect(hold.consumePrimitiveRow.length).toBeLessThanOrEqual(2);
    hold.consumePrimitiveRow(row([4], [1], [-2]));

    for (const mode of Object.values(STEREO_MAP_MODES)) {
      expect(hold.valuesFor(mode)[0] ?? hold.valuesFor(mode).minimum[0]).not.toBeNull();
    }
  });

  it("retains raw valid infinities and clips only when a renderer derives points", () => {
    const hold = new StereoMapHoldAccumulator();

    hold.consumePrimitiveRow(row([1], [1], [-1]));

    expect(hold.valuesFor(STEREO_MAP_MODES.MONO_LOSS_DB)).toEqual([-Infinity]);
    expect(hold.valuesFor(STEREO_MAP_MODES.MS_RATIO_DB)).toEqual([Infinity]);
  });

  it("starts a new epoch on clear and ignores rows tagged with an old epoch", () => {
    const hold = new StereoMapHoldAccumulator();
    const oldEpoch = hold.epoch;
    hold.consumePrimitiveRow(row([9], [1], [0]), oldEpoch);

    const newEpoch = hold.clear();
    hold.consumePrimitiveRow(row([1], [9], [0]), oldEpoch);

    expect(newEpoch).toBe(oldEpoch + 1);
    expect(hold.valuesFor(STEREO_MAP_MODES.POSITION)).toEqual({
      minimum: [],
      maximum: [],
    });

    hold.consumePrimitiveRow(row([1], [9], [0]), newEpoch);
    const position = hold.valuesFor(STEREO_MAP_MODES.POSITION);
    expect(position.minimum[0]).toBeCloseTo(-0.8);
    expect(position.maximum[0]).toBeCloseTo(-0.8);
  });

  it("does not initialize the current epoch shape from an old-epoch row", () => {
    const hold = new StereoMapHoldAccumulator(2);

    expect(hold.consumePrimitiveRow(row([1, 1], [1, 1], [0, 0]), 1)).toBe(false);
    expect(hold.valuesFor(STEREO_MAP_MODES.CORRELATION)).toEqual([]);

    expect(hold.consumePrimitiveRow(row([1], [1], [0]), 2)).toBe(true);
    expect(hold.valuesFor(STEREO_MAP_MODES.CORRELATION)).toEqual([0]);
  });

  it("ignores malformed old-epoch rows without validating them", () => {
    const hold = new StereoMapHoldAccumulator(2);

    expect(hold.consumePrimitiveRow(null, 1)).toBe(false);
    expect(hold.valuesFor(STEREO_MAP_MODES.CORRELATION)).toEqual([]);
  });

  it("validates a complete first row before installing its summary shape", () => {
    const hold = new StereoMapHoldAccumulator();

    expect(() =>
      hold.consumePrimitiveRow({
        bandCentersHz: [100, 200],
        pl: [1, 1],
        pr: [1],
        c: [0, 0],
      })
    ).toThrow(/equal lengths/);
    expect(hold.valuesFor(STEREO_MAP_MODES.CORRELATION)).toEqual([]);

    expect(hold.consumePrimitiveRow(row([1], [1], [0]))).toBe(true);
    expect(hold.valuesFor(STEREO_MAP_MODES.CORRELATION)).toEqual([0]);
  });

  it("drops the old band shape on clear so a new grid can initialize", () => {
    const hold = new StereoMapHoldAccumulator();
    hold.consumePrimitiveRow(row([1, 1], [1, 1], [0, 0]));

    hold.clear();

    expect(hold.consumePrimitiveRow(row([1], [1], [0]))).toBe(true);
    expect(hold.valuesFor(STEREO_MAP_MODES.CORRELATION)).toEqual([0]);
  });

  it("reads each primitive band once while accumulating all four modes", () => {
    const hold = new StereoMapHoldAccumulator();
    const source = row([1, 1], [1, 1], [0, -1]);
    const reads = { pl: 0, pr: 0, c: 0 };
    for (const field of Object.keys(reads)) {
      source[field] = new Proxy(source[field], {
        get(target, property, receiver) {
          if (/^\d+$/.test(String(property))) reads[field] += 1;
          return Reflect.get(target, property, receiver);
        },
      });
    }

    hold.consumePrimitiveRow(source);

    expect(reads).toEqual({ pl: 2, pr: 2, c: 2 });
    expect(hold.valuesFor(STEREO_MAP_MODES.CORRELATION)).toEqual([0, -1]);
  });
});
