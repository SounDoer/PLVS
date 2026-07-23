import { describe, expect, it } from "vitest";
import {
  SpectrumHistorySlab,
  FrozenSpectrumHistory,
  EMPTY_SPECTRUM_VIEW,
} from "./SpectrumHistorySlab.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

const bands = [{ fCenter: 100 }, { fCenter: 200 }, { fCenter: 400 }];

describe("SpectrumHistorySlab", () => {
  it("stores rows and returns them in chronological order", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({ bands, dbList: [-10, -20, -30], timestampMs: 1000 });
    slab.push({ bands, dbList: [-11, -21, -31], timestampMs: 1040 });

    expect(slab.length).toBe(2);
    expect(slab.capacity).toBe(4);
    expect(slab.at(0).timestampMs).toBe(1000);
    expect(Array.from(slab.at(0).dbList)).toEqual([-10, -20, -30]);
    expect(slab.at(1).timestampMs).toBe(1040);
    expect(slab.toArray().map((row) => row.timestampMs)).toEqual([1000, 1040]);
  });

  it("retains the exact capacity while advancing through a partial oldest chunk", () => {
    const capacity = VISUAL_HISTORY_CHUNK_ROWS + 3;
    const slab = new SpectrumHistorySlab(capacity, bands);

    for (let i = 0; i < capacity + 7; i += 1) {
      slab.push({ bands, dbList: [i, i + 1, i + 2], timestampMs: i });
    }

    expect(slab.length).toBe(capacity);
    expect(slab.timestampAt(0)).toBe(7);
    expect(slab.timestampAt(capacity - 1)).toBe(capacity + 6);
    expect(slab.storageStats()).toMatchObject({
      chunkCount: 2,
      retainedRows: capacity,
    });
  });

  it("allocates the secondary curve lazily", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({ bands, dbList: [-1, -2, -3], timestampMs: 1 });
    expect(slab.hasSecondary).toBe(false);
    expect(slab.at(0).dbListB.length).toBe(0);

    slab.push({
      bands,
      dbList: [-4, -5, -6],
      dbListB: [-7, -8, -9],
      timestampMs: 2,
    });

    expect(slab.hasSecondary).toBe(true);
    expect(slab.at(0).dbListB.length).toBe(0);
    expect(Array.from(slab.at(1).dbListB)).toEqual([-7, -8, -9]);
  });

  it("fills missing primary values with -Infinity and truncates extras", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({
      bands,
      dbList: [-1],
      dbListB: [-2, Number.NaN],
      timestampMs: Number.NaN,
    });
    slab.push({ bands, dbList: [-2, -3, -4, -5], timestampMs: 2 });

    expect(Array.from(slab.at(0).dbList)).toEqual([-1, -Infinity, -Infinity]);
    expect(Array.from(slab.at(0).dbListB)).toEqual([-2, NaN, NaN]);
    expect(slab.at(0).timestampMs).toBe(-Infinity);
    expect(Array.from(slab.at(1).dbList)).toEqual([-2, -3, -4]);
  });

  it("detects incompatible band grids", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    expect(slab.matchesBands(bands)).toBe(true);
    expect(slab.matchesBands([{ fCenter: 100 }, { fCenter: 300 }, { fCenter: 400 }])).toBe(false);
    expect(slab.matchesBands([{ fCenter: 100 }, { fCenter: 200 }])).toBe(false);
    expect(() =>
      slab.push({
        bands: [{ fCenter: 100 }],
        dbList: [-1],
        timestampMs: 1,
      })
    ).toThrow(/different band grid/);
  });

  it("clear releases chunks and can rebuild on the next push", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({ bands, dbList: [-1, -2, -3], timestampMs: 1 });
    const before = slab.rowAt(0).dbList.buffer;

    slab.clear();

    expect(slab.length).toBe(0);
    expect(slab.storageStats()).toEqual({
      chunkCount: 0,
      retainedRows: 0,
      sharedSealedChunks: 0,
      copiedTailRows: 0,
      copiedTailBytes: 0,
    });

    slab.push({ bands, dbList: [-4, -5, -6], timestampMs: 2 });
    expect(slab.length).toBe(1);
    expect(slab.rowAt(0).dbList.buffer).not.toBe(before);
  });

  it("seals full chunks and appends into a new active chunk", () => {
    const slab = new SpectrumHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 1, bands);

    for (let i = 0; i <= VISUAL_HISTORY_CHUNK_ROWS; i += 1) {
      slab.push({ bands, dbList: [-i, -i, -i], timestampMs: i });
    }

    const first = slab.at(0).dbList;
    const lastInSealed = slab.at(VISUAL_HISTORY_CHUNK_ROWS - 1).dbList;
    const active = slab.at(VISUAL_HISTORY_CHUNK_ROWS).dbList;

    expect(first).toBeInstanceOf(Float32Array);
    expect(first.buffer).toBe(lastInSealed.buffer);
    expect(active.buffer).not.toBe(first.buffer);
    expect(slab.storageStats()).toMatchObject({
      chunkCount: 2,
      retainedRows: VISUAL_HISTORY_CHUNK_ROWS + 1,
    });
  });

  it("exposes version, timestampAt, and rowAt over wrap-around", () => {
    const bands = [{ fCenter: 100 }, { fCenter: 200 }];
    const slab = new SpectrumHistorySlab(2, bands);
    const v0 = slab.version;
    slab.push({ bands, dbList: [-10, -20], timestampMs: 1000 });
    slab.push({ bands, dbList: [-30, -40], timestampMs: 1040 });
    slab.push({ bands, dbList: [-50, -60], timestampMs: 1080 }); // overwrites slot 0

    expect(slab.length).toBe(2);
    expect(slab.version).toBeGreaterThan(v0);
    expect(slab.version).toBe(v0 + 3);
    expect(slab.timestampAt(0)).toBe(1040);
    expect(slab.timestampAt(1)).toBe(1080);
    expect(slab.timestampAt(2)).toBeNaN();
    expect(Array.from(slab.rowAt(0).dbList)).toEqual([-30, -40]);
    expect(slab.rowAt(1).timestampMs).toBe(1080);
    expect(slab.rowAt(5)).toBeUndefined();
  });

  it("freeze() shares sealed chunks, clones the active tail, and survives eviction", () => {
    const slab = new SpectrumHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 2, bands);
    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS + 1; i += 1) {
      slab.push({
        bands,
        dbList: [i, i + 1, i + 2],
        dbListB: i === VISUAL_HISTORY_CHUNK_ROWS ? [i + 3, i + 4, i + 5] : undefined,
        timestampMs: i,
      });
    }

    const frozen = slab.freeze();
    const frozenSealedBuffer = frozen.rowAt(0).dbList.buffer;
    const frozenTailBuffer = frozen.rowAt(VISUAL_HISTORY_CHUNK_ROWS).dbList.buffer;
    const liveTailBuffer = slab.rowAt(VISUAL_HISTORY_CHUNK_ROWS).dbList.buffer;

    expect(frozen).toBeInstanceOf(FrozenSpectrumHistory);
    expect(frozenSealedBuffer).toBe(slab.rowAt(0).dbList.buffer);
    expect(frozenTailBuffer).not.toBe(liveTailBuffer);
    expect(frozen.storageStats()).toMatchObject({
      chunkCount: 2,
      retainedRows: VISUAL_HISTORY_CHUNK_ROWS + 1,
      sharedSealedChunks: 1,
      copiedTailRows: 1,
    });

    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS + 3; i += 1) {
      slab.push({ bands, dbList: [-i, -i, -i], timestampMs: 10_000 + i });
    }

    expect(frozen.timestampAt(0)).toBe(0);
    expect(frozen.timestampAt(VISUAL_HISTORY_CHUNK_ROWS)).toBe(VISUAL_HISTORY_CHUNK_ROWS);
    expect(Array.from(frozen.rowAt(VISUAL_HISTORY_CHUNK_ROWS).dbListB)).toEqual([
      VISUAL_HISTORY_CHUNK_ROWS + 3,
      VISUAL_HISTORY_CHUNK_ROWS + 4,
      VISUAL_HISTORY_CHUNK_ROWS + 5,
    ]);
    expect(frozen.rowAt(0).dbList.buffer).toBe(frozenSealedBuffer);
  });

  it("freeze() copies no payload when the latest chunk is exactly full", () => {
    const slab = new SpectrumHistorySlab(VISUAL_HISTORY_CHUNK_ROWS, bands);
    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS; i += 1) {
      slab.push({ bands, dbList: [i, i, i], timestampMs: i });
    }

    const frozen = slab.freeze();

    expect(frozen.rowAt(0).dbList.buffer).toBe(slab.rowAt(0).dbList.buffer);
    expect(frozen.storageStats()).toEqual({
      chunkCount: 1,
      retainedRows: VISUAL_HISTORY_CHUNK_ROWS,
      sharedSealedChunks: 1,
      copiedTailRows: 0,
      copiedTailBytes: 0,
    });
  });

  it("reports only retained active-tail rows when cloning the full backing", () => {
    const slab = new SpectrumHistorySlab(1, bands);
    for (let i = 0; i < 10; i += 1) {
      slab.push({ bands, dbList: [i, i + 1, i + 2], timestampMs: i });
    }

    const frozen = slab.freeze();

    expect(frozen.length).toBe(1);
    expect(frozen.timestampAt(0)).toBe(9);
    expect(frozen.storageStats()).toMatchObject({
      retainedRows: 1,
      copiedTailRows: 1,
    });
    expect(frozen.storageStats().copiedTailBytes).toBeGreaterThan(0);
  });

  it("freezes a partial oldest sealed chunk, sealed middle, and active tail together", () => {
    const endSequence = VISUAL_HISTORY_CHUNK_ROWS * 2 + 5;
    const capacity = endSequence - 7;
    const slab = new SpectrumHistorySlab(capacity, bands);
    for (let i = 0; i < endSequence; i += 1) {
      slab.push({ bands, dbList: [i, i + 1, i + 2], timestampMs: i });
    }

    const frozen = slab.freeze();
    const lastIndex = capacity - 1;
    const middleIndex = VISUAL_HISTORY_CHUNK_ROWS - 7;
    const liveFirstBuffer = slab.rowAt(0).dbList.buffer;
    const liveMiddleBuffer = slab.rowAt(middleIndex).dbList.buffer;
    const liveTailBuffer = slab.rowAt(lastIndex).dbList.buffer;

    expect(slab.length).toBe(capacity);
    expect(frozen.length).toBe(capacity);
    expect(slab.timestampAt(0)).toBe(7);
    expect(frozen.timestampAt(0)).toBe(7);
    expect(slab.timestampAt(lastIndex)).toBe(endSequence - 1);
    expect(frozen.timestampAt(lastIndex)).toBe(endSequence - 1);
    expect(Array.from(frozen.rowAt(0).dbList)).toEqual([7, 8, 9]);
    expect(Array.from(frozen.rowAt(lastIndex).dbList)).toEqual([
      endSequence - 1,
      endSequence,
      endSequence + 1,
    ]);
    expect(frozen.rowAt(0).dbList.buffer).toBe(liveFirstBuffer);
    expect(frozen.rowAt(middleIndex).dbList.buffer).toBe(liveMiddleBuffer);
    expect(frozen.rowAt(lastIndex).dbList.buffer).not.toBe(liveTailBuffer);
    expect(frozen.storageStats()).toEqual({
      chunkCount: 3,
      retainedRows: capacity,
      sharedSealedChunks: 2,
      copiedTailRows: 5,
      copiedTailBytes: 20_480,
    });

    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS * 2; i += 1) {
      slab.push({ bands, dbList: [-i, -i, -i], timestampMs: 10_000 + i });
    }

    expect(slab.timestampAt(0)).toBe(10_002);
    expect(frozen.timestampAt(0)).toBe(7);
    expect(frozen.timestampAt(lastIndex)).toBe(endSequence - 1);
    expect(Array.from(frozen.rowAt(0).dbList)).toEqual([7, 8, 9]);
    expect(frozen.rowAt(0).dbList.buffer).toBe(liveFirstBuffer);
  });

  it("keeps secondary storage lazy per chunk while hasSecondary stays sticky", () => {
    const slab = new SpectrumHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 1, bands);
    slab.push({ bands, dbList: [1, 2, 3], dbListB: [4, 5, 6], timestampMs: 0 });
    for (let i = 1; i <= VISUAL_HISTORY_CHUNK_ROWS; i += 1) {
      slab.push({ bands, dbList: [i, i, i], timestampMs: i });
    }

    expect(slab.hasSecondary).toBe(true);
    expect(Array.from(slab.rowAt(0).dbListB)).toEqual([4, 5, 6]);
    expect(slab.rowAt(VISUAL_HISTORY_CHUNK_ROWS).dbListB).toHaveLength(0);
    expect(slab.storageStats().chunkCount).toBe(2);
  });

  it("handles small capacities and empty freezes", () => {
    const slab = new SpectrumHistorySlab(1, bands);
    const empty = slab.freeze();

    expect(empty.length).toBe(0);
    expect(empty.version).toBe(0);
    expect(empty.timestampAt(0)).toBeNaN();
    expect(empty.rowAt(0)).toBeUndefined();
    expect(empty.storageStats()).toEqual({
      chunkCount: 0,
      retainedRows: 0,
      sharedSealedChunks: 0,
      copiedTailRows: 0,
      copiedTailBytes: 0,
    });

    slab.push({ bands, dbList: [1], timestampMs: Number.NaN });
    slab.push({ bands, dbList: [2, 3, 4], timestampMs: 2 });
    expect(slab.length).toBe(1);
    expect(slab.timestampAt(0)).toBe(2);
    expect(Array.from(slab.rowAt(0).dbList)).toEqual([2, 3, 4]);
  });

  it("EMPTY_SPECTRUM_VIEW is an empty read-only view", () => {
    expect(EMPTY_SPECTRUM_VIEW.length).toBe(0);
    expect(EMPTY_SPECTRUM_VIEW.timestampAt(0)).toBeNaN();
    expect(EMPTY_SPECTRUM_VIEW.rowAt(0)).toBeUndefined();
  });

  it("honors toArray copyRows without exposing copied buffers", () => {
    const slab = new SpectrumHistorySlab(2, bands);

    slab.push({ bands, dbList: [1, 2, 3], timestampMs: 1 });
    slab.push({ bands, dbList: [4, 5, 6], timestampMs: 2 });

    const live = slab.toArray();
    const frozen = slab.toArray({ copyRows: true });

    expect(live[0].dbList.buffer).toBe(slab.rowAt(0).dbList.buffer);
    expect(frozen[0].dbList.buffer).not.toBe(live[0].dbList.buffer);
    live[0].dbList[0] = 99;

    expect(Array.from(slab.rowAt(0).dbList)).toEqual([99, 2, 3]);
    expect(Array.from(frozen[0].dbList)).toEqual([1, 2, 3]);
  });

  it("queries internal and cross-chunk timestamp gaps while clipping the logical range", () => {
    const rowCount = VISUAL_HISTORY_CHUNK_ROWS * 2 + 4;
    const slab = new SpectrumHistorySlab(rowCount - 3, []);
    let timestampMs = 0;
    for (let index = 0; index < rowCount; index += 1) {
      if (index === VISUAL_HISTORY_CHUNK_ROWS - 2) timestampMs += 400;
      if (index === VISUAL_HISTORY_CHUNK_ROWS) timestampMs += 800;
      slab.push({ bands: [], dbList: [], timestampMs });
      timestampMs += 40;
    }

    const internalGapIndex = VISUAL_HISTORY_CHUNK_ROWS - 2 - 3;
    expect(slab.timestampGapBoundaries(0, slab.length - 1, 72)).toEqual([
      {
        previousTimestampMs: slab.timestampAt(internalGapIndex - 1),
        nextTimestampMs: slab.timestampAt(internalGapIndex),
      },
      {
        previousTimestampMs: slab.timestampAt(VISUAL_HISTORY_CHUNK_ROWS - 1 - 3),
        nextTimestampMs: slab.timestampAt(VISUAL_HISTORY_CHUNK_ROWS - 3),
      },
    ]);
    expect(slab.lastGapQueryStats()).toMatchObject({
      chunksInspected: 3,
      rowsScanned: VISUAL_HISTORY_CHUNK_ROWS - 3,
    });

    expect(slab.timestampGapBoundaries(internalGapIndex + 1, slab.length - 1, 72)).toEqual([
      {
        previousTimestampMs: slab.timestampAt(VISUAL_HISTORY_CHUNK_ROWS - 1 - 3),
        nextTimestampMs: slab.timestampAt(VISUAL_HISTORY_CHUNK_ROWS - 3),
      },
    ]);

    const frozen = slab.freeze();
    expect(frozen.timestampGapBoundaries(0, frozen.length - 1, 72)).toEqual(
      slab.timestampGapBoundaries(0, slab.length - 1, 72)
    );
  });

  it("treats non-finite timestamps symmetrically on both sides of a gap query", () => {
    const slab = new SpectrumHistorySlab(5, []);
    for (const timestampMs of [1000, 1040, Number.NaN, 1120, 1200]) {
      slab.push({ bands: [], dbList: [], timestampMs });
    }

    expect(slab.timestampGapBoundaries(0, slab.length - 1, 72)).toEqual([
      { previousTimestampMs: 1120, nextTimestampMs: 1200 },
    ]);
    expect(slab.lastGapQueryStats()).toEqual({
      chunksInspected: 1,
      rowsScanned: 5,
    });
    expect(slab.freeze().timestampGapBoundaries(0, slab.length - 1, 72)).toEqual([
      { previousTimestampMs: 1120, nextTimestampMs: 1200 },
    ]);
  });

  it("uses a strict threshold for timestamp gap boundaries", () => {
    const slab = new SpectrumHistorySlab(3, []);
    for (const timestampMs of [1000, 1072, 1145]) {
      slab.push({ bands: [], dbList: [], timestampMs });
    }

    expect(slab.timestampGapBoundaries(0, slab.length - 1, 72)).toEqual([
      { previousTimestampMs: 1072, nextTimestampMs: 1145 },
    ]);
  });

  it("skips row scans for 240 minutes of continuous zero-band timestamps", () => {
    const rowCount = 360_000;
    const slab = new SpectrumHistorySlab(rowCount, []);
    for (let index = 0; index < rowCount; index += 1) {
      slab.push({ bands: [], dbList: [], timestampMs: index * 40 });
    }

    expect(slab.timestampGapBoundaries(0, slab.length - 1, 72)).toEqual([]);
    expect(slab.lastGapQueryStats()).toEqual({
      chunksInspected: Math.ceil(rowCount / VISUAL_HISTORY_CHUNK_ROWS),
      rowsScanned: 0,
    });
    expect(slab.freeze().timestampGapBoundaries(0, slab.length - 1, 72)).toEqual([]);
  });
});
