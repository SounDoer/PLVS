/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HIST_SAMPLE_SEC, useLoudnessHistory } from "./useLoudnessHistory.js";

function makeHist(n) {
  return Array.from({ length: n }, (_, i) => ({
    m: -20,
    st: -20,
    timestampMs: i * HIST_SAMPLE_SEC * 1000,
  }));
}

describe("useLoudnessHistory", () => {
  const props = {
    histSourceList: makeHist(1500),
    hasHistoryData: true,
    running: false,
    displayAudio: { integrated: -20 },
    referenceLufs: -23,
  };

  it("owns only globally meaningful history and loudness data", () => {
    const { result } = renderHook(() => useLoudnessHistory(props));

    expect(result.current.totalSamples).toBe(1500);
    expect(result.current.historyChartInteractive).toBe(true);
    expect(result.current.statsMetrics.length).toBeGreaterThan(0);
    expect(result.current).not.toHaveProperty("visibleSamples");
    expect(result.current).not.toHaveProperty("historyTimeTicks");
    expect(result.current).not.toHaveProperty("historyTimeAxisHandlers");
    expect(result.current).not.toHaveProperty("historyWindowSec");
    expect(result.current).not.toHaveProperty("historyOffsetSec");
  });
});
