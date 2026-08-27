import { describe, expect, it } from "vitest";
import { ScalarHistoryStore } from "./ScalarHistoryStore.js";

function appendRow(store, index) {
  store.append({
    loudness: { m: -20 - index, st: -22 - index, timestampMs: index * 100 },
    audio: { momentary: -20 - index, integrated: -18 },
    correlation: index / 10,
  });
}

describe("ScalarHistoryStore", () => {
  it("keeps loudness, audio, and correlation projections aligned through wrap", () => {
    const store = new ScalarHistoryStore(3, { chunkRows: 2 });
    for (let index = 0; index < 5; index += 1) appendRow(store, index);

    expect(store.length).toBe(3);
    expect(store.loudness.length).toBe(3);
    expect(store.audio.length).toBe(3);
    expect(store.correlation.length).toBe(3);
    expect(store.loudness.rowAt(0)).toEqual({ m: -22, st: -24, timestampMs: 200 });
    expect(store.loudness.timestampAt(2)).toBe(400);
    expect(store.audio.at(2)).toEqual({ momentary: -24, integrated: -18 });
    expect(store.correlation.at(1)).toBe(0.3);
  });

  it("freezes one boundary and copies only each active column tail", () => {
    const store = new ScalarHistoryStore(6, { chunkRows: 4 });
    for (let index = 0; index < 7; index += 1) appendRow(store, index);

    const frozen = store.freeze();
    const stats = frozen.storageStats();

    expect(frozen.loudness.length).toBe(6);
    expect(frozen.audio.length).toBe(6);
    expect(frozen.correlation.length).toBe(6);
    expect(stats.copiedTailRows).toBe(9);
    expect(stats.copiedReferences).toBe(9);
    expect(stats.sharedSealedChunks).toBe(3);
  });

  it("keeps a frozen boundary unchanged after live wrap and clear", () => {
    const store = new ScalarHistoryStore(3, { chunkRows: 2 });
    for (let index = 0; index < 3; index += 1) appendRow(store, index);
    const frozen = store.freeze();

    for (let index = 3; index < 8; index += 1) appendRow(store, index);
    store.clear();

    expect(Array.from(frozen.loudness, (row) => row.timestampMs)).toEqual([0, 100, 200]);
    expect(Array.from(frozen.correlation)).toEqual([0, 0.1, 0.2]);
    expect(store.length).toBe(0);
  });
});
