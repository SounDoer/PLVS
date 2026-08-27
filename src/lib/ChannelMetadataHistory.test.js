import { describe, expect, it } from "vitest";
import { ChannelMetadataHistory } from "./ChannelMetadataHistory.js";

const stereo = { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" };
const surround = { frequencyLabel: "L/C/R", vectorscopePairLabel: "Ls/Rs" };

describe("ChannelMetadataHistory", () => {
  it("stores repeated metadata once while resolving every logical row", () => {
    const history = new ChannelMetadataHistory(5, { chunkRows: 2 });
    history.push(stereo);
    history.push({ ...stereo });
    history.push({ ...stereo });

    expect(history.length).toBe(3);
    expect(history.changeCount).toBe(1);
    expect(history.rowAt(0)).toEqual(stereo);
    expect(history.at(2)).toEqual(stereo);
  });

  it("resolves exact changes and retains the predecessor across row eviction", () => {
    const history = new ChannelMetadataHistory(3, { chunkRows: 2 });
    history.push(stereo);
    history.push(stereo);
    history.push(surround);
    history.push(surround);
    history.push(surround);

    expect(history.length).toBe(3);
    expect(history.rowAt(0)).toEqual(surround);
    expect(history.rowAt(2)).toEqual(surround);
  });

  it("keeps frozen metadata unchanged after later changes, wrap, and clear", () => {
    const history = new ChannelMetadataHistory(4, { chunkRows: 2 });
    history.push(stereo);
    history.push(stereo);
    history.push(surround);
    const frozen = history.freeze();

    history.push(stereo);
    history.push(stereo);
    history.clear();

    expect(Array.from(frozen)).toEqual([stereo, stereo, surround]);
    expect(frozen.storageStats()).toMatchObject({ changeCount: 2 });
    expect(history.length).toBe(0);
  });
});
