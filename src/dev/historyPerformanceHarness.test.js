import { describe, expect, it, vi } from "vitest";
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
