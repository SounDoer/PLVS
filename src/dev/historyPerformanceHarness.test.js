import { describe, expect, it, vi } from "vitest";
import { deriveAnalysisRequests } from "../analysis/analysisRequests.js";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { FrameIntake } from "../lib/FrameIntake.js";
import { resolveKeyedVisualIndex } from "../lib/snapshotResolve.js";
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
    expect(spectrumKey).toContain(":sp75:tilt150:sm");

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
});
