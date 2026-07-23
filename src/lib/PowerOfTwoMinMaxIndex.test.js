import { describe, expect, it, vi } from "vitest";
import { PowerOfTwoMinMaxIndex } from "./PowerOfTwoMinMaxIndex.js";

function rawRange(rows, start, end, valueCount) {
  const retainedStart = rows[0]?.sequence ?? 0;
  const retainedEnd = (rows.at(-1)?.sequence ?? -1) + 1;
  const clampedStart = Math.max(start, retainedStart);
  const clampedEnd = Math.min(end, retainedEnd - 1);
  if (clampedStart > clampedEnd) return null;

  const mins = new Array(valueCount).fill(Infinity);
  const maxes = new Array(valueCount).fill(-Infinity);
  for (let sequence = clampedStart; sequence <= clampedEnd; sequence++) {
    const row = rows[sequence - retainedStart];
    for (let value = 0; value < valueCount; value++) {
      mins[value] = Math.min(mins[value], row.mins[value] ?? 0);
      maxes[value] = Math.max(maxes[value], row.maxes[value] ?? 0);
    }
  }
  return { mins, maxes };
}

function rawRowAt(rows, sequence) {
  const row = rows[sequence - (rows[0]?.sequence ?? 0)];
  return row && { mins: row.mins, maxes: row.maxes };
}

function append(index, rows, sequence, mins, maxes) {
  index.append(sequence, mins, maxes);
  rows.push({ sequence, mins: [...mins], maxes: [...maxes] });
  while (rows.length > index.capacity) rows.splice(0, 1);
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("PowerOfTwoMinMaxIndex", () => {
  it("validates capacity and continuous sequence appends", () => {
    expect(() => new PowerOfTwoMinMaxIndex(0)).toThrow(RangeError);
    const index = new PowerOfTwoMinMaxIndex(4);
    expect(() => index.append(1, [0], [0])).toThrow(RangeError);
    index.append(0, [0], [0]);
    expect(() => index.append(2, [0], [0])).toThrow(RangeError);
    expect(() => index.append(0, [0], [0])).toThrow(RangeError);
  });

  it("queries one row and reports an exact raw visit", () => {
    const index = new PowerOfTwoMinMaxIndex(4);
    const rows = [];
    append(index, rows, 0, [-Infinity, 3], [7, Infinity]);

    expect(index.queryRange(0, 0, (sequence) => rawRowAt(rows, sequence))).toEqual({
      mins: [-Infinity, 3],
      maxes: [7, Infinity],
    });
    expect(index.lastQueryStats()).toEqual({
      nodesVisited: 1,
      rawRowsVisited: 1,
      summaryBucketsVisited: 0,
    });
  });

  it("uses canonical summaries for aligned and unaligned ranges", () => {
    const index = new PowerOfTwoMinMaxIndex(16);
    const rows = [];
    for (let sequence = 0; sequence < 16; sequence++) {
      append(index, rows, sequence, [sequence, -sequence], [sequence + 0.5, sequence]);
    }

    expect(index.queryRange(0, 15, (sequence) => rawRowAt(rows, sequence))).toEqual(
      rawRange(rows, 0, 15, 2)
    );
    expect(index.lastQueryStats()).toEqual({
      nodesVisited: 1,
      rawRowsVisited: 0,
      summaryBucketsVisited: 1,
    });

    expect(index.queryRange(3, 12, (sequence) => rawRowAt(rows, sequence))).toEqual(
      rawRange(rows, 3, 12, 2)
    );
    const stats = index.lastQueryStats();
    expect(stats.rawRowsVisited).toBe(2);
    expect(stats.summaryBucketsVisited).toBeGreaterThan(0);
    expect(stats.nodesVisited).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(16)) + 2);
  });

  it("clamps queries to retained rows after wrap and partial eviction", () => {
    const index = new PowerOfTwoMinMaxIndex(5);
    const rows = [];
    for (let sequence = 0; sequence < 13; sequence++) {
      append(index, rows, sequence, [-sequence], [sequence]);
    }

    expect(index.retainedStartSequence).toBe(8);
    expect(index.retainedEndSequence).toBe(13);
    expect(index.queryRange(-100, 10, (sequence) => rawRowAt(rows, sequence))).toEqual(
      rawRange(rows, -100, 10, 1)
    );
    expect(index.queryRange(10, 100, (sequence) => rawRowAt(rows, sequence))).toEqual(
      rawRange(rows, 10, 100, 1)
    );
    expect(index.queryRange(0, 7, (sequence) => rawRowAt(rows, sequence))).toBeNull();
    expect(index.queryRange(13, 20, (sequence) => rawRowAt(rows, sequence))).toBeNull();
  });

  it("widens vectors lazily and treats missing old dimensions as zero", () => {
    const index = new PowerOfTwoMinMaxIndex(8);
    const rows = [];
    append(index, rows, 0, [5], [6]);
    append(index, rows, 1, [2], [7]);
    append(index, rows, 2, [4, -9, 3], [8, -2, 11]);
    append(index, rows, 3, [1, -4], [9, -1]);

    expect(index.valueCount).toBe(3);
    expect(index.queryRange(0, 3, (sequence) => rawRowAt(rows, sequence))).toEqual({
      mins: [1, -9, 0],
      maxes: [9, 0, 11],
    });
    expect(rows[0].mins).toHaveLength(1);
  });

  it("freezes immutable bucket references and remains stable after live eviction", () => {
    const index = new PowerOfTwoMinMaxIndex(8);
    const rows = [];
    for (let sequence = 0; sequence < 8; sequence++) {
      append(index, rows, sequence, [sequence], [sequence + 1]);
    }
    const bucket = index._levels[3].at(0);
    const frozen = index.freeze();
    const frozenRows = rows.map((row) => ({ ...row }));

    expect(Object.isFrozen(bucket)).toBe(true);
    expect(Object.isFrozen(bucket.mins)).toBe(true);
    expect(frozen._levels[3][0]).toBe(bucket);

    for (let sequence = 8; sequence < 20; sequence++) {
      append(index, rows, sequence, [-sequence], [sequence]);
    }
    expect(frozen.queryRange(0, 7, (sequence) => rawRowAt(frozenRows, sequence))).toEqual({
      mins: [0],
      maxes: [8],
    });
    expect(frozen.retainedStartSequence).toBe(0);
    expect(frozen.retainedEndSequence).toBe(8);
    expect(frozen.version).toBe(8);
  });

  it("clear releases levels and pending carry state, then restarts at sequence zero", () => {
    const index = new PowerOfTwoMinMaxIndex(8);
    for (let sequence = 0; sequence < 6; sequence++) {
      index.append(sequence, [sequence], [sequence]);
    }
    const version = index.version;

    index.clear();

    expect(index.retainedStartSequence).toBe(0);
    expect(index.retainedEndSequence).toBe(0);
    expect(index.valueCount).toBe(0);
    expect(index.version).toBe(version + 1);
    expect(index._levels.every((level) => level.length === 0)).toBe(true);
    expect(index._pending.every((bucket) => bucket === undefined)).toBe(true);
    expect(() => index.append(1, [1], [1])).toThrow(RangeError);
    index.append(0, [1], [2]);
    expect(index.queryRange(0, 0, () => ({ mins: [1], maxes: [2] }))).toEqual({
      mins: [1],
      maxes: [2],
    });
  });

  it("never calls Array.shift while appending or wrapping", () => {
    const shift = vi.spyOn(Array.prototype, "shift");
    const index = new PowerOfTwoMinMaxIndex(17);
    for (let sequence = 0; sequence < 500; sequence++) {
      const width = (sequence % 8) + 1;
      index.append(
        sequence,
        Array.from({ length: width }, (_, value) => sequence - value),
        Array.from({ length: width }, (_, value) => sequence + value)
      );
    }
    expect(shift).not.toHaveBeenCalled();
    shift.mockRestore();
  });

  it("matches raw scans for live and frozen randomized wrapped histories", () => {
    const capacity = 37;
    const bound = 2 * Math.ceil(Math.log2(capacity)) + 2;
    let randomCases = 0;
    let maxNodes = 0;

    for (let seed = 1; seed <= 6; seed++) {
      const random = makeRandom(seed);
      const index = new PowerOfTwoMinMaxIndex(capacity);
      const rows = [];

      for (let sequence = 0; sequence < 320; sequence++) {
        const width = 1 + Math.floor(random() * 8);
        const mins = Array.from({ length: width }, () =>
          random() < 0.01 ? -Infinity : Math.floor(random() * 401) - 200
        );
        const maxes = mins.map((min) =>
          min === -Infinity ? Math.floor(random() * 201) : min + Math.floor(random() * 50)
        );
        append(index, rows, sequence, mins, maxes);

        for (let query = 0; query < 8; query++) {
          const start = Math.floor(random() * (capacity * 2)) + sequence - capacity * 1.5;
          const end = start + Math.floor(random() * (capacity * 1.5));
          const expected = rawRange(rows, Math.floor(start), Math.floor(end), index.valueCount);
          expect(
            index.queryRange(Math.floor(start), Math.floor(end), (candidate) =>
              rawRowAt(rows, candidate)
            )
          ).toEqual(expected);
          const nodes = index.lastQueryStats().nodesVisited;
          expect(nodes).toBeLessThanOrEqual(bound);
          maxNodes = Math.max(maxNodes, nodes);
          randomCases++;
        }

        if (sequence > 0 && sequence % 53 === 0) {
          const frozen = index.freeze();
          const frozenRows = rows.map((row) => ({
            sequence: row.sequence,
            mins: [...row.mins],
            maxes: [...row.maxes],
          }));
          const start = frozen.retainedStartSequence - 3;
          const end = frozen.retainedEndSequence + 3;
          expect(
            frozen.queryRange(start, end, (candidate) => rawRowAt(frozenRows, candidate))
          ).toEqual(rawRange(frozenRows, start, end, frozen.valueCount));
          expect(frozen.lastQueryStats().nodesVisited).toBeLessThanOrEqual(bound);
          randomCases++;
        }
      }
    }

    expect(randomCases).toBe(15_396);
    expect(maxNodes).toBeGreaterThan(1);
    expect(maxNodes).toBeLessThanOrEqual(bound);
  });
});
