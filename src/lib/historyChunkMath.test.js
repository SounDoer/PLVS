import { describe, expect, it } from "vitest";

import {
  chunkIdForSequence,
  chunkOffsetForSequence,
  findChunkForSequence,
} from "./historyChunkMath.js";

describe("history chunk sequence helpers", () => {
  const chunkRows = 512;

  it.each([
    [0, 0],
    [chunkRows - 1, 0],
    [chunkRows, 1],
    [chunkRows * 2 - 1, 1],
  ])("maps sequence %s to chunk %s", (sequence, expectedChunkId) => {
    expect(chunkIdForSequence(sequence, chunkRows)).toBe(expectedChunkId);
  });

  it.each([
    [0, 0],
    [chunkRows - 1, chunkRows - 1],
    [chunkRows, 0],
    [chunkRows * 2 - 1, chunkRows - 1],
  ])("maps sequence %s to offset %s", (sequence, expectedOffset) => {
    expect(chunkOffsetForSequence(sequence, chunkRows)).toBe(expectedOffset);
  });

  it("finds a chunk relative to a non-zero first chunk id", () => {
    const chunks = [{ id: 4 }, { id: 5 }, { id: 6 }];

    expect(findChunkForSequence(chunks, 4, 5 * chunkRows + 17, chunkRows)).toBe(chunks[1]);
  });

  it("returns undefined when the sequence chunk is missing", () => {
    const chunks = [{ id: 4 }, { id: 5 }];

    expect(findChunkForSequence(chunks, 4, 6 * chunkRows, chunkRows)).toBeUndefined();
  });
});
