# Packed Scalar History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the 10 Hz scalar history layer from keeping millions of small JavaScript objects alive, so V8 mark-compact pauses stop growing with capture length.

**Architecture:** The visual history families (Spectrum, Vectorscope, Stereo Map, visual Waveform) already store their rows as typed-array columns inside `ChunkedHistorySlab`, which is why they cost almost nothing to trace even at gigabyte scale. The scalar layer never got that treatment: `ScalarHistoryStore` and both min/max indexes still store one JavaScript object per retained row. This plan moves the scalar layer onto the same chunked typed-array machinery, one column at a time, keeping the existing `rowAt(index)` read API so call sites do not change.

**Tech Stack:** JavaScript (ES modules), Vitest, the existing `ChunkedHistorySlab` / `baseChunk` primitives in `src/lib/`.

---

## Why (measured 2026-08-28)

A steady-state frame loop was run against a real `FrameIntake` at four retention depths. Median
frame cost is flat; only the tail moves, and `--trace-gc` attributes the tail to full GCs:

| retention | frame p50 | frame max | Mark-Compact pause | live JS heap after GC |
| --- | --- | --- | --- | --- |
| 2 min | 0.157 ms | 4.2 ms | 1–4 ms | ~9 MB |
| 15 min | 0.161 ms | 17.8 ms | 3–9 ms | ~21 MB |
| 60 min | 0.162 ms | 29.4 ms | 12–33 ms | ~58 MB |
| 240 min | 0.170 ms | 93.9 ms | 40–124 ms | ~205 MB |

Where the 205 MB sits, measured at 144,000 rows (four hours at `HIST_SAMPLE_SEC = 0.1`):

| component | live heap | per row |
| --- | --- | --- |
| `ScalarHistoryStore.loudness` | 56.8 MB | 413 B |
| `ScalarHistoryStore.audio` | 52.7 MB | 384 B |
| `WaveformHistoryIndex` (pyramid + `_rawRows`) | 59.5 MB | 433 B |
| `LoudnessHistoryIndex` | 35.3 MB | 257 B |
| `ScalarHistoryStore.correlation` | 3.3 MB | 24 B |
| `ChannelMetadataHistory`, `SparseHistoryMarkers` | ~0.2 MB | ~2 B |

Typed-array payloads live in external memory and are not traced by mark-compact: repeating the
measurement with a 100-float `waveformSubPairs` on every row reported an identical live heap. That
is the whole reason this works. The correlation column already stores unboxed doubles at 24 B/row
and is left alone.

**Target:** scalar-layer live heap under 40 MB at 144,000 rows, and a mark-compact pause at 240 min
retention in the band the 15 min case occupies today.

---

## File Structure

- Create: `src/lib/RaggedFloatColumn.js` — per-chunk storage for a row payload whose float length
  varies (per-channel extrema, waveform sub-blocks). One growable `Float32Array` plus a `Uint32Array`
  offset table; a row reads back as a `subarray` view.
- Create: `src/lib/RaggedFloatColumn.test.js`
- Create: `src/lib/AudioSnapHistorySlab.js` — packed replacement for the `audio` column.
- Create: `src/lib/AudioSnapHistorySlab.test.js`
- Create: `src/lib/LoudnessHistorySlab.js` — packed replacement for the `loudness` column.
- Create: `src/lib/LoudnessHistorySlab.test.js`
- Create: `src/lib/MinMaxRowStore.js` — packed replacement for `WaveformHistoryIndex._rawRows`.
- Create: `src/lib/MinMaxRowStore.test.js`
- Modify: `src/lib/ScalarHistoryStore.js` — construct the two new slabs instead of `ChunkedSequence`.
- Modify: `src/lib/PowerOfTwoMinMaxIndex.js` — level storage becomes typed-array chunks.
- Modify: `src/math/waveformHistoryIndex.js` — raw rows come from `MinMaxRowStore`.
- Modify: `src/math/historyMath.js` — read single values without materialising a row.
- Modify: `src/lib/FrameIntake.js` — stop copying row arrays the slab now copies itself.
- Modify: `scripts/history-perf-benchmark.mjs` — byte-based snapshot assertions plus a live-heap budget.
- Modify: `scripts/history-perf-benchmark.test.js` — cover the new budget helper.

Every consumer already reads rows through a `rowAt(entries, index)` helper
(`src/math/historyMath.js:7`, `src/math/waveformMath.js:3`, `src/lib/snapshotResolve.js:18`), and
the audio column is read at exactly one index per frame (`src/lib/snapshotResolve.js:140`). That is
what keeps this a storage change rather than a call-site migration.

---

### Task 1: RaggedFloatColumn

**Files:**
- Create: `src/lib/RaggedFloatColumn.js`
- Test: `src/lib/RaggedFloatColumn.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from "vitest";
import { RaggedFloatColumn } from "./RaggedFloatColumn.js";

describe("RaggedFloatColumn", () => {
  it("reads back each appended row as its own view", () => {
    const column = new RaggedFloatColumn(4, 2);
    column.append([1, 2]);
    column.append([3, 4, 5]);
    column.append([]);
    expect(Array.from(column.at(0))).toEqual([1, 2]);
    expect(Array.from(column.at(1))).toEqual([3, 4, 5]);
    expect(Array.from(column.at(2))).toEqual([]);
    expect(column.lengthAt(1)).toBe(3);
    expect(column.rows).toBe(3);
  });

  it("grows past its initial guess without losing earlier rows", () => {
    const column = new RaggedFloatColumn(2, 1);
    column.append([1, 2, 3, 4, 5, 6, 7, 8]);
    column.append([9]);
    expect(Array.from(column.at(0))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(column.at(1))).toEqual([9]);
  });

  it("stores an unusable value as zero by default, matching WaveformVisualHistorySlab", () => {
    const column = new RaggedFloatColumn(2, 2);
    column.append([Number.NaN, undefined]);
    expect(Array.from(column.at(0))).toEqual([0, 0]);
  });

  it("keeps -Infinity when the column asked for it", () => {
    // A dB column means silence by -Infinity; storing 0 there would read back as full scale.
    const column = new RaggedFloatColumn(2, 2, -Infinity);
    column.append([-Infinity, Number.NaN, -6]);
    expect(Array.from(column.at(0))).toEqual([-Infinity, -Infinity, -6]);
  });

  it("carries its unusable-value fill into a clone", () => {
    const column = new RaggedFloatColumn(4, 2, -Infinity);
    column.append([-Infinity]);
    const copy = column.clone();
    expect(Array.from(copy.at(0))).toEqual([-Infinity]);
  });

  it("clones only the rows written so far", () => {
    const column = new RaggedFloatColumn(64, 4);
    column.append([1, 2]);
    column.append([3]);
    const copy = column.clone();
    column.append([9, 9]);
    expect(copy.rows).toBe(2);
    expect(Array.from(copy.at(1))).toEqual([3]);
    expect(copy.at(2)).toBeUndefined();
  });

  it("reports out-of-range rows as undefined", () => {
    const column = new RaggedFloatColumn(4, 2);
    column.append([1]);
    expect(column.at(-1)).toBeUndefined();
    expect(column.at(1)).toBeUndefined();
    expect(column.lengthAt(1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/RaggedFloatColumn.test.js`
Expected: FAIL with `Failed to resolve import "./RaggedFloatColumn.js"`

- [ ] **Step 3: Write minimal implementation**

```javascript
/**
 * Per-chunk storage for a row payload whose float length varies -- per-channel extrema, waveform
 * sub-blocks. Every row's values sit back to back in one growable Float32Array, and a Uint32 offset
 * table says where each row starts, so a row reads back as a view and nothing is allocated per
 * stored row.
 *
 * A value that arrives unusable stores as `unusableFill`. Waveform extents want 0, the way
 * WaveformVisualHistorySlab writes them; a dB column wants -Infinity, because that is how the audio
 * snap spells silence and 0 would read back as full scale. A Float32Array holds -Infinity exactly,
 * so the fill is a choice rather than a limitation.
 */
export class RaggedFloatColumn {
  /**
   * @param {number} rowCapacity rows this column will hold
   * @param {number} valuesPerRow initial guess; the value buffer doubles when a row overruns it
   * @param {number} unusableFill stored in place of a value that is not a finite number
   */
  constructor(rowCapacity, valuesPerRow = 4, unusableFill = 0) {
    this._offsets = new Uint32Array(Math.max(1, rowCapacity) + 1);
    this._values = new Float32Array(Math.max(1, rowCapacity * valuesPerRow));
    this._unusableFill = unusableFill;
    this._used = 0;
    this._rows = 0;
  }

  get rows() {
    return this._rows;
  }

  get byteLength() {
    return this._values.byteLength + this._offsets.byteLength;
  }

  /** Appends one row's values. Rows are written in order and never revisited. */
  append(values) {
    const count = values?.length ?? 0;
    this._ensure(this._used + count);
    for (let index = 0; index < count; index += 1) {
      const value = values[index];
      this._values[this._used + index] = Number.isFinite(value) ? value : this._unusableFill;
    }
    this._used += count;
    this._rows += 1;
    this._offsets[this._rows] = this._used;
  }

  at(row) {
    if (!Number.isInteger(row) || row < 0 || row >= this._rows) return undefined;
    return this._values.subarray(this._offsets[row], this._offsets[row + 1]);
  }

  lengthAt(row) {
    if (!Number.isInteger(row) || row < 0 || row >= this._rows) return 0;
    return this._offsets[row + 1] - this._offsets[row];
  }

  /** A copy holding only the rows written so far; used when a live chunk is frozen. */
  clone() {
    const copy = new RaggedFloatColumn(0, 1, this._unusableFill);
    copy._offsets = this._offsets.slice(0, this._rows + 1);
    copy._values = this._values.slice(0, this._used);
    copy._used = this._used;
    copy._rows = this._rows;
    return copy;
  }

  _ensure(capacity) {
    if (capacity <= this._values.length) return;
    let next = Math.max(1, this._values.length);
    while (next < capacity) next *= 2;
    const grown = new Float32Array(next);
    grown.set(this._values.subarray(0, this._used));
    this._values = grown;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/RaggedFloatColumn.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/RaggedFloatColumn.js src/lib/RaggedFloatColumn.test.js
git commit -m "feat: add ragged float column for packed history rows"
```

---

### Task 2: AudioSnapHistorySlab

The `audio` column holds `buildAudioSnap`'s output (`src/lib/FrameIntake.js:115`): 22 plain numeric
fields, one boolean, one nullable percentage, and two per-channel arrays. Values are routinely
`-Infinity`, which a `Float32Array` stores exactly, so no codec is needed. `dialoguePercent` is
`null` when absent, which stores as `NaN` and decodes back to `null`.

**Files:**
- Create: `src/lib/AudioSnapHistorySlab.js`
- Test: `src/lib/AudioSnapHistorySlab.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from "vitest";
import { AudioSnapHistorySlab } from "./AudioSnapHistorySlab.js";

function snap(overrides = {}) {
  return {
    momentary: -20, shortTerm: -22, mMax: -18, stMax: -20, integrated: -23, lra: 5,
    dialogueIntegrated: -24, dialogueLra: 3, dialoguePercent: 70, dialogueActiveNow: true,
    truePeakL: -1, truePeakR: -1.5, tpMax: -1, samplePeak: -1, tpL: -3, tpR: -3.5,
    sampleL: -3, sampleR: -3.5, samplePeakMaxL: -2.5, samplePeakMaxR: -3,
    peakDb: [-6, -7], rmsDb: [-24, -25], correlation: 0.75, sideToMidDb: -8,
    vectorscopePairX: 0, vectorscopePairY: 1,
    ...overrides,
  };
}

describe("AudioSnapHistorySlab", () => {
  it("reads back every field of an appended row", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap(), 1000);
    const row = slab.rowAt(0);
    expect(row.momentary).toBeCloseTo(-20, 4);
    expect(row.integrated).toBeCloseTo(-23, 4);
    expect(row.dialogueActiveNow).toBe(true);
    expect(row.dialoguePercent).toBeCloseTo(70, 4);
    expect(Array.from(row.peakDb)).toEqual([-6, -7]);
    expect(Array.from(row.rmsDb)).toEqual([-24, -25]);
    expect(row.correlation).toBeCloseTo(0.75, 4);
    expect(slab.timestampAt(0)).toBe(1000);
  });

  it("round-trips -Infinity, which the audio snap uses for 'no value'", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap({ momentary: -Infinity, tpMax: -Infinity }), 0);
    const row = slab.rowAt(0);
    expect(row.momentary).toBe(-Infinity);
    expect(row.tpMax).toBe(-Infinity);
  });

  it("keeps a silent channel at -Infinity rather than full scale", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap({ peakDb: [-Infinity, -Infinity], rmsDb: [-Infinity, -24] }), 0);
    const row = slab.rowAt(0);
    expect(Array.from(row.peakDb)).toEqual([-Infinity, -Infinity]);
    expect(Array.from(row.rmsDb)).toEqual([-Infinity, -24]);
  });

  it("round-trips a null dialoguePercent", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap({ dialoguePercent: null }), 0);
    expect(slab.rowAt(0).dialoguePercent).toBeNull();
  });

  it("expires the oldest rows at capacity and keeps index 0 on the window start", () => {
    const slab = new AudioSnapHistorySlab(4);
    for (let i = 0; i < 6; i += 1) slab.push(snap({ momentary: -i }), i);
    expect(slab.length).toBe(4);
    expect(slab.rowAt(0).momentary).toBeCloseTo(-2, 4);
    expect(slab.rowAt(3).momentary).toBeCloseTo(-5, 4);
  });

  it("keeps a frozen view stable while the live slab keeps growing", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap({ momentary: -10 }), 0);
    const frozen = slab.freeze();
    slab.push(snap({ momentary: -11 }), 100);
    expect(frozen.length).toBe(1);
    expect(frozen.rowAt(0).momentary).toBeCloseTo(-10, 4);
    expect(slab.length).toBe(2);
  });

  it("reports copiedReferences so ScalarHistoryStore stats stay numeric", () => {
    const slab = new AudioSnapHistorySlab(8);
    slab.push(snap(), 0);
    const stats = slab.freeze().storageStats();
    expect(stats.copiedReferences).toBe(0);
    expect(typeof stats.copiedTailBytes).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/AudioSnapHistorySlab.test.js`
Expected: FAIL with `Failed to resolve import "./AudioSnapHistorySlab.js"`

- [ ] **Step 3: Write minimal implementation**

```javascript
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";
import { RaggedFloatColumn } from "./RaggedFloatColumn.js";

/** Plain numeric fields of one audio snap, one Float32 column each. */
const SCALAR_FIELDS = [
  "momentary", "shortTerm", "mMax", "stMax", "integrated", "lra",
  "dialogueIntegrated", "dialogueLra", "truePeakL", "truePeakR", "tpMax", "samplePeak",
  "tpL", "tpR", "sampleL", "sampleR", "samplePeakMaxL", "samplePeakMaxR",
  "correlation", "sideToMidDb", "vectorscopePairX", "vectorscopePairY",
];
/** Per-channel fields, whose length follows the device and so is stored ragged. */
const CHANNEL_FIELDS = ["peakDb", "rmsDb"];

function createChunk(sequenceStart) {
  const chunk = baseChunk(sequenceStart);
  for (const field of SCALAR_FIELDS) chunk[field] = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS);
  // Absent reads back as null rather than 0, so it needs a NaN-carrying column of its own.
  chunk.dialoguePercent = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS);
  chunk.dialogueActiveNow = new Uint8Array(VISUAL_HISTORY_CHUNK_ROWS);
  for (const field of CHANNEL_FIELDS) {
    // Both are dB: silence arrives as -Infinity and must read back as -Infinity, not 0 dBFS.
    chunk[field] = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2, -Infinity);
  }
  return chunk;
}

function cloneChunk(chunk) {
  const copy = {
    sequenceStart: chunk.sequenceStart,
    rowCount: chunk.rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(0, chunk.rowCount),
    dialoguePercent: chunk.dialoguePercent.slice(0, chunk.rowCount),
    dialogueActiveNow: chunk.dialogueActiveNow.slice(0, chunk.rowCount),
  };
  for (const field of SCALAR_FIELDS) copy[field] = chunk[field].slice(0, chunk.rowCount);
  for (const field of CHANNEL_FIELDS) copy[field] = chunk[field].clone();
  return copy;
}

function payloadBytes(chunk) {
  let bytes =
    chunk.timestamps.byteLength +
    chunk.dialoguePercent.byteLength +
    chunk.dialogueActiveNow.byteLength;
  for (const field of SCALAR_FIELDS) bytes += chunk[field].byteLength;
  for (const field of CHANNEL_FIELDS) bytes += chunk[field].byteLength;
  return bytes;
}

const SCHEMA = { name: "AudioSnapHistorySlab", createChunk, cloneChunk, payloadBytes };

function rowFrom(chunk, row) {
  const result = { timestampMs: chunk.timestamps[row] };
  for (const field of SCALAR_FIELDS) result[field] = chunk[field][row];
  const percent = chunk.dialoguePercent[row];
  result.dialoguePercent = Number.isNaN(percent) ? null : percent;
  result.dialogueActiveNow = chunk.dialogueActiveNow[row] === 1;
  for (const field of CHANNEL_FIELDS) result[field] = chunk[field].at(row);
  return result;
}

/** Packed storage for the audio-snap column of the scalar history. */
export class AudioSnapHistorySlab extends ChunkedHistorySlab {
  constructor(capacity) {
    super(capacity, SCHEMA);
  }

  push(snap, timestampMs) {
    this.appendRow(timestampMs, (chunk, row) => {
      for (const field of SCALAR_FIELDS) {
        const value = snap?.[field];
        chunk[field][row] = typeof value === "number" ? value : -Infinity;
      }
      chunk.dialoguePercent[row] = Number.isFinite(snap?.dialoguePercent)
        ? snap.dialoguePercent
        : Number.NaN;
      chunk.dialogueActiveNow[row] = snap?.dialogueActiveNow ? 1 : 0;
      for (const field of CHANNEL_FIELDS) chunk[field].append(snap?.[field]);
    });
  }

  at(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  freeze() {
    return new FrozenAudioSnapHistory(this.freezeChunks());
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}

export class FrozenAudioSnapHistory extends FrozenChunkedHistory {
  rowAt(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  at(index) {
    return this.rowAt(index);
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/AudioSnapHistorySlab.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/AudioSnapHistorySlab.js src/lib/AudioSnapHistorySlab.test.js
git commit -m "feat: add packed audio snap history slab"
```

---

### Task 3: Move the audio column onto the slab

`ScalarHistoryStore.append` receives `{ loudness, audio, correlation }` and pushes each into a
`ChunkedSequence`. The slab also needs a timestamp, which the audio snap does not carry; take it
from the loudness row that arrives in the same call.

**Files:**
- Modify: `src/lib/ScalarHistoryStore.js:38-70`
- Test: `src/lib/ScalarHistoryStore.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ScalarHistoryStore.test.js`:

```javascript
import { AudioSnapHistorySlab } from "./AudioSnapHistorySlab.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ScalarHistoryStore.test.js`
Expected: FAIL with `expected ChunkedSequence to be an instance of AudioSnapHistorySlab`

- [ ] **Step 3: Write minimal implementation**

Add the import to `src/lib/ScalarHistoryStore.js`:

```javascript
import { AudioSnapHistorySlab } from "./AudioSnapHistorySlab.js";
```

Swap the column and pass the timestamp through:

```javascript
  constructor(capacity, options) {
    this._loudness = new ChunkedSequence(capacity, options);
    this._audio = new AudioSnapHistorySlab(capacity);
    this._correlation = new ChunkedSequence(capacity, options);
  }
```

```javascript
  append({ loudness, audio, correlation }) {
    this._loudness.push(loudness);
    this._audio.push(audio, loudness?.timestampMs);
    this._correlation.push(correlation);
  }
```

`aggregateStats` sums `sharedSealedChunks`, `copiedTailRows` and `copiedReferences`; the slab reports
all three (Task 2 added `copiedReferences: 0`), so it needs no change.

- [ ] **Step 4: Run the affected suites**

Run: `npx vitest run src/lib/ScalarHistoryStore.test.js src/lib/FrameIntake.test.js src/lib/snapshotResolve.test.js src/hooks/useSnapshot.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ScalarHistoryStore.js src/lib/ScalarHistoryStore.test.js
git commit -m "perf: store audio snaps as packed columns"
```

---

### Task 4: LoudnessHistorySlab

The loudness row is `{ m, st, waveformMin, waveformMax, waveformSubPairs, waveformSubCount,
timestampMs }` (`src/lib/FrameIntake.js:283`). `waveformSubPairs` is flat at stride
`2 * channelCount` and holds roughly 19 sub-blocks per 100 ms tick at 48 kHz
(`src-tauri/src/engine/waveform_accumulator.rs:4`); both its length and the channel count can change
mid-session, so all three float payloads go in ragged columns. `waveformSubCount` is derived from
the stored lengths rather than stored.

**Files:**
- Create: `src/lib/LoudnessHistorySlab.js`
- Test: `src/lib/LoudnessHistorySlab.test.js`

> **Correction applied during execution.** The array assertions below cannot use `toEqual` against
> these literals: `Float32Array` does not represent 0.1, 0.2, 0.3 or 0.4 exactly — `Math.fround(-0.4)`
> is `-0.4000000059604645` — so `toEqual` on a read-back view fails no matter how the slab is
> written. The five affected assertions (three in "reads back every field", two in "keeps rows
> independent") use a per-element `toBeCloseTo(..., 4)` helper instead. The scalar `m`/`st`
> assertions were already written with `toBeCloseTo` and are unaffected.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from "vitest";
import { LoudnessHistorySlab } from "./LoudnessHistorySlab.js";

function row(overrides = {}) {
  return {
    m: -20, st: -22,
    waveformMin: [-0.5, -0.4], waveformMax: [0.5, 0.4],
    waveformSubPairs: Float32Array.from([-0.1, 0.1, -0.2, 0.2]),
    waveformSubCount: 1,
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
    expect(Array.from(stored.waveformMin)).toEqual([-0.5, -0.4]);
    expect(Array.from(stored.waveformMax)).toEqual([0.5, 0.4]);
    expect(Array.from(stored.waveformSubPairs)).toEqual([-0.1, 0.1, -0.2, 0.2]);
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
    expect(Array.from(slab.rowAt(0).waveformMin)).toEqual([-0.5, -0.4]);
    expect(Array.from(slab.rowAt(1).waveformMin)).toEqual([-0.1, -0.2, -0.3]);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/LoudnessHistorySlab.test.js`
Expected: FAIL with `Failed to resolve import "./LoudnessHistorySlab.js"`

- [ ] **Step 3: Write minimal implementation**

```javascript
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";
import { RaggedFloatColumn } from "./RaggedFloatColumn.js";

/** ~19 sub-blocks per 100 ms tick at 48 kHz in stereo: a starting guess, not a limit. */
const SUB_PAIR_VALUES_PER_ROW = 40;

function createChunk(sequenceStart) {
  const chunk = baseChunk(sequenceStart);
  chunk.m = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS);
  chunk.st = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS);
  chunk.waveformMin = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2);
  chunk.waveformMax = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2);
  chunk.waveformSubPairs = new RaggedFloatColumn(
    VISUAL_HISTORY_CHUNK_ROWS,
    SUB_PAIR_VALUES_PER_ROW
  );
  return chunk;
}

function cloneChunk(chunk) {
  return {
    sequenceStart: chunk.sequenceStart,
    rowCount: chunk.rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(0, chunk.rowCount),
    m: chunk.m.slice(0, chunk.rowCount),
    st: chunk.st.slice(0, chunk.rowCount),
    waveformMin: chunk.waveformMin.clone(),
    waveformMax: chunk.waveformMax.clone(),
    waveformSubPairs: chunk.waveformSubPairs.clone(),
  };
}

function payloadBytes(chunk) {
  return (
    chunk.timestamps.byteLength +
    chunk.m.byteLength +
    chunk.st.byteLength +
    chunk.waveformMin.byteLength +
    chunk.waveformMax.byteLength +
    chunk.waveformSubPairs.byteLength
  );
}

const SCHEMA = { name: "LoudnessHistorySlab", createChunk, cloneChunk, payloadBytes };

/**
 * Sub-blocks are stored flat at stride 2 * channelCount, and the channel count is whatever this
 * row's extrema carried, so the count is derived rather than stored.
 */
function subCountFrom(chunk, row) {
  const channels = chunk.waveformMin.lengthAt(row) || chunk.waveformMax.lengthAt(row);
  if (channels === 0) return 0;
  return Math.floor(chunk.waveformSubPairs.lengthAt(row) / (2 * channels));
}

function rowFrom(chunk, row) {
  return {
    m: chunk.m[row],
    st: chunk.st[row],
    timestampMs: chunk.timestamps[row],
    waveformMin: chunk.waveformMin.at(row),
    waveformMax: chunk.waveformMax.at(row),
    waveformSubPairs: chunk.waveformSubPairs.at(row),
    waveformSubCount: subCountFrom(chunk, row),
  };
}

function readValue(view, index, key) {
  const found = view.chunkAt(index);
  if (!found) return undefined;
  return found.chunk[key]?.[found.row];
}

/** Packed storage for the loudness column of the scalar history. */
export class LoudnessHistorySlab extends ChunkedHistorySlab {
  constructor(capacity) {
    super(capacity, SCHEMA);
  }

  push(row) {
    this.appendRow(row?.timestampMs, (chunk, index) => {
      chunk.m[index] = typeof row?.m === "number" ? row.m : -Infinity;
      chunk.st[index] = typeof row?.st === "number" ? row.st : -Infinity;
      chunk.waveformMin.append(row?.waveformMin);
      chunk.waveformMax.append(row?.waveformMax);
      chunk.waveformSubPairs.append(row?.waveformSubPairs);
    });
  }

  /** One loudness value, for hot paths that would otherwise materialise a whole row. */
  valueAt(index, key) {
    return readValue(this, index, key);
  }

  at(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  freeze() {
    return new FrozenLoudnessHistory(this.freezeChunks());
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}

export class FrozenLoudnessHistory extends FrozenChunkedHistory {
  valueAt(index, key) {
    return readValue(this, index, key);
  }

  rowAt(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  at(index) {
    return this.rowAt(index);
  }

  toArray() {
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/LoudnessHistorySlab.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/LoudnessHistorySlab.js src/lib/LoudnessHistorySlab.test.js
git commit -m "feat: add packed loudness history slab"
```

---

### Task 5: Move the loudness column onto the slab

The row `FrameIntake.pushHistRow` builds is retained today, which is why it copies the incoming
arrays (`snapshotNumericArray` / `snapshotFloat32Array`, `src/lib/FrameIntake.js:286-289`). Once the
slab copies values into its own buffers, that row object is transient — consumed by the slab and the
two indexes inside the one call — and those copies are dead weight.

**Files:**
- Modify: `src/lib/ScalarHistoryStore.js:38-45`
- Modify: `src/lib/FrameIntake.js:277-300`
- Test: `src/lib/FrameIntake.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/FrameIntake.test.js`:

```javascript
import { LoudnessHistorySlab } from "./LoudnessHistorySlab.js";

describe("FrameIntake packed loudness column", () => {
  it("stores loudness rows in a packed slab", () => {
    const intake = new FrameIntake();
    intake.pushHistRow(
      {
        timestampMs: 1000,
        lufsMomentary: -20,
        lufsShortTerm: -22,
        waveformMin: [-0.5, -0.4],
        waveformMax: [0.5, 0.4],
        waveformSubPairs: Float32Array.from([-0.1, 0.1, -0.2, 0.2]),
        waveformSubCount: 1,
        correlation: 0.75,
      },
      8
    );
    const history = intake.getLoudnessHistory();
    expect(history).toBeInstanceOf(LoudnessHistorySlab);
    expect(history.rowAt(0).m).toBeCloseTo(-20, 4);
    expect(Array.from(history.rowAt(0).waveformMin)).toEqual([-0.5, -0.4]);
    expect(history.rowAt(0).waveformSubCount).toBe(1);
    expect(history.timestampAt(0)).toBe(1000);
  });

  it("does not retain the caller's arrays", () => {
    const intake = new FrameIntake();
    const waveformMin = [-0.5, -0.4];
    intake.pushHistRow(
      {
        timestampMs: 0,
        lufsMomentary: -20,
        lufsShortTerm: -22,
        waveformMin,
        waveformMax: [0.5, 0.4],
        waveformSubPairs: new Float32Array(0),
        waveformSubCount: 0,
        correlation: 0,
      },
      8
    );
    waveformMin[0] = 99;
    expect(Array.from(intake.getLoudnessHistory().rowAt(0).waveformMin)).toEqual([-0.5, -0.4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: FAIL with `expected ChunkedSequence to be an instance of LoudnessHistorySlab`

- [ ] **Step 3: Write minimal implementation**

Add the import to `src/lib/ScalarHistoryStore.js`:

```javascript
import { LoudnessHistorySlab } from "./LoudnessHistorySlab.js";
```

```javascript
  constructor(capacity, options) {
    this._loudness = new LoudnessHistorySlab(capacity);
    this._audio = new AudioSnapHistorySlab(capacity);
    this._correlation = new ChunkedSequence(capacity, options);
  }
```

In `src/lib/FrameIntake.js`, drop the copies now that nothing retains the row:

```javascript
    const loudnessRow = {
      m: hm,
      st: hst,
      waveformMin: row.waveformMin,
      waveformMax: row.waveformMax,
      waveformSubPairs: row.waveformSubPairs,
      waveformSubCount: row.waveformSubCount ?? 0,
      timestampMs,
    };
```

- [ ] **Step 4: Run the affected suites**

Run: `npx vitest run src/lib/FrameIntake.test.js src/lib/ScalarHistoryStore.test.js src/math/historyMath.test.js src/math/waveformMath.test.js src/math/waveformHistoryIndex.test.js src/hooks/useSnapshot.test.jsx src/components/panels/LoudnessPanel.test.jsx src/components/panels/WaveformPanel.test.jsx`
Expected: PASS

`snapshotFloat32Array` is now unused — this change orphaned it, so delete it. `snapshotNumericArray`
is still used by `buildAudioSnap` and stays. Run `npm run lint` to confirm nothing else referenced it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ScalarHistoryStore.js src/lib/FrameIntake.js src/lib/FrameIntake.test.js
git commit -m "perf: store loudness rows as packed columns"
```

---

### Task 6: Read path values without materialising rows

`buildHistoryPath` reads `rowAt(histSourceList, i)[key]` once per visible sample
(`src/math/historyMath.js:146,161`), which now materialises a row object with three subarray views
per sample. Short-lived garbage is cheap, but this loop runs per frame per panel and the slab can
answer directly.

**Files:**
- Modify: `src/math/historyMath.js:7-12,146,161`
- Test: `src/math/historyMath.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/math/historyMath.test.js`:

```javascript
describe("buildHistoryPath value access", () => {
  it("prefers a slab's valueAt over materialising a row", () => {
    let rowAtCalls = 0;
    const entries = {
      length: 4,
      valueAt: (index, key) => (key === "m" ? -20 - index : -30),
      rowAt: (index) => {
        rowAtCalls += 1;
        return { m: -20 - index, st: -30 };
      },
    };
    const path = buildHistoryPath(entries, "m", 4, 0, (value) => value, 600, 600);
    expect(path).not.toBe("");
    expect(rowAtCalls).toBe(0);
  });

  it("still reads a plain array of rows", () => {
    const entries = [{ m: -20 }, { m: -21 }, { m: -22 }];
    expect(buildHistoryPath(entries, "m", 3, 0, (value) => value, 600, 600)).not.toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/historyMath.test.js`
Expected: FAIL with `expected 3 to be 0`

- [ ] **Step 3: Write minimal implementation**

Add next to `rowAt` in `src/math/historyMath.js`:

```javascript
function valueAt(entries, index, key) {
  if (!entries) return undefined;
  if (typeof entries.valueAt === "function") return entries.valueAt(index, key);
  return rowAt(entries, index)?.[key];
}
```

Replace both reads inside `buildHistoryPath`:

```javascript
      d += `${i === start ? "M" : " L"} ${xOf(i)} ${toY(valueAt(histSourceList, i, key))}`;
```

```javascript
    const y = toY(valueAt(histSourceList, i, key));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/historyMath.test.js src/components/panels/LoudnessPanel.test.jsx src/dock/modules/DockLoudness.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/math/historyMath.js src/math/historyMath.test.js
git commit -m "perf: read loudness path values without materialising rows"
```

---

### Task 7: MinMaxRowStore

`WaveformHistoryIndex.append` pushes `{ mins, maxes }` into a `ChunkedSequence`
(`src/math/waveformHistoryIndex.js:64`) — three objects per row, duplicating extrema the loudness
column already holds. Only `queryRange`'s `rawRowAt` callback reads them, and it reads `.mins` /
`.maxes`, so a packed store with the same read shape drops in.

**Files:**
- Create: `src/lib/MinMaxRowStore.js`
- Test: `src/lib/MinMaxRowStore.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from "vitest";
import { MinMaxRowStore } from "./MinMaxRowStore.js";

describe("MinMaxRowStore", () => {
  it("reads back the mins and maxes of a row", () => {
    const store = new MinMaxRowStore(8);
    store.push({ mins: [-1, -2], maxes: [1, 2] });
    const row = store.at(0);
    expect(Array.from(row.mins)).toEqual([-1, -2]);
    expect(Array.from(row.maxes)).toEqual([1, 2]);
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

  it("reports copiedReferences for stats parity", () => {
    const store = new MinMaxRowStore(8);
    store.push({ mins: [1], maxes: [1] });
    expect(store.storageStats().copiedReferences).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/MinMaxRowStore.test.js`
Expected: FAIL with `Failed to resolve import "./MinMaxRowStore.js"`

- [ ] **Step 3: Write minimal implementation**

```javascript
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";
import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";
import { RaggedFloatColumn } from "./RaggedFloatColumn.js";

function createChunk(sequenceStart) {
  const chunk = baseChunk(sequenceStart);
  chunk.mins = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2);
  chunk.maxes = new RaggedFloatColumn(VISUAL_HISTORY_CHUNK_ROWS, 2);
  return chunk;
}

function cloneChunk(chunk) {
  return {
    sequenceStart: chunk.sequenceStart,
    rowCount: chunk.rowCount,
    sealed: true,
    timestamps: chunk.timestamps.slice(0, chunk.rowCount),
    mins: chunk.mins.clone(),
    maxes: chunk.maxes.clone(),
  };
}

const SCHEMA = {
  name: "MinMaxRowStore",
  createChunk,
  cloneChunk,
  payloadBytes: (chunk) =>
    chunk.timestamps.byteLength + chunk.mins.byteLength + chunk.maxes.byteLength,
};

function rowFrom(chunk, row) {
  return { mins: chunk.mins.at(row), maxes: chunk.maxes.at(row) };
}

/** The per-row extrema a min/max index falls back to when no summary bucket covers a sequence. */
export class MinMaxRowStore extends ChunkedHistorySlab {
  constructor(capacity) {
    super(capacity, SCHEMA);
  }

  push(row) {
    // A raw-row store has no clock of its own; the base slab's timestamp column stays unused.
    this.appendRow(Number.NaN, (chunk) => {
      chunk.mins.append(row?.mins);
      chunk.maxes.append(row?.maxes);
    });
  }

  at(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  freeze() {
    return new FrozenMinMaxRowStore(this.freezeChunks());
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}

export class FrozenMinMaxRowStore extends FrozenChunkedHistory {
  at(index) {
    const found = this.chunkAt(index);
    return found ? rowFrom(found.chunk, found.row) : undefined;
  }

  rowAt(index) {
    return this.at(index);
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/MinMaxRowStore.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/MinMaxRowStore.js src/lib/MinMaxRowStore.test.js
git commit -m "feat: add packed min max row store"
```

---

### Task 8: Move the waveform index's raw rows onto MinMaxRowStore

**Files:**
- Modify: `src/math/waveformHistoryIndex.js:1-2,50-56`
- Test: `src/math/waveformHistoryIndex.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/math/waveformHistoryIndex.test.js`:

```javascript
import { MinMaxRowStore } from "../lib/MinMaxRowStore.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/waveformHistoryIndex.test.js`
Expected: FAIL with `expected ChunkedSequence to be an instance of MinMaxRowStore`

- [ ] **Step 3: Write minimal implementation**

In `src/math/waveformHistoryIndex.js`, add the import beside the existing one:

```javascript
import { ChunkedSequence } from "../lib/ChunkedSequence.js";
import { MinMaxRowStore } from "../lib/MinMaxRowStore.js";
```

`_nanSequences` stays a `ChunkedSequence` — it stores unboxed numbers at 2 B/row. Change only the
raw-row store:

```javascript
    this._rawRows = rawRows ?? new MinMaxRowStore(capacityOrIndex);
```

`append` already pushes `{ mins, maxes }` and `queryRange` already reads through `.at(...)`, so
neither changes. `freeze()` passes `this._rawRows.freeze()` into the constructor's `rawRows` slot,
which bypasses construction, so the frozen path needs no change either.

- [ ] **Step 4: Run the affected suites**

Run: `npx vitest run src/math/waveformHistoryIndex.test.js src/math/waveformMath.test.js src/lib/FrameIntake.test.js src/components/panels/WaveformPanel.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/math/waveformHistoryIndex.js src/math/waveformHistoryIndex.test.js
git commit -m "perf: pack the waveform index raw rows"
```

---

### Task 9: Pack the min/max index levels

Each level of `PowerOfTwoMinMaxIndex` stores frozen bucket objects — `{ startSequence, width, mins,
maxes }`, three objects per bucket — in a `ChunkedSequence`, and bucket counts across levels sum to
roughly one per retained row. Bucket `n` of level `L` always covers `[n * 2**L, (n + 1) * 2**L)`, so
`startSequence` and `width` are arithmetic and only the two value vectors need storing. `valueCount`
is unknown until the first append, so levels are created lazily.

**Files:**
- Modify: `src/lib/PowerOfTwoMinMaxIndex.js`
- Test: `src/lib/PowerOfTwoMinMaxIndex.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/PowerOfTwoMinMaxIndex.test.js`:

```javascript
describe("PowerOfTwoMinMaxIndex packed levels", () => {
  it("stores level buckets as typed-array views", () => {
    const index = new PowerOfTwoMinMaxIndex(64);
    for (let i = 0; i < 8; i += 1) index.append(i, [i, -i], [i + 1, 1 - i]);
    const bucket = index._bucketAtStart(1, 0, 2);
    expect(bucket.mins).toBeInstanceOf(Float32Array);
    expect(bucket.maxes).toBeInstanceOf(Float32Array);
    expect(bucket.width).toBe(2);
    expect(bucket.startSequence).toBe(0);
  });

  it("answers a whole-range query from summary buckets alone", () => {
    const index = new PowerOfTwoMinMaxIndex(64);
    for (let i = 0; i < 8; i += 1) index.append(i, [i], [i * 2]);
    const result = index.queryRange(0, 7, () => {
      throw new Error("should not need a raw row");
    });
    expect(result.mins[0]).toBeCloseTo(0, 4);
    expect(result.maxes[0]).toBeCloseTo(14, 4);
  });

  it("falls back to raw rows for a range no bucket covers", () => {
    const index = new PowerOfTwoMinMaxIndex(64);
    for (let i = 0; i < 8; i += 1) index.append(i, [i], [i * 2]);
    const result = index.queryRange(1, 2, (sequence) => ({
      mins: [sequence],
      maxes: [sequence * 2],
    }));
    expect(result.mins[0]).toBeCloseTo(1, 4);
    expect(result.maxes[0]).toBeCloseTo(4, 4);
  });

  it("keeps a frozen index answering after the live one moves on", () => {
    const index = new PowerOfTwoMinMaxIndex(64);
    for (let i = 0; i < 8; i += 1) index.append(i, [i], [i * 2]);
    const frozen = index.freeze();
    for (let i = 8; i < 16; i += 1) index.append(i, [100], [100]);
    const result = frozen.queryRange(0, 7, () => {
      throw new Error("should not need a raw row");
    });
    expect(result.maxes[0]).toBeCloseTo(14, 4);
  });

  it("expires level buckets that fall out of the retained window", () => {
    const index = new PowerOfTwoMinMaxIndex(8);
    for (let i = 0; i < 32; i += 1) index.append(i, [i], [i]);
    expect(index.retainedStartSequence).toBe(24);
    const result = index.queryRange(24, 31, (sequence) => ({
      mins: [sequence],
      maxes: [sequence],
    }));
    expect(result.mins[0]).toBeCloseTo(24, 4);
    expect(result.maxes[0]).toBeCloseTo(31, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/PowerOfTwoMinMaxIndex.test.js`
Expected: FAIL with `expected Array to be an instance of Float32Array`

- [ ] **Step 3: Write minimal implementation**

Delete `createBucket`, `createRowBucket`, `mergeBuckets`, `bucketAtStart`, `frozenBucketAtStart` and
the `ChunkedSequence` import from `src/lib/PowerOfTwoMinMaxIndex.js`, and add the level storage:

```javascript
import { ChunkedHistorySlab, FrozenChunkedHistory, baseChunk } from "./ChunkedHistorySlab.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "./historyChunkConfig.js";

function levelSchema(valueCount) {
  return {
    name: "MinMaxLevel",
    createChunk: (sequenceStart) => {
      const chunk = baseChunk(sequenceStart);
      chunk.mins = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * valueCount);
      chunk.maxes = new Float32Array(VISUAL_HISTORY_CHUNK_ROWS * valueCount);
      return chunk;
    },
    cloneChunk: (chunk) => ({
      sequenceStart: chunk.sequenceStart,
      rowCount: chunk.rowCount,
      sealed: true,
      timestamps: chunk.timestamps.slice(0, chunk.rowCount),
      mins: chunk.mins.slice(0, chunk.rowCount * valueCount),
      maxes: chunk.maxes.slice(0, chunk.rowCount * valueCount),
    }),
    payloadBytes: (chunk) =>
      chunk.timestamps.byteLength + chunk.mins.byteLength + chunk.maxes.byteLength,
  };
}

function bucketFrom(view, bucketIndex, valueCount) {
  if (view.length === 0) return undefined;
  // A level has no clock, so the base slab's timestamp column carries the absolute bucket index.
  const firstRetained = view.timestampAt(0);
  const found = view.chunkAt(bucketIndex - firstRetained);
  if (!found) return undefined;
  const first = found.row * valueCount;
  return {
    mins: found.chunk.mins.subarray(first, first + valueCount),
    maxes: found.chunk.maxes.subarray(first, first + valueCount),
  };
}

/** One level of the pyramid: bucket n covers [n * width, (n + 1) * width). */
class MinMaxLevel extends ChunkedHistorySlab {
  constructor(capacityBuckets, valueCount) {
    super(capacityBuckets, levelSchema(valueCount));
    this._valueCount = valueCount;
  }

  push(bucketIndex, mins, maxes) {
    this.appendRow(bucketIndex, (chunk, row) => {
      const first = row * this._valueCount;
      for (let value = 0; value < this._valueCount; value += 1) {
        chunk.mins[first + value] = mins[value] ?? 0;
        chunk.maxes[first + value] = maxes[value] ?? 0;
      }
    });
  }

  bucketAt(bucketIndex) {
    return bucketFrom(this, bucketIndex, this._valueCount);
  }

  freeze() {
    return new FrozenMinMaxLevel(this.freezeChunks(), this._valueCount);
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}

class FrozenMinMaxLevel extends FrozenChunkedHistory {
  constructor(storage, valueCount) {
    super(storage);
    this._valueCount = valueCount;
  }

  bucketAt(bucketIndex) {
    return bucketFrom(this, bucketIndex, this._valueCount);
  }

  storageStats() {
    return { ...super.storageStats(), copiedReferences: 0 };
  }
}
```

The pending-carry merge now works on plain `{ start, mins, maxes }` value pairs and pushes into the
lazily created level:

```javascript
  append(sequence, mins, maxes) {
    if (!Number.isInteger(sequence) || sequence !== this._retainedEndSequence) {
      throw new RangeError(`expected sequence ${this._retainedEndSequence}, received ${sequence}`);
    }
    if (
      mins == null ||
      maxes == null ||
      typeof mins.length !== "number" ||
      typeof maxes.length !== "number"
    ) {
      throw new TypeError("mins and maxes must be array-like");
    }

    this._valueCount = Math.max(this._valueCount, mins.length, maxes.length);
    let carry = { start: sequence, mins: Array.from(mins), maxes: Array.from(maxes) };
    for (let level = 0; level <= this._maxLevel; level++) {
      const pending = this._pending[level];
      if (!pending) {
        this._pending[level] = carry;
        break;
      }
      this._pending[level] = undefined;
      const merged = { start: pending.start, mins: [], maxes: [] };
      for (let value = 0; value < this._valueCount; value += 1) {
        merged.mins[value] = Math.min(pending.mins[value] ?? 0, carry.mins[value] ?? 0);
        merged.maxes[value] = Math.max(pending.maxes[value] ?? 0, carry.maxes[value] ?? 0);
      }
      carry = merged;
      const nextLevel = level + 1;
      if (nextLevel <= this._maxLevel) {
        const width = 2 ** nextLevel;
        this._ensureLevel(nextLevel).push(merged.start / width, merged.mins, merged.maxes);
      }
    }

    this._retainedEndSequence = sequence + 1;
    this._retainedStartSequence = Math.max(0, this._retainedEndSequence - this._capacity);
    this._version++;
  }

  _ensureLevel(level) {
    if (!this._levels[level]) {
      const width = 2 ** level;
      this._levels[level] = new MinMaxLevel(
        Math.ceil(this._capacity / width) + 2,
        this._valueCount
      );
    }
    return this._levels[level];
  }

  _bucketAtStart(level, startSequence, width) {
    const store = this._levels[level];
    if (!store) return undefined;
    const bucketIndex = startSequence / width;
    if (!Number.isInteger(bucketIndex)) return undefined;
    const bucket = store.bucketAt(bucketIndex);
    if (!bucket) return undefined;
    return { startSequence, width, mins: bucket.mins, maxes: bucket.maxes };
  }
```

`queryRange` reads `bucket.width`, `bucket.mins` and `bucket.maxes`, all of which the returned shape
still carries, so it is unchanged. `storageStats` and `clear` must skip levels that were never
created:

```javascript
    for (let level = 1; level <= this._maxLevel; level += 1) {
      const store = this._levels[level];
      if (!store) continue;
      const stats = store.storageStats();
      levels.push({ level, ...stats });
      sharedSealedChunks += stats.sharedSealedChunks;
      copiedTailRows += stats.copiedTailRows;
      copiedReferences += stats.copiedReferences;
    }
```

```javascript
  clear() {
    for (let level = 1; level <= this._maxLevel; level++) this._levels[level] = undefined;
    this._pending.fill(undefined);
    this._retainedStartSequence = 0;
    this._retainedEndSequence = 0;
    this._valueCount = 0;
    this._lastQueryStats = EMPTY_QUERY_STATS;
    this._version++;
  }
```

`FrozenPowerOfTwoMinMaxIndex` freezes only the levels that exist, and resolves buckets the same way:

```javascript
    const levels = new Array(this._maxLevel + 1);
    for (let level = 1; level <= this._maxLevel; level++) {
      levels[level] = source._levels[level] ? source._levels[level].freeze() : undefined;
    }
```

```javascript
  _bucketAtStart(level, startSequence, width) {
    const store = this._levels[level];
    if (!store) return undefined;
    const bucketIndex = startSequence / width;
    if (!Number.isInteger(bucketIndex)) return undefined;
    const bucket = store.bucketAt(bucketIndex);
    if (!bucket) return undefined;
    return { startSequence, width, mins: bucket.mins, maxes: bucket.maxes };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/PowerOfTwoMinMaxIndex.test.js src/math/loudnessHistoryIndex.test.js src/math/waveformHistoryIndex.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/PowerOfTwoMinMaxIndex.js src/lib/PowerOfTwoMinMaxIndex.test.js
git commit -m "perf: pack min max index levels into typed arrays"
```

---

### Task 10: Guard the win with a live-heap budget

The benchmark's snapshot assertions count copied *references*, which packed columns no longer have.
Replace them with the assertion that actually protects this work: the scalar layer's live heap at
four-hour retention.

**Files:**
- Modify: `scripts/history-perf-benchmark.mjs:1-16,180-230`
- Test: `scripts/history-perf-benchmark.test.js`

- [ ] **Step 1: Write the failing test**

Append to `scripts/history-perf-benchmark.test.js`:

```javascript
import { scalarLiveHeapBudgetBytes } from "./history-perf-benchmark.mjs";

describe("scalarLiveHeapBudgetBytes", () => {
  it("budgets 40 MB at four-hour retention", () => {
    expect(scalarLiveHeapBudgetBytes(144_000)).toBe(40 * 1024 * 1024);
  });

  it("scales with retained rows", () => {
    expect(scalarLiveHeapBudgetBytes(72_000)).toBe(20 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/history-perf-benchmark.test.js`
Expected: FAIL with `does not provide an export named 'scalarLiveHeapBudgetBytes'`

- [ ] **Step 3: Write minimal implementation**

Add to the imports at the top of `scripts/history-perf-benchmark.mjs`:

```javascript
import v8 from "node:v8";
```

Add the budget helper:

```javascript
/**
 * The live-heap ceiling for the scalar history layer. Object-per-row storage cost 1,442 B/row
 * (measured 2026-08-28: 207.6 MB at 144,000 rows) and mark-compact pause time tracked it linearly.
 * Packed columns put the payload in external memory, so this budget covers bookkeeping alone.
 */
export function scalarLiveHeapBudgetBytes(retainedRows) {
  const bytesPerRow = (40 * 1024 * 1024) / 144_000;
  return Math.round(retainedRows * bytesPerRow);
}
```

In `benchmarkScalarSnapshot`, replace the three `copiedReferences <= bounds...` assertions with the
packed equivalents plus the heap check:

```javascript
  assertStructure(
    stats.scalar.copiedReferences === 0,
    `packed scalar snapshot copied ${stats.scalar.copiedReferences} references`
  );
  global.gc?.();
  const liveHeapBytes = v8.getHeapStatistics().used_heap_size;
  const budget = scalarLiveHeapBudgetBytes(rows.length);
  assertStructure(
    liveHeapBytes <= budget,
    `scalar live heap ${(liveHeapBytes / 1048576).toFixed(1)} MB exceeds the ${(budget / 1048576).toFixed(1)} MB budget`
  );
```

`projectedScalarSnapshotCopyBounds` is now unused by the scalar path but still describes the
supporting `ChunkedSequence` columns; leave it and its test alone.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/history-perf-benchmark.test.js`
Expected: PASS

Run: `node --expose-gc scripts/history-perf-benchmark.mjs`
Expected: completes with no structural assertion failure

- [ ] **Step 5: Commit**

```bash
git add scripts/history-perf-benchmark.mjs scripts/history-perf-benchmark.test.js
git commit -m "test: budget the scalar history live heap"
```

---

### Task 11: Verify the GC pause actually flattened

**Files:**
- Create: `scripts/scalar-history-gc-probe.mjs` (temporary; removed in Step 4)

- [ ] **Step 1: Write the probe**

This is the exact script that produced the table at the top of this plan, so the before/after
numbers are comparable. Row shapes mirror `src/dev/historyPerformanceHarness.js`; the duplication is
deliberate, because the probe is deleted in Step 4 rather than kept.

```javascript
// Does the frontend's per-frame cost grow with how much history is retained?
import { performance } from "node:perf_hooks";
import v8 from "node:v8";
import { FrameIntake } from "../src/lib/FrameIntake.js";
import { buildLoudnessHistoryPathsFromIndex } from "../src/math/historyMath.js";

const BANDS = 958;
const VECTOR_VALUES = 200;
const SPECTRUM_KEY = "spectrum:pair:0:1:combined:sp25:tilt300:smoff";
const VECTORSCOPE_KEY = "vectorscope:pair:0:1";
const VISUAL_CADENCE_MS = 40;
const SCALAR_CADENCE_MS = 100;
const FRAMES = 20_000;

const centers = Float32Array.from({ length: BANDS }, (_, i) => 20 * Math.pow(1000, i / BANDS));
const smoothDb = Float32Array.from({ length: BANDS }, (_, i) => -40 + 10 * Math.sin(i / 17));
const pairs = Float32Array.from({ length: VECTOR_VALUES }, (_, i) => Math.sin(i / 7) * 0.5);

function scalarRow(i, ts) {
  return {
    timestampMs: ts,
    lufsMomentary: -20 + Math.sin(i / 19), lufsShortTerm: -22 + Math.cos(i / 37),
    lufsMMax: -18, lufsStMax: -20, integrated: -23, lra: 5,
    dialogueIntegrated: -24, dialogueLra: 3, dialoguePercent: 70, dialogueActiveNow: i % 4 !== 0,
    truePeakL: -1, truePeakR: -1.5, truePeakMaxDbtp: -1, sampleLDb: -3, sampleRDb: -3.5,
    samplePeakMaxL: -2.5, samplePeakMaxR: -3,
    waveformMin: [-0.45 - Math.sin(i / 11) * 0.05, -0.4],
    waveformMax: [0.45 + Math.cos(i / 13) * 0.05, 0.4],
    waveformSubPairs: new Float32Array(76), waveformSubCount: 19,
    rmsDb: [-24, -25], correlation: 0.7 + Math.sin(i / 53) * 0.2, sideToMidDb: -8,
    vectorscopePairX: 0, vectorscopePairY: 1, peakDb: [-6, -7], peakHoldDb: [-5, -6],
  };
}

function visualRow(ts) {
  return {
    timestampMs: ts,
    waveformMin: [-0.5, -0.4], waveformMax: [0.5, 0.4],
    dominantFrequencyHz: [440, 441], spectralCentroidHz: [2000, 2100], tonality: [0.5, 0.6],
    spectrumByKey: { [SPECTRUM_KEY]: { bandCentersHz: centers, smoothDb } },
    vectorscopeByKey: {
      [VECTORSCOPE_KEY]: {
        pairs, correlation: 0.8, sideToMidDb: -9, midEnergy: 1, sideEnergy: 0.2,
      },
    },
  };
}

const minutes = Number(process.argv[2] ?? 15);
const visualRows = Math.round((minutes * 60 * 1000) / VISUAL_CADENCE_MS);
const scalarRows = Math.round((minutes * 60 * 1000) / SCALAR_CADENCE_MS);
const intake = new FrameIntake();
intake.setRetainedVisualKeys(
  {
    spectrum: new Set([SPECTRUM_KEY]),
    vectorscope: new Set([VECTORSCOPE_KEY]),
    stereoMap: new Set(),
    stereoMapModesByKey: new Map(),
  },
  minutes * 60 * 1000
);
for (let i = 0; i < scalarRows; i += 1) {
  intake.pushHistRow(scalarRow(i, i * SCALAR_CADENCE_MS), scalarRows);
}
for (let i = 0; i < visualRows; i += 1) {
  intake.pushVisualHistRow(visualRow(i * VISUAL_CADENCE_MS), visualRows, 48000);
}

const samples = new Float64Array(FRAMES);
const toY = (value) => 220 - (value + 60) * 3;
let visualTs = visualRows * VISUAL_CADENCE_MS;
let scalarTs = scalarRows * SCALAR_CADENCE_MS;
let scalarIndex = scalarRows;
let sink;
for (let frame = 0; frame < FRAMES; frame += 1) {
  const started = performance.now();
  intake.pushVisualHistRow(visualRow(visualTs), visualRows, 48000);
  while (visualTs >= scalarTs) {
    intake.pushHistRow(scalarRow(scalarIndex, scalarTs), scalarRows);
    scalarIndex += 1;
    scalarTs += SCALAR_CADENCE_MS;
  }
  visualTs += VISUAL_CADENCE_MS;
  const list = intake.getLoudnessHistory();
  sink = buildLoudnessHistoryPathsFromIndex(
    list,
    intake.getLoudnessDisplayIndex(),
    Math.min(list.length, 600),
    0,
    toY,
    600,
    600
  );
  samples[frame] = performance.now() - started;
}

const sorted = Array.from(samples).sort((a, b) => a - b);
const pct = (p) => sorted[Math.floor((sorted.length - 1) * p)].toFixed(3);
const heap = v8.getHeapStatistics();
console.log(
  JSON.stringify({
    minutes,
    p50: pct(0.5), p95: pct(0.95), p99: pct(0.99),
    max: sorted[sorted.length - 1].toFixed(3),
    heapUsedMB: +(heap.used_heap_size / 1048576).toFixed(1),
    externalMB: +(heap.external_memory / 1048576).toFixed(1),
    sinkLen: sink.m.length,
  })
);
```

- [ ] **Step 2: Run it at four depths with GC tracing**

```bash
for m in 2 15 60 240; do node --max-old-space-size=6144 --trace-gc scripts/scalar-history-gc-probe.mjs $m; done
```

Expected: Mark-Compact pauses at 240 min land in the band 15 min occupied before this work (under
~10 ms), and live heap after a full GC stays under 40 MB. Record the four rows in the PR description
next to the table above.

- [ ] **Step 3: Run the merge gate**

Run: `npm run check`
Expected: PASS. `scripts/tauriSecurityConfig.test.js` and `scripts/tauriDependencyContract.test.js`
guard Rust and installer config from the JavaScript side — a failure there would be unrelated to
this work.

- [ ] **Step 4: Remove the probe and commit**

```bash
rm scripts/scalar-history-gc-probe.mjs
git add -A
git commit -m "perf: verify packed scalar history flattens gc pauses"
```

---

## Not in scope

- The `correlation` column (3.3 MB at 24 B/row — already unboxed doubles).
- `ChannelMetadataHistory` and `SparseHistoryMarkers` (~0.2 MB combined; both already store changes
  rather than rows).
- Per-frame garbage rate, which sets how *often* a major GC runs rather than how long it takes.
  Worth revisiting once the pause cost is gone.
- Retention length. Per `project-plvs-retention-uniform-across-panels`, retention is one global
  promise and no panel gets a special case.

## Risks

- **Subarray views are live.** `rowAt` returns views into chunk storage, so a caller that mutates a
  returned array corrupts history. `WaveformVisualHistorySlab` already behaves this way, so the
  hazard is consistent rather than new — but the loudness row now has three such fields.
- **`timestampMs` becomes `-Infinity` rather than `undefined`** for a row that arrived without a
  usable timestamp, because `ChunkedHistorySlab.appendRow` normalises it. Call sites guard with
  `Number.isFinite`, but re-read `src/components/panels/WaveformPanel.jsx:66` and
  `src/dock/modules/DockLoudness.jsx:108` during Task 5.
- **Task 9 is the invasive one.** It rewrites the pyramid's storage, and `queryRange` correctness
  then rests on the derived bucket arithmetic. If it turns into a fight, Tasks 1–8 already remove
  roughly half the live heap and are independently shippable — stop there and re-measure.
