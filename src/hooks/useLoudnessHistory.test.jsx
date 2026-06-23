/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLoudnessHistory, HIST_SAMPLE_SEC } from "./useLoudnessHistory.js";

function makeHist(n) {
  return Array.from({ length: n }, (_, i) => ({
    m: -20,
    st: -20,
    timestampMs: i * HIST_SAMPLE_SEC * 1000,
  }));
}

// Parse an axis label ("0s", "45s", "1m", "1m30s") back into seconds for ordering assertions.
const toSec = (lb) => {
  const m = lb.match(/^(?:(\d+)m)?(?:(\d+)s)?$/);
  return Number(m?.[1] || 0) * 60 + Number(m?.[2] || 0);
};

describe("useLoudnessHistory time axis", () => {
  const baseProps = {
    histSourceList: makeHist(1500),
    hasHistoryData: true,
    running: false,
    displayAudio: { integrated: -20 },
    referenceLufs: -23,
    selectedOffset: -1,
  };

  it("renders an ascending absolute media-time axis in file mode (oldest left -> newest right)", () => {
    const { result } = renderHook(() => useLoudnessHistory({ ...baseProps, sourceMode: "file" }));
    const ticks = result.current.historyTimeTicks.map(toSec);
    for (let i = 0; i < ticks.length - 1; i++) {
      expect(ticks[i + 1]).toBeGreaterThanOrEqual(ticks[i]);
    }
  });

  it("keeps the descending time-ago axis in live mode (newest edge reads 0s)", () => {
    const { result } = renderHook(() => useLoudnessHistory({ ...baseProps, sourceMode: "live" }));
    const ticks = result.current.historyTimeTicks.map(toSec);
    for (let i = 0; i < ticks.length - 1; i++) {
      expect(ticks[i + 1]).toBeLessThanOrEqual(ticks[i]);
    }
    expect(ticks[ticks.length - 1]).toBe(0);
  });
});

describe("useLoudnessHistory window clamp", () => {
  // 200 hist samples = 20 s; shorter than the 60 s default window.
  const shortHist = makeHist(200);
  const props = {
    histSourceList: shortHist,
    hasHistoryData: true,
    running: false,
    displayAudio: { integrated: -20 },
    referenceLufs: -23,
    selectedOffset: -1,
  };

  it("caps the file-mode window to the whole file so content fills the axis", () => {
    const { result } = renderHook(() => useLoudnessHistory({ ...props, sourceMode: "file" }));
    expect(result.current.visibleSamples).toBeLessThanOrEqual(result.current.totalSamples);
    expect(result.current.visibleSamples).toBe(200);
  });

  it("leaves the live-mode window unclamped (can exceed available data)", () => {
    const { result } = renderHook(() => useLoudnessHistory({ ...props, sourceMode: "live" }));
    // 60 s default window -> 600 samples, larger than the 200 samples captured so far.
    expect(result.current.visibleSamples).toBeGreaterThan(result.current.totalSamples);
  });
});
