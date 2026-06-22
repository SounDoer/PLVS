import { describe, expect, it } from "vitest";
import {
  SpectrumHistorySlab,
  FrozenSpectrumHistory,
  EMPTY_SPECTRUM_VIEW,
} from "./SpectrumHistorySlab.js";

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

  it("overwrites the oldest rows after capacity is full", () => {
    const slab = new SpectrumHistorySlab(2, bands);

    slab.push({ bands, dbList: [1, 2, 3], timestampMs: 1 });
    slab.push({ bands, dbList: [4, 5, 6], timestampMs: 2 });
    slab.push({ bands, dbList: [7, 8, 9], timestampMs: 3 });

    expect(slab.length).toBe(2);
    expect(slab.toArray().map((row) => row.timestampMs)).toEqual([2, 3]);
    expect(Array.from(slab.at(1).dbList)).toEqual([7, 8, 9]);
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

    slab.push({ bands, dbList: [-1], timestampMs: 1 });
    slab.push({ bands, dbList: [-2, -3, -4, -5], timestampMs: 2 });

    expect(Array.from(slab.at(0).dbList)).toEqual([-1, -Infinity, -Infinity]);
    expect(Array.from(slab.at(1).dbList)).toEqual([-2, -3, -4]);
  });

  it("detects incompatible band grids", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    expect(slab.matchesBands(bands)).toBe(true);
    expect(slab.matchesBands([{ fCenter: 100 }, { fCenter: 300 }, { fCenter: 400 }])).toBe(false);
    expect(slab.matchesBands([{ fCenter: 100 }, { fCenter: 200 }])).toBe(false);
  });

  it("clear releases backing arrays and resets length", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({ bands, dbList: [-1, -2, -3], timestampMs: 1 });
    const before = slab.dbA;

    slab.clear();

    expect(slab.length).toBe(0);
    expect(slab.dbA).toBeNull();
    expect(slab.timestamps).toBeNull();
    expect(before).toBeInstanceOf(Float32Array);
  });

  it("returns row views backed by one contiguous Float32Array", () => {
    const slab = new SpectrumHistorySlab(4, bands);

    slab.push({ bands, dbList: [-10, -20, -30], timestampMs: 1 });
    slab.push({ bands, dbList: [-11, -21, -31], timestampMs: 2 });

    const first = slab.at(0).dbList;
    const second = slab.at(1).dbList;

    expect(first).toBeInstanceOf(Float32Array);
    expect(second).toBeInstanceOf(Float32Array);
    expect(first.buffer).toBe(slab.dbA.buffer);
    expect(second.buffer).toBe(slab.dbA.buffer);
    expect(first.byteOffset).not.toBe(second.byteOffset);
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
    expect(slab.timestampAt(0)).toBe(1040);
    expect(slab.timestampAt(1)).toBe(1080);
    expect(slab.timestampAt(2)).toBeNaN();
    expect(Array.from(slab.rowAt(0).dbList)).toEqual([-30, -40]);
    expect(slab.rowAt(1).timestampMs).toBe(1080);
    expect(slab.rowAt(5)).toBeUndefined();
  });

  it("freeze() copies the ring and is immune to later pushes", () => {
    const bands = [{ fCenter: 100 }, { fCenter: 200 }];
    const slab = new SpectrumHistorySlab(2, bands);
    slab.push({ bands, dbList: [-10, -20], dbListB: [-1, -2], timestampMs: 1000 });
    slab.push({ bands, dbList: [-30, -40], dbListB: [-3, -4], timestampMs: 1040 });

    const frozen = slab.freeze();
    slab.push({ bands, dbList: [-50, -60], timestampMs: 1080 }); // overwrites slot 0 in the live ring

    expect(frozen).toBeInstanceOf(FrozenSpectrumHistory);
    expect(frozen.length).toBe(2);
    expect(frozen.timestampAt(0)).toBe(1000);
    expect(Array.from(frozen.rowAt(0).dbList)).toEqual([-10, -20]);
    expect(Array.from(frozen.rowAt(0).dbListB)).toEqual([-1, -2]);
    expect(Array.from(frozen.rowAt(1).dbList)).toEqual([-30, -40]);
    // Live ring moved on; frozen snapshot did not.
    expect(Array.from(slab.rowAt(1).dbList)).toEqual([-50, -60]);
  });

  it("EMPTY_SPECTRUM_VIEW is an empty read-only view", () => {
    expect(EMPTY_SPECTRUM_VIEW.length).toBe(0);
    expect(EMPTY_SPECTRUM_VIEW.timestampAt(0)).toBeNaN();
    expect(EMPTY_SPECTRUM_VIEW.rowAt(0)).toBeUndefined();
  });

  it("can return copied rows for snapshot freeze safety", () => {
    const slab = new SpectrumHistorySlab(2, bands);

    slab.push({ bands, dbList: [1, 2, 3], timestampMs: 1 });
    slab.push({ bands, dbList: [4, 5, 6], timestampMs: 2 });

    const live = slab.toArray();
    const frozen = slab.toArray({ copyRows: true });

    slab.push({ bands, dbList: [7, 8, 9], timestampMs: 3 });

    expect(Array.from(live[0].dbList)).toEqual([7, 8, 9]);
    expect(Array.from(frozen[0].dbList)).toEqual([1, 2, 3]);
  });
});
