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

  it("reports the allocated buffer size, not the used size", () => {
    const column = new RaggedFloatColumn(4, 2);
    // 4 rows * 2 values/row * 4 bytes = 32 bytes of values, plus a Uint32 offset table of 5 entries.
    expect(column.byteLength).toBe(4 * 2 * 4 + 5 * 4);
    column.append([1, 2]);
    expect(column.byteLength).toBe(4 * 2 * 4 + 5 * 4);
  });

  it("grows byteLength when an append overruns the initial guess, and does not shrink back", () => {
    const column = new RaggedFloatColumn(2, 1);
    const before = column.byteLength;
    column.append([1, 2, 3]);
    expect(column.byteLength).toBeGreaterThan(before);
    // Doubling from capacity 2 to fit 3 values lands on 4, leaving one value of spare capacity
    // that the next append below uses up without growing again -- byteLength reflects what is
    // allocated, not what is used, and it never shrinks back down.
    const afterGrowth = column.byteLength;
    column.append([9]);
    expect(column.byteLength).toBe(afterGrowth);
  });

  it("returns a live view into the column's buffer, not a copy", () => {
    const column = new RaggedFloatColumn(4, 2);
    column.append([1, 2]);
    column.at(0)[0] = 42;
    expect(Array.from(column.at(0))).toEqual([42, 2]);
  });
});
