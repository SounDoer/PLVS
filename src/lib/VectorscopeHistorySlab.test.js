import { describe, expect, it } from "vitest";
import { FrozenVectorscopeHistory, VectorscopeHistorySlab } from "./VectorscopeHistorySlab.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { aggregatePolarLevel } from "../math/vectorscopePolarMath.js";

const PAIR_VALUE_COUNT = 200;
const copiedTailBytes = (rows) =>
  rows * PAIR_VALUE_COUNT * Int16Array.BYTES_PER_ELEMENT +
  rows * 2 * Float64Array.BYTES_PER_ELEMENT +
  64 * Float64Array.BYTES_PER_ELEMENT;

function pairsFor(sequence) {
  return Float32Array.from(
    { length: PAIR_VALUE_COUNT },
    (_, index) => ((sequence + index) % 200) / 100 - 1
  );
}

function pushRow(slab, sequence, overrides = {}) {
  slab.push({
    pairs: pairsFor(sequence),
    correlation: sequence / 10,
    timestampMs: sequence,
    ...overrides,
  });
}

describe("VectorscopeHistorySlab", () => {
  it("packs normalized pairs into Int16 rows with bounded display error", () => {
    const slab = new VectorscopeHistorySlab(2, 4);
    slab.push({ pairs: new Float32Array([-1, -0.12345, 0.5, 1]), timestampMs: 1 });

    const row = slab.rowAt(0);
    expect(row.pairAt(0)).toBe(-1);
    expect(row.pairAt(1)).toBeCloseTo(-0.12345, 4);
    expect(row.pairAt(2)).toBeCloseTo(0.5, 4);
    expect(row.pairAt(3)).toBe(1);
    expect(row.packedPairs).toBeInstanceOf(Int16Array);
    expect(slab.storageStats()).toMatchObject({
      valueArrayType: "Int16Array",
      bytesPerValue: 2,
    });
  });

  it("maintains an incremental Polar Max Hold summary across chunk boundaries", () => {
    const slab = new VectorscopeHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 2, 2);
    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS + 2; i += 1) {
      const pairs =
        i === 10
          ? new Float32Array([1, 0])
          : i === VISUAL_HISTORY_CHUNK_ROWS
            ? new Float32Array([0, 1])
            : new Float32Array([0, 0]);
      slab.push({ pairs, timestampMs: i });
    }

    const expected = aggregatePolarLevel(slab.toArray());
    expect(Array.from(slab.freeze().polarMaxHoldAt(slab.length - 1))).toEqual(Array.from(expected));
  });

  it("retains exact capacity through a partial oldest chunk and drops whole expired chunks", () => {
    const capacity = VISUAL_HISTORY_CHUNK_ROWS + 3;
    const slab = new VectorscopeHistorySlab(capacity, PAIR_VALUE_COUNT);

    for (let i = 0; i < capacity + VISUAL_HISTORY_CHUNK_ROWS + 7; i += 1) pushRow(slab, i);

    expect(slab.length).toBe(capacity);
    expect(slab.timestampAt(0)).toBe(VISUAL_HISTORY_CHUNK_ROWS + 7);
    expect(slab.timestampAt(capacity - 1)).toBe(capacity + VISUAL_HISTORY_CHUNK_ROWS + 6);
    expect(slab.storageStats()).toMatchObject({ chunkCount: 2, retainedRows: capacity });
  });

  it("uses fixed pair widths, ignores empty pairs, and preserves malformed correlation fallback", () => {
    const slab = new VectorscopeHistorySlab(2, PAIR_VALUE_COUNT);
    const version = slab.version;

    slab.push({ pairs: [] });
    expect(slab.length).toBe(0);
    expect(slab.version).toBe(version);
    expect(() => slab.push({ pairs: new Float32Array(PAIR_VALUE_COUNT - 1) })).toThrow(
      /different pair count/
    );

    pushRow(slab, 0, {
      timestampMs: Number.NaN,
      correlation: Number.NaN,
    });
    expect(slab.rowAt(0)).toMatchObject({
      timestampMs: -Infinity,
      correlation: -Infinity,
    });
  });

  it("maps wrapped logical rows in O(1) order and advances version per stored row", () => {
    const slab = new VectorscopeHistorySlab(2, PAIR_VALUE_COUNT);
    const version = slab.version;
    pushRow(slab, 1);
    pushRow(slab, 2);
    pushRow(slab, 3);

    expect(slab.capacity).toBe(2);
    expect(slab.pairValueCount).toBe(PAIR_VALUE_COUNT);
    expect(slab.version).toBe(version + 3);
    expect(slab.timestampAt(0)).toBe(2);
    expect(slab.timestampAt(1)).toBe(3);
    expect(slab.timestampAt(2)).toBeNaN();
    expect(slab.rowAt(0).pairs[0]).toBeCloseTo(-0.98, 4);
    expect(slab.rowAt(1).correlation).toBe(0.3);
    expect(slab.rowAt(2)).toBeUndefined();
  });

  it("freeze shares sealed buffers, clones the appended tail, and pins both after eviction", () => {
    const slab = new VectorscopeHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 2, PAIR_VALUE_COUNT);
    for (let i = 0; i <= VISUAL_HISTORY_CHUNK_ROWS; i += 1) pushRow(slab, i);

    const frozen = slab.freeze();
    const frozenSealed = frozen.rowAt(0).packedPairs.buffer;
    const frozenTail = frozen.rowAt(VISUAL_HISTORY_CHUNK_ROWS).packedPairs.buffer;
    const liveTail = slab.rowAt(VISUAL_HISTORY_CHUNK_ROWS).packedPairs.buffer;

    expect(frozen).toBeInstanceOf(FrozenVectorscopeHistory);
    expect(frozenSealed).toBe(slab.rowAt(0).packedPairs.buffer);
    expect(frozenTail).not.toBe(liveTail);
    expect(frozen.storageStats()).toMatchObject({
      chunkCount: 2,
      retainedRows: VISUAL_HISTORY_CHUNK_ROWS + 1,
      sharedSealedChunks: 1,
      copiedTailRows: 1,
      copiedTailBytes: copiedTailBytes(1),
    });

    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS + 3; i += 1) pushRow(slab, 10_000 + i);

    expect(frozen.length).toBe(VISUAL_HISTORY_CHUNK_ROWS + 1);
    expect(frozen.version).toBe(0);
    expect(frozen.timestampAt(0)).toBe(0);
    expect(frozen.timestampAt(VISUAL_HISTORY_CHUNK_ROWS)).toBe(VISUAL_HISTORY_CHUNK_ROWS);
    expect(frozen.rowAt(0).packedPairs.buffer).toBe(frozenSealed);
    expect(frozen.rowAt(VISUAL_HISTORY_CHUNK_ROWS).packedPairs.buffer).toBe(frozenTail);
  });

  it("freeze copies no payload when the newest chunk is exactly full", () => {
    const slab = new VectorscopeHistorySlab(VISUAL_HISTORY_CHUNK_ROWS, PAIR_VALUE_COUNT);
    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS; i += 1) pushRow(slab, i);

    const frozen = slab.freeze();

    expect(frozen.rowAt(0).packedPairs.buffer).toBe(slab.rowAt(0).packedPairs.buffer);
    expect(frozen.storageStats()).toMatchObject({
      chunkCount: 1,
      retainedRows: VISUAL_HISTORY_CHUNK_ROWS,
      sharedSealedChunks: 1,
      copiedTailRows: 0,
      copiedTailBytes: 0,
    });
  });

  it("freezes a partial oldest sealed chunk, sealed middle, and active tail", () => {
    const endSequence = VISUAL_HISTORY_CHUNK_ROWS * 2 + 5;
    const capacity = endSequence - 7;
    const slab = new VectorscopeHistorySlab(capacity, PAIR_VALUE_COUNT);
    for (let i = 0; i < endSequence; i += 1) pushRow(slab, i);

    const frozen = slab.freeze();
    const middleIndex = VISUAL_HISTORY_CHUNK_ROWS - 7;
    const lastIndex = capacity - 1;

    expect(frozen.timestampAt(0)).toBe(7);
    expect(frozen.timestampAt(lastIndex)).toBe(endSequence - 1);
    expect(frozen.rowAt(0).packedPairs.buffer).toBe(slab.rowAt(0).packedPairs.buffer);
    expect(frozen.rowAt(middleIndex).packedPairs.buffer).toBe(
      slab.rowAt(middleIndex).packedPairs.buffer
    );
    expect(frozen.rowAt(lastIndex).packedPairs.buffer).not.toBe(
      slab.rowAt(lastIndex).packedPairs.buffer
    );
    expect(frozen.storageStats()).toMatchObject({
      chunkCount: 3,
      retainedRows: capacity,
      sharedSealedChunks: 2,
      copiedTailRows: 5,
      copiedTailBytes: copiedTailBytes(5),
    });
  });

  it("reports retained active intersection while cloning appended tail storage", () => {
    const slab = new VectorscopeHistorySlab(1, PAIR_VALUE_COUNT);
    for (let i = 0; i < 10; i += 1) pushRow(slab, i);

    const frozen = slab.freeze();

    expect(frozen.length).toBe(1);
    expect(frozen.timestampAt(0)).toBe(9);
    expect(frozen.storageStats()).toMatchObject({
      chunkCount: 1,
      retainedRows: 1,
      sharedSealedChunks: 0,
      copiedTailRows: 1,
      copiedTailBytes: copiedTailBytes(10),
    });
  });

  it("returns correlation and honors copyRows", () => {
    const slab = new VectorscopeHistorySlab(2, PAIR_VALUE_COUNT);
    pushRow(slab, 4);

    const live = slab.rowAt(0);
    const copied = slab.toArray({ copyRows: true })[0];

    expect(live).toMatchObject({
      correlation: 0.4,
      timestampMs: 4,
    });
    expect(live).not.toHaveProperty("sideToMidDb");
    expect(live).not.toHaveProperty("midEnergy");
    expect(live).not.toHaveProperty("sideEnergy");
    expect(copied.pairs.buffer).not.toBe(live.pairs.buffer);
    live.pairs[0] = 99;
    expect(copied.pairs[0]).toBeCloseTo(-0.96, 4);
    expect(slab.rowAt(0).pairs[0]).toBeCloseTo(-0.96, 4);
  });

  it("clear releases chunks, preserves version, and reuses the slab", () => {
    const slab = new VectorscopeHistorySlab(2, PAIR_VALUE_COUNT);
    pushRow(slab, 1);
    const oldBuffer = slab.rowAt(0).packedPairs.buffer;
    const version = slab.version;

    slab.clear();

    expect(slab.length).toBe(0);
    expect(slab.version).toBe(version);
    expect(slab.storageStats()).toMatchObject({
      chunkCount: 0,
      retainedRows: 0,
      sharedSealedChunks: 0,
      copiedTailRows: 0,
      copiedTailBytes: 0,
    });

    pushRow(slab, 2);
    expect(slab.rowAt(0).packedPairs.buffer).not.toBe(oldBuffer);
    expect(slab.timestampAt(0)).toBe(2);
  });

  it("freezes an empty slab as an empty stable view", () => {
    const frozen = new VectorscopeHistorySlab(1, PAIR_VALUE_COUNT).freeze();

    expect(frozen.length).toBe(0);
    expect(frozen.version).toBe(0);
    expect(frozen.timestampAt(0)).toBeNaN();
    expect(frozen.rowAt(0)).toBeUndefined();
    expect(frozen.storageStats()).toMatchObject({
      chunkCount: 0,
      retainedRows: 0,
      sharedSealedChunks: 0,
      copiedTailRows: 0,
      copiedTailBytes: 0,
    });
  });
});
