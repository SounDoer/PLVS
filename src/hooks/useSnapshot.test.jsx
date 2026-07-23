/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSnapshot } from "./useSnapshot.js";
import { SpectrumHistorySlab } from "../lib/SpectrumHistorySlab.js";
import { VectorscopeHistorySlab } from "../lib/VectorscopeHistorySlab.js";

const emptyHist = { toArray: () => [] };

function createIntake(samples) {
  return {
    getLoudnessHistory: () => samples.loudness,
    getCorrSnap: () => samples.corr,
    getAudioSnap: () => samples.audio,
    getVisualWaveformHist: () => emptyHist,
  };
}

function countingTimestampRows(timestamps) {
  let reads = 0;
  return {
    rows: timestamps.map((timestampMs) => ({
      get timestampMs() {
        reads += 1;
        return timestampMs;
      },
    })),
    reads: () => reads,
  };
}

function countingVisualView(rows) {
  let timestampReads = 0;
  let rowReads = 0;
  return {
    view: {
      length: rows.length,
      timestampAt(index) {
        timestampReads += 1;
        return rows[index]?.timestampMs ?? NaN;
      },
      rowAt(index) {
        rowReads += 1;
        return rows[index];
      },
    },
    timestampReads: () => timestampReads,
    rowReads: () => rowReads,
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

  it("memoizes main snapshot resolution across live audio rerenders", () => {
    const loudness = countingTimestampRows([1000, 1100]);
    const intake = createIntake({
      loudness: loudness.rows,
      corr: [0.1, 0.2],
      audio: [{ correlation: 0.1 }, { correlation: 0.2 }],
    });
    const baseProps = { selectedOffset: 0, sampleSec: 0.1, intake };
    const { result, rerender } = renderHook((props) => useSnapshot(props), {
      initialProps: { ...baseProps, audio: { correlation: 0.8 } },
    });
    const readsAfterResolve = loudness.reads();
    const spectrumResolver = result.current.resolveSpectrumSnapshotForKey;
    const vectorscopeResolver = result.current.resolveVectorscopeSnapshotForKey;

    rerender({ ...baseProps, audio: { correlation: -0.8 } });

    expect(loudness.reads()).toBe(readsAfterResolve);
    expect(result.current.resolveSpectrumSnapshotForKey).toBe(spectrumResolver);
    expect(result.current.resolveVectorscopeSnapshotForKey).toBe(vectorscopeResolver);

    rerender({ ...baseProps, selectedOffset: 0.1, audio: { correlation: 0.4 } });
    expect(loudness.reads()).toBeGreaterThan(readsAfterResolve);
  });

  it("memoizes Spectrum results per key and target without refreezing while scrubbing", () => {
    const spectrum = countingVisualView([
      {
        timestampMs: 1000,
        bands: [{ fCenter: 100 }, { fCenter: 1000 }],
        dbList: [-30, -20],
      },
      {
        timestampMs: 1100,
        bands: [{ fCenter: 100 }, { fCenter: 1000 }],
        dbList: [-24, -18],
      },
    ]);
    let freezes = 0;
    const intake = createIntake({
      loudness: [{ timestampMs: 1000 }, { timestampMs: 1100 }],
      corr: [0.1, 0.2],
      audio: [{ correlation: 0.1 }, { correlation: 0.2 }],
    });
    intake.snapshotVisualSpectrumByKey = () => {
      freezes += 1;
      return { spectrum: spectrum.view };
    };
    const baseProps = { selectedOffset: 0, sampleSec: 0.1, intake, audio: { correlation: 0.8 } };
    const { result, rerender } = renderHook((props) => useSnapshot(props), {
      initialProps: baseProps,
    });

    const first = result.current.resolveSpectrumSnapshotForKey("spectrum");
    const readsAfterFirst = spectrum.timestampReads();
    const rowReadsAfterFirst = spectrum.rowReads();
    const second = result.current.resolveSpectrumSnapshotForKey("spectrum");

    expect(second).toBe(first);
    expect(spectrum.timestampReads()).toBe(readsAfterFirst);
    expect(spectrum.rowReads()).toBe(rowReadsAfterFirst);

    rerender({ ...baseProps, selectedOffset: 0.1 });
    const atEarlierTarget = result.current.resolveSpectrumSnapshotForKey("spectrum");
    expect(atEarlierTarget).not.toBe(first);
    expect(spectrum.timestampReads()).toBeGreaterThan(readsAfterFirst);
    expect(freezes).toBe(1);
  });

  it("freezes visual slabs once per snapshot session and resolves their typed row views", () => {
    const bands = [{ fCenter: 100 }, { fCenter: 1000 }];
    const spectrumSlab = new SpectrumHistorySlab(4, bands);
    const vectorscopeSlab = new VectorscopeHistorySlab(4, 2);
    for (const [index, timestampMs] of [1000, 1100].entries()) {
      spectrumSlab.push({
        bands,
        dbList: [-30 + index, -20 + index],
        timestampMs,
      });
      vectorscopeSlab.push({
        pairs: [0.25 + index, -0.25 - index],
        correlation: 0.5,
        timestampMs,
      });
    }

    let spectrumFreezes = 0;
    let vectorscopeFreezes = 0;
    let frozenSpectrum;
    let frozenVectorscope;
    const intake = createIntake({
      loudness: [{ timestampMs: 1000 }, { timestampMs: 1100 }],
      corr: [0.5, 0.5],
      audio: [{ correlation: 0.5 }, { correlation: 0.5 }],
    });
    intake.snapshotVisualSpectrumByKey = () => {
      spectrumFreezes += 1;
      frozenSpectrum = spectrumSlab.freeze();
      return { spectrum: frozenSpectrum };
    };
    intake.snapshotVisualVectorscopeByKey = () => {
      vectorscopeFreezes += 1;
      frozenVectorscope = vectorscopeSlab.freeze();
      return { vectorscope: frozenVectorscope };
    };
    const baseProps = { sampleSec: 0.1, intake, audio: { correlation: 0.8 } };
    const { result, rerender } = renderHook((props) => useSnapshot(props), {
      initialProps: { ...baseProps, selectedOffset: -1 },
    });

    rerender({ ...baseProps, selectedOffset: 0 });
    const spectrum = result.current.resolveSpectrumSnapshotForKey("spectrum");
    const vectorscope = result.current.resolveVectorscopeSnapshotForKey("vectorscope");

    expect(spectrumFreezes).toBe(1);
    expect(vectorscopeFreezes).toBe(1);
    expect(result.current.snapshotSpectrumByKey.spectrum).toBe(frozenSpectrum);
    expect(frozenSpectrum.constructor.name).toBe("FrozenSpectrumHistory");
    expect(frozenVectorscope.constructor.name).toBe("FrozenVectorscopeHistory");
    expect(spectrum.data.dbList).toBeInstanceOf(Float32Array);
    expect(spectrum.data.dbList.buffer).toBe(frozenSpectrum.rowAt(1).dbList.buffer);
    expect(vectorscope.pairs).toBeInstanceOf(Float32Array);
    expect(vectorscope.pairs.buffer).toBe(frozenVectorscope.rowAt(1).pairs.buffer);

    rerender({ ...baseProps, selectedOffset: 0.1 });
    result.current.resolveSpectrumSnapshotForKey("spectrum");
    result.current.resolveVectorscopeSnapshotForKey("vectorscope");
    expect(spectrumFreezes).toBe(1);
    expect(vectorscopeFreezes).toBe(1);
  });

  it("separates Vectorscope result caches by peak-hold mode", () => {
    const vectorscope = countingVisualView([
      {
        timestampMs: 1000,
        pairs: new Float32Array([0.25, 0.25]),
        correlation: 0.5,
      },
    ]);
    const intake = createIntake({
      loudness: [{ timestampMs: 1000 }],
      corr: [0.5],
      audio: [{ correlation: 0.5 }],
    });
    intake.snapshotVisualVectorscopeByKey = () => ({ vectorscope: vectorscope.view });
    const { result } = renderHook(() =>
      useSnapshot({ selectedOffset: 0, sampleSec: 0.1, intake, audio: { correlation: 0 } })
    );

    const withoutHold = result.current.resolveVectorscopeSnapshotForKey("vectorscope");
    const readsWithoutHold = vectorscope.timestampReads();
    expect(result.current.resolveVectorscopeSnapshotForKey("vectorscope")).toBe(withoutHold);
    expect(vectorscope.timestampReads()).toBe(readsWithoutHold);

    const withHold = result.current.resolveVectorscopeSnapshotForKey("vectorscope", {
      withPeakHold: true,
    });
    const readsWithHold = vectorscope.timestampReads();
    expect(withHold).not.toBe(withoutHold);
    expect(withHold.peakHold).toBeInstanceOf(Float64Array);
    expect(
      result.current.resolveVectorscopeSnapshotForKey("vectorscope", { withPeakHold: true })
    ).toBe(withHold);
    expect(vectorscope.timestampReads()).toBe(readsWithHold);
  });

  it("starts fresh keyed caches for a new snapshot session and caches missing results", () => {
    const spectrum = countingVisualView([
      {
        timestampMs: 1000,
        bands: [{ fCenter: 100 }],
        dbList: [-30],
      },
    ]);
    const intake = createIntake({
      loudness: [{ timestampMs: 1000 }],
      corr: [0.1],
      audio: [{ correlation: 0.1 }],
    });
    intake.snapshotVisualSpectrumByKey = () => ({ spectrum: spectrum.view });
    const baseProps = { selectedOffset: 0, sampleSec: 0.1, intake, audio: { correlation: 0.8 } };
    const { result, rerender } = renderHook((props) => useSnapshot(props), {
      initialProps: baseProps,
    });

    const first = result.current.resolveSpectrumSnapshotForKey("spectrum");
    const readsAfterFirstSession = spectrum.timestampReads();
    const missing = result.current.resolveSpectrumSnapshotForKey("missing");
    expect(result.current.resolveSpectrumSnapshotForKey("missing")).toBe(missing);

    rerender({ ...baseProps, selectedOffset: -1 });
    rerender(baseProps);
    const nextSession = result.current.resolveSpectrumSnapshotForKey("spectrum");

    expect(nextSession).not.toBe(first);
    expect(spectrum.timestampReads()).toBeGreaterThan(readsAfterFirstSession);
  });

  it("retains keyed results only for the current snapshot target", () => {
    const rows = Array.from({ length: 32 }, (_, index) => ({
      timestampMs: 1000 + index * 100,
    }));
    const spectrum = countingVisualView(
      rows.map(({ timestampMs }, index) => ({
        timestampMs,
        bands: [{ fCenter: 100 }],
        dbList: [-30 + index],
      }))
    );
    const vectorscope = countingVisualView(
      rows.map(({ timestampMs }, index) => ({
        timestampMs,
        pairs: new Float32Array([index / 32, index / 32]),
        correlation: 0.5,
      }))
    );
    const intake = createIntake({
      loudness: rows,
      corr: rows.map(() => 0.5),
      audio: rows.map(() => ({ correlation: 0.5 })),
    });
    intake.snapshotVisualSpectrumByKey = () => ({ spectrum: spectrum.view });
    intake.snapshotVisualVectorscopeByKey = () => ({ vectorscope: vectorscope.view });
    const baseProps = { selectedOffset: 0, sampleSec: 0.1, intake, audio: { correlation: 0.8 } };
    const { result, rerender } = renderHook((props) => useSnapshot(props), {
      initialProps: baseProps,
    });

    const firstSpectrum = result.current.resolveSpectrumSnapshotForKey("spectrum");
    const firstVectorscope = result.current.resolveVectorscopeSnapshotForKey("vectorscope");
    const readsAtFirstTarget = {
      spectrum: spectrum.timestampReads(),
      vectorscope: vectorscope.timestampReads(),
    };
    expect(result.current.resolveSpectrumSnapshotForKey("spectrum")).toBe(firstSpectrum);
    expect(result.current.resolveVectorscopeSnapshotForKey("vectorscope")).toBe(firstVectorscope);
    expect(spectrum.timestampReads()).toBe(readsAtFirstTarget.spectrum);
    expect(vectorscope.timestampReads()).toBe(readsAtFirstTarget.vectorscope);

    for (let index = 1; index <= 24; index += 1) {
      rerender({ ...baseProps, selectedOffset: index * 0.1 });
      result.current.resolveSpectrumSnapshotForKey("spectrum");
      result.current.resolveVectorscopeSnapshotForKey("vectorscope");
    }
    const readsBeforeReturning = {
      spectrum: spectrum.timestampReads(),
      vectorscope: vectorscope.timestampReads(),
    };

    rerender(baseProps);
    const returnedSpectrum = result.current.resolveSpectrumSnapshotForKey("spectrum");
    const returnedVectorscope = result.current.resolveVectorscopeSnapshotForKey("vectorscope");

    expect(returnedSpectrum).not.toBe(firstSpectrum);
    expect(returnedVectorscope).not.toBe(firstVectorscope);
    expect(spectrum.timestampReads()).toBeGreaterThan(readsBeforeReturning.spectrum);
    expect(vectorscope.timestampReads()).toBeGreaterThan(readsBeforeReturning.vectorscope);

    const readsAfterReturning = {
      spectrum: spectrum.timestampReads(),
      vectorscope: vectorscope.timestampReads(),
    };
    expect(result.current.resolveSpectrumSnapshotForKey("spectrum")).toBe(returnedSpectrum);
    expect(result.current.resolveVectorscopeSnapshotForKey("vectorscope")).toBe(
      returnedVectorscope
    );
    expect(spectrum.timestampReads()).toBe(readsAfterReturning.spectrum);
    expect(vectorscope.timestampReads()).toBe(readsAfterReturning.vectorscope);
  });

  it("updates displayAudio on every live-mode audio rerender", () => {
    const intake = createIntake({ loudness: [], corr: [], audio: [] });
    const firstAudio = { correlation: 0.2 };
    const nextAudio = { correlation: 0.9 };
    const baseProps = { selectedOffset: -1, sampleSec: 0.1, intake };
    const { result, rerender } = renderHook((props) => useSnapshot(props), {
      initialProps: { ...baseProps, audio: firstAudio },
    });

    rerender({ ...baseProps, audio: nextAudio });

    expect(result.current.displayAudio).toBe(nextAudio);
  });
});
