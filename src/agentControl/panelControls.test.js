import { describe, expect, it } from "vitest";
import { readPublicPanelControls } from "./panelControls.js";

describe("readPublicPanelControls", () => {
  it("returns the complete Level Meter control document", () => {
    expect(
      readPublicPanelControls("levelMeter", {
        levelMeterMode: "shortTerm",
        levelMeterPlaybackMax: true,
        levelMeterValueMarker: true,
        levelMeterTpMaxMarker: false,
        levelMeterYMinDb: -48,
        levelMeterYMaxDb: -6,
        loudnessYMinDb: -36,
        loudnessYMaxDb: -12,
      })
    ).toEqual({
      mode: "shortTerm",
      playbackMax: true,
      floatingValue: true,
      tpMaxMarker: false,
      levelRangeDbfs: { min: -48, max: -6 },
      loudnessRangeLufs: { min: -36, max: -12 },
    });
  });

  it("returns the complete Vectorscope control document", () => {
    expect(
      readPublicPanelControls("vectorscope", {
        vectorscopePair: { x: 2, y: 5 },
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelMaxHold: true,
      })
    ).toEqual({
      channelPair: { x: 2, y: 5 },
      mode: "polarLevel",
      maxHold: true,
    });
  });

  it("returns the complete Spectrum control document", () => {
    expect(
      readPublicPanelControls("spectrum", {
        spectrumChannel: { type: "single", ch: 3 },
        spectrumView: "lr",
        spectrumMaxMode: "hold",
        spectrumPeakLabels: true,
        spectrumSpeedPercent: 70,
        spectrumTiltDbPerOctave: 4.5,
        spectrumOctaveSmoothing: "1/6",
        spectrumYMinDb: -72,
        spectrumYMaxDb: -6,
      })
    ).toEqual({
      channel: { type: "single", ch: 3 },
      view: "lr",
      maxMode: "hold",
      peakLabels: true,
      speedPercent: 70,
      tiltDbPerOctave: 4.5,
      octaveSmoothing: "1/6",
      levelRangeDb: { min: -72, max: -6 },
    });
  });

  it("returns the complete Spectrogram control document", () => {
    expect(
      readPublicPanelControls("spectrogram", {
        spectrumChannel: { type: "pair", x: 2, y: 3 },
        spectrogramMode: "surface",
        spectrumTiltDbPerOctave: 2.25,
        spectrumOctaveSmoothing: "1/3",
        spectrogramDbFloor: -66,
        spectrogram3dAzimuthDeg: 210,
        spectrogram3dElevationDeg: 45,
        spectrogram3dHeightGain: 1.5,
        spectrogram3dColorize: false,
        spectrogram3dFloor: false,
      })
    ).toEqual({
      channel: { type: "pair", x: 2, y: 3 },
      mode: "surface",
      tiltDbPerOctave: 2.25,
      octaveSmoothing: "1/3",
      dbFloor: -66,
      threeD: {
        azimuthDeg: 210,
        elevationDeg: 45,
        heightScale: 1.5,
        colorize: false,
        grid: false,
      },
    });
  });

  it("returns the complete Stereo Map control document", () => {
    expect(
      readPublicPanelControls("stereo-map", {
        stereoMapMode: "msRatioDb",
        stereoMapPair: { x: 1, y: 4 },
        stereoMapHold: true,
        stereoMapSpeedPercent: 80,
        stereoMapOctaveSmoothing: "off",
        stereoMapMonoLossYMinDb: -30,
        stereoMapMsRatioYMinDb: -36,
        stereoMapMsRatioYMaxDb: 18,
      })
    ).toEqual({
      mode: "msRatioDb",
      channelPair: { x: 1, y: 4 },
      maxHold: true,
      speedPercent: 80,
      octaveSmoothing: "off",
      monoLossFloorDb: -30,
      msRatioRangeDb: { min: -36, max: 18 },
    });
  });

  it("returns the complete Waveform control document", () => {
    expect(
      readPublicPanelControls("waveform", {
        waveformFrequencyColor: true,
        waveformLowMidSplitHz: 300,
        waveformMidHighSplitHz: 3000,
        waveformCentroid: true,
      })
    ).toEqual({
      frequencyColor: true,
      frequencyBandsHz: { lowMid: 300, midHigh: 3000 },
      centroid: true,
    });
  });

  it("sorts visible Stats metrics by the public metric order", () => {
    expect(
      readPublicPanelControls("stats", {
        statsVisibleIds: ["momentary", "truePeak", "lra"],
        statsOrder: [
          "truePeak",
          "lra",
          "momentary",
          "shortTerm",
          "integrated",
          "momentaryMax",
          "shortTermMax",
          "psr",
          "plr",
          "dialogueCoverage",
          "dialogueIntegrated",
          "dialogueRange",
          "dialogueOffset",
          "correlation",
          "sideToMid",
        ],
      })
    ).toEqual({
      metrics: {
        visible: ["truePeak", "lra", "momentary"],
        order: [
          "truePeak",
          "lra",
          "momentary",
          "shortTerm",
          "integrated",
          "momentaryMax",
          "shortTermMax",
          "psr",
          "plr",
          "dialogueCoverage",
          "dialogueIntegrated",
          "dialogueRange",
          "dialogueOffset",
          "correlation",
          "sideToMid",
        ],
      },
    });
  });

  it("publishes only Loudness layers available under the active Profile", () => {
    const controls = {
      loudnessHistoryVisibleLayerIds: ["ref", "shortTerm", "momentary"],
      loudnessYMinDb: -48,
      loudnessYMaxDb: -6,
    };

    expect(readPublicPanelControls("loudness", controls, { hasLoudnessReference: true })).toEqual({
      layers: ["momentary", "shortTerm", "reference"],
      loudnessRangeLufs: { min: -48, max: -6 },
    });
    expect(readPublicPanelControls("loudness", controls, { hasLoudnessReference: false })).toEqual({
      layers: ["momentary", "shortTerm"],
      loudnessRangeLufs: { min: -48, max: -6 },
    });
  });
});
