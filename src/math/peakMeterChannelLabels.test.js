import { describe, expect, it } from "vitest";
import { getPeakMeterChannelLabels, PEAK_METER_CHANNEL_FORMATS } from "./peakMeterChannelLabels.js";

describe("getPeakMeterChannelLabels", () => {
  it("maps mono, stereo, and 5.1", () => {
    expect(getPeakMeterChannelLabels(1)).toEqual(["M"]);
    expect(getPeakMeterChannelLabels(2)).toEqual(["L", "R"]);
    expect(getPeakMeterChannelLabels(6)).toEqual(["L", "R", "C", "LFE", "Ls", "Rs"]);
  });

  it("maps 3-, 4-, and 5-channel rows", () => {
    expect(getPeakMeterChannelLabels(3)).toEqual(["L", "R", "C"]);
    expect(getPeakMeterChannelLabels(4)).toEqual(["L", "R", "Ls", "Rs"]);
    expect(getPeakMeterChannelLabels(5)).toEqual(["L", "R", "C", "Ls", "Rs"]);
  });

  it("maps 7.1 eight-channel strip", () => {
    expect(getPeakMeterChannelLabels(8, { formatId: "7.1" })).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Lb",
      "Rb",
      "Ls",
      "Rs",
    ]);
  });

  it("maps 7.0 seven-channel strip", () => {
    expect(getPeakMeterChannelLabels(7)).toEqual(["L", "R", "C", "Lb", "Rb", "Ls", "Rs"]);
  });

  it("honours formatId when channel count matches that format", () => {
    expect(getPeakMeterChannelLabels(6, { formatId: "5.1" })).toEqual(
      PEAK_METER_CHANNEL_FORMATS["5.1"].labels
    );
    expect(getPeakMeterChannelLabels(2, { formatId: "stereo" })).toEqual(["L", "R"]);
  });

  it("ignores formatId when channel count mismatches", () => {
    expect(getPeakMeterChannelLabels(6, { formatId: "stereo" })).toEqual(
      PEAK_METER_CHANNEL_FORMATS["5.1"].labels
    );
  });

  it("honours overrideLabels at highest priority when length matches", () => {
    expect(
      getPeakMeterChannelLabels(7, {
        channelLayout: "auto",
        resolvedLayout: "unknown",
        overrideLabels: ["L", "R", "C", "LFE", "Ls", "Rs", "Cs"],
      })
    ).toEqual(["L", "R", "C", "LFE", "Ls", "Rs", "Cs"]);
  });

  it("ignores overrideLabels when its length does not match the channel count", () => {
    expect(
      getPeakMeterChannelLabels(6, {
        resolvedLayout: "5.1",
        overrideLabels: ["L", "R"],
      })
    ).toEqual(["L", "R", "C", "LFE", "Ls", "Rs"]);
  });

  it("shows numbered labels when resolvedLayout is unknown, regardless of channel count", () => {
    expect(getPeakMeterChannelLabels(6, { resolvedLayout: "unknown" })).toEqual([
      "Ch 1",
      "Ch 2",
      "Ch 3",
      "Ch 4",
      "Ch 5",
      "Ch 6",
    ]);
    expect(getPeakMeterChannelLabels(8, { resolvedLayout: "unknown" })).toEqual([
      "Ch 1",
      "Ch 2",
      "Ch 3",
      "Ch 4",
      "Ch 5",
      "Ch 6",
      "Ch 7",
      "Ch 8",
    ]);
    expect(getPeakMeterChannelLabels(2, { resolvedLayout: "unknown" })).toEqual(["Ch 1", "Ch 2"]);
  });

  it("shows ITU labels when resolvedLayout is a known format", () => {
    expect(getPeakMeterChannelLabels(8, { formatId: "7.1", resolvedLayout: "7.1" })).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Lb",
      "Rb",
      "Ls",
      "Rs",
    ]);
    expect(getPeakMeterChannelLabels(6, { resolvedLayout: "5.1" })).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Ls",
      "Rs",
    ]);
    expect(getPeakMeterChannelLabels(4, { channelLayout: "auto", resolvedLayout: "quad" })).toEqual(
      ["L", "R", "Ls", "Rs"]
    );
    expect(getPeakMeterChannelLabels(3, { channelLayout: "auto", resolvedLayout: "lcr" })).toEqual([
      "L",
      "R",
      "C",
    ]);
    expect(
      getPeakMeterChannelLabels(5, { channelLayout: "auto", resolvedLayout: "surround50" })
    ).toEqual(["L", "R", "C", "Ls", "Rs"]);
    expect(getPeakMeterChannelLabels(7, { channelLayout: "auto", resolvedLayout: "7.0" })).toEqual([
      "L",
      "R",
      "C",
      "Lb",
      "Rb",
      "Ls",
      "Rs",
    ]);
  });

  it("labels a 12-channel 7.1.4 layout from the shared table", () => {
    expect(getPeakMeterChannelLabels(12, { formatId: "7.1.4" })).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Lb",
      "Rb",
      "Ls",
      "Rs",
      "Ltf",
      "Rtf",
      "Ltr",
      "Rtr",
    ]);
  });

  it("does not name channels for a count with no single standard layout", () => {
    expect(getPeakMeterChannelLabels(10)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Ch ${i + 1}`)
    );
  });
});
