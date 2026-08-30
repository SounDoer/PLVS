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

  it("does not allocate backing storage for raw width-one rows", () => {
    const capacity = 144_000;
    const index = new PowerOfTwoMinMaxIndex(capacity);

    // Levels are created on first use: their stride is the vector width, which only the first
    // append reveals.
    expect(index._levels[1]).toBeUndefined();
    index.append(0, [0], [0]);
    index.append(1, [0], [0]);

    expect(index._levels[0]).toBeUndefined();
    expect(index._levels[1].capacity).toBe(Math.ceil(capacity / 2) + 2);
    expect(index.freeze()._levels[0]).toBeUndefined();
  });

  it("stores level buckets as typed-array views", () => {
    const index = new PowerOfTwoMinMaxIndex(8);
    for (let sequence = 0; sequence < 8; sequence++) {
      index.append(sequence, [sequence, -sequence], [sequence + 0.5, sequence]);
    }

    const bucket = index._bucketAtStart(3, 0, 8);
    expect(bucket.mins).toBeInstanceOf(Float32Array);
    expect(bucket.maxes).toBeInstanceOf(Float32Array);
    expect(Array.from(bucket.mins)).toEqual([0, -7]);
    expect(Array.from(bucket.maxes)).toEqual([7.5, 7]);
    expect(index.freeze()._bucketAtStart(3, 0, 8).mins).toBeInstanceOf(Float32Array);
  });

  it("answers an aligned whole-range query from summary buckets alone", () => {
    const index = new PowerOfTwoMinMaxIndex(16);
    for (let sequence = 0; sequence < 16; sequence++) {
      index.append(sequence, [-sequence], [sequence]);
    }

    const forbidden = () => {
      throw new Error("rawRowAt must not be called for a fully covered range");
    };
    expect(index.queryRange(0, 15, forbidden)).toEqual({ mins: [-15], maxes: [15] });
    expect(index.lastQueryStats().rawRowsVisited).toBe(0);
  });

  it("falls back to raw rows for a range no bucket covers", () => {
    const index = new PowerOfTwoMinMaxIndex(16);
    const rows = [];
    for (let sequence = 0; sequence < 16; sequence++) {
      append(index, rows, sequence, [-sequence], [sequence]);
    }

    // 5..7 is three rows: no power-of-two bucket starts at 5 or 7, and the level-1 bucket at 6 is
    // the only summary that fits.
    expect(index.queryRange(5, 7, (sequence) => rawRowAt(rows, sequence))).toEqual(
      rawRange(rows, 5, 7, 1)
    );
    expect(index.lastQueryStats().rawRowsVisited).toBe(1);
    expect(index.queryRange(5, 5, () => rawRowAt(rows, 5))).toEqual(rawRange(rows, 5, 5, 1));
    expect(index.lastQueryStats()).toEqual({
      nodesVisited: 1,
      rawRowsVisited: 1,
      summaryBucketsVisited: 0,
    });
  });

  it("resolves buckets whose oldest chunk has expired", () => {
    // Large enough that a level slab fills and drops a whole chunk, which is where a bucket index
    // and the slab's own push-order sequence stop agreeing.
    const capacity = 2048;
    const index = new PowerOfTwoMinMaxIndex(capacity);
    for (let sequence = 0; sequence < 6000; sequence++) {
      index.append(sequence, [-sequence], [sequence]);
    }

    expect(index._levels[1].storageStats().chunkCount).toBeGreaterThan(1);
    expect(index.retainedStartSequence).toBe(3952);
    expect(index._bucketAtStart(1, 3000, 2)).toBeUndefined();
    expect(Array.from(index._bucketAtStart(1, 4000, 2).maxes)).toEqual([4001]);

    const forbidden = () => {
      throw new Error("rawRowAt must not be called for a fully covered range");
    };
    expect(index.queryRange(4096, 5119, forbidden)).toEqual({ mins: [-5119], maxes: [5119] });
  });

  it("widens existing levels when a later row carries more values", () => {
    const index = new PowerOfTwoMinMaxIndex(16);
    const rows = [];
    for (let sequence = 0; sequence < 4; sequence++) {
      append(index, rows, sequence, [-sequence], [sequence]);
    }
    expect(index._bucketAtStart(2, 0, 4).mins).toHaveLength(1);

    for (let sequence = 4; sequence < 16; sequence++) {
      append(index, rows, sequence, [-sequence, -sequence - 0.5], [sequence, sequence + 0.5]);
    }

    // The level-2 bucket at 0 predates the widening; it must now carry the wider stride, with the
    // dimension its rows never had reading as zero rather than as a neighbour's value.
    expect(index._bucketAtStart(2, 0, 4).mins).toHaveLength(2);
    expect(Array.from(index._bucketAtStart(2, 0, 4).mins)).toEqual([-3, 0]);
    expect(Array.from(index._bucketAtStart(2, 4, 4).mins)).toEqual([-7, -7.5]);
    expect(index.queryRange(0, 15, (sequence) => rawRowAt(rows, sequence))).toEqual(
      rawRange(rows, 0, 15, 2)
    );
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

  it("keeps a snapshot readable at its own stride after the live index widens", () => {
    // Large enough that a level chunk seals and is therefore *shared* with the snapshot rather
    // than copied. That sharing is the whole reason widening a level in place is unsafe, so the
    // widening below must rebuild the level rather than touch the arrays the snapshot reads.
    const index = new PowerOfTwoMinMaxIndex(8192);
    for (let sequence = 0; sequence < 2100; sequence++)
      index.append(sequence, [-sequence], [sequence]);
    const frozen = index.freeze();
    expect(frozen._levels[1].storageStats().sharedSealedChunks).toBeGreaterThan(0);

    const forbidden = () => {
      throw new Error("rawRowAt must not be called for a fully covered range");
    };
    // Read through a level-1 bucket that lives in the shared sealed chunk, at a row far enough in
    // that a stride change would resolve it to a different bucket entirely. Querying the aligned
    // whole range instead would be answered by a high level whose tail chunk was *copied* at
    // freeze time, and so would survive an in-place widening and prove nothing.
    const before = frozen.queryRange(1000, 1001, forbidden);
    expect(before).toEqual({ mins: [-1001], maxes: [1001] });

    for (let sequence = 2100; sequence < 2200; sequence++) {
      index.append(sequence, [-sequence, -1], [sequence, 1]);
    }

    expect(index.valueCount).toBe(2);
    expect(frozen.queryRange(1000, 1001, forbidden)).toEqual(before);
    expect(Array.from(frozen._bucketAtStart(1, 1000, 2).mins)).toEqual([-1001]);
    expect(frozen._bucketAtStart(1, 1000, 2).mins).toHaveLength(1);
  });

  it("freezes bucket storage and remains stable after live eviction", () => {
    const index = new PowerOfTwoMinMaxIndex(8);
    const rows = [];
    for (let sequence = 0; sequence < 8; sequence++) {
      append(index, rows, sequence, [sequence], [sequence + 1]);
    }
    const frozen = index.freeze();
    const frozenRows = rows.map((row) => ({ ...row }));

    expect(Array.from(frozen._bucketAtStart(3, 0, 8).mins)).toEqual([0]);
    expect(Array.from(frozen._bucketAtStart(3, 0, 8).maxes)).toEqual([8]);

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

  it("bounds frozen index copying to active chunk tails", () => {
    const capacity = 8192;
    const index = new PowerOfTwoMinMaxIndex(capacity);
    for (let sequence = 0; sequence < capacity; sequence += 1) {
      index.append(sequence, [sequence], [sequence]);
    }

    const stats = index.freeze().storageStats();

    expect(stats.sharedSealedChunks).toBeGreaterThan(0);
    expect(stats.copiedReferences).toBeLessThan(capacity / 2);
    expect(stats.levels).toHaveLength(Math.floor(Math.log2(capacity)));
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

  it("answers every range exactly as a plain scan would, whatever level it starts at", () => {
    // The query picks its starting bucket level by arithmetic on the sequence's alignment rather
    // than by scanning down from the top. That is only ever a hint -- the loop still tests width
    // and alignment -- so the thing worth pinning is that the answer never moves: min and max are
    // associative, so any decomposition of the same range has to agree with a scan over it.
    const index = new PowerOfTwoMinMaxIndex(600);
    const rows = [];
    for (let i = 0; i < 600; i += 1) {
      // Float32 columns: a fixture written in plain decimals fails against a correct index.
      // See AGENTS.md.
      const value = Math.fround(Math.sin(i * 0.37) * 40 - 20);
      rows.push(value);
      index.append(i, [value], [value]);
    }
    const rawRowAt = (sequence) => ({ mins: [rows[sequence]], maxes: [rows[sequence]] });

    for (let start = 0; start < 600; start += 7) {
      for (const span of [1, 2, 3, 5, 8, 13, 64, 129, 256]) {
        const end = Math.min(599, start + span - 1);
        const result = index.queryRange(start, end, rawRowAt);
        let min = Infinity;
        let max = -Infinity;
        for (let i = start; i <= end; i += 1) {
          min = Math.min(min, rows[i]);
          max = Math.max(max, rows[i]);
        }
        expect(result.mins[0]).toBe(min);
        expect(result.maxes[0]).toBe(max);
      }
    }
  });

  it("hands the same wrapper back for each bucket without letting a caller keep one", () => {
    // The bucket wrapper is reused across hits rather than allocated per hit, which is safe only
    // because the caller merges it immediately. This states that contract where a future caller
    // that tries to hold one will read it.
    const index = new PowerOfTwoMinMaxIndex(64);
    for (let i = 0; i < 64; i += 1) index.append(i, [i], [i]);
    const seen = [];
    index.queryRange(0, 63, () => {
      throw new Error("this range is covered by buckets");
    });
    const first = index._bucketAtStart(1, 0, 2);
    seen.push(first);
    const second = index._bucketAtStart(1, 2, 2);
    expect(second).toBe(first);
    expect(second.startSequence).toBe(2);
  });
});
