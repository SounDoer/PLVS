import { describe, expect, it } from "vitest";
import { LoudnessHistorySlab } from "./LoudnessHistorySlab.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

// Values round-trip through a Float32Array, so a non-integer literal (e.g. -0.4) comes back as
// the nearest float32, not the exact double. Compare with a tolerance instead of toEqual.
function closeArray(actual, expected) {
  const values = Array.from(actual);
  expect(values).toHaveLength(expected.length);
  values.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 4));
}

function row(overrides = {}) {
  return {
    m: -20,
    st: -22,
    waveformMin: [-0.5, -0.4],
    waveformMax: [0.5, 0.4],
    waveformSubPairs: Float32Array.from([-0.1, 0.1, -0.2, 0.2]),
    timestampMs: 1000,
    ...overrides,
  };
}

describe("LoudnessHistorySlab", () => {
  it("reads back every field of an appended row", () => {
    const slab = new LoudnessHistorySlab(8);
    slab.push(row());
    const stored = slab.rowAt(0);
    expect(stored.m).toBeCloseTo(-20, 4);
    expect(stored.st).toBeCloseTo(-22, 4);
    expect(stored.timestampMs).toBe(1000);
    closeArray(stored.waveformMin, [-0.5, -0.4]);
    closeArray(stored.waveformMax, [0.5, 0.4]);
    closeArray(stored.waveformSubPairs, [-0.1, 0.1, -0.2, 0.2]);
    expect(stored.waveformSubCount).toBe(1);
  });

  it("derives waveformSubCount from the stored payload and channel count", () => {
    const slab = new LoudnessHistorySlab(8);
    slab.push(row({ waveformSubPairs: Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]) }));
    expect(slab.rowAt(0).waveformSubCount).toBe(2);
  });

  it("keeps rows independent when the channel count changes mid-session", () => {
    const slab = new LoudnessHistorySlab(8);
    slab.push(row());
    slab.push(
      row({
        waveformMin: [-0.1, -0.2, -0.3],
        waveformMax: [0.1, 0.2, 0.3],
        waveformSubPairs: Float32Array.from([1, 2, 3, 4, 5, 6]),
        timestampMs: 1100,
      })
    );
    closeArray(slab.rowAt(0).waveformMin, [-0.5, -0.4]);
    closeArray(slab.rowAt(1).waveformMin, [-0.1, -0.2, -0.3]);
    expect(slab.rowAt(1).waveformSubCount).toBe(1);
  });

  it("exposes m and st without materialising a row", () => {
    const slab = new LoudnessHistorySlab(8);
    slab.push(row({ m: -14, st: -15 }));
    expect(slab.valueAt(0, "m")).toBeCloseTo(-14, 4);
    expect(slab.valueAt(0, "st")).toBeCloseTo(-15, 4);
  });

  it("stores -Infinity for a loudness value that arrived unusable", () => {
    const slab = new LoudnessHistorySlab(8);
    slab.push(row({ m: -Infinity }));
    expect(slab.rowAt(0).m).toBe(-Infinity);
  });

  it("expires the oldest rows at capacity", () => {
    const slab = new LoudnessHistorySlab(4);
    for (let i = 0; i < 6; i += 1) slab.push(row({ m: -i, timestampMs: i * 100 }));
    expect(slab.length).toBe(4);
    expect(slab.rowAt(0).m).toBeCloseTo(-2, 4);
    expect(slab.timestampAt(0)).toBe(200);
  });

  it("keeps a frozen view stable while the live slab keeps growing", () => {
    const slab = new LoudnessHistorySlab(8);
    slab.push(row({ m: -10 }));
    const frozen = slab.freeze();
    slab.push(row({ m: -11, timestampMs: 1100 }));
    expect(frozen.length).toBe(1);
    expect(frozen.rowAt(0).m).toBeCloseTo(-10, 4);
    expect(frozen.valueAt(0, "m")).toBeCloseTo(-10, 4);
  });

  it("shares sealed chunks and copies only the active chunk on freeze, with rows on both sides of the boundary intact", () => {
    const slab = new LoudnessHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 1);
    for (let index = 0; index <= VISUAL_HISTORY_CHUNK_ROWS; index += 1) {
      slab.push(row({ m: -index, timestampMs: index }));
    }
    const frozen = slab.freeze();

    expect(frozen.storageStats()).toMatchObject({
      sharedSealedChunks: 1,
      copiedTailRows: 1,
    });
    expect(frozen.rowAt(0).m).toBeCloseTo(0, 4);
    expect(frozen.rowAt(VISUAL_HISTORY_CHUNK_ROWS - 1).m).toBeCloseTo(
      -(VISUAL_HISTORY_CHUNK_ROWS - 1),
      4
    );
    expect(frozen.rowAt(VISUAL_HISTORY_CHUNK_ROWS).m).toBeCloseTo(-VISUAL_HISTORY_CHUNK_ROWS, 4);
    slab.push(row({ m: -99_999, timestampMs: 99_999 }));
    expect(frozen.length).toBe(VISUAL_HISTORY_CHUNK_ROWS + 1);
  });

  it("stores documented fallbacks for a malformed (undefined/empty) row", () => {
    const slab = new LoudnessHistorySlab(8);
    slab.push(undefined);
    slab.push({});
    for (const index of [0, 1]) {
      const stored = slab.rowAt(index);
      expect(stored.m).toBe(-Infinity);
      expect(stored.st).toBe(-Infinity);
      expect(Array.from(stored.waveformMin)).toEqual([]);
      expect(Array.from(stored.waveformMax)).toEqual([]);
      expect(Array.from(stored.waveformSubPairs)).toEqual([]);
      expect(stored.waveformSubCount).toBe(0);
    }
  });
});
