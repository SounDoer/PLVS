/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSnapshot } from "./useSnapshot.js";

function createIntake(samples) {
  return {
    getLoudnessHistory: () => samples.loudness,
    getSpectrumSnap: () => samples.spectrum,
    getSpectrumDataSnap: () => samples.spectrumData,
    getVectorSnap: () => samples.vector,
    getCorrSnap: () => samples.corr,
    getAudioSnap: () => samples.audio,
    getSpectrumData: () => samples.liveSpectrumData,
  };
}

describe("useSnapshot", () => {
  it("freezes history data while scrubbing and returns to live data afterward", () => {
    const samples = {
      loudness: [{ lufs: -20 }, { lufs: -18 }],
      spectrum: ["spectrum-0", "spectrum-1"],
      spectrumData: [{ band: 0 }, { band: 1 }],
      vector: ["vector-0", "vector-1"],
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
    expect(result.current.displaySpectrumPath).toBe("spectrum-1");
    expect(result.current.displaySpectrumPeakPath).toBe("");

    samples.audio.push({ peak: -99, correlation: -1 });
    samples.spectrum.push("new-live-spectrum");
    rerender({ ...baseProps, selectedOffset: 1 });
    expect(result.current.displayAudio).toEqual({ peak: -6, correlation: 0.1 });
    expect(result.current.displaySpectrumPath).toBe("spectrum-0");

    rerender(baseProps);
    expect(result.current.displayAudio).toBe(liveAudio);
    expect(result.current.displaySpectrumPath).toBe("live-spectrum");
    expect(result.current.displaySpectrumPeakPath).toBe("live-peak");
  });
});
