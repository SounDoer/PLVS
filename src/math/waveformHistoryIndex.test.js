import { describe, expect, it } from "vitest";
import { WaveformHistoryIndex } from "./waveformHistoryIndex.js";
import { MinMaxRowStore } from "../lib/MinMaxRowStore.js";

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
    // Values are exactly representable in Float32 on purpose. A range query merges summary
    // buckets with raw rows, and those two stores do not have to agree on precision, so data that
    // needs rounding would make this assertion about float representation instead of channel
    // widths -- which is what it is here to test.
    const rows = [
      { waveformMin: [-0.25], waveformMax: [0.375] },
      { waveformMin: [-0.75, -0.5, -0.125], waveformMax: [0.5, 0.875, 0.25] },
      { waveformMin: [-0.125, -0.875], waveformMax: [0.5] },
    ];
    rows.forEach((row) => index.append(row));

    expect(index.capacity).toBe(8);
    expect(index.valueCount).toBe(3);
    expect(index.retainedStartSequence).toBe(0);
    expect(index.retainedEndSequence).toBe(3);
    expect(index.queryRange(0, 2, (sequence) => rawRow(rows, 0, sequence))).toEqual({
      mins: [-0.75, -0.875, -0.125],
      maxes: [0.5, 0.875, 0.25],
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

  it("freezes support rows without copying the retained history", () => {
    const capacity = 2049;
    const index = new WaveformHistoryIndex(capacity);
    for (let sequence = 0; sequence < capacity; sequence += 1) {
      index.append({
        waveformMin: [sequence === 2048 ? NaN : -sequence],
        waveformMax: [sequence],
      });
    }

    const stats = index.freeze().storageStats();

    expect(stats.rawRows.sharedSealedChunks).toBe(2);
    // The packed raw-row store copies the open chunk's bytes, never per-row references, so the
    // "did freeze copy the whole retained history" question is answered by the tail row count.
    expect(stats.rawRows.copiedReferences).toBe(0);
    expect(stats.rawRows.copiedTailRows).toBe(1);
    expect(stats.nanSequences.copiedReferences).toBe(1);
    expect(stats.index.sharedSealedChunks).toBeGreaterThan(0);
  });
});

describe("WaveformHistoryIndex packed raw rows", () => {
  it("stores raw extrema in a packed store", () => {
    const index = new WaveformHistoryIndex(8);
    index.append({ waveformMin: [-0.5, -0.4], waveformMax: [0.5, 0.4] });
    expect(index._rawRows).toBeInstanceOf(MinMaxRowStore);
  });

  it("still answers a range query that falls back to raw rows", () => {
    const index = new WaveformHistoryIndex(8);
    index.append({ waveformMin: [-0.5], waveformMax: [0.5] });
    index.append({ waveformMin: [-0.9], waveformMax: [0.2] });
    index.append({ waveformMin: [-0.1], waveformMax: [0.7] });
    const result = index.queryRange(0, 2);
    expect(result.mins[0]).toBeCloseTo(-0.9, 4);
    expect(result.maxes[0]).toBeCloseTo(0.7, 4);
  });

  it("keeps a frozen index answering the same query", () => {
    const index = new WaveformHistoryIndex(8);
    index.append({ waveformMin: [-0.5], waveformMax: [0.5] });
    index.append({ waveformMin: [-0.9], waveformMax: [0.2] });
    const frozen = index.freeze();
    index.append({ waveformMin: [-2], waveformMax: [2] });
    const result = frozen.queryRange(0, 1);
    expect(result.mins[0]).toBeCloseTo(-0.9, 4);
    expect(result.maxes[0]).toBeCloseTo(0.5, 4);
  });
});
