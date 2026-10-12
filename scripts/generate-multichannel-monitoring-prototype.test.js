import { describe, expect, it } from "vitest";
import { buildMultichannelMonitoringPrototypePlan } from "./generate-multichannel-monitoring-prototype.mjs";

describe("Multichannel Monitoring prototype plan", () => {
  it("keeps review-only assets out of the public Theme contract", async () => {
    const plan = await buildMultichannelMonitoringPrototypePlan("plvs-dark");
    expect(plan.assets).toEqual([
      expect.objectContaining({
        id: "multichannel-preset-1280x800",
        surface: "preset",
        viewport: expect.objectContaining({ widthCssPx: 1280, heightCssPx: 800 }),
      }),
      expect.objectContaining({
        id: "multichannel-theme-1280x800",
        surface: "theme",
        viewport: expect.objectContaining({ widthCssPx: 1280, heightCssPx: 800 }),
      }),
    ]);
    expect(plan.multichannelFixture.measurementFrame.channelCount).toBe(6);
    expect(plan.multichannelFixture.audio.channelLabels).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Ls",
      "Rs",
    ]);
  });
});
