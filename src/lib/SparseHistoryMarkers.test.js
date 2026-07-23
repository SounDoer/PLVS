import { describe, expect, it } from "vitest";
import { SparseHistoryMarkers } from "./SparseHistoryMarkers.js";

const marker = (name) => ({ type: "frequencyChannelChange", from: name, to: `${name}-next` });

describe("SparseHistoryMarkers", () => {
  it("starts empty and advances retained row positions for null markers", () => {
    const markers = new SparseHistoryMarkers(4);

    markers.push(null);
    markers.push(null);

    expect(markers.length).toBe(2);
    expect(markers.capacity).toBe(4);
    expect(markers.query(0, 1)).toEqual([]);
    expect(markers.version).toBe(2);
  });

  it("returns only markers in an inclusive retained logical range", () => {
    const markers = new SparseHistoryMarkers(8);
    markers.push(null);
    markers.push(marker("a"));
    markers.push(null);
    markers.push(marker("b"));
    markers.push(null);

    expect(markers.query(2, 4)).toEqual([{ sequence: 3, logicalIndex: 3, marker: marker("b") }]);
    expect(markers.query(0, 1)).toEqual([{ sequence: 1, logicalIndex: 1, marker: marker("a") }]);
  });

  it("drops wrapped markers and remaps retained logical indices", () => {
    const markers = new SparseHistoryMarkers(3);
    markers.push(marker("expired"));
    markers.push(null);
    markers.push(marker("kept"));
    markers.push(null);
    markers.push(marker("latest"));

    expect(markers.query(0, 2)).toEqual([
      { sequence: 2, logicalIndex: 0, marker: marker("kept") },
      { sequence: 4, logicalIndex: 2, marker: marker("latest") },
    ]);
  });

  it("uses binary bounds and inspects only matching sparse markers", () => {
    const markers = new SparseHistoryMarkers(360_000);
    for (let index = 0; index < 360_000; index += 1) {
      markers.push(
        index === 10 || index === 200_000 || index === 359_999 ? marker(`${index}`) : null
      );
    }

    expect(markers.query(199_999, 200_001)).toEqual([
      { sequence: 200_000, logicalIndex: 200_000, marker: marker("200000") },
    ]);
    expect(markers.lastQueryStats()).toMatchObject({
      markersReturned: 1,
      markersInspected: 1,
    });
    expect(markers.lastQueryStats().binarySearchReads).toBeLessThanOrEqual(6);
  });

  it("freezes stable sequence positions across later wrap and clear", () => {
    const markers = new SparseHistoryMarkers(3);
    markers.push(null);
    markers.push(marker("frozen"));
    markers.push(null);
    const frozen = markers.freeze();

    markers.push(marker("live"));
    markers.clear();

    expect(frozen.capacity).toBe(3);
    expect(frozen.version).toBe(markers.version - 2);
    expect(frozen.query(0, 2)).toEqual([
      { sequence: 1, logicalIndex: 1, marker: marker("frozen") },
    ]);
    expect(markers.query(0, 2)).toEqual([]);
  });

  it("rejects non-positive capacities", () => {
    expect(() => new SparseHistoryMarkers(0)).toThrow(/capacity must be > 0/);
  });
});
