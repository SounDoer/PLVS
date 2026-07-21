/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSnapshot } from "./useSnapshot.js";

const emptyHist = { toArray: () => [] };

function createIntake(samples) {
  return {
    getLoudnessHistory: () => samples.loudness,
    getCorrSnap: () => samples.corr,
    getAudioSnap: () => samples.audio,
    getVisualWaveformHist: () => emptyHist,
  };
}

describe("useSnapshot", () => {
  it("freezes history data while scrubbing and returns to live data afterward", () => {
    const samples = {
      loudness: [{ lufs: -20 }, { lufs: -18 }],
      corr: [0.1, 0.7],
      audio: [
        { peak: -6, correlation: 0.1 },
        { peak: -3, correlation: 0.7 },
      ],
    };
    const intake = createIntake(samples);
    const liveAudio = { peak: -1, correlation: 0.9 };
    const baseProps = { selectedOffset: -1, sampleSec: 1, intake, audio: liveAudio };

    const { result, rerender } = renderHook((props) => useSnapshot(props), {
      initialProps: baseProps,
    });

    expect(result.current.displayAudio).toBe(liveAudio);

    rerender({ ...baseProps, selectedOffset: 0 });
    expect(result.current.displayAudio).toEqual({ peak: -3, correlation: 0.7 });

    samples.audio.push({ peak: -99, correlation: -1 });
    rerender({ ...baseProps, selectedOffset: 1 });
    expect(result.current.displayAudio).toEqual({ peak: -6, correlation: 0.1 });

    rerender(baseProps);
    expect(result.current.displayAudio).toBe(liveAudio);
  });

  it("returns channel metadata for the selected snapshot tick", () => {
    const intake = {
      getLoudnessHistory: () => [
        { m: -20, st: -18 },
        { m: -21, st: -19 },
      ],
      getCorrSnap: () => [0.1, 0.2],
      getAudioSnap: () => [{ correlation: 0.1 }, { correlation: 0.2 }],
      getChannelMetadataSnap: () => [
        { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" },
        { frequencyLabel: "C", vectorscopePairLabel: "L/C" },
      ],
      getVisualWaveformHist: () => emptyHist,
    };

    const { result } = renderHook(() =>
      useSnapshot({ selectedOffset: 0, sampleSec: 0.1, intake, audio: { correlation: 0 } })
    );

    expect(result.current.channelMetadata).toEqual({
      frequencyLabel: "C",
      vectorscopePairLabel: "L/C",
    });
  });

  it("marks a per-key spectrum snapshot missing after that request stopped collecting", () => {
    const samples = {
      loudness: [{ timestampMs: 1000 }, { timestampMs: 1200 }],
      corr: [0.1, 0.2],
      audio: [{ correlation: 0.1 }, { correlation: 0.2 }],
    };
    const intake = createIntake(samples);
    intake.snapshotVisualSpectrumByKey = () => ({
      "spectrum:single:2:combined": [
        {
          timestampMs: 1040,
          bands: [{ fCenter: 100 }],
          dbList: [-30],
        },
        {
          timestampMs: 1080,
          bands: [{ fCenter: 100 }],
          dbList: [-24],
        },
      ],
    });

    const { result } = renderHook(() =>
      useSnapshot({ selectedOffset: 0, sampleSec: 0.1, intake, audio: { correlation: 0 } })
    );

    expect(result.current.resolveSpectrumSnapshotForKey("spectrum:single:2:combined")).toEqual({
      missing: true,
      path: "",
      pathB: "",
      data: null,
    });
  });

  it("returns vectorscope snapshot signal presence from stored pairs", () => {
    const samples = {
      loudness: [{ timestampMs: 1000 }],
      corr: [0.5],
      audio: [{ correlation: 0.5 }],
    };
    const intake = createIntake(samples);
    intake.snapshotVisualVectorscopeByKey = () => ({
      "vectorscope:pair:0:1": {
        length: 1,
        timestampAt: () => 1000,
        rowAt: () => ({
          timestampMs: 1000,
          pairs: new Float32Array([0.25, -0.25]),
          correlation: 0.5,
        }),
      },
    });

    const { result } = renderHook(() =>
      useSnapshot({ selectedOffset: 0, sampleSec: 0.1, intake, audio: { correlation: 0 } })
    );

    const snap = result.current.resolveVectorscopeSnapshotForKey("vectorscope:pair:0:1");
    expect(snap.missing).toBe(false);
    expect(snap.hasSignal).toBe(true);
    expect(snap.correlation).toBe(0.5);
    expect(snap.pairs).toBeInstanceOf(Float32Array);
    expect([...snap.pairs]).toEqual([0.25, -0.25]);
  });

  it("returns no vectorscope pairs when the selected request snapshot is missing", () => {
    const samples = {
      loudness: [{ timestampMs: 1000 }],
      corr: [0.5],
      audio: [{ correlation: 0.5 }],
    };
    const intake = createIntake(samples);
    intake.snapshotVisualVectorscopeByKey = () => ({});

    const { result } = renderHook(() =>
      useSnapshot({ selectedOffset: 0, sampleSec: 0.1, intake, audio: { correlation: 0 } })
    );

    expect(result.current.resolveVectorscopeSnapshotForKey("vectorscope:pair:0:1")).toEqual({
      missing: true,
      path: "",
      pairs: null,
      correlation: -Infinity,
      peakHold: null,
    });
  });

  it("reconstructs Polar Level peak hold after entering history in another mode", () => {
    const samples = {
      loudness: [{ timestampMs: 1000 }],
      corr: [0.5],
      audio: [{ correlation: 0.5 }],
    };
    const intake = createIntake(samples);
    intake.snapshotVisualVectorscopeByKey = () => ({
      "vectorscope:pair:0:1": {
        length: 1,
        timestampAt: () => 1000,
        rowAt: () => ({ timestampMs: 1000, pairs: new Float32Array([1, 1]), correlation: 0.5 }),
      },
    });

    const { result } = renderHook(() =>
      useSnapshot({ selectedOffset: 0, sampleSec: 0.1, intake, audio: { correlation: 0 } })
    );

    // Entering history in Lissajous/Polar Sample resolves the frozen pairs without building a hold.
    const withoutHold = result.current.resolveVectorscopeSnapshotForKey("vectorscope:pair:0:1");
    expect(withoutHold.peakHold).toBeNull();

    // Switching the already-frozen history view to Polar Level + Peak hold reconstructs it lazily.
    const withHold = result.current.resolveVectorscopeSnapshotForKey("vectorscope:pair:0:1", {
      withPeakHold: true,
    });
    expect(withHold.peakHold).toBeInstanceOf(Float64Array);
    expect(withHold.peakHold).toHaveLength(64);
    // Full-scale mono reaches the arc-scale extent (sqrt(2)); reconstruction reflects the row.
    expect(Math.max(...withHold.peakHold)).toBeCloseTo(Math.SQRT2, 5);
  });
});
