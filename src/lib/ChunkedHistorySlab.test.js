import { describe, expect, it } from "vitest";
import {
  ChunkedHistorySlab,
  FrozenChunkedHistory,
  baseChunk,
  chunkIdForSequence,
  chunkOffsetForSequence,
} from "./ChunkedHistorySlab.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

/** A minimal metric: one number per row, so the tests exercise storage and nothing else. */
const schema = {
  name: "TestSlab",
  createChunk: (sequenceStart) => ({
    ...baseChunk(sequenceStart),
    values: new Float64Array(VISUAL_HISTORY_CHUNK_ROWS),
  }),
  cloneChunk: (chunk) => ({
    sequenceStart: chunk.sequenceStart,
    rowCount: chunk.rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(),
    values: chunk.values.slice(),
  }),
  payloadBytes: (chunk) => chunk.timestamps.byteLength + chunk.values.byteLength,
};

function makeSlab(capacity) {
  return new ChunkedHistorySlab(capacity, schema);
}

function pushRows(slab, count, { from = 0, timestampStep = 10 } = {}) {
  for (let i = 0; i < count; i += 1) {
    const value = from + i;
    slab.appendRow(value * timestampStep, (chunk, row) => {
      chunk.values[row] = value;
    });
  }
}

function valueAt(history, index) {
  const found = history.chunkAt(index);
  return found ? found.chunk.values[found.row] : undefined;
}

describe("ChunkedHistorySlab", () => {
  it("rejects a capacity that retains nothing", () => {
    expect(() => makeSlab(0)).toThrow(RangeError);
    expect(() => makeSlab(-1)).toThrow(/TestSlab capacity/);
  });

  it("reads back rows in order with their timestamps", () => {
    const slab = makeSlab(100);
    pushRows(slab, 3);

    expect(slab.length).toBe(3);
    expect([0, 1, 2].map((i) => valueAt(slab, i))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((i) => slab.timestampAt(i))).toEqual([0, 10, 20]);
  });

  it("stores an unusable timestamp as -Infinity rather than dropping the row", () => {
    const slab = makeSlab(10);
    slab.appendRow(undefined, (chunk, row) => {
      chunk.values[row] = 7;
    });

    expect(slab.length).toBe(1);
    expect(slab.timestampAt(0)).toBe(-Infinity);
    expect(valueAt(slab, 0)).toBe(7);
  });

  it("returns nothing outside the retained window", () => {
    const slab = makeSlab(10);
    pushRows(slab, 2);

    expect(slab.chunkAt(-1)).toBeNull();
    expect(slab.chunkAt(2)).toBeNull();
    expect(slab.timestampAt(2)).toBeNaN();
  });

  it("bumps the version once per row", () => {
    const slab = makeSlab(10);
    expect(slab.version).toBe(0);
    pushRows(slab, 4);
    expect(slab.version).toBe(4);
  });

  it("seals a chunk at the chunk row count and opens the next one", () => {
    const slab = makeSlab(VISUAL_HISTORY_CHUNK_ROWS * 3);
    pushRows(slab, VISUAL_HISTORY_CHUNK_ROWS + 1);

    expect(slab.storageStats().chunkCount).toBe(2);
    expect(slab.length).toBe(VISUAL_HISTORY_CHUNK_ROWS + 1);
    // The row that opened the second chunk still reads back as itself.
    expect(valueAt(slab, VISUAL_HISTORY_CHUNK_ROWS)).toBe(VISUAL_HISTORY_CHUNK_ROWS);
  });

  it("expires the oldest rows once capacity is exceeded, without moving the survivors", () => {
    const slab = makeSlab(5);
    pushRows(slab, 8);

    expect(slab.length).toBe(5);
    expect([0, 1, 2, 3, 4].map((i) => valueAt(slab, i))).toEqual([3, 4, 5, 6, 7]);
    expect(slab.timestampAt(0)).toBe(30);
  });

  it("drops a chunk only once every row in it has expired", () => {
    const capacity = VISUAL_HISTORY_CHUNK_ROWS;
    const slab = makeSlab(capacity);
    pushRows(slab, capacity);
    expect(slab.storageStats().chunkCount).toBe(1);

    // One row past capacity: the window no longer covers row 0, but the rest of chunk 0 is live.
    pushRows(slab, 1, { from: capacity });
    expect(slab.storageStats().chunkCount).toBe(2);
    expect(valueAt(slab, 0)).toBe(1);

    // Once the window has moved past all of chunk 0, it goes.
    pushRows(slab, capacity - 1, { from: capacity + 1 });
    expect(slab.storageStats().chunkCount).toBe(1);
    expect(valueAt(slab, 0)).toBe(capacity);
  });

  it("keeps addressing rows correctly after a chunk has been dropped", () => {
    const capacity = VISUAL_HISTORY_CHUNK_ROWS + 10;
    const slab = makeSlab(capacity);
    pushRows(slab, VISUAL_HISTORY_CHUNK_ROWS * 3);

    expect(slab.length).toBe(capacity);
    const firstRetained = VISUAL_HISTORY_CHUNK_ROWS * 3 - capacity;
    expect(valueAt(slab, 0)).toBe(firstRetained);
    expect(valueAt(slab, capacity - 1)).toBe(VISUAL_HISTORY_CHUNK_ROWS * 3 - 1);
  });

  it("clears to empty and keeps accepting rows", () => {
    const slab = makeSlab(10);
    pushRows(slab, 4);
    slab.clear();

    expect(slab.length).toBe(0);
    expect(slab.chunkAt(0)).toBeNull();
    expect(slab.storageStats().chunkCount).toBe(0);

    pushRows(slab, 2, { from: 100 });
    expect(slab.length).toBe(2);
    expect(valueAt(slab, 0)).toBe(100);
  });

  it("clears onto a chunk boundary so a snapshot taken first keeps its own rows", () => {
    const slab = makeSlab(50);
    pushRows(slab, 4);
    const before = new FrozenChunkedHistory(slab.freezeChunks());
    slab.clear();
    pushRows(slab, 2, { from: 100 });

    expect(before.length).toBe(4);
    expect([0, 1, 2, 3].map((i) => valueAt(before, i))).toEqual([0, 1, 2, 3]);
    expect(valueAt(slab, 0)).toBe(100);
  });

  it("shares sealed chunks with a snapshot and copies only the open one", () => {
    const slab = makeSlab(VISUAL_HISTORY_CHUNK_ROWS * 3);
    pushRows(slab, VISUAL_HISTORY_CHUNK_ROWS + 5);
    const frozen = new FrozenChunkedHistory(slab.freezeChunks());
    const stats = frozen.storageStats();

    expect(stats.chunkCount).toBe(2);
    expect(stats.sharedSealedChunks).toBe(1);
    expect(stats.copiedTailRows).toBe(5);
    expect(stats.copiedTailBytes).toBeGreaterThan(0);
    expect(stats.retainedRows).toBe(VISUAL_HISTORY_CHUNK_ROWS + 5);
  });

  it("leaves a snapshot unchanged when the live slab keeps growing", () => {
    const slab = makeSlab(100);
    pushRows(slab, 3);
    const frozen = new FrozenChunkedHistory(slab.freezeChunks());
    pushRows(slab, 3, { from: 3 });

    expect(frozen.length).toBe(3);
    expect(valueAt(frozen, 2)).toBe(2);
    expect(frozen.chunkAt(3)).toBeNull();
    expect(slab.length).toBe(6);
  });

  it("gives a snapshot a constant version and the live slab a moving one", () => {
    const slab = makeSlab(10);
    pushRows(slab, 2);
    const frozen = new FrozenChunkedHistory(slab.freezeChunks());
    pushRows(slab, 1, { from: 2 });

    expect(frozen.version).toBe(0);
    expect(slab.version).toBe(3);
  });

  it("freezes an empty slab into an empty snapshot", () => {
    const frozen = new FrozenChunkedHistory(makeSlab(10).freezeChunks());

    expect(frozen.length).toBe(0);
    expect(frozen.chunkAt(0)).toBeNull();
    expect(frozen.timestampAt(0)).toBeNaN();
    expect(frozen.storageStats()).toMatchObject({ chunkCount: 0, retainedRows: 0 });
  });

  it("reports live storage without any sharing or copying", () => {
    const slab = makeSlab(10);
    pushRows(slab, 3);

    expect(slab.storageStats()).toEqual({
      chunkCount: 1,
      retainedRows: 3,
      sharedSealedChunks: 0,
      copiedTailRows: 0,
      copiedTailBytes: 0,
    });
  });
});

describe("sequence addressing", () => {
  it("splits a sequence into its chunk and its offset", () => {
    expect(chunkIdForSequence(0)).toBe(0);
    expect(chunkOffsetForSequence(0)).toBe(0);
    expect(chunkIdForSequence(VISUAL_HISTORY_CHUNK_ROWS)).toBe(1);
    expect(chunkOffsetForSequence(VISUAL_HISTORY_CHUNK_ROWS)).toBe(0);
    expect(chunkIdForSequence(VISUAL_HISTORY_CHUNK_ROWS + 7)).toBe(1);
    expect(chunkOffsetForSequence(VISUAL_HISTORY_CHUNK_ROWS + 7)).toBe(7);
  });
});
