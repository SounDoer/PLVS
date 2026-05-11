import { describe, it, expect } from "vitest";
import { getPeakChannels } from "./peakChannelMath";

describe("getPeakChannels", () => {
  it("uses peakDb when present (multichannel) with layout labels", () => {
    const ch = getPeakChannels({ peakDb: [-1, -2, -3], peakHoldDb: [-10, -20, -30] }, {});
    expect(ch).toEqual([
      { label: "L", valueDb: -1, holdDb: -10 },
      { label: "R", valueDb: -2, holdDb: -20 },
      { label: "C", valueDb: -3, holdDb: -30 },
    ]);
  });

  it("uses peakDb with generic Ch when count has no format row", () => {
    const ch = getPeakChannels({ peakDb: [-1, -2, -3, -4, -5, -6, -7] }, {});
    expect(ch.map((c) => c.label)).toEqual([
      "Ch 1",
      "Ch 2",
      "Ch 3",
      "Ch 4",
      "Ch 5",
      "Ch 6",
      "Ch 7",
    ]);
  });

  it("falls back to L/R when peakDb missing", () => {
    const ch = getPeakChannels({
      sampleL: -6,
      sampleR: -7,
      samplePeakMaxL: -1,
      samplePeakMaxR: -2,
    });
    expect(ch).toEqual([
      { label: "L", valueDb: -6, holdDb: -1 },
      { label: "R", valueDb: -7, holdDb: -2 },
    ]);
  });
});
