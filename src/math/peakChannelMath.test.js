import { describe, it, expect } from "vitest";
import { getPeakChannels, getPeakChannelSpacingScale } from "./peakChannelMath";

describe("getPeakChannels", () => {
  it("uses peakDb when present (multichannel) with layout labels", () => {
    const ch = getPeakChannels({ peakDb: [-1, -2, -3] }, {});
    expect(ch).toEqual([
      { label: "L", valueDb: -1 },
      { label: "R", valueDb: -2 },
      { label: "C", valueDb: -3 },
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
    const ch = getPeakChannels({ sampleL: -6, sampleR: -7 });
    expect(ch).toEqual([
      { label: "L", valueDb: -6 },
      { label: "R", valueDb: -7 },
    ]);
  });

  it("caps peakDb at 16 channels", () => {
    const peakDb = Array.from({ length: 20 }, (_, i) => -(i + 1));
    const ch = getPeakChannels({ peakDb });
    expect(ch).toHaveLength(16);
    expect(ch[15].valueDb).toBe(-16);
  });

  it("shows numbered labels in auto/unknown layout for multichannel peakDb", () => {
    const ch = getPeakChannels({ peakDb: [-1, -2, -3, -4, -5, -6] }, { resolvedLayout: "unknown" });
    expect(ch.map((c) => c.label)).toEqual(["Ch 1", "Ch 2", "Ch 3", "Ch 4", "Ch 5", "Ch 6"]);
    expect(ch[0].valueDb).toBe(-1);
    expect(ch[5].valueDb).toBe(-6);
  });

  it("scales peak channel spacing down as channel count grows", () => {
    expect(getPeakChannelSpacingScale(1)).toBe(1);
    expect(getPeakChannelSpacingScale(2)).toBe(1);
    expect(getPeakChannelSpacingScale(6)).toBeCloseTo(1 / 3);
    expect(getPeakChannelSpacingScale(8)).toBeCloseTo(0.25);
    expect(getPeakChannelSpacingScale(16)).toBeCloseTo(0.125);
  });

  it("uses full spacing when channel count is unavailable", () => {
    expect(getPeakChannelSpacingScale(undefined)).toBe(1);
    expect(getPeakChannelSpacingScale(0)).toBe(1);
    expect(getPeakChannelSpacingScale(Number.NaN)).toBe(1);
  });
});
