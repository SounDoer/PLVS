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
    expect(getPeakMeterChannelLabels(8)).toEqual(["L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb"]);
  });

  it("falls back to Ch n for unknown counts (e.g. 7)", () => {
    expect(getPeakMeterChannelLabels(7)).toEqual([
      "Ch 1",
      "Ch 2",
      "Ch 3",
      "Ch 4",
      "Ch 5",
      "Ch 6",
      "Ch 7",
    ]);
  });

  it("honours formatId when channel count matches that format", () => {
    expect(getPeakMeterChannelLabels(6, { formatId: "surround51" })).toEqual(
      PEAK_METER_CHANNEL_FORMATS.surround51.labels
    );
    expect(getPeakMeterChannelLabels(2, { formatId: "stereo" })).toEqual(["L", "R"]);
  });

  it("ignores formatId when channel count mismatches", () => {
    expect(getPeakMeterChannelLabels(6, { formatId: "stereo" })).toEqual(
      PEAK_METER_CHANNEL_FORMATS.surround51.labels
    );
  });
});
