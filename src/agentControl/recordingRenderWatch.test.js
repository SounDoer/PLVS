/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchRecordingRender } from "./recordingRenderWatch.js";

describe("recording render watch", () => {
  let frames;
  let clock;
  let visibility;
  const windowObject = /** @type {any} */ ({
    requestAnimationFrame: (callback) => frames.push(callback),
    cancelAnimationFrame: () => {},
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (id) => clearInterval(id),
  });
  const runFrames = () => {
    for (const callback of frames.splice(0)) callback(clock);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    clock = 0;
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function settle(ms) {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("reports nothing while frames keep arriving", async () => {
    const report = vi.fn();
    const stop = watchRecordingRender({ report, windowObject, now: () => clock });
    for (let i = 0; i < 10; i++) {
      await settle(100);
      runFrames();
    }
    stop();
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a stall when frames stop and a resume when they return", async () => {
    const report = vi.fn();
    const stop = watchRecordingRender({ report, windowObject, now: () => clock });
    await settle(100);
    runFrames();
    await settle(600);
    expect(report).toHaveBeenLastCalledWith(false);
    runFrames();
    await settle(0);
    expect(report.mock.calls).toEqual([[false], [true]]);
    stop();
  });

  it("reports a hidden page immediately", async () => {
    const report = vi.fn();
    const stop = watchRecordingRender({ report, windowObject, now: () => clock });
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await settle(0);
    expect(report.mock.calls).toEqual([[false]]);
    stop();
  });

  it("treats a minimized window as stalled even while frames arrive", async () => {
    const report = vi.fn();
    let minimized = false;
    const stop = watchRecordingRender({
      report,
      windowObject,
      now: () => clock,
      isMinimized: () => minimized,
    });
    minimized = true;
    await settle(250);
    runFrames();
    await settle(0);
    expect(report.mock.calls).toEqual([[false]]);
    minimized = false;
    await settle(250);
    runFrames();
    await settle(0);
    expect(report.mock.calls).toEqual([[false], [true]]);
    stop();
  });

  it("stops reporting once stopped", async () => {
    const report = vi.fn();
    const stop = watchRecordingRender({ report, windowObject, now: () => clock });
    stop();
    await settle(1000);
    expect(report).not.toHaveBeenCalled();
  });
});
