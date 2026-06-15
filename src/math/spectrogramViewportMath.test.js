import { describe, expect, it } from "vitest";
import { mapHistoryViewportToVisual } from "./spectrogramViewportMath";

describe("mapHistoryViewportToVisual", () => {
  it("maps the visible history timestamp range onto visual entries", () => {
    const historyEntries = Array.from({ length: 10 }, (_, i) => ({ timestampMs: i * 100 }));
    const visualEntries = [0, 40, 80, 120, 160, 300, 460, 620, 780, 940].map((timestampMs) => ({
      timestampMs,
    }));

    expect(
      mapHistoryViewportToVisual({
        historyEntries,
        visualEntries,
        effectiveOffsetSamples: 2,
        visibleSamples: 4,
      })
    ).toEqual({
      effectiveOffsetSamples: 2,
      visibleSamples: 2,
    });
  });

  it("keeps the live edge aligned by timestamp even when visual cadence drifts", () => {
    const historyEntries = Array.from({ length: 6 }, (_, i) => ({ timestampMs: i * 100 }));
    const visualEntries = [0, 55, 140, 260, 390, 500].map((timestampMs) => ({ timestampMs }));

    expect(
      mapHistoryViewportToVisual({
        historyEntries,
        visualEntries,
        effectiveOffsetSamples: 0,
        visibleSamples: 3,
      })
    ).toEqual({
      effectiveOffsetSamples: 0,
      visibleSamples: 2,
    });
  });

  it("falls back to sample ratio when timestamps are unavailable", () => {
    expect(
      mapHistoryViewportToVisual({
        totalHistorySamples: 1000,
        totalVisualSamples: 2500,
        effectiveOffsetSamples: 200,
        visibleSamples: 100,
      })
    ).toEqual({
      effectiveOffsetSamples: 500,
      visibleSamples: 250,
    });
  });

  it("preserves a full visual window while live data is still filling", () => {
    const historyEntries = Array.from({ length: 3 }, (_, i) => ({ timestampMs: i * 100 }));
    const visualEntries = Array.from({ length: 6 }, (_, i) => ({ timestampMs: i * 40 }));

    expect(
      mapHistoryViewportToVisual({
        historyEntries,
        visualEntries,
        totalHistorySamples: historyEntries.length,
        totalVisualSamples: visualEntries.length,
        effectiveOffsetSamples: 0,
        visibleSamples: 50,
      })
    ).toEqual({
      effectiveOffsetSamples: 0,
      visibleSamples: 100,
    });
  });
});
