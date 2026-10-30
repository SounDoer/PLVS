import { describe, expect, it } from "vitest";
import { DEFAULT_LOUDNESS_PROFILE } from "../../lib/loudnessProfileCatalog.js";
import { loudnessProfileEvaluate } from "../../lib/loudnessProfileEvaluate.js";
import { HOMEPAGE_MULTICHANNEL_714_V1 } from "./homepageMultichannel714V1.js";
import { HOMEPAGE_STEREO_V1 } from "./homepageStereoV1.js";

describe("homepage stereo fixture", () => {
  it("reads the hero verdicts against the starter Profile at its final frame", () => {
    const { loudness } = HOMEPAGE_STEREO_V1.measurementFrame;
    const statuses = loudnessProfileEvaluate(DEFAULT_LOUDNESS_PROFILE, {
      values: {
        momentary: loudness.momentaryLufs,
        shortTerm: loudness.shortTermLufs,
        integrated: loudness.integratedLufs,
        lra: loudness.rangeLu,
        truePeak: loudness.truePeakDbtp,
      },
      integratedReady: true,
    });
    expect(statuses).toEqual({
      momentary: "ok",
      shortTerm: "warn",
      integrated: "warn",
      lra: "ok",
      truePeak: "fail",
    });
  });

  it("keeps every frequency bin and a full minute of history", () => {
    const { source, clock, visuals } = HOMEPAGE_STEREO_V1;
    expect(source.frequencyBinStride).toBe(1);
    expect(source.windowEndMs - source.windowStartMs).toBe(60_000);
    expect(clock.durationMs).toBe(60_000);
    for (const rows of Object.values(visuals.spectrogramByKey)) {
      expect(rows.at(-1).db).toHaveLength(visuals.bandCentersHz.length);
    }
    expect(visuals.spectrogramByKey["spectrum:pair:0:1:ms:sp25:smoff"].at(-1).dbB).toHaveLength(
      visuals.bandCentersHz.length
    );
  });
});

describe("homepage 7.1.4 fixture", () => {
  it("meters twelve 7.1.4 channels, each carrying signal, over a full minute", () => {
    const { audio, measurementFrame, clock, visuals } = HOMEPAGE_MULTICHANNEL_714_V1;
    expect(audio.channelLabels).toEqual([
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
    expect(clock.durationMs).toBe(60_000);
    expect(measurementFrame.peaksDbfs).toHaveLength(12);
    for (const rms of measurementFrame.rmsDbfs) expect(rms).toBeGreaterThan(-40);
    expect(visuals.waveform.at(-1).max).toHaveLength(12);
  });
});
