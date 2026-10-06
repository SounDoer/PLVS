import { describe, expect, it } from "vitest";
import { firstHistoryTimestampMs, latestHistoryTimestampMs } from "./historyTimestamps.js";

const ring = (rows) => ({ length: rows.length, rowAt: (index) => rows[index] });

describe("history timestamps", () => {
  it("reads both ends of a plain array", () => {
    const rows = [{ timestampMs: 100 }, { timestampMs: 250 }];
    expect(firstHistoryTimestampMs(rows)).toBe(100);
    expect(latestHistoryTimestampMs(rows)).toBe(250);
  });

  it("reads both ends of a history ring", () => {
    const rows = ring([{ timestampMs: 5 }, { timestampMs: 9 }, { timestampMs: 12 }]);
    expect(firstHistoryTimestampMs(rows)).toBe(5);
    expect(latestHistoryTimestampMs(rows)).toBe(12);
  });

  it("answers undefined for an empty list or a row without a finite timestamp", () => {
    expect(firstHistoryTimestampMs([])).toBeUndefined();
    expect(latestHistoryTimestampMs(ring([]))).toBeUndefined();
    expect(latestHistoryTimestampMs([{ timestampMs: Number.NaN }])).toBeUndefined();
  });
});
