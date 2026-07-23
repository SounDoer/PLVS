import { describe, expect, it } from "vitest";
import { WaveformHistoryIndex } from "./waveformHistoryIndex.js";

function rawRow(rows, retainedStart, sequence) {
  const row = rows[sequence - retainedStart];
  if (!row) return row;
  return {
    mins: Array.from(
      { length: Math.max(row.waveformMin?.length ?? 0, row.waveformMax?.length ?? 0) },
      (_, channel) => row.waveformMin?.[channel] ?? 0
    ),
    maxes: Array.from(
      { length: Math.max(row.waveformMin?.length ?? 0, row.waveformMax?.length ?? 0) },
      (_, channel) => row.waveformMax?.[channel] ?? 0
    ),
  };
}

describe("WaveformHistoryIndex", () => {
  it("indexes dynamic channel widths with missing channels treated as zero", () => {
    const index = new WaveformHistoryIndex(8);
    const rows = [
      { waveformMin: [-0.2], waveformMax: [0.3] },
      { waveformMin: [-0.8, -0.4, -0.1], waveformMax: [0.5, 0.7, 0.2] },
      { waveformMin: [-0.1, -0.9], waveformMax: [0.4] },
    ];
    rows.forEach((row) => index.append(row));

    expect(index.capacity).toBe(8);
    expect(index.valueCount).toBe(3);
    expect(index.retainedStartSequence).toBe(0);
    expect(index.retainedEndSequence).toBe(3);
    expect(index.queryRange(0, 2, (sequence) => rawRow(rows, 0, sequence))).toEqual({
      mins: [-0.8, -0.9, -0.1],
      maxes: [0.5, 0.7, 0.2],
    });
  });

  it("keeps sequence alignment through wrap and accumulates bounded query stats", () => {
    const capacity = 5;
    const index = new WaveformHistoryIndex(capacity);
    const rows = [];
    for (let sequence = 0; sequence < 13; sequence += 1) {
      const row = {
        waveformMin: [-sequence, sequence % 2 ? -sequence / 2 : undefined],
        waveformMax: [sequence, sequence % 3 ? sequence / 3 : undefined],
      };
      index.append(row);
      rows.push(row);
      if (rows.length > capacity) rows.splice(0, 1);
    }

    expect(index.retainedStartSequence).toBe(8);
    expect(index.retainedEndSequence).toBe(13);
    index.beginQueryBatch();
    expect(
      index.queryRange(8, 12, (sequence) => rawRow(rows, index.retainedStartSequence, sequence))
    ).toEqual({
      mins: [-12, -5.5],
      maxes: [12, 11 / 3],
    });
    expect(index.batchQueryStats()).toMatchObject({
      queries: 1,
      nodesVisited: expect.any(Number),
      rawRowsVisited: expect.any(Number),
      summaryBucketsVisited: expect.any(Number),
    });
    expect(index.batchQueryStats().nodesVisited).toBeGreaterThan(0);
  });

  it("freezes independently and clear restarts sequence zero", () => {
    const index = new WaveformHistoryIndex(3);
    const rows = [
      { waveformMin: [-0.5], waveformMax: [0.2] },
      { waveformMin: [-0.3, -0.7], waveformMax: [0.8, 0.4] },
      { waveformMin: [-0.1], waveformMax: [0.6] },
    ];
    rows.forEach((row) => index.append(row));
    const frozen = index.freeze();
    const frozenVersion = frozen.version;

    index.append({ waveformMin: [-1], waveformMax: [1] });
    expect(frozen.queryRange(0, 2, (sequence) => rawRow(rows, 0, sequence))).toEqual({
      mins: [-0.5, -0.7],
      maxes: [0.8, 0.4],
    });
    expect(frozen.version).toBe(frozenVersion);
    expect(() => frozen.append(rows[0])).toThrow(TypeError);
    expect(() => frozen.clear()).toThrow(TypeError);

    index.clear();
    expect(index.retainedStartSequence).toBe(0);
    expect(index.retainedEndSequence).toBe(0);
    expect(index.valueCount).toBe(0);
    index.append(rows[0]);
    expect(index.retainedEndSequence).toBe(1);
  });

  it("tracks sparse NaN sequences with inclusive range and eviction semantics", () => {
    const index = new WaveformHistoryIndex(4);
    index.append({ waveformMin: [-0.1], waveformMax: [0.1] });
    index.append({ waveformMin: [NaN], waveformMax: [0.2] });
    index.append({ waveformMin: [-0.3], waveformMax: [NaN] });
    index.append({ waveformMin: [-Infinity], waveformMax: [Infinity] });
    const frozen = index.freeze();

    expect(index.hasNaNInRange(0, 0)).toBe(false);
    expect(index.hasNaNInRange(1, 1)).toBe(true);
    expect(index.hasNaNInRange(2, 2)).toBe(true);
    expect(index.hasNaNInRange(3, 3)).toBe(false);
    expect(index.hasNaNInRange(-100, 100)).toBe(true);

    index.append({ waveformMin: [-0.5], waveformMax: [0.5] });
    expect(index.retainedStartSequence).toBe(1);
    expect(index.hasNaNInRange(0, 0)).toBe(false);
    index.append({ waveformMin: [-0.6], waveformMax: [0.6] });
    expect(index.retainedStartSequence).toBe(2);
    expect(index.hasNaNInRange(0, 1)).toBe(false);
    expect(index.hasNaNInRange(2, 2)).toBe(true);
    index.append({ waveformMin: [-0.7], waveformMax: [0.7] });
    expect(index.hasNaNInRange(0, 2)).toBe(false);

    expect(frozen.hasNaNInRange(1, 2)).toBe(true);
    expect(frozen.hasNaNInRange(3, 3)).toBe(false);
  });
});
