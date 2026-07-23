import { describe, expect, it } from "vitest";
import { LoudnessHistoryIndex } from "./loudnessHistoryIndex.js";

function rowAtSequence(rows, retainedStartSequence, sequence) {
  return rows[sequence - retainedStartSequence];
}

describe("LoudnessHistoryIndex", () => {
  it("indexes M and ST with an internal monotonic sequence", () => {
    const index = new LoudnessHistoryIndex(4);
    const rows = [
      { m: -24, st: -26 },
      { m: -18, st: -22 },
      { m: -30, st: -20 },
    ];
    rows.forEach((row) => index.append(row));

    expect(index.capacity).toBe(4);
    expect(index.retainedStartSequence).toBe(0);
    expect(index.retainedEndSequence).toBe(3);
    expect(index.queryRange("m", 0, 2, (sequence) => rows[sequence])).toEqual({
      min: -30,
      max: -18,
    });
    expect(index.queryRange("st", 0, 2, (sequence) => rows[sequence])).toEqual({
      min: -26,
      max: -20,
    });
  });

  it("keeps retained sequences aligned through wrap and reports batch query work", () => {
    const capacity = 5;
    const index = new LoudnessHistoryIndex(capacity);
    const rows = [];
    for (let sequence = 0; sequence < 13; sequence += 1) {
      index.append({ m: -sequence, st: sequence - 20 });
      rows.push({ m: -sequence, st: sequence - 20 });
      if (rows.length > capacity) rows.splice(0, 1);
    }

    expect(index.retainedStartSequence).toBe(8);
    expect(index.retainedEndSequence).toBe(13);
    index.beginQueryBatch();
    expect(
      index.queryRange("m", 8, 10, (sequence) =>
        rowAtSequence(rows, index.retainedStartSequence, sequence)
      )
    ).toEqual({ min: -10, max: -8 });
    expect(
      index.queryRange("st", 11, 12, (sequence) =>
        rowAtSequence(rows, index.retainedStartSequence, sequence)
      )
    ).toEqual({ min: -9, max: -8 });
    expect(index.lastQueryStats().nodesVisited).toBeGreaterThan(0);
    expect(index.batchQueryStats()).toMatchObject({
      queries: 2,
      nodesVisited: expect.any(Number),
      rawRowsVisited: expect.any(Number),
      summaryBucketsVisited: expect.any(Number),
    });
    expect(index.batchQueryStats().nodesVisited).toBeGreaterThanOrEqual(
      index.lastQueryStats().nodesVisited
    );
  });

  it("freezes independently and clear restarts sequence zero", () => {
    const index = new LoudnessHistoryIndex(3);
    const rows = [
      { m: -24, st: -25 },
      { m: -22, st: -23 },
      { m: -20, st: -21 },
    ];
    rows.forEach((row) => index.append(row));
    const frozenRows = rows.map((row) => ({ ...row }));
    const frozen = index.freeze();
    const frozenVersion = frozen.version;

    index.append({ m: -1, st: -2 });
    expect(frozen.queryRange("m", 0, 2, (sequence) => frozenRows[sequence])).toEqual({
      min: -24,
      max: -20,
    });
    expect(frozen.version).toBe(frozenVersion);

    index.clear();
    expect(index.retainedStartSequence).toBe(0);
    expect(index.retainedEndSequence).toBe(0);
    index.append({ m: -12, st: -13 });
    expect(index.retainedEndSequence).toBe(1);
  });

  it("rejects unsupported value keys", () => {
    const index = new LoudnessHistoryIndex(2);
    index.append({ m: -20, st: -21 });
    expect(() => index.queryRange("integrated", 0, 0, () => ({}))).toThrow(TypeError);
  });
});
