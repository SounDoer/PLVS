import { describe, expect, it, vi } from "vitest";
import { deriveAnalysisRequests } from "../analysis/analysisRequests.js";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { FrameIntake } from "../lib/FrameIntake.js";
import { VISUAL_HISTORY_CHUNK_ROWS } from "../lib/historyChunkConfig.js";
import { resolveKeyedVisualIndex } from "../lib/snapshotResolve.js";
import { StereoMapHistorySlab } from "../lib/StereoMapHistorySlab.js";
import {
  projectedStereoMapBytes,
  projectedStereoMapRetentionBytes,
} from "../../scripts/history-perf-benchmark.mjs";
import {
  seedHistoryPerformance,
  startHistoryPerformanceHarness,
} from "./historyPerformanceHarness.js";

function createScheduler() {
  let nextId = 1;
  const idle = new Map();
  const intervals = new Map();
  return {
    requestIdleCallback(callback) {
      const id = nextId++;
      idle.set(id, callback);
      return id;
    },
    cancelIdleCallback(id) {
      idle.delete(id);
    },
    setTimeout(callback) {
      const id = nextId++;
      idle.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      idle.delete(id);
    },
    setInterval(callback, delay) {
      const id = nextId++;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    runIdle() {
      const jobs = [...idle.values()];
      idle.clear();
      for (const callback of jobs) callback({ didTimeout: false, timeRemaining: () => 50 });
    },
    runAllIdle(limit = 100) {
      for (let index = 0; idle.size > 0 && index < limit; index += 1) this.runIdle();
      if (idle.size > 0) throw new Error("idle queue did not drain");
    },
    tickIntervals(times = 1) {
      for (let index = 0; index < times; index += 1) {
        for (const { callback } of [...intervals.values()]) callback();
      }
    },
    pendingIdle() {
      return idle.size;
    },
    intervalDelays() {
      return [...intervals.values()].map(({ delay }) => delay);
    },
  };
}

function createIntakeSpy() {
  return {
    pushHistRow: vi.fn(),
    pushVisualHistRow: vi.fn(),
  };
}

describe("history performance harness", () => {
  it("stores visual rows under active keys from the analysis request resolver", async () => {
    const requests = deriveAnalysisRequests({
      tree: {
        type: "leaf",
        tabs: ["spectrum-panel", "vectorscope-panel"],
        activeTab: "spectrum-panel",
      },
      panelsById: {
        "spectrum-panel": { id: "spectrum-panel", moduleId: "spectrum" },
        "vectorscope-panel": { id: "vectorscope-panel", moduleId: "vectorscope" },
      },
      panelOrder: ["spectrum-panel", "vectorscope-panel"],
      panelControlsById: {
        "spectrum-panel": {
          ...DEFAULT_PANEL_CONTROLS,
          spectrumSpeedPercent: 75,
          spectrumTiltDbPerOctave: 1.5,
          spectrumOctaveSmoothing: "1/3",
        },
        "vectorscope-panel": {
          ...DEFAULT_PANEL_CONTROLS,
          vectorscopePair: { x: 1, y: 2 },
        },
      },
    });
    const spectrumKey = requests.spectrumRequests[0].key;
    const vectorscopeKey = requests.vectorscopeRequests[0].key;
    expect(spectrumKey).toContain(":sp75:sm");

    const scheduler = createScheduler();
    const intake = new FrameIntake();
    const controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: 0,
      visualRows: 2,
      spectrumKeys: [spectrumKey],
      vectorscopeKeys: [vectorscopeKey],
    });
    scheduler.runAllIdle();
    await controller.done;

    const spectrum = intake.getVisualSpectrumHistByKey(spectrumKey);
    const vectorscope = intake.getVisualVectorscopeHistByKey(vectorscopeKey);
    expect(spectrum).toHaveLength(2);
    expect(vectorscope).toHaveLength(2);
    expect(resolveKeyedVisualIndex(spectrum, 40, 0)).toEqual({ index: 1, missing: false });
    expect(resolveKeyedVisualIndex(vectorscope, 40, 0)).toEqual({ index: 1, missing: false });
  });

  it("updates only future visual rows without backfilling or restarting timestamps", async () => {
    const scheduler = createScheduler();
    const intake = new FrameIntake();
    const pushVisualHistRow = vi.spyOn(intake, "pushVisualHistRow");
    const controller = startHistoryPerformanceHarness({
      intake,
      scheduler,
      scalarRows: 0,
      visualRows: 2,
      visualBatchSize: 1,
      spectrumKeys: ["spectrum:old"],
      vectorscopeKeys: ["vectorscope:old"],
    });

    scheduler.runIdle();
    controller.updateRequestKeys({
      spectrumKeys: ["spectrum:new"],
      vectorscopeKeys: ["vectorscope:new"],
    });
    scheduler.runAllIdle();
    await controller.seeded;
    scheduler.tickIntervals(1);

    const rows = pushVisualHistRow.mock.calls.map(([row]) => row);
    expect(Object.keys(rows[0].spectrumByKey)).toEqual(["spectrum:old"]);
    expect(Object.keys(rows[0].vectorscopeByKey)).toEqual(["vectorscope:old"]);
    expect(Object.keys(rows[1].spectrumByKey)).toEqual(["spectrum:new"]);
    expect(Object.keys(rows[1].vectorscopeByKey)).toEqual(["vectorscope:new"]);
    expect(Object.keys(rows[2].spectrumByKey)).toEqual(["spectrum:new"]);
    expect(rows.map((row) => row.timestampMs)).toEqual([0, 40, 80]);
    expect(intake.getVisualSpectrumHistByKey("spectrum:old")).toHaveLength(1);
    expect(intake.getVisualSpectrumHistByKey("spectrum:new")).toHaveLength(2);
    expect(intake.getVisualSpectrumHistByKey("spectrum:new").timestampAt(0)).toBe(40);

    controller.cancel();
  });

  it("seeds injected small counts in bounded idle batches with exact cadence and capacity", async () => {
    const scheduler = createScheduler();
    const intake = createIntakeSpy();
    const progress = [];
    const controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: 5,
      visualRows: 7,
      scalarBatchSize: 2,
      visualBatchSize: 3,
      onProgress: (value) => progress.push(value),
    });

    scheduler.runIdle();
    expect(intake.pushHistRow).toHaveBeenCalledTimes(2);
    expect(scheduler.pendingIdle()).toBe(1);
    scheduler.runAllIdle();
    await controller.done;

    expect(intake.pushHistRow).toHaveBeenCalledTimes(5);
    expect(intake.pushVisualHistRow).toHaveBeenCalledTimes(7);
    expect(intake.pushHistRow.mock.calls.map(([row]) => row.timestampMs)).toEqual([
      0, 100, 200, 300, 400,
    ]);
    expect(intake.pushHistRow.mock.calls.every(([, capacity]) => capacity === 5)).toBe(true);
    expect(intake.pushVisualHistRow.mock.calls.map(([row]) => row.timestampMs)).toEqual([
      0, 40, 80, 120, 160, 200, 240,
    ]);
    expect(intake.pushVisualHistRow.mock.calls.every(([, capacity]) => capacity === 7)).toBe(true);
    expect(progress).toContainEqual({
      phase: "scalar",
      completed: 2,
      total: 5,
      fullVisual: false,
    });
    expect(progress.at(-1)).toEqual({
      phase: "complete",
      completed: 12,
      total: 12,
      fullVisual: false,
    });
  });

  it("reports structural scalar snapshot freeze work for a real intake", async () => {
    const scheduler = createScheduler();
    const intake = new FrameIntake();
    const controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: VISUAL_HISTORY_CHUNK_ROWS + 1,
      visualRows: 0,
      scalarBatchSize: VISUAL_HISTORY_CHUNK_ROWS + 1,
    });

    scheduler.runAllIdle();
    const result = await controller.done;

    expect(result.scalarSnapshot.retainedRows).toBe(VISUAL_HISTORY_CHUNK_ROWS + 1);
    expect(result.scalarSnapshot.stats.scalar.sharedSealedChunks).toBe(3);
    // Loudness and audio are both packed slabs and always report copiedReferences: 0 (they copy
    // whole chunks, not individual references), so only correlation contributes here.
    expect(result.scalarSnapshot.stats.scalar.copiedReferences).toBe(1);
    expect(result.scalarSnapshot.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("uses safe one-value visual keys by default and production widths only when explicit", async () => {
    const safeScheduler = createScheduler();
    const safeIntake = createIntakeSpy();
    const safe = seedHistoryPerformance({
      intake: safeIntake,
      scheduler: safeScheduler,
      scalarRows: 0,
      visualRows: 1,
    });
    safeScheduler.runAllIdle();
    await safe.done;
    const safeRow = safeIntake.pushVisualHistRow.mock.calls[0][0];
    const safeSpectrum = Object.values(safeRow.spectrumByKey)[0];
    const safeVectorscope = Object.values(safeRow.vectorscopeByKey)[0];
    expect(safeSpectrum.bandCentersHz).toHaveLength(1);
    expect(safeSpectrum.smoothDb).toHaveLength(1);
    expect(safeVectorscope.pairs).toHaveLength(2);

    const fullScheduler = createScheduler();
    const fullIntake = createIntakeSpy();
    const full = seedHistoryPerformance({
      intake: fullIntake,
      scheduler: fullScheduler,
      scalarRows: 0,
      visualRows: 1,
      fullVisual: true,
    });
    fullScheduler.runAllIdle();
    await full.done;
    const fullRow = fullIntake.pushVisualHistRow.mock.calls[0][0];
    expect(Object.values(fullRow.spectrumByKey)[0].bandCentersHz).toHaveLength(958);
    expect(Object.values(fullRow.spectrumByKey)[0].smoothDb).toHaveLength(958);
    expect(Object.values(fullRow.vectorscopeByKey)[0].pairs).toHaveLength(200);
  });

  it("cancels pending idle work and settles without further appends", async () => {
    const scheduler = createScheduler();
    const intake = createIntakeSpy();
    const controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: 10,
      visualRows: 10,
      scalarBatchSize: 2,
    });

    scheduler.runIdle();
    controller.cancel();
    scheduler.runAllIdle();
    await controller.done;

    expect(intake.pushHistRow).toHaveBeenCalledTimes(2);
    expect(intake.pushVisualHistRow).not.toHaveBeenCalled();
    expect(scheduler.pendingIdle()).toBe(0);
  });

  it("falls back to scheduler timeouts when idle callbacks are unavailable", async () => {
    const base = createScheduler();
    const scheduler = {
      setTimeout: base.setTimeout,
      clearTimeout: base.clearTimeout,
      setInterval: base.setInterval,
      clearInterval: base.clearInterval,
    };
    const intake = createIntakeSpy();
    const controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: 1,
      visualRows: 1,
    });

    base.runAllIdle();
    await controller.done;

    expect(intake.pushHistRow).toHaveBeenCalledTimes(1);
    expect(intake.pushVisualHistRow).toHaveBeenCalledTimes(1);
  });

  it.each(["scalar", "visual"])(
    "stops scheduling and ends progress at cancelled after synchronous %s cancellation",
    async (cancelPhase) => {
      const scheduler = createScheduler();
      const intake = createIntakeSpy();
      const phases = [];
      let controller;
      controller = seedHistoryPerformance({
        intake,
        scheduler,
        scalarRows: cancelPhase === "scalar" ? 2 : 0,
        visualRows: 2,
        scalarBatchSize: 1,
        visualBatchSize: 1,
        onProgress(progress) {
          phases.push(progress.phase);
          if (progress.phase === cancelPhase) controller.cancel();
        },
      });

      scheduler.runIdle();
      expect(scheduler.pendingIdle()).toBe(0);
      scheduler.runAllIdle();
      const result = await controller.done;

      expect(result.cancelled).toBe(true);
      expect(phases.at(-1)).toBe("cancelled");
      expect(phases).not.toContain("complete");
      expect(scheduler.pendingIdle()).toBe(0);
    }
  );

  it("keeps cancelled as the final phase when complete progress synchronously cancels", async () => {
    const scheduler = createScheduler();
    const intake = createIntakeSpy();
    const phases = [];
    let controller;
    controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: 0,
      visualRows: 1,
      onProgress(progress) {
        phases.push(progress.phase);
        if (progress.phase === "complete") controller.cancel();
      },
    });

    scheduler.runIdle();
    expect(scheduler.pendingIdle()).toBe(0);
    scheduler.runAllIdle();
    const result = await controller.done;

    expect(result.cancelled).toBe(true);
    expect(phases).toEqual(["visual", "complete", "cancelled"]);
    expect(scheduler.pendingIdle()).toBe(0);
  });

  it("stops the batch when a progress event listener synchronously cancels", async () => {
    const scheduler = createScheduler();
    const intake = createIntakeSpy();
    const phases = [];
    const globalTarget = {
      dispatchEvent(event) {
        phases.push(event.detail.phase);
        if (event.detail.phase === "visual") this.__PLVS_HISTORY_PERF__.cancel();
      },
    };
    const controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: 0,
      visualRows: 2,
      visualBatchSize: 1,
      globalTarget,
    });

    scheduler.runIdle();
    expect(scheduler.pendingIdle()).toBe(0);
    scheduler.runAllIdle();
    const result = await controller.done;

    expect(result.cancelled).toBe(true);
    expect(phases.at(-1)).toBe("cancelled");
    expect(phases).not.toContain("complete");
    expect(scheduler.pendingIdle()).toBe(0);
  });

  it("continues 40 ms live visual appends and approximately 100 ms scalar publishes", async () => {
    const scheduler = createScheduler();
    const intake = createIntakeSpy();
    const publishAudio = vi.fn();
    const controller = startHistoryPerformanceHarness({
      intake,
      scheduler,
      publishAudio,
      scalarRows: 2,
      visualRows: 5,
    });
    scheduler.runAllIdle();
    await controller.seeded;
    intake.pushHistRow.mockClear();
    intake.pushVisualHistRow.mockClear();
    publishAudio.mockClear();

    expect(scheduler.intervalDelays()).toEqual([40]);
    scheduler.tickIntervals(5);

    expect(intake.pushVisualHistRow).toHaveBeenCalledTimes(5);
    expect(intake.pushHistRow).toHaveBeenCalledTimes(2);
    expect(intake.pushHistRow.mock.calls.map(([row]) => row.timestampMs)).toEqual([200, 300]);
    expect(publishAudio).toHaveBeenCalledTimes(2);
    const firstPublished = publishAudio.mock.calls[0][0];
    const firstStored = intake.pushHistRow.mock.calls[0][0];
    expect(firstPublished).toMatchObject({
      momentary: firstStored.lufsMomentary,
      shortTerm: firstStored.lufsShortTerm,
      correlation: firstStored.correlation,
      peakDb: firstStored.peakDb,
    });
    expect(firstPublished).not.toHaveProperty("lufsMomentary");
    expect(firstPublished).not.toHaveProperty("lufsShortTerm");

    controller.cancel();
    scheduler.tickIntervals(2);
    expect(intake.pushVisualHistRow).toHaveBeenCalledTimes(5);
    expect(intake.pushHistRow).toHaveBeenCalledTimes(2);
  });

  it("keeps real history slabs bounded after seeded retention fills and a whole chunk rolls over", async () => {
    const scheduler = createScheduler();
    const intake = new FrameIntake();
    const spectrumKey = "spectrum:bounded";
    const vectorscopeKey = "vectorscope:bounded";
    const stereoMapKey = "stereoMap:bounded";
    const scalarCapacity = 3;
    const visualCapacity = 4;
    intake.setRetainedVisualKeys(
      {
        spectrum: new Set([spectrumKey]),
        vectorscope: new Set([vectorscopeKey]),
        stereoMap: new Set([stereoMapKey]),
        stereoMapModesByKey: new Map([[stereoMapKey, new Set(["position"])]]),
      },
      4 * 60 * 60 * 1_000
    );
    const controller = startHistoryPerformanceHarness({
      intake,
      scheduler,
      scalarRows: scalarCapacity,
      visualRows: visualCapacity,
      spectrumKeys: [spectrumKey],
      vectorscopeKeys: [vectorscopeKey],
      stereoMapKeys: [stereoMapKey],
    });
    scheduler.runAllIdle();
    await controller.seeded;

    scheduler.tickIntervals(VISUAL_HISTORY_CHUNK_ROWS + 7);

    const spectrum = intake.getVisualSpectrumHistByKey(spectrumKey);
    const vectorscope = intake.getVisualVectorscopeHistByKey(vectorscopeKey);
    const stereoMap = intake.getVisualStereoMapHistByKey(stereoMapKey);
    expect(intake.getLoudnessHistory()).toHaveLength(scalarCapacity);
    for (const slab of [spectrum, vectorscope, stereoMap]) {
      expect(slab).toHaveLength(visualCapacity);
      expect(slab.storageStats().chunkCount).toBeLessThanOrEqual(2);
    }
    expect(spectrum.timestampAt(0)).toBe(vectorscope.timestampAt(0));
    expect(vectorscope.timestampAt(0)).toBe(stereoMap.timestampAt(0));

    controller.cancel();
  });

  it("seeds a single Stereo Map key with production band width and a packed mode plane", async () => {
    const scheduler = createScheduler();
    const intake = new FrameIntake();
    const key = "stereoMap:pair:0:1:sp50:sm12";
    const controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: 0,
      visualRows: 3,
      fullVisual: true,
      stereoMapKeys: [key],
    });
    scheduler.runAllIdle();
    await controller.done;

    const slab = intake.getVisualStereoMapHistByKey(key);
    expect(slab).not.toBeNull();
    expect(slab.length).toBe(3);
    const row = slab.rowAt(2);
    expect(row.bandCentersHz).toHaveLength(958);
    expect(row.derivedForMode("position", { lowerBound: -1, upperBound: 1 }).values).toHaveLength(
      958
    );
    expect(slab.storageStats()).toMatchObject({
      retainedModes: ["position", "correlation", "monoLossDb", "msRatioDb"],
      arrayTypes: { values: "Uint8Array (12-bit)", opacity: "Uint8Array (4-bit)" },
    });
  });

  it("seeds four Stereo Map keys independently in the same run", async () => {
    const scheduler = createScheduler();
    const intake = new FrameIntake();
    const keys = [0, 1, 2, 3].map((index) => `stereoMap:pair:${index}:${index + 1}:sp50:sm12`);
    const controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: 0,
      visualRows: 4,
      stereoMapKeys: keys,
    });
    scheduler.runAllIdle();
    await controller.done;

    for (const key of keys) {
      const slab = intake.getVisualStereoMapHistByKey(key);
      expect(slab).not.toBeNull();
      expect(slab.length).toBe(4);
    }
  });

  it("mixes four Spectrum and four Stereo Map keys per tick with one intake call per row", async () => {
    const scheduler = createScheduler();
    const intake = new FrameIntake();
    const pushVisualHistRow = vi.spyOn(intake, "pushVisualHistRow");
    const spectrumKeys = [0, 1, 2, 3].map(
      (index) => `spectrum:pair:${index}:${index + 1}:combined:sp50:smoff`
    );
    const stereoMapKeys = [0, 1, 2, 3].map(
      (index) => `stereoMap:pair:${index}:${index + 1}:sp50:sm12`
    );
    const controller = seedHistoryPerformance({
      intake,
      scheduler,
      scalarRows: 0,
      visualRows: 5,
      spectrumKeys,
      stereoMapKeys,
    });
    scheduler.runAllIdle();
    await controller.done;

    expect(pushVisualHistRow).toHaveBeenCalledTimes(5);
    for (const key of spectrumKeys) {
      expect(intake.getVisualSpectrumHistByKey(key)?.length).toBe(5);
    }
    for (const key of stereoMapKeys) {
      expect(intake.getVisualStereoMapHistByKey(key)?.length).toBe(5);
    }
  });

  it("updates Stereo Map keys mid-stream without backfilling earlier rows", async () => {
    const scheduler = createScheduler();
    const intake = new FrameIntake();
    const pushVisualHistRow = vi.spyOn(intake, "pushVisualHistRow");
    const controller = startHistoryPerformanceHarness({
      intake,
      scheduler,
      scalarRows: 0,
      visualRows: 2,
      visualBatchSize: 1,
      stereoMapKeys: ["stereoMap:old"],
    });

    scheduler.runIdle();
    controller.updateRequestKeys({ stereoMapKeys: ["stereoMap:new"] });
    scheduler.runAllIdle();
    await controller.seeded;
    scheduler.tickIntervals(1);

    const rows = pushVisualHistRow.mock.calls.map(([row]) => row);
    expect(Object.keys(rows[0].stereoMapByKey)).toEqual(["stereoMap:old"]);
    expect(Object.keys(rows[1].stereoMapByKey)).toEqual(["stereoMap:new"]);
    expect(Object.keys(rows[2].stereoMapByKey)).toEqual(["stereoMap:new"]);
    expect(intake.getVisualStereoMapHistByKey("stereoMap:old").length).toBe(1);
    expect(intake.getVisualStereoMapHistByKey("stereoMap:new").length).toBe(2);

    controller.cancel();
  });

  it("uses a one-band Stereo Map key by default and 958 bands only when explicit", async () => {
    const safeScheduler = createScheduler();
    const safeIntake = createIntakeSpy();
    const safe = seedHistoryPerformance({
      intake: safeIntake,
      scheduler: safeScheduler,
      scalarRows: 0,
      visualRows: 1,
    });
    safeScheduler.runAllIdle();
    await safe.done;
    const safeRow = safeIntake.pushVisualHistRow.mock.calls[0][0];
    const safeStereoMap = Object.values(safeRow.stereoMapByKey)[0];
    expect(safeStereoMap.bandCentersHz).toHaveLength(1);
    expect(safeStereoMap.pl).toHaveLength(1);
    expect(safeStereoMap.pr).toHaveLength(1);
    expect(safeStereoMap.c).toHaveLength(1);

    const fullScheduler = createScheduler();
    const fullIntake = createIntakeSpy();
    const full = seedHistoryPerformance({
      intake: fullIntake,
      scheduler: fullScheduler,
      scalarRows: 0,
      visualRows: 1,
      fullVisual: true,
    });
    fullScheduler.runAllIdle();
    await full.done;
    const fullRow = fullIntake.pushVisualHistRow.mock.calls[0][0];
    const fullStereoMap = Object.values(fullRow.stereoMapByKey)[0];
    expect(fullStereoMap.bandCentersHz).toHaveLength(958);
    expect(fullStereoMap.pl).toHaveLength(958);
    expect(fullStereoMap.pr).toHaveLength(958);
    expect(fullStereoMap.c).toHaveLength(958);
  });
});

describe("Stereo Map history benchmark projections", () => {
  it("projects one packed mode plus a shared packed visibility plane at 30/60/120/240-minute retention", () => {
    const bands = 958;
    const rowsPerMinute = 60 * 25;
    for (const minutes of [30, 60, 120, 240]) {
      const rows = minutes * rowsPerMinute;
      const projected = projectedStereoMapBytes(rows, { bands, keyCount: 1 });
      const expectedTimestamps = rows * Float64Array.BYTES_PER_ELEMENT;
      const planeEntries = rows * bands;
      const expectedPlane = planeEntries + ((planeEntries + 1) >> 1);
      const expectedOpacity = (planeEntries + 1) >> 1;
      const chunkCount = Math.ceil(rows / VISUAL_HISTORY_CHUNK_ROWS);
      const expectedHoldIndex = chunkCount * bands * Uint16Array.BYTES_PER_ELEMENT * 2;
      expect(projected.timestamps).toBe(expectedTimestamps);
      expect(projected.modeValues).toBe(expectedPlane);
      expect(projected.opacity).toBe(expectedOpacity);
      expect(projected.holdIndex).toBe(expectedHoldIndex);
      // No row-peak term: the peak existed only so a stored energy could be turned back into a
      // gate, and the visibility plane stores the answer instead of the ingredients.
      expect(projected.total).toBe(
        expectedTimestamps +
          expectedPlane +
          expectedOpacity +
          rows * Uint8Array.BYTES_PER_ELEMENT +
          bands * Float32Array.BYTES_PER_ELEMENT +
          expectedHoldIndex
      );
    }
  });

  it("scales retained-byte projections linearly with key count across the retention sweep", () => {
    const oneKey = projectedStereoMapRetentionBytes(1);
    const fourKeys = projectedStereoMapRetentionBytes(4);
    expect(oneKey.map((entry) => entry.minutes)).toEqual([30, 60, 120, 240]);
    for (let index = 0; index < oneKey.length; index += 1) {
      expect(fourKeys[index].total).toBe(oneKey[index].total * 4);
    }

    // One active mode plus the shared visibility plane is roughly 0.65 GiB at four hours, down
    // from 0.81 when a byte of energy per band and a row peak were stored. Keep a tight bound so
    // accidental retained-plane growth fails.
    const fullRetention = oneKey.at(-1);
    expect(fullRetention.minutes).toBe(240);
    expect(fullRetention.total).toBeGreaterThan(0.64 * 1024 ** 3);
    expect(fullRetention.total).toBeLessThan(0.66 * 1024 ** 3);
    expect(fullRetention.holdIndex / fullRetention.perKeyTotal).toBeLessThan(0.002);
  });
});

describe("Stereo Map history slab structural benchmarks", () => {
  const bandCentersFor = (bandCount) =>
    Float32Array.from({ length: bandCount }, (_, index) => 20 * 2 ** (index / 96));

  it("freezes across a chunk boundary by sharing the sealed chunk and copying only the active tail", () => {
    const bands = 958;
    const tailRows = 50;
    const rows = VISUAL_HISTORY_CHUNK_ROWS + tailRows;
    const slab = new StereoMapHistorySlab(rows);
    const bandCentersHz = bandCentersFor(bands);
    const pl = new Float32Array(bands).fill(0.2);
    const pr = new Float32Array(bands).fill(0.25);
    const c = new Float32Array(bands).fill(0.05);
    for (let index = 0; index < rows; index += 1) {
      slab.append({ timestampMs: index * 40, sampleRateHz: 48_000, bandCentersHz, pl, pr, c });
    }

    const frozen = slab.freeze();
    const stats = frozen.storageStats();
    expect(stats.retainedRows).toBe(rows);
    expect(stats.sharedSealedChunks).toBe(1);
    expect(stats.copiedTailRows).toBe(tailRows);
    expect(stats.copiedTailBytes).toBe(
      tailRows * Float64Array.BYTES_PER_ELEMENT +
        tailRows * bands * Float32Array.BYTES_PER_ELEMENT * 3 +
        bands * (5 * Float64Array.BYTES_PER_ELEMENT + 4 * Uint8Array.BYTES_PER_ELEMENT)
    );
  });

  it("resolves a historical Hold query from sealed chunk summaries, scanning only the unsealed tail", () => {
    const bands = 4;
    const tailScanRows = 10;
    const rows = VISUAL_HISTORY_CHUNK_ROWS * 3 + 50;
    const slab = new StereoMapHistorySlab(rows);
    const bandCentersHz = bandCentersFor(bands);
    for (let index = 0; index < rows; index += 1) {
      const value = 0.1 + index / rows;
      slab.append({
        timestampMs: index * 40,
        sampleRateHz: 48_000,
        bandCentersHz,
        pl: new Float32Array(bands).fill(value),
        pr: new Float32Array(bands).fill(value),
        c: new Float32Array(bands).fill(0),
      });
    }

    const frozen = slab.freeze();
    const targetIndex = VISUAL_HISTORY_CHUNK_ROWS * 3 + tailScanRows;
    const result = frozen.holdAtOrBeforeTimestamp(targetIndex * 40, frozen.epoch);
    expect(result).not.toBeNull();
    // Two O(bandCount) merges cover the three sealed chunks before the unsealed tail: the front
    // chunk's own summary, plus one cached-prefix lookup for everything between it and the
    // target chunk (chunks 1 and 2 here) — not one merge per sealed chunk.
    expect(result.stats.mergedChunks).toBe(2);
    expect(result.stats.scannedRows).toBe(tailScanRows + 1);
    expect(result.stats.scannedRows).toBeLessThan(VISUAL_HISTORY_CHUNK_ROWS);
  });

  it("keeps live Hold reads (Mode switching) at constant working-set bytes regardless of retained rows", () => {
    const bands = 6;
    const rows = VISUAL_HISTORY_CHUNK_ROWS * 2 + 10;
    const slab = new StereoMapHistorySlab(rows);
    const bandCentersHz = bandCentersFor(bands);
    const pl = new Float32Array(bands).fill(0.1);
    const pr = new Float32Array(bands).fill(0.2);
    const c = new Float32Array(bands).fill(0.05);
    for (let index = 0; index < rows; index += 1) {
      slab.append({ timestampMs: index * 40, sampleRateHz: 48_000, bandCentersHz, pl, pr, c });
    }

    const before = slab.storageStats().workingBytes;
    slab.liveHoldValues();
    slab.liveHoldValues();
    slab.liveHoldValues();
    const after = slab.storageStats().workingBytes;
    expect(after.total).toBe(before.total);
    expect(after.holdDerivation).toBe(bands * 6 * Float64Array.BYTES_PER_ELEMENT);
  });
});
