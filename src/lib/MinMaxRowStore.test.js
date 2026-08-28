import { describe, expect, it } from "vitest";
import { MinMaxRowStore } from "./MinMaxRowStore.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

describe("MinMaxRowStore", () => {
  it("reads back the mins and maxes of a row", () => {
    const store = new MinMaxRowStore(8);
    store.push({ mins: [-1, -2], maxes: [1, 2] });
    const row = store.at(0);
    expect(Array.from(row.mins)).toEqual([-1, -2]);
    expect(Array.from(row.maxes)).toEqual([1, 2]);
  });

  it("keeps each row's channel count when it changes between rows", () => {
    const store = new MinMaxRowStore(8);
    store.push({ mins: [-1, -2], maxes: [1, 2] });
    store.push({ mins: [-1, -2, -3], maxes: [1, 2, 3] });
    expect(store.at(0).mins).toHaveLength(2);
    expect(Array.from(store.at(1).maxes)).toEqual([1, 2, 3]);
  });

  it("expires the oldest rows at capacity", () => {
    const store = new MinMaxRowStore(2);
    store.push({ mins: [1], maxes: [1] });
    store.push({ mins: [2], maxes: [2] });
    store.push({ mins: [3], maxes: [3] });
    expect(store.length).toBe(2);
    expect(Array.from(store.at(0).mins)).toEqual([2]);
  });

  it("keeps a frozen view stable while the live store grows", () => {
    const store = new MinMaxRowStore(8);
    store.push({ mins: [1], maxes: [1] });
    const frozen = store.freeze();
    store.push({ mins: [2], maxes: [2] });
    expect(frozen.length).toBe(1);
    expect(Array.from(frozen.at(0).mins)).toEqual([1]);
  });

  it("shares sealed chunks and copies only the open tail on freeze", () => {
    const store = new MinMaxRowStore(VISUAL_HISTORY_CHUNK_ROWS * 2);
    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS + 1; i += 1) {
      store.push({ mins: [-i], maxes: [i] });
    }
    const frozen = store.freeze();
    const stats = frozen.storageStats();
    expect(stats.sharedSealedChunks).toBe(1);
    expect(stats.copiedTailRows).toBe(1);
    // Rows on both sides of the seal must survive the clone.
    expect(Array.from(frozen.at(VISUAL_HISTORY_CHUNK_ROWS - 1).maxes)).toEqual([
      VISUAL_HISTORY_CHUNK_ROWS - 1,
    ]);
    expect(Array.from(frozen.at(VISUAL_HISTORY_CHUNK_ROWS).maxes)).toEqual([
      VISUAL_HISTORY_CHUNK_ROWS,
    ]);
  });

  it("reports copiedReferences for stats parity with the object-backed columns", () => {
    const store = new MinMaxRowStore(8);
    store.push({ mins: [1], maxes: [1] });
    expect(store.storageStats().copiedReferences).toBe(0);
  });
});
