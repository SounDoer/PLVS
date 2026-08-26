// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryDataProvider } from "../workspace/AudioDataContext.jsx";
import { usePanelHistoryData } from "./usePanelHistoryData.js";

function historyData(overrides = {}) {
  return {
    sourceMode: "live",
    historyMaxWindowSec: 3600,
    historyWindowSec: 30,
    historyOffsetSec: 10,
    setHistoryWindowSec: vi.fn(),
    setHistoryOffsetSec: vi.fn(),
    selectedOffset: 5,
    setSelectedOffset: vi.fn(),
    running: true,
    hasHistoryData: true,
    histSourceList: Array.from({ length: 1000 }, () => ({})),
    ...overrides,
  };
}

function wrapperFor(value) {
  return function Wrapper({ children }) {
    return <HistoryDataProvider value={value}>{children}</HistoryDataProvider>;
  };
}

describe("usePanelHistoryData", () => {
  afterEach(() => vi.useRealTimers());

  it("derives one timeline panel's effective viewport from the global history inputs", () => {
    const { result } = renderHook(() => usePanelHistoryData("loudness"), {
      wrapper: wrapperFor(historyData()),
    });

    expect(result.current.clampedWindowSec).toBe(30);
    expect(result.current.effectiveOffsetSec).toBe(10);
    expect(result.current.visibleSamples).toBe(300);
    expect(result.current.effectiveOffsetSamples).toBe(100);
    expect(result.current.showSelLine).toBe(false);
    expect(result.current.selectionEdge).toBe("right");
    expect(result.current.historyTimeTicks.length).toBeGreaterThan(0);
    expect(result.current.historyTimeAxisHandlers).toEqual(
      expect.objectContaining({
        onWheel: expect.any(Function),
        onDoubleClick: expect.any(Function),
      })
    );
  });

  it.each([
    [20, true, null],
    [50, false, "left"],
    [5, false, "right"],
  ])(
    "places selection %ss correctly relative to the panel's own window",
    (selectedOffset, showSelLine, selectionEdge) => {
      const { result } = renderHook(() => usePanelHistoryData("waveform"), {
        wrapper: wrapperFor(historyData({ selectedOffset })),
      });

      expect(result.current.showSelLine).toBe(showSelLine);
      expect(result.current.selectionEdge).toBe(selectionEdge);
    }
  );

  it("keeps the HUD lifecycle local to each timeline panel mount", () => {
    vi.useFakeTimers();
    const value = historyData();
    const first = renderHook(() => usePanelHistoryData("spectrogram"), {
      wrapper: wrapperFor(value),
    });
    const second = renderHook(() => usePanelHistoryData("waveform"), {
      wrapper: wrapperFor(value),
    });

    act(() => first.result.current.showHistoryHud(1600));

    expect(first.result.current.isHistoryHudVisible).toBe(true);
    expect(second.result.current.isHistoryHudVisible).toBe(false);
  });

  it("leaves non-timeline panels on the global history data path", () => {
    const value = historyData({ captureCurrentSnapshot: vi.fn() });
    const { result } = renderHook(() => usePanelHistoryData("spectrum"), {
      wrapper: wrapperFor(value),
    });

    expect(result.current).toBe(value);
    expect(result.current.historyTimeAxisHandlers).toBeUndefined();
  });

  it("writes a timeline panel's effective time viewport through the axis adapter", () => {
    const setAxisViewportValue = vi.fn();
    const axisViewportData = {
      axisViewports: {
        time: { windowSec: 20, offsetSec: 8, linked: true },
      },
      setAxisViewportValue,
    };
    const { result } = renderHook(() => usePanelHistoryData("loudness", axisViewportData), {
      wrapper: wrapperFor(historyData()),
    });

    act(() => {
      result.current.setHistoryWindowSec(12);
      result.current.setHistoryOffsetSec(4);
    });

    expect(setAxisViewportValue).toHaveBeenNthCalledWith(1, "time", {
      windowSec: 12,
      offsetSec: 8,
    });
    expect(setAxisViewportValue).toHaveBeenNthCalledWith(2, "time", {
      windowSec: 12,
      offsetSec: 4,
    });
  });
});
