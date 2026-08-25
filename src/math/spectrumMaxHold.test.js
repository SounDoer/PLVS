import { describe, expect, it } from "vitest";
import {
  accumulateSpectrumMaxHold,
  buildSpectrumMaxHoldTable,
  spectrumMaxHoldAt,
} from "./spectrumMaxHold.js";

/** A stand-in for a frozen SpectrumHistorySlab: rowAt(index) is all the table builder needs. */
function fakeHistory(rows) {
  return {
    length: rows.length,
    rowAt(index) {
      if (index < 0 || index >= rows.length) return undefined;
      const row = rows[index];
      return { dbList: row.a, dbListB: row.b ?? [], bands: [], timestampMs: index };
    },
  };
}

/** The definition the table has to match: fold every row from 0 to index. */
function naiveFold(rows, index, plane) {
  const bandCount = rows[0][plane]?.length ?? 0;
  const out = new Float32Array(bandCount).fill(-Infinity);
  for (let i = 0; i <= index; i += 1) {
    const values = rows[i][plane] ?? [];
    for (let band = 0; band < bandCount; band += 1) {
      const value = values[band];
      if (Number.isFinite(value) && value > out[band]) out[band] = value;
    }
  }
  return out;
}

describe("accumulateSpectrumMaxHold", () => {
  it("takes the per-band maximum across frames", () => {
    let held = accumulateSpectrumMaxHold(null, [-30, -50, -70]);
    held = accumulateSpectrumMaxHold(held, [-40, -20, -80]);

    expect(Array.from(held)).toEqual([-30, -20, -70]);
  });

  it("reuses the same buffer while the band count holds, so the live path stops allocating", () => {
    const first = accumulateSpectrumMaxHold(null, [-30, -50]);
    const second = accumulateSpectrumMaxHold(first, [-20, -60]);

    expect(second).toBe(first);
  });

  it("starts a new hold when the band count changes", () => {
    const first = accumulateSpectrumMaxHold(null, [-30, -50]);
    const second = accumulateSpectrumMaxHold(first, [-30, -50, -70]);

    expect(second).not.toBe(first);
    expect(Array.from(second)).toEqual([-30, -50, -70]);
  });

  it("leaves a band untouched when its incoming value is not finite", () => {
    let held = accumulateSpectrumMaxHold(null, [-30, -50]);
    held = accumulateSpectrumMaxHold(held, [Number.NaN, -Infinity]);

    expect(Array.from(held)).toEqual([-30, -50]);
  });

  it("holds a band that has never seen a finite value at -Infinity", () => {
    const held = accumulateSpectrumMaxHold(null, [Number.NaN, -20]);

    expect(held[0]).toBe(-Infinity);
    expect(held[1]).toBe(-20);
  });

  it("returns the previous hold unchanged for an empty row", () => {
    const first = accumulateSpectrumMaxHold(null, [-30]);

    expect(accumulateSpectrumMaxHold(first, [])).toBe(first);
    expect(accumulateSpectrumMaxHold(null, [])).toBeNull();
  });
});

describe("spectrumMaxHoldAt", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    a: [-60 + i, -40 - (i % 7), -80 + ((i * 3) % 11)],
    b: [-70 + ((i * 2) % 9), -50 + (i % 5), -90 + i],
  }));

  it("matches a naive fold at every row, with buckets smaller than the history", () => {
    const built = buildSpectrumMaxHoldTable(fakeHistory(rows), 4);

    for (let index = 0; index < rows.length; index += 1) {
      const held = spectrumMaxHoldAt(built, index);
      expect(Array.from(held.dbList)).toEqual(Array.from(naiveFold(rows, index, "a")));
      expect(Array.from(held.dbListB)).toEqual(Array.from(naiveFold(rows, index, "b")));
    }
  });

  it("matches a naive fold when one bucket covers the whole history", () => {
    const built = buildSpectrumMaxHoldTable(fakeHistory(rows), 1000);
    const held = spectrumMaxHoldAt(built, rows.length - 1);

    expect(Array.from(held.dbList)).toEqual(Array.from(naiveFold(rows, rows.length - 1, "a")));
  });

  it("returns null outside the history", () => {
    const built = buildSpectrumMaxHoldTable(fakeHistory(rows), 4);

    expect(spectrumMaxHoldAt(built, -1)).toBeNull();
    expect(spectrumMaxHoldAt(built, rows.length)).toBeNull();
  });

  it("leaves the second plane empty for a history whose rows carry one curve", () => {
    const singles = rows.map((row) => ({ a: row.a }));
    const built = buildSpectrumMaxHoldTable(fakeHistory(singles), 4);
    const held = spectrumMaxHoldAt(built, 10);

    expect(Array.from(held.dbList)).toEqual(Array.from(naiveFold(singles, 10, "a")));
    expect(held.dbListB.length).toBe(0);
  });

  it("handles an empty history", () => {
    const built = buildSpectrumMaxHoldTable(fakeHistory([]), 4);

    expect(built.length).toBe(0);
    expect(spectrumMaxHoldAt(built, 0)).toBeNull();
  });
});
