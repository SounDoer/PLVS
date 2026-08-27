import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginPanelCpuSample,
  finishPanelCpuSample,
  recordPanelCpuEvent,
  resetPanelCpuProfiler,
  setPanelCpuProfilerEnabled,
  snapshotPanelCpuProfiler,
} from "./panelCpuProfiler.js";

afterEach(() => {
  setPanelCpuProfilerEnabled(false);
  resetPanelCpuProfiler();
  vi.restoreAllMocks();
});

describe("panelCpuProfiler", () => {
  it("does not collect samples while disabled", () => {
    recordPanelCpuEvent("spectrogram2d", "scheduled", 4);
    expect(beginPanelCpuSample()).toBeNull();
    expect(snapshotPanelCpuProfiler()).toEqual({});
  });

  it("aggregates counters and elapsed time without retaining per-frame samples", () => {
    setPanelCpuProfilerEnabled(true);
    recordPanelCpuEvent("spectrogram2d", "scheduled");
    recordPanelCpuEvent("spectrogram2d", "callback", 2);
    recordPanelCpuEvent("spectrogram2d", "callback", 5);

    expect(snapshotPanelCpuProfiler()).toEqual({
      "spectrogram2d:scheduled": { count: 1, totalMs: 0, maxMs: 0 },
      "spectrogram2d:callback": { count: 2, totalMs: 7, maxMs: 5 },
    });
  });

  it("measures a guarded sample only while enabled", () => {
    setPanelCpuProfilerEnabled(true);
    vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(13.5);

    const startedAt = beginPanelCpuSample();
    finishPanelCpuSample("spectrogram3d", "callback", startedAt);

    expect(snapshotPanelCpuProfiler()["spectrogram3d:callback"]).toEqual({
      count: 1,
      totalMs: 3.5,
      maxMs: 3.5,
    });
  });
});
