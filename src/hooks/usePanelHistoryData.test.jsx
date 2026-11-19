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

  it("keeps the HUD visible until the most recent interaction deadline", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePanelHistoryData("loudness"), {
      wrapper: wrapperFor(historyData()),
    });

    act(() => result.current.showHistoryHud(1600));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.showHistoryHud(1600));
    act(() => vi.advanceTimersByTime(650));
    expect(result.current.isHistoryHudVisible).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.isHistoryHudVisible).toBe(false);
  });

  it("honors a shorter HUD deadline after a later interaction", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePanelHistoryData("loudness"), {
      wrapper: wrapperFor(historyData()),
    });

    act(() => result.current.showHistoryHud(2200));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.showHistoryHud(900));
    act(() => vi.advanceTimersByTime(950));
    expect(result.current.isHistoryHudVisible).toBe(false);
  });

  it.each([
    ["right-to-left", 250, 125, 0, 125],
    ["left-to-right", 750, 125, 1000, 125],
    ["bottom-to-top", 500, 62.5, 500, 0],
    ["top-to-bottom", 500, 187.5, 500, 250],
  ])(
    "selects the plotted time of a short File Spectrogram in %s",
    (orientation, x, y, oldestX, oldestY) => {
      const selectSnapshot = vi.fn();
      const { result } = renderHook(
        () =>
          usePanelHistoryData("spectrogram", null, {
            spectrogramMode: "heatmap",
            spectrogramOrientation: orientation,
          }),
        {
          wrapper: wrapperFor(
            historyData({
              sourceMode: "file",
              historyWindowSec: 30,
              historyOffsetSec: 0,
              running: false,
              selectSnapshot,
              histSourceList: Array.from({ length: 30 }, (_, i) => ({
                timestampMs: (i + 1) * 100,
              })),
            })
          ),
        }
      );

      expect(result.current.fileTimeRange).toEqual({ startSec: 0, endSec: 3 });
      const event = {
        button: 0,
        clientX: x,
        clientY: y,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 250 }),
          setPointerCapture: vi.fn(),
        },
      };
      act(() => result.current.onHistoryPointerDown(event));
      expect(selectSnapshot).toHaveBeenLastCalledWith(2.25);
      act(() =>
        result.current.onHistoryPointerMove({ ...event, clientX: oldestX, clientY: oldestY })
      );
      expect(selectSnapshot).toHaveBeenLastCalledWith(3);
    }
  );

  it("places a File selection at its checkpoint when media time and chart steps differ", () => {
    const { result } = renderHook(() => usePanelHistoryData("waveform"), {
      wrapper: wrapperFor(
        historyData({
          sourceMode: "file",
          histSourceList: [{ timestampMs: 100 }, { timestampMs: 410 }, { timestampMs: 650 }],
          selectedOffset: 0.24,
          selectedMediaTimestampMs: 410,
        })
      ),
    });

    expect(result.current.selectedHistSteps).toBe(1);
    expect(result.current.showSelLine).toBe(true);
  });

  it.each(["loudness", "waveform", "spectrogram"])(
    "labels a coarser File history by media time in %s",
    (moduleId) => {
      const { result } = renderHook(() => usePanelHistoryData(moduleId), {
        wrapper: wrapperFor(
          historyData({
            sourceMode: "file",
            histSourceList: { length: 100, timestampAt: (i) => (i + 1) * 200 },
            historyOffsetSec: 0,
          })
        ),
      });
      expect(result.current.historyTimeTicks.at(-1)).toBe("20s");
    }
  );

  it("keeps a File viewport wider than the Live history retention", () => {
    const { result } = renderHook(() => usePanelHistoryData("loudness"), {
      wrapper: wrapperFor(
        historyData({
          sourceMode: "file",
          histSourceList: { length: 42000, timestampAt: (i) => i * 100 },
          historyWindowSec: 3600,
          historyMaxWindowSec: 1800,
        })
      ),
    });
    expect(result.current.clampedWindowSec).toBe(3600);
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
