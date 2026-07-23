import { describe, it, expect } from "vitest";
import { sliceWaveformSubHistory, sliceWaveformSubHistoryFromIndex } from "./waveformMath.js";
import { WaveformHistoryIndex } from "./waveformHistoryIndex.js";

const SUBS = 19;
function flatEntry(amp) {
  const pairs = new Float32Array(SUBS * 2); // 1 channel, stride 2
  for (let s = 0; s < SUBS; s++) {
    pairs[s * 2] = -amp;
    pairs[s * 2 + 1] = amp;
  }
  return {
    waveformSubPairs: pairs,
    waveformSubCount: SUBS,
    waveformMin: [-amp],
    waveformMax: [amp],
  };
}
function spikeEntry(baseAmp, spikeAmp, spikeSub) {
  const pairs = new Float32Array(SUBS * 2);
  for (let s = 0; s < SUBS; s++) {
    const a = s === spikeSub ? spikeAmp : baseAmp;
    pairs[s * 2] = -a;
    pairs[s * 2 + 1] = a;
  }
  return {
    waveformSubPairs: pairs,
    waveformSubCount: SUBS,
    waveformMin: [-spikeAmp],
    waveformMax: [spikeAmp],
  };
}
// 50 flat entries with one sharp spike at entry 25.
function spikeTrack() {
  return Array.from({ length: 50 }, (_, i) =>
    i === 25 ? spikeEntry(0.2, 0.95, 9) : flatEntry(0.2)
  );
}

describe("sliceWaveformSubHistory", () => {
  it("returns zero arrays without throwing for empty input", () => {
    const r = sliceWaveformSubHistory([], 100, 0, 2, 300);
    expect(r.bucketCount).toBeGreaterThanOrEqual(1);
    expect(r.mins).toHaveLength(2);
    expect(r.maxes[0]).toHaveLength(r.bucketCount);
    expect(r.maxes[0].every((v) => v === 0)).toBe(true);
    expect(Number.isFinite(r.fracPhase)).toBe(true);
    expect(r.firstBucket).toBe(-1);
    expect(r.lastBucket).toBe(-1);
  });

  it("reports the data-bucket range so the envelope can grow from the right", () => {
    // Few entries in a wide window: data occupies only the rightmost buckets.
    const entries = Array.from({ length: 5 }, () => flatEntry(0.5));
    const r = sliceWaveformSubHistory(entries, 50, 0, 1, 300);
    expect(r.firstBucket).toBeGreaterThan(r.bucketCount / 2); // leading half stays empty
    expect(r.lastBucket).toBeGreaterThanOrEqual(r.bucketCount - 2); // data hugs the right edge
  });

  it("emits roughly one bucket per device pixel", () => {
    const r = sliceWaveformSubHistory(spikeTrack(), 50, 0, 1, 300);
    expect(r.bucketCount).toBeGreaterThanOrEqual(300);
    expect(r.bucketCount).toBeLessThanOrEqual(302);
  });

  it("produces a smooth curve — far more distinct levels than the ~50 ticks", () => {
    const entries = Array.from({ length: 50 }, (_, i) => flatEntry((0.8 * (i + 1)) / 50));
    const r = sliceWaveformSubHistory(entries, 50, 0, 1, 300);
    expect(new Set(r.maxes[0]).size).toBeGreaterThan(40);
  });

  it("SCROLL STABILITY: scrolling exactly one bucket translates by one column, peak unchanged", () => {
    const entries = spikeTrack();
    const W = 300;
    const coordsPerBucket = 50 / W;
    const a = sliceWaveformSubHistory(entries, 50, 0, 1, W);
    const b = sliceWaveformSubHistory(entries, 50, coordsPerBucket, 1, W);

    expect(Math.max(...a.maxes[0])).toBeCloseTo(0.95, 5);
    expect(Math.max(...b.maxes[0])).toBeCloseTo(0.95, 5); // peak preserved, not dropped
    expect(b.fracPhase).toBeCloseTo(a.fracPhase, 6); // whole-bucket scroll keeps phase

    const peakA = a.maxes[0].indexOf(Math.max(...a.maxes[0]));
    const peakB = b.maxes[0].indexOf(Math.max(...b.maxes[0]));
    expect(peakB).toBe(peakA + 1); // pure 1-column translation
  });

  it("SUB-BUCKET scroll preserves the peak value and yields fracPhase in [0,1)", () => {
    const entries = spikeTrack();
    const W = 300;
    const coordsPerBucket = 50 / W;
    const c = sliceWaveformSubHistory(entries, 50, coordsPerBucket * 0.4, 1, W);
    expect(Math.max(...c.maxes[0])).toBeCloseTo(0.95, 5);
    expect(c.fracPhase).toBeGreaterThanOrEqual(0);
    expect(c.fracPhase).toBeLessThan(1);
  });

  it("falls back to whole-tick bounds for entries lacking sub-pairs", () => {
    const entries = [
      { waveformMin: [-0.4], waveformMax: [0.4] },
      { waveformMin: [-0.9], waveformMax: [0.9] },
    ];
    const r = sliceWaveformSubHistory(entries, 2, 0, 1, 200);
    expect(Math.max(...r.maxes[0])).toBeCloseTo(0.9, 5);
  });

  it("uses whole-tick bounds when a pixel bucket spans full history entries", () => {
    const entries = Array.from({ length: 100 }, () => flatEntry(0.2));
    entries[40] = {
      ...flatEntry(0.2),
      waveformMin: [-0.95],
      waveformMax: [0.95],
    };

    const r = sliceWaveformSubHistory(entries, 100, 0, 1, 10);

    expect(Math.max(...r.maxes[0])).toBeCloseTo(0.95, 5);
    expect(Math.min(...r.mins[0])).toBeCloseTo(-0.95, 5);
  });

  it("uses whole-tick bounds near the one-entry-per-pixel density cliff", () => {
    const entries = Array.from({ length: 100 }, () => flatEntry(0.2));
    entries[40] = {
      ...flatEntry(0.2),
      waveformMin: [-0.95],
      waveformMax: [0.95],
    };

    const r = sliceWaveformSubHistory(entries, 100, 0, 1, 110);

    expect(Math.max(...r.maxes[0])).toBeCloseTo(0.95, 5);
    expect(Math.min(...r.mins[0])).toBeCloseTo(-0.95, 5);
  });

  it("keeps sub-pair detail when zoomed in beyond the density budget", () => {
    const entries = Array.from({ length: 100 }, () => flatEntry(0.2));
    entries[40] = {
      ...flatEntry(0.2),
      waveformMin: [-0.95],
      waveformMax: [0.95],
    };

    const r = sliceWaveformSubHistory(entries, 100, 0, 1, 200);

    expect(Math.max(...r.maxes[0])).toBeCloseTo(0.2, 5);
    expect(Math.min(...r.mins[0])).toBeCloseTo(-0.2, 5);
  });
});

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomEntry(random, sequence) {
  const channelCount = 1 + Math.floor(random() * 8);
  let minCount = Math.max(0, channelCount - Math.floor(random() * 3));
  let maxCount = Math.max(0, channelCount - Math.floor(random() * 3));
  if (minCount === 0 && maxCount === 0) maxCount = 1;
  const waveformMin = Array.from(
    { length: minCount },
    (_, channel) =>
      -Math.round((random() * 0.9 + channel / 100 + sequence / 1_000_000) * 100_000) / 100_000
  );
  const waveformMax = Array.from(
    { length: maxCount },
    (_, channel) =>
      Math.round((random() * 0.9 + channel / 100 + sequence / 1_000_000) * 100_000) / 100_000
  );
  const waveformSubCount = 3 + Math.floor(random() * 8);
  const waveformSubPairs = new Float32Array(waveformSubCount * channelCount * 2);
  for (let sub = 0; sub < waveformSubCount; sub += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const amplitude = 0.05 + random() * 0.8;
      const base = (sub * channelCount + channel) * 2;
      waveformSubPairs[base] = -amplitude;
      waveformSubPairs[base + 1] = amplitude;
    }
  }
  return { waveformMin, waveformMax, waveformSubCount, waveformSubPairs };
}

function expectSameWaveform(actual, expected) {
  expect(actual.bucketCount).toBe(expected.bucketCount);
  expect(actual.firstBucket).toBe(expected.firstBucket);
  expect(actual.lastBucket).toBe(expected.lastBucket);
  expect(actual.fracPhase).toBeCloseTo(expected.fracPhase, 12);
  expect(actual.mins).toEqual(expected.mins);
  expect(actual.maxes).toEqual(expected.maxes);
}

describe("sliceWaveformSubHistoryFromIndex", () => {
  it("matches the reference across randomized startup, wrap, offsets, widths, and channels", () => {
    let randomCases = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      const random = makeRandom(seed);
      const capacity = 1_250 + seed * 7;
      const index = new WaveformHistoryIndex(capacity);
      const retained = [];
      const appendCount = seed % 2 === 0 ? capacity + 137 : 310 + seed;
      for (let sequence = 0; sequence < appendCount; sequence += 1) {
        const row = randomEntry(random, sequence);
        index.append(row);
        retained.push(row);
        if (retained.length > capacity) retained.splice(0, 1);
      }

      for (const pixelWidth of [600, 1200]) {
        for (const visibleSamples of [
          Math.max(1, Math.floor(retained.length / 3)),
          pixelWidth,
          pixelWidth + 137,
          capacity + 500,
        ]) {
          for (const offset of [0, 1, 7.25]) {
            const channelCount = 1 + Math.floor(random() * 8);
            const expected = sliceWaveformSubHistory(
              retained,
              visibleSamples,
              offset,
              channelCount,
              pixelWidth
            );
            const actual = sliceWaveformSubHistoryFromIndex(
              retained,
              index,
              visibleSamples,
              offset,
              channelCount,
              pixelWidth
            );
            expectSameWaveform(actual, expected);
            randomCases += 1;
          }
        }
      }
    }
    expect(randomCases).toBe(192);
  });

  it("does not read finite 240-minute source rows and bounds wide-window summary work", () => {
    const rows = Array.from({ length: 144_000 }, (_, sequence) => ({
      waveformMin: [-0.5 - (sequence % 7) / 100, -0.4],
      waveformMax: [0.5 + (sequence % 11) / 100, 0.4],
    }));
    const index = new WaveformHistoryIndex(rows.length);
    rows.forEach((row) => index.append(row));
    let sourceReads = 0;
    const source = {
      length: rows.length,
      rowAt(entry) {
        sourceReads += 1;
        return rows[entry];
      },
    };

    const result = sliceWaveformSubHistoryFromIndex(source, index, rows.length, 0, 8, 600);

    expect(result.bucketCount).toBeGreaterThanOrEqual(600);
    expect(sourceReads).toBe(0);
    expect(index.batchQueryStats().rawRowsVisited).toBe(0);
    expect(index.batchQueryStats().nodesVisited).toBeLessThanOrEqual(
      result.bucketCount * (2 * Math.ceil(Math.log2(rows.length)) + 2)
    );
  });

  it("falls back to raw sub-pairs at close zoom with output-bounded source reads", () => {
    const rows = Array.from({ length: 2_000 }, (_, sequence) =>
      sequence === 1_990 ? spikeEntry(0.2, 0.95, 9) : randomEntry(() => 0.2, sequence)
    );
    const index = new WaveformHistoryIndex(rows.length);
    rows.forEach((row) => index.append(row));
    let sourceReads = 0;
    const source = {
      length: rows.length,
      rowAt(entry) {
        sourceReads += 1;
        return rows[entry];
      },
    };

    const expected = sliceWaveformSubHistory(rows, 100, 2.25, 1, 600);
    const actual = sliceWaveformSubHistoryFromIndex(source, index, 100, 2.25, 1, 600);

    expectSameWaveform(actual, expected);
    expect(sourceReads).toBeLessThanOrEqual(102);
    expect(index.batchQueryStats().queries).toBe(0);
  });

  it("preserves order-sensitive NaN buckets by falling back for a wide visible range", () => {
    const rows = [
      { waveformMin: [NaN], waveformMax: [0.1] },
      { waveformMin: [-0.8], waveformMax: [0.8] },
      { waveformMin: [-0.2], waveformMax: [0.2] },
      { waveformMin: [-0.4], waveformMax: [0.4] },
      { waveformMin: [NaN], waveformMax: [0.9] },
      { waveformMin: [-0.7], waveformMax: [NaN] },
    ];
    const index = new WaveformHistoryIndex(rows.length);
    rows.forEach((row) => index.append(row));
    let sourceReads = 0;
    const source = {
      length: rows.length,
      rowAt(entry) {
        sourceReads += 1;
        return rows[entry];
      },
    };

    const expected = sliceWaveformSubHistory(rows, 6, 0, 1, 2);
    const actual = sliceWaveformSubHistoryFromIndex(source, index, 6, 0, 1, 2);

    expectSameWaveform(actual, expected);
    expect(Number.isNaN(actual.mins[0][0])).toBe(true);
    expect(actual.mins[0][1]).toBe(-0.7);
    expect(sourceReads).toBe(6);
    expect(index.batchQueryStats().queries).toBe(0);
  });

  it("keeps the indexed zero-read path when NaN rows are outside the wide visible range", () => {
    const rows = Array.from({ length: 8 }, (_, entry) => ({
      waveformMin: [entry === 0 ? NaN : -entry],
      waveformMax: [entry],
    }));
    const index = new WaveformHistoryIndex(rows.length);
    rows.forEach((row) => index.append(row));
    let sourceReads = 0;
    const source = {
      length: rows.length,
      rowAt(entry) {
        sourceReads += 1;
        return rows[entry];
      },
    };

    const expected = sliceWaveformSubHistory(rows, 4, 0, 1, 2);
    const actual = sliceWaveformSubHistoryFromIndex(source, index, 4, 0, 1, 2);

    expectSameWaveform(actual, expected);
    expect(sourceReads).toBe(0);
    expect(index.batchQueryStats().queries).toBeGreaterThan(0);
  });

  it("matches the reference from a frozen index after live NaN eviction", () => {
    const rows = [
      { waveformMin: [-0.1], waveformMax: [0.1] },
      { waveformMin: [-0.2], waveformMax: [0.2] },
      { waveformMin: [-0.3], waveformMax: [0.3] },
      { waveformMin: [NaN], waveformMax: [0.4] },
      { waveformMin: [-0.5], waveformMax: [0.5] },
      { waveformMin: [-0.6], waveformMax: [0.6] },
    ];
    const index = new WaveformHistoryIndex(rows.length);
    rows.forEach((row) => index.append(row));
    const frozen = index.freeze();
    const frozenRows = rows.map((row) => ({
      waveformMin: [...row.waveformMin],
      waveformMax: [...row.waveformMax],
    }));
    for (let entry = 0; entry < rows.length; entry += 1) {
      index.append({ waveformMin: [-1], waveformMax: [1] });
    }

    const expected = sliceWaveformSubHistory(frozenRows, 6, 0, 1, 2);
    const actual = sliceWaveformSubHistoryFromIndex(frozenRows, frozen, 6, 0, 1, 2);

    expectSameWaveform(actual, expected);
    expect(frozen.hasNaNInRange(0, 5)).toBe(true);
    expect(index.hasNaNInRange(0, 5)).toBe(false);
  });
});
