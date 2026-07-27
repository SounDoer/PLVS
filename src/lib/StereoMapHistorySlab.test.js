import { describe, expect, it } from "vitest";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { STEREO_MAP_MODES } from "../math/stereoMapMath.js";
import {
  accumulateStereoMapHold,
  createStereoMapHoldSummary,
  stereoMapHoldValues,
} from "../math/stereoMapHold.js";
import {
  FrozenStereoMapHistory,
  HOLD_CHECKPOINT_STRIDE,
  MAX_STEREO_MAP_HISTORY_ROWS,
  StereoMapHistorySlab,
} from "./StereoMapHistorySlab.js";

const centers = [62.5000001, 125.0000001, 250.0000001];

function appendRow(slab, index, overrides = {}) {
  slab.append({
    timestampMs: 1_000_000_000_000.125 + index * 40.25,
    sampleRateHz: 48_000,
    bandCentersHz: centers,
    pl: [index + 0.1, index + 0.2, index + 0.3],
    pr: [index + 0.4, index + 0.5, index + 0.6],
    c: [index - 0.1, index - 0.2, index - 0.3],
    ...overrides,
  });
}

function f32(values) {
  return Array.from(Float32Array.from(values));
}

function appendHoldRow(slab, index, { pl = 1, pr = 1, c = 0, ...overrides } = {}) {
  appendRow(slab, index, {
    bandCentersHz: [100],
    pl: [pl],
    pr: [pr],
    c: [c],
    ...overrides,
  });
}

describe("StereoMapHistorySlab", () => {
  it("exports the typed history constructor", () => {
    expect(StereoMapHistorySlab).toBeTypeOf("function");
  });

  it("stores Float64 timestamps and Float32 metadata and primitive planes", () => {
    const slab = new StereoMapHistorySlab(4);
    appendRow(slab, 0);

    const row = slab.rowAt(0);
    expect(slab.length).toBe(1);
    expect(slab.timestampAt(0)).toBe(1_000_000_000_000.125);
    expect(row.timestampMs).toBe(1_000_000_000_000.125);
    expect(row.sampleRateHz).toBe(48_000);
    expect(row.bandCentersHz).toBeInstanceOf(Float32Array);
    expect(row.pl).toBeInstanceOf(Float32Array);
    expect(row.pr).toBeInstanceOf(Float32Array);
    expect(row.c).toBeInstanceOf(Float32Array);
    expect(Array.from(row.bandCentersHz)).toEqual(f32(centers));
    expect(Array.from(row.pl)).toEqual(f32([0.1, 0.2, 0.3]));
    expect(Array.from(row.pr)).toEqual(f32([0.4, 0.5, 0.6]));
    expect(Array.from(row.c)).toEqual(f32([-0.1, -0.2, -0.3]));
    expect(slab.timestampAt(-1)).toBeNaN();
    expect(slab.timestampAt(1)).toBeNaN();
    expect(slab.rowAt(1)).toBeUndefined();
  });

  it("preserves every row exactly under Float32 storage semantics", () => {
    const slab = new StereoMapHistorySlab(3);
    appendRow(slab, 0, {
      pl: [1 / 3, 1 / 7, Number.MIN_VALUE],
      pr: [Math.PI, Math.E, -0],
      c: [-1 / 3, -1 / 7, 0.99999999],
    });
    appendRow(slab, 1);

    expect(Array.from(slab.rowAt(0).pl)).toEqual(f32([1 / 3, 1 / 7, Number.MIN_VALUE]));
    expect(Array.from(slab.rowAt(0).pr)).toEqual(f32([Math.PI, Math.E, -0]));
    expect(Array.from(slab.rowAt(0).c)).toEqual(f32([-1 / 3, -1 / 7, 0.99999999]));
    expect(Array.from(slab.rowAt(1).pl)).toEqual(f32([1.1, 1.2, 1.3]));
  });

  it("rejects values that overflow during Float32 conversion without changing history", () => {
    const slab = new StereoMapHistorySlab(3);
    appendRow(slab, 0);
    const before = slab.rowAt(0);

    expect(() =>
      appendRow(slab, 1, {
        bandCentersHz: [centers[0], Number.MAX_VALUE, centers[2]],
      })
    ).toThrow(/finite/);
    expect(() =>
      appendRow(slab, 1, {
        pl: [1, Number.MAX_VALUE, 3],
      })
    ).toThrow(/finite/);

    expect(slab.length).toBe(1);
    expect(slab.rowAt(0)).toEqual(before);
  });

  it("validates an incompatible throwing row before replacing compatible history", () => {
    const slab = new StereoMapHistorySlab(3);
    appendRow(slab, 0);
    const before = slab.rowAt(0);
    const throwingPlane = new Proxy([1, 2, 3], {
      get(target, property, receiver) {
        if (property === "1") throw new Error("primitive read failed");
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() =>
      appendRow(slab, 1, {
        sampleRateHz: 96_000,
        bandCentersHz: [80, 160, 320],
        pl: throwingPlane,
      })
    ).toThrow("primitive read failed");

    expect(slab.length).toBe(1);
    expect(slab.sampleRateHz).toBe(48_000);
    expect(slab.rowAt(0)).toEqual(before);
    expect(slab.storageStats().gridCopies).toBe(1);
  });

  it("reads each append value once before committing an incompatible row", () => {
    const slab = new StereoMapHistorySlab(3);
    appendRow(slab, 0);
    const reads = new Map();
    const readOncePlane = new Proxy([4, 5, 6], {
      get(target, property, receiver) {
        if (/^\d+$/.test(String(property))) {
          const count = (reads.get(property) ?? 0) + 1;
          reads.set(property, count);
          if (count > 1) throw new Error("primitive read twice");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() =>
      appendRow(slab, 1, {
        sampleRateHz: 96_000,
        bandCentersHz: [80, 160, 320],
        pl: readOncePlane,
      })
    ).not.toThrow();
    expect(slab.length).toBe(1);
    expect(slab.sampleRateHz).toBe(96_000);
    expect(Array.from(slab.rowAt(0).pl)).toEqual([4, 5, 6]);
    expect(Array.from(reads.values())).toEqual([1, 1, 1]);
  });

  it("does not expose mutable typed-array backing storage through row views", () => {
    const slab = new StereoMapHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 1);
    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS; i += 1) appendRow(slab, i);
    const frozen = slab.freeze();

    const row = slab.rowAt(0);
    row.bandCentersHz[0] = 999;
    row.pl[0] = 999;
    row.pr[0] = 999;
    row.c[0] = 999;
    slab._bandCentersHz?.fill(999);
    slab._chunks?.[0]?.pl.fill(999);
    frozen._bandCentersHz?.fill(999);
    frozen._chunks?.[0]?.pl.fill(999);

    expect(Object.getOwnPropertyNames(slab)).toEqual([]);
    expect(Object.getOwnPropertyNames(frozen)).toEqual([]);
    expect(slab.rowAt(0).bandCentersHz[0]).toBe(Math.fround(centers[0]));
    expect(slab.rowAt(0).pl[0]).toBe(Math.fround(0.1));
    expect(slab.rowAt(0).pr[0]).toBe(Math.fround(0.4));
    expect(slab.rowAt(0).c[0]).toBe(Math.fround(-0.1));
    expect(frozen.rowAt(0).bandCentersHz[0]).toBe(Math.fround(centers[0]));
    expect(frozen.rowAt(0).pl[0]).toBe(Math.fround(0.1));
  });

  it("does not expose per-row objects, JavaScript arrays, or typed backing planes", () => {
    const slab = new StereoMapHistorySlab(2);
    appendRow(slab, 0);

    expect(Object.keys(slab)).toEqual([]);
    expect(Object.values(slab)).toEqual([]);
    expect(slab.rows).toBeUndefined();
    expect(slab._chunks).toBeUndefined();
    expect(slab._bandCentersHz).toBeUndefined();
  });

  it("reports typed-plane layout and allocated versus used bytes for sealed and active chunks", () => {
    const rowCount = VISUAL_HISTORY_CHUNK_ROWS + 1;
    const slab = new StereoMapHistorySlab(rowCount);
    for (let i = 0; i < rowCount; i += 1) appendRow(slab, i);

    const liveStats = slab.storageStats();
    expect(liveStats.arrayTypes).toEqual({
      timestamps: "Float64Array",
      bandCenters: "Float32Array",
      primitives: {
        pl: "Float32Array",
        pr: "Float32Array",
        c: "Float32Array",
      },
    });
    // Two chunks are live: one sealed (VISUAL_HISTORY_CHUNK_ROWS rows) and one active (1 row).
    // The Hold index is a fixed-size per-band summary, not a per-row buffer, so it is the same
    // size whether counted as allocated or used. Only the active chunk (index 1) carries a
    // cached Hold prefix — index 0 (the front chunk) never caches one (see
    // `attachHoldPrefixBefore`), so with exactly two chunks there is exactly one prefix's worth.
    const summaryBytes = centers.length * (5 * Float64Array.BYTES_PER_ELEMENT + 4);
    const holdIndexBytes = summaryBytes * 2;
    const holdPrefixBytes = summaryBytes;
    // Only the sealed chunk carries checkpoints: one per full stride except the last, which the
    // whole-chunk summary already covers. The active chunk holds a single row, short of a stride.
    const holdCheckpointBytes =
      summaryBytes * (VISUAL_HISTORY_CHUNK_ROWS / HOLD_CHECKPOINT_STRIDE - 1);
    expect(liveStats.allocatedBytes).toEqual({
      timestamps: VISUAL_HISTORY_CHUNK_ROWS * 2 * Float64Array.BYTES_PER_ELEMENT,
      bandCenters: centers.length * Float32Array.BYTES_PER_ELEMENT,
      pl: VISUAL_HISTORY_CHUNK_ROWS * 2 * centers.length * Float32Array.BYTES_PER_ELEMENT,
      pr: VISUAL_HISTORY_CHUNK_ROWS * 2 * centers.length * Float32Array.BYTES_PER_ELEMENT,
      c: VISUAL_HISTORY_CHUNK_ROWS * 2 * centers.length * Float32Array.BYTES_PER_ELEMENT,
      holdIndex: holdIndexBytes,
      holdCheckpoints: holdCheckpointBytes,
      holdPrefix: holdPrefixBytes,
      total:
        VISUAL_HISTORY_CHUNK_ROWS * 2 * Float64Array.BYTES_PER_ELEMENT +
        centers.length * Float32Array.BYTES_PER_ELEMENT +
        VISUAL_HISTORY_CHUNK_ROWS * 2 * centers.length * Float32Array.BYTES_PER_ELEMENT * 3 +
        holdIndexBytes +
        holdCheckpointBytes +
        holdPrefixBytes,
    });
    expect(liveStats.usedBytes).toEqual({
      timestamps: rowCount * Float64Array.BYTES_PER_ELEMENT,
      bandCenters: centers.length * Float32Array.BYTES_PER_ELEMENT,
      pl: rowCount * centers.length * Float32Array.BYTES_PER_ELEMENT,
      pr: rowCount * centers.length * Float32Array.BYTES_PER_ELEMENT,
      c: rowCount * centers.length * Float32Array.BYTES_PER_ELEMENT,
      holdIndex: holdIndexBytes,
      holdCheckpoints: holdCheckpointBytes,
      holdPrefix: holdPrefixBytes,
      total:
        rowCount * Float64Array.BYTES_PER_ELEMENT +
        centers.length * Float32Array.BYTES_PER_ELEMENT +
        rowCount * centers.length * Float32Array.BYTES_PER_ELEMENT * 3 +
        holdIndexBytes +
        holdCheckpointBytes +
        holdPrefixBytes,
    });

    const frozenStats = slab.freeze().storageStats();
    expect(frozenStats.arrayTypes).toEqual(liveStats.arrayTypes);
    expect(frozenStats.allocatedBytes).toEqual(frozenStats.usedBytes);
    expect(frozenStats.usedBytes).toEqual(liveStats.usedBytes);

    liveStats.arrayTypes.primitives.pl = "Array";
    liveStats.allocatedBytes.pl = 0;
    liveStats.usedBytes.total = 0;
    expect(slab.storageStats().arrayTypes.primitives.pl).toBe("Float32Array");
    expect(slab.storageStats().allocatedBytes.pl).toBeGreaterThan(0);
    expect(slab.storageStats().usedBytes.total).toBeGreaterThan(0);
  });

  it("reuses canonicalization scratch and copies the grid only on successful compatibility changes", () => {
    const slab = new StereoMapHistorySlab(6);
    expect(slab.storageStats()).toMatchObject({
      gridCopies: 0,
      workingBytes: { centers: 0, pl: 0, pr: 0, c: 0, total: 0 },
    });

    appendRow(slab, 0);
    const firstStats = slab.storageStats();
    expect(firstStats.gridCopies).toBe(1);
    expect(firstStats.workingBytes).toEqual({
      centers: centers.length * Float32Array.BYTES_PER_ELEMENT,
      pl: centers.length * Float32Array.BYTES_PER_ELEMENT,
      pr: centers.length * Float32Array.BYTES_PER_ELEMENT,
      c: centers.length * Float32Array.BYTES_PER_ELEMENT,
      holdDerivation: centers.length * 6 * Float64Array.BYTES_PER_ELEMENT,
      total:
        centers.length * Float32Array.BYTES_PER_ELEMENT * 4 +
        centers.length * 6 * Float64Array.BYTES_PER_ELEMENT,
    });

    for (let i = 1; i < 5; i += 1) appendRow(slab, i);
    expect(slab.storageStats().gridCopies).toBe(1);
    expect(slab.storageStats().workingBytes).toEqual(firstStats.workingBytes);

    expect(() =>
      appendRow(slab, 5, {
        bandCentersHz: [80, Number.MAX_VALUE, 320],
      })
    ).toThrow(/finite/);
    expect(slab.storageStats().gridCopies).toBe(1);
    expect(slab.length).toBe(5);

    appendRow(slab, 5, {
      sampleRateHz: 96_000,
      bandCentersHz: [80, 160, 320],
    });
    expect(slab.storageStats().gridCopies).toBe(2);
    expect(slab.length).toBe(1);
  });

  it("shares sealed chunks and copies only the exact active tail on freeze", () => {
    const slab = new StereoMapHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 2);
    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS + 1; i += 1) appendRow(slab, i);

    const frozen = slab.freeze();
    const repeated = slab.freeze();

    expect(frozen).toBeInstanceOf(FrozenStereoMapHistory);
    expect(frozen.storageStats()).toMatchObject({
      chunkCount: 2,
      retainedRows: VISUAL_HISTORY_CHUNK_ROWS + 1,
      sharedSealedChunks: 1,
      copiedTailRows: 1,
      copiedTailBytes:
        8 + centers.length * 3 * 4 + centers.length * (5 * Float64Array.BYTES_PER_ELEMENT + 4),
    });
    expect(repeated.storageStats()).toEqual(frozen.storageStats());
    expect(repeated.rowAt(0)).toEqual(frozen.rowAt(0));

    appendRow(slab, VISUAL_HISTORY_CHUNK_ROWS + 1);
    expect(frozen.length).toBe(VISUAL_HISTORY_CHUNK_ROWS + 1);
    expect(frozen.timestampAt(VISUAL_HISTORY_CHUNK_ROWS)).toBe(
      1_000_000_000_000.125 + VISUAL_HISTORY_CHUNK_ROWS * 40.25
    );
    expect(Array.from(frozen.rowAt(VISUAL_HISTORY_CHUNK_ROWS).pl)).toEqual(
      f32([
        VISUAL_HISTORY_CHUNK_ROWS + 0.1,
        VISUAL_HISTORY_CHUNK_ROWS + 0.2,
        VISUAL_HISTORY_CHUNK_ROWS + 0.3,
      ])
    );
  });

  it("freezes full chunks without copying payload", () => {
    const slab = new StereoMapHistorySlab(VISUAL_HISTORY_CHUNK_ROWS);
    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS; i += 1) appendRow(slab, i);

    const frozen = slab.freeze();

    expect(frozen.storageStats()).toMatchObject({
      chunkCount: 1,
      retainedRows: VISUAL_HISTORY_CHUNK_ROWS,
      sharedSealedChunks: 1,
      copiedTailRows: 0,
      copiedTailBytes: 0,
    });
  });

  it("evicts a logical prefix without copying the retained chunk payload", () => {
    const capacity = VISUAL_HISTORY_CHUNK_ROWS + 3;
    const slab = new StereoMapHistorySlab(capacity);
    for (let i = 0; i < capacity + 7; i += 1) appendRow(slab, i);

    expect(slab.length).toBe(capacity);
    expect(slab.timestampAt(0)).toBe(1_000_000_000_000.125 + 7 * 40.25);
    expect(Array.from(slab.rowAt(0).pl)).toEqual(f32([7.1, 7.2, 7.3]));
    expect(slab.storageStats()).toMatchObject({ chunkCount: 2, retainedRows: capacity });

    const frozen = slab.freeze();
    expect(frozen.storageStats().sharedSealedChunks).toBe(1);
    expect(frozen.timestampAt(0)).toBe(slab.timestampAt(0));
  });

  it("starts fresh storage when sample rate or Float32 grid compatibility changes", () => {
    const slab = new StereoMapHistorySlab(4);
    appendRow(slab, 0);

    appendRow(slab, 1, {
      bandCentersHz: centers.map((value) => value + 1e-10),
    });
    expect(slab.length).toBe(2);

    appendRow(slab, 2, { sampleRateHz: 96_000 });
    expect(slab.length).toBe(1);
    expect(slab.sampleRateHz).toBe(96_000);

    appendRow(slab, 3, {
      sampleRateHz: 96_000,
      bandCentersHz: [80, 160, 320],
    });
    expect(slab.length).toBe(1);
    expect(Array.from(slab.rowAt(0).bandCentersHz)).toEqual([80, 160, 320]);
    expect(slab.timestampAt(0)).toBe(1_000_000_000_000.125 + 3 * 40.25);
  });

  it("validates public input and caps visual retention at four hours", () => {
    expect(() => new StereoMapHistorySlab(0)).toThrow(/capacity/);
    expect(() => new StereoMapHistorySlab(MAX_STEREO_MAP_HISTORY_ROWS + 1)).toThrow(/four hours/);

    const slab = new StereoMapHistorySlab(2);
    expect(() =>
      appendRow(slab, 0, {
        pl: [1],
      })
    ).toThrow(/plane lengths/);
    expect(slab.length).toBe(0);
    expect(() => appendRow(slab, 0, { timestampMs: Number.NaN })).toThrow(/timestamp/);
    expect(() => appendRow(slab, 0, { c: [0, Number.NaN, 0] })).toThrow(/finite/);
  });

  it("rejects missing and NaN sample rates without changing storage", () => {
    const slab = new StereoMapHistorySlab(2);

    expect(() => appendRow(slab, 0, { sampleRateHz: undefined })).toThrow(/sample rate/);
    expect(() => appendRow(slab, 0, { sampleRateHz: Number.NaN })).toThrow(/sample rate/);
    expect(slab.length).toBe(0);
  });

  it("freezes an empty slab", () => {
    const frozen = new StereoMapHistorySlab(2).freeze();

    expect(() => new FrozenStereoMapHistory({})).toThrow(/direct construction/);
    expect(frozen.length).toBe(0);
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

  it("keeps a sealed snapshot unchanged while live appends and evicts", () => {
    const slab = new StereoMapHistorySlab(VISUAL_HISTORY_CHUNK_ROWS);
    for (let i = 0; i < VISUAL_HISTORY_CHUNK_ROWS; i += 1) appendRow(slab, i);
    const frozen = slab.freeze();
    const first = frozen.rowAt(0);
    const last = frozen.rowAt(frozen.length - 1);

    for (let i = VISUAL_HISTORY_CHUNK_ROWS; i < VISUAL_HISTORY_CHUNK_ROWS * 2 + 1; i += 1) {
      appendRow(slab, i);
    }

    expect(frozen.length).toBe(VISUAL_HISTORY_CHUNK_ROWS);
    expect(frozen.rowAt(0)).toEqual(first);
    expect(frozen.rowAt(frozen.length - 1)).toEqual(last);
    expect(slab.timestampAt(0)).toBe(
      1_000_000_000_000.125 + (VISUAL_HISTORY_CHUNK_ROWS + 1) * 40.25
    );
  });

  it("drops a fully evicted chunk at the exact retention boundary", () => {
    const slab = new StereoMapHistorySlab(1);
    for (let i = 0; i <= VISUAL_HISTORY_CHUNK_ROWS; i += 1) appendRow(slab, i);

    expect(slab.length).toBe(1);
    expect(slab.storageStats()).toMatchObject({ chunkCount: 1, retainedRows: 1 });
    expect(slab.timestampAt(0)).toBe(1_000_000_000_000.125 + VISUAL_HISTORY_CHUNK_ROWS * 40.25);
  });

  it("merges exact sealed summaries for every mode and scans only the target partial chunk", () => {
    const slab = new StereoMapHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 4);
    appendHoldRow(slab, 0, { pl: 0, pr: 1 });
    appendHoldRow(slab, 1, { pl: 1, pr: 0 });
    appendHoldRow(slab, 2, { c: -1 });
    for (let index = 3; index < VISUAL_HISTORY_CHUNK_ROWS; index += 1) {
      appendHoldRow(slab, index);
    }
    appendHoldRow(slab, VISUAL_HISTORY_CHUNK_ROWS, { pl: 9, pr: 1 });
    appendHoldRow(slab, VISUAL_HISTORY_CHUNK_ROWS + 1, { pl: 1, pr: 9 });
    appendHoldRow(slab, VISUAL_HISTORY_CHUNK_ROWS + 2, { c: 1 });

    const result = slab.holdAt(VISUAL_HISTORY_CHUNK_ROWS + 1, slab.epoch);

    expect(result.values[STEREO_MAP_MODES.POSITION]).toEqual({
      minimum: [-1],
      maximum: [1],
    });
    expect(result.values[STEREO_MAP_MODES.CORRELATION]).toEqual([-1]);
    expect(result.values[STEREO_MAP_MODES.MONO_LOSS_DB]).toEqual([-Infinity]);
    expect(result.values[STEREO_MAP_MODES.MS_RATIO_DB]).toEqual([Infinity]);
    expect(result.stats).toEqual({ mergedChunks: 1, mergedCheckpoints: 0, scannedRows: 2 });
  });

  it("does not let future rows contribute to a historical Hold query", () => {
    const slab = new StereoMapHistorySlab(4);
    appendHoldRow(slab, 0);
    appendHoldRow(slab, 1, { c: -1 });

    const result = slab.holdAt(0, slab.epoch);

    expect(result.values[STEREO_MAP_MODES.CORRELATION]).toEqual([0]);
    expect(result.values[STEREO_MAP_MODES.MONO_LOSS_DB][0]).toBeCloseTo(10 * Math.log10(0.5));
    expect(result.stats).toEqual({ mergedChunks: 0, mergedCheckpoints: 0, scannedRows: 1 });
  });

  it("lets the oldest chunk's evicted prefix keep contributing, exactly as liveHoldValues does", () => {
    // Deliberate: the front chunk is merged whole rather than re-scanned from the retention
    // boundary. Re-scanning it was the one remaining unbounded term in a Hold query (up to a full
    // chunk of rows on every scrub tick once retention fills), and it bought a precision that
    // `liveHoldValues` never had — it has always merged chunks[0].holdSummary whole, evicted
    // prefix included. Historical Hold now carries the same, bounded slop as live Hold instead of
    // disagreeing with it. Fully evicted chunks are still dropped outright, so the slop can never
    // exceed the oldest retained chunk.
    const capacity = VISUAL_HISTORY_CHUNK_ROWS + 2;
    const slab = new StereoMapHistorySlab(capacity);
    appendHoldRow(slab, 0, { c: -1 });
    for (let index = 1; index < VISUAL_HISTORY_CHUNK_ROWS + 5; index += 1) {
      appendHoldRow(slab, index);
    }

    const result = slab.holdAt(slab.length - 1, slab.epoch);

    expect(result.values[STEREO_MAP_MODES.CORRELATION]).toEqual([-1]);
    expect(slab.liveHoldValues()[STEREO_MAP_MODES.CORRELATION]).toEqual([-1]);
    expect(result.stats.scannedRows).toBeLessThan(HOLD_CHECKPOINT_STRIDE);
  });

  it("does not resurrect an evicted chunk's extremum through the cached prefix", () => {
    // Retain at most 3 chunks so a post-eviction query still lands on a chunk whose index is
    // >= 2 — the branch that reads the cached prefix instead of re-scanning every earlier chunk.
    const capacity = VISUAL_HISTORY_CHUNK_ROWS * 3;
    const slab = new StereoMapHistorySlab(capacity);
    appendHoldRow(slab, 0, { c: -1 }); // the chunk holding this row gets fully evicted below.
    for (let index = 1; index < VISUAL_HISTORY_CHUNK_ROWS; index += 1) appendHoldRow(slab, index);
    // Seal three more full chunks so the very first chunk (holding the c: -1 extreme) is
    // entirely outside retention, and the cached prefix for the newest chunks gets rebuilt
    // without it.
    for (let index = VISUAL_HISTORY_CHUNK_ROWS; index < VISUAL_HISTORY_CHUNK_ROWS * 5; index += 1) {
      appendHoldRow(slab, index);
    }

    const result = slab.holdAt(slab.length - 1, slab.epoch);

    expect(result.values[STEREO_MAP_MODES.CORRELATION]).toEqual([0]);
  });

  it("excludes a later sealed chunk's extremum from an older cached historical query", () => {
    const capacity = VISUAL_HISTORY_CHUNK_ROWS * 4;
    const slab = new StereoMapHistorySlab(capacity);
    for (let index = 0; index < VISUAL_HISTORY_CHUNK_ROWS * 3; index += 1)
      appendHoldRow(slab, index);
    // Seal a fourth chunk whose extreme (c: -1) must never leak backward into an older query,
    // even though the query below targets a chunk whose prefix is served from the cache.
    for (
      let index = VISUAL_HISTORY_CHUNK_ROWS * 3;
      index < VISUAL_HISTORY_CHUNK_ROWS * 4;
      index += 1
    ) {
      appendHoldRow(slab, index, index === VISUAL_HISTORY_CHUNK_ROWS * 3 ? { c: -1 } : {});
    }

    const target = VISUAL_HISTORY_CHUNK_ROWS * 3 - 1; // last row of the third chunk (index 2)
    const result = slab.holdAt(target, slab.epoch);

    expect(result.values[STEREO_MAP_MODES.CORRELATION]).toEqual([0]);
    // Also confirm this query actually took the cached-prefix branch (index 2's prefix covers
    // the second chunk), not just a lucky scan that happened to avoid the fourth chunk.
    expect(result.stats.mergedChunks).toBeGreaterThan(0);
  });

  it("keeps holdAt's merge/scan work bounded as more chunks seal, instead of growing with chunk count", () => {
    // Before the prefix cache, holdAt merged every earlier retained chunk from scratch on every
    // call, so mergedChunks grew with the chunk count (5 whole chunks would precede the target
    // here). With the cache, the work preceding the target chunk collapses to one prefix lookup
    // plus the bounded front-chunk contribution, regardless of how many chunks sealed before it.
    const chunkCount = 6;
    const capacity = VISUAL_HISTORY_CHUNK_ROWS * chunkCount;
    const slab = new StereoMapHistorySlab(capacity);
    for (let index = 0; index < capacity; index += 1) appendHoldRow(slab, index);

    const result = slab.holdAt(capacity - 1, slab.epoch);

    expect(result.stats.mergedChunks).toBeLessThanOrEqual(3);
    expect(result.stats.scannedRows).toBeLessThanOrEqual(VISUAL_HISTORY_CHUNK_ROWS);
  });

  it("bounds a Hold query landing mid-chunk to one checkpoint merge plus under a stride of rows", () => {
    // The cached per-chunk prefix only collapses the chunks *before* the target's own chunk; the
    // target's position inside that chunk was still re-scanned row by row, so scrubbing to a row
    // near the end of a sealed chunk cost a full chunk's worth of derivation (~1000 rows).
    const capacity = VISUAL_HISTORY_CHUNK_ROWS * 3;
    const slab = new StereoMapHistorySlab(capacity);
    for (let index = 0; index < capacity; index += 1) appendHoldRow(slab, index);

    // One row short of the chunk boundary: the worst case, and no rarer than any other landing.
    const result = slab.holdAt(VISUAL_HISTORY_CHUNK_ROWS * 2 - 2, slab.epoch);

    expect(result.stats.mergedCheckpoints).toBe(1);
    expect(result.stats.scannedRows).toBeLessThan(HOLD_CHECKPOINT_STRIDE);
  });

  it("resolves a mid-chunk Hold query to the same values a linear rescan produces", () => {
    const capacity = VISUAL_HISTORY_CHUNK_ROWS * 2;
    const slab = new StereoMapHistorySlab(capacity);
    for (let index = 0; index < capacity; index += 1) {
      // Scatter each mode's extremes across rows rather than parking them on one edge row, so a
      // checkpoint that silently dropped rows would change the answer.
      appendHoldRow(slab, index, {
        pl: 1 + (index % 7) / 10,
        pr: 1 + (index % 5) / 10,
        c: ((index % 11) - 5) / 20,
      });
    }
    const target = VISUAL_HISTORY_CHUNK_ROWS + 300;

    const reference = createStereoMapHoldSummary(1);
    for (let index = 0; index <= target; index += 1) {
      accumulateStereoMapHold(reference, slab.rowAt(index));
    }

    expect(slab.holdAt(target, slab.epoch).values).toEqual(stereoMapHoldValues(reference));
  });

  it("merges every chunk's already-maintained Hold summary for liveHoldValues, across a chunk boundary", () => {
    const slab = new StereoMapHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 4);
    appendHoldRow(slab, 0, { pl: 0, pr: 1 }); // seals into chunk 0: Position minimum -1
    for (let index = 1; index < VISUAL_HISTORY_CHUNK_ROWS; index += 1) {
      appendHoldRow(slab, index);
    }
    appendHoldRow(slab, VISUAL_HISTORY_CHUNK_ROWS, { pl: 1, pr: 0 }); // active chunk: Position max +1

    const live = slab.liveHoldValues();

    expect(live[STEREO_MAP_MODES.POSITION]).toEqual({ minimum: [-1], maximum: [1] });
  });

  it("still merges every retained chunk for liveHoldValues across many sealed chunk boundaries", () => {
    const chunkCount = 5;
    const slab = new StereoMapHistorySlab(VISUAL_HISTORY_CHUNK_ROWS * chunkCount + 1);
    appendHoldRow(slab, 0, { pl: 0, pr: 1 }); // chunk 0: Position minimum -1
    for (let index = 1; index < VISUAL_HISTORY_CHUNK_ROWS * chunkCount - 1; index += 1) {
      appendHoldRow(slab, index);
    }
    appendHoldRow(slab, VISUAL_HISTORY_CHUNK_ROWS * chunkCount - 1, { pl: 1, pr: 0 }); // last sealed chunk: Position max +1

    const live = slab.liveHoldValues();

    expect(live[STEREO_MAP_MODES.POSITION]).toEqual({ minimum: [-1], maximum: [1] });
  });

  it("returns null for liveHoldValues before any row has been appended", () => {
    const slab = new StereoMapHistorySlab(4);

    expect(slab.liveHoldValues()).toBeNull();
  });

  it("starts a new Hold epoch on clear and frozen histories retain their epoch", () => {
    const slab = new StereoMapHistorySlab(4);
    appendHoldRow(slab, 0, { c: -1 });
    const oldEpoch = slab.epoch;
    const frozen = slab.freeze();

    slab.clear();
    appendHoldRow(slab, 1);

    expect(slab.epoch).toBe(oldEpoch + 1);
    expect(slab.holdAt(0, oldEpoch)).toBeNull();
    expect(slab.holdAt(0, slab.epoch).values[STEREO_MAP_MODES.CORRELATION]).toEqual([0]);
    expect(frozen.epoch).toBe(oldEpoch);
    expect(frozen.holdAt(0, oldEpoch).values[STEREO_MAP_MODES.CORRELATION]).toEqual([-1]);
  });

  it("floors timestamp Hold queries without including the nearest future row", () => {
    const slab = new StereoMapHistorySlab(4);
    appendHoldRow(slab, 0, { timestampMs: 20 });
    appendHoldRow(slab, 1, { timestampMs: 40, c: -1 });

    expect(slab.holdAtOrBeforeTimestamp(10, slab.epoch)).toBeNull();
    expect(
      slab.holdAtOrBeforeTimestamp(30, slab.epoch).values[STEREO_MAP_MODES.CORRELATION]
    ).toEqual([0]);
    expect(
      slab.holdAtOrBeforeTimestamp(40, slab.epoch).values[STEREO_MAP_MODES.CORRELATION]
    ).toEqual([-1]);
  });

  it("keeps rows and Hold summaries unchanged when append validation fails", () => {
    const slab = new StereoMapHistorySlab(3);
    appendHoldRow(slab, 0, { c: -1 });
    const before = slab.holdAt(0, slab.epoch);

    expect(() => appendHoldRow(slab, 1, { c: Number.NaN })).toThrow(/finite/);

    expect(slab.length).toBe(1);
    expect(slab.holdAt(0, slab.epoch)).toEqual(before);
  });

  it("accounts exact Hold index bytes for 958-band sealed, active, and frozen chunks", () => {
    const bandCount = 958;
    const holdBytesPerChunk = bandCount * (5 * Float64Array.BYTES_PER_ELEMENT + 4);
    const slab = new StereoMapHistorySlab(VISUAL_HISTORY_CHUNK_ROWS + 1);
    const bandCentersHz = Float32Array.from(
      { length: bandCount },
      (_, index) => 20 * 2 ** (index / 96)
    );
    const pl = new Float32Array(bandCount).fill(1);
    const pr = new Float32Array(bandCount).fill(1);
    const c = new Float32Array(bandCount);
    for (let index = 0; index < VISUAL_HISTORY_CHUNK_ROWS + 1; index += 1) {
      slab.append({
        timestampMs: index * 40,
        sampleRateHz: 48_000,
        bandCentersHz,
        pl,
        pr,
        c,
      });
    }

    const live = slab.storageStats();
    expect(live.holdIndexBytes).toEqual({
      allocated: holdBytesPerChunk * 2,
      used: holdBytesPerChunk * 2,
    });
    expect(live.allocatedBytes.holdIndex).toBe(holdBytesPerChunk * 2);
    expect(live.usedBytes.holdIndex).toBe(holdBytesPerChunk * 2);
    expect(live.workingBytes.holdDerivation).toBe(bandCount * 6 * Float64Array.BYTES_PER_ELEMENT);

    const frozen = slab.freeze().storageStats();
    expect(frozen.holdIndexBytes).toEqual(live.holdIndexBytes);
    expect(frozen.copiedTailBytes).toBe(
      Float64Array.BYTES_PER_ELEMENT +
        bandCount * 3 * Float32Array.BYTES_PER_ELEMENT +
        holdBytesPerChunk
    );
  });
});
