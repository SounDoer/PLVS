import { describe, expect, it } from "vitest";
import { ChunkedSequence } from "./ChunkedSequence.js";

describe("ChunkedSequence", () => {
  it("retains chronological values through wrap and partial front chunks", () => {
    const sequence = new ChunkedSequence(5, { chunkRows: 4 });
    for (let value = 0; value < 9; value += 1) sequence.push(`row-${value}`);

    expect(sequence.length).toBe(5);
    expect(Array.from(sequence)).toEqual(["row-4", "row-5", "row-6", "row-7", "row-8"]);
    expect(sequence.at(0)).toBe("row-4");
    expect(sequence.rowAt(4)).toBe("row-8");
    expect(sequence.at(-1)).toBeUndefined();
    expect(sequence.at(5)).toBeUndefined();
  });

  it("freezes by sharing sealed chunks and copying only retained active-tail values", () => {
    const sequence = new ChunkedSequence(6, { chunkRows: 4 });
    for (let value = 0; value < 7; value += 1) sequence.push({ value });

    const frozen = sequence.freeze();

    expect(Array.from(frozen, (row) => row.value)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(frozen.storageStats()).toMatchObject({
      retainedRows: 6,
      sharedSealedChunks: 1,
      copiedTailRows: 3,
      copiedReferences: 3,
    });
  });

  it("keeps frozen values unchanged after live wrap and clear", () => {
    const sequence = new ChunkedSequence(4, { chunkRows: 2 });
    sequence.push("a");
    sequence.push("b");
    sequence.push("c");
    const first = sequence.freeze();

    sequence.push("d");
    sequence.push("e");
    sequence.push("f");
    const second = sequence.freeze();
    sequence.clear();
    sequence.push("after-clear");

    expect(Array.from(first)).toEqual(["a", "b", "c"]);
    expect(Array.from(second)).toEqual(["c", "d", "e", "f"]);
    expect(Array.from(sequence)).toEqual(["after-clear"]);
  });

  it("freezes an empty sequence", () => {
    const sequence = new ChunkedSequence(3, { chunkRows: 2 });
    const frozen = sequence.freeze();

    expect(frozen.length).toBe(0);
    expect(Array.from(frozen)).toEqual([]);
    expect(frozen.storageStats()).toMatchObject({
      retainedRows: 0,
      sharedSealedChunks: 0,
      copiedTailRows: 0,
      copiedReferences: 0,
    });
  });

  it("rejects invalid capacities and chunk sizes", () => {
    expect(() => new ChunkedSequence(0)).toThrow(RangeError);
    expect(() => new ChunkedSequence(1, { chunkRows: 0 })).toThrow(RangeError);
  });
});
