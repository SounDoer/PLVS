import { describe, expect, it } from "vitest";
import { ScalarHistoryStore } from "./ScalarHistoryStore.js";
import { AudioSnapHistorySlab } from "./AudioSnapHistorySlab.js";
import { LoudnessHistorySlab } from "./LoudnessHistorySlab.js";

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
    // Loudness is a packed slab: it reads back the full row shape, not just the pushed fields.
    expect(store.loudness.rowAt(0).m).toBe(-22);
    expect(store.loudness.rowAt(0).st).toBe(-24);
    expect(store.loudness.rowAt(0).timestampMs).toBe(200);
    expect(store.loudness.timestampAt(2)).toBe(400);
    // Audio is a packed slab: it reads back the full row shape, not just the pushed fields.
    expect(store.audio.at(2).momentary).toBe(-24);
    expect(store.audio.at(2).integrated).toBe(-18);
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
    // Loudness and audio are both packed slabs that always use the shared history chunk size
    // (1024 rows), independent of the `chunkRows` option given to correlation, so their 7-row
    // stream never seals a chunk here: each contributes 0 sealed chunks + 6 copied tail rows
    // (its whole retained window, still unsealed) + 0 copied references (they report none).
    // Correlation still uses chunkRows: 4 and contributes 1 sealed chunk + 3 copied tail
    // rows/references.
    expect(stats.copiedTailRows).toBe(15);
    expect(stats.copiedReferences).toBe(3);
    expect(stats.sharedSealedChunks).toBe(1);
  });

  it("keeps a frozen boundary unchanged after live wrap and clear", () => {
    const store = new ScalarHistoryStore(3, { chunkRows: 2 });
    for (let index = 0; index < 3; index += 1) appendRow(store, index);
    const frozen = store.freeze();

    for (let index = 3; index < 8; index += 1) appendRow(store, index);
    store.clear();

    expect(frozen.loudness.toArray().map((row) => row.timestampMs)).toEqual([0, 100, 200]);
    expect(Array.from(frozen.correlation)).toEqual([0, 0.1, 0.2]);
    expect(store.length).toBe(0);
  });
});

describe("ScalarHistoryStore packed audio column", () => {
  it("stores audio snaps in a packed slab", () => {
    const store = new ScalarHistoryStore(8);
    store.append({
      loudness: { m: -20, st: -22, timestampMs: 1000 },
      audio: { momentary: -20, peakDb: [-6, -7], rmsDb: [-24, -25] },
      correlation: 0.5,
    });
    expect(store.audio).toBeInstanceOf(AudioSnapHistorySlab);
    expect(store.audio.rowAt(0).momentary).toBeCloseTo(-20, 4);
    expect(Array.from(store.audio.rowAt(0).peakDb)).toEqual([-6, -7]);
    expect(store.audio.timestampAt(0)).toBe(1000);
  });

  it("keeps aggregate storage stats numeric across mixed column kinds", () => {
    const store = new ScalarHistoryStore(8);
    store.append({
      loudness: { m: -20, st: -22, timestampMs: 0 },
      audio: { momentary: -20 },
      correlation: 0.5,
    });
    const stats = store.freeze().storageStats();
    expect(Number.isFinite(stats.copiedReferences)).toBe(true);
    expect(Number.isFinite(stats.copiedTailRows)).toBe(true);
  });
});

describe("ScalarHistoryStore packed loudness column", () => {
  it("stores loudness rows in a packed slab", () => {
    const store = new ScalarHistoryStore(8);
    store.append({
      loudness: {
        m: -20,
        st: -22,
        timestampMs: 1000,
        waveformMin: [-0.5, -0.4],
        waveformMax: [0.5, 0.4],
      },
      audio: { momentary: -20 },
      correlation: 0.5,
    });
    expect(store.loudness).toBeInstanceOf(LoudnessHistorySlab);
    expect(store.loudness.rowAt(0).m).toBeCloseTo(-20, 4);
    expect(store.loudness.rowAt(0).waveformMin[0]).toBeCloseTo(-0.5, 4);
    expect(store.loudness.rowAt(0).waveformMin[1]).toBeCloseTo(-0.4, 4);
    expect(store.loudness.timestampAt(0)).toBe(1000);
  });
});
