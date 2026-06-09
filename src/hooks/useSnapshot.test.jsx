/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSnapshot } from "./useSnapshot.js";

const emptyHist = { toArray: () => [] };

function createIntake(samples) {
  return {
    getLoudnessHistory: () => samples.loudness,
    getSpectrumDataSnap: () => samples.spectrumData,
    getCorrSnap: () => samples.corr,
    getAudioSnap: () => samples.audio,
    getSpectrumData: () => samples.liveSpectrumData,
    getVisualWaveformHist: () => emptyHist,
    getVisualSpectrumHist: () => emptyHist,
    getVisualVectorscopeHist: () => emptyHist,
    getVisualCorrHist: () => emptyHist,
  };
}

describe("useSnapshot", () => {
  it("freezes history data while scrubbing and returns to live data afterward", () => {
    const samples = {
      loudness: [{ lufs: -20 }, { lufs: -18 }],
      spectrumData: [{ band: 0 }, { band: 1 }],
      corr: [0.1, 0.7],
      audio: [
        { peak: -6, correlation: 0.1 },
        { peak: -3, correlation: 0.7 },
      ],
      liveSpectrumData: { band: "live" },
    };
    const intake = createIntake(samples);
    const liveAudio = { peak: -1, correlation: 0.9 };
    const baseProps = {
      selectedOffset: -1,
      sampleSec: 1,
      intake,
      audio: liveAudio,
      spectrumPath: "live-spectrum",
      spectrumPeakPath: "live-peak",
      vectorPath: "live-vector",
    };

    const { result, rerender } = renderHook((props) => useSnapshot(props), {
      initialProps: baseProps,
    });

    expect(result.current.displayAudio).toBe(liveAudio);
    expect(result.current.displaySpectrumPath).toBe("live-spectrum");

    rerender({ ...baseProps, selectedOffset: 0 });
    expect(result.current.displayAudio).toEqual({ peak: -3, correlation: 0.7 });
    // No visual ring in this mock: spectrum path falls back to the live path.
    expect(result.current.displaySpectrumPath).toBe("live-spectrum");
    expect(result.current.displaySpectrumPeakPath).toBe("");

    samples.audio.push({ peak: -99, correlation: -1 });
    rerender({ ...baseProps, selectedOffset: 1 });
    expect(result.current.displayAudio).toEqual({ peak: -6, correlation: 0.1 });
    expect(result.current.displaySpectrumPath).toBe("live-spectrum");

    rerender(baseProps);
    expect(result.current.displayAudio).toBe(liveAudio);
    expect(result.current.displaySpectrumPath).toBe("live-spectrum");
    expect(result.current.displaySpectrumPeakPath).toBe("live-peak");
  });

  it("returns channel metadata for the selected snapshot tick", () => {
    const intake = {
      getLoudnessHistory: () => [
        { m: -20, st: -18 },
        { m: -21, st: -19 },
      ],
      getSpectrumDataSnap: () => [{ dbList: [-20] }, { dbList: [-30] }],
      getCorrSnap: () => [0.1, 0.2],
      getAudioSnap: () => [{ correlation: 0.1 }, { correlation: 0.2 }],
      getSpectrumData: () => ({ dbList: [-1] }),
      getChannelMetadataSnap: () => [
        { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" },
        { frequencyLabel: "C", vectorscopePairLabel: "L/C" },
      ],
      getVisualWaveformHist: () => emptyHist,
      getVisualSpectrumHist: () => emptyHist,
      getVisualVectorscopeHist: () => emptyHist,
      getVisualCorrHist: () => emptyHist,
    };

    const { result } = renderHook(() =>
      useSnapshot({
        selectedOffset: 0,
        sampleSec: 0.1,
        intake,
        audio: { correlation: 0 },
        spectrumPath: "live-spectrum",
        spectrumPeakPath: "live-peak",
        vectorPath: "live-vector",
      })
    );

    expect(result.current.channelMetadata).toEqual({
      frequencyLabel: "C",
      vectorscopePairLabel: "L/C",
    });
  });

  it("selects visual snapshots by timestamp instead of fixed visual cadence", () => {
    const intake = createIntake({
      loudness: [{ timestampMs: 500 }, { timestampMs: 1000 }],
      spectrumData: [
        { bands: [{ fCenter: 100 }], dbList: [-40] },
        { bands: [{ fCenter: 100 }], dbList: [-20] },
      ],
      corr: [0.1, 0.2],
      audio: [{ correlation: 0.1 }, { correlation: 0.2 }],
      liveSpectrumData: { bands: [{ fCenter: 100 }], dbList: [-10] },
    });
    intake.getVisualSpectrumHist = () => ({
      toArray: () =>
        [500, 760, 830, 1000].map((timestampMs, i) => ({
          timestampMs,
          bands: [{ fCenter: 100 }],
          dbList: [-50 + i],
        })),
    });
    intake.getVisualVectorscopeHist = () => ({
      toArray: () =>
        [500, 760, 830, 1000].map((timestampMs, i) => ({
          timestampMs,
          pairs: [i, i],
        })),
    });

    const { result } = renderHook(() =>
      useSnapshot({
        selectedOffset: 0.2,
        sampleSec: 0.1,
        intake,
        audio: { correlation: 0 },
        spectrumPath: "live-spectrum",
        spectrumPeakPath: "live-peak",
        vectorPath: "live-vector",
      })
    );

    expect(result.current.visualSnapIdx).toBe(2);
  });
});
