import { describe, it, expect } from "vitest";
import { getPeakChannels } from "./peakChannelMath";

describe("getPeakChannels", () => {
  it("uses peakDb when present (multichannel) with layout labels", () => {
    const ch = getPeakChannels({ peakDb: [-1, -2, -3] }, {});
    expect(ch).toEqual([
      { label: "L", valueDb: -1 },
      { label: "R", valueDb: -2 },
      { label: "C", valueDb: -3 },
    ]);
  });

  it("uses peakDb with 7.0 layout labels for seven channels", () => {
    const ch = getPeakChannels({ peakDb: [-1, -2, -3, -4, -5, -6, -7] }, {});
    expect(ch.map((c) => c.label)).toEqual(["L", "R", "C", "Ls", "Rs", "Lb", "Rb"]);
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
});
