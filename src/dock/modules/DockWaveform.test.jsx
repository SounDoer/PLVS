/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sliceWaveformSubHistory } from "../../math/waveformMath.js";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import {
  dockWaveformAggregationStride,
  DockWaveform,
  paintDockWaveformCanvas,
  sliceDockWaveformHistory,
} from "./DockWaveform.jsx";
import { WaveformHistoryIndex } from "../../math/waveformHistoryIndex.js";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub;
  globalThis.ResizeObserver = ResizeObserverStub;
});

function rows(values, channelCount = 2) {
  return values.map((value, index) => ({
    waveformMin: Array.from({ length: channelCount }, (_, channel) => -value * (1 - channel * 0.1)),
    waveformMax: Array.from({ length: channelCount }, (_, channel) => value * (1 - channel * 0.2)),
    timestampMs: index * 100,
  }));
}

function renderWith(histSourceList, frameData = {}) {
  return render(
    <FrameDataProvider
      value={{
        displayAudio: { peakDb: [-12, -10] },
        channelCount: 2,
        peakLabelContext: { resolvedLayout: "stereo" },
        ...frameData,
      }}
    >
      <HistoryDataProvider value={{ histSourceList }}>
        <DockWaveform />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

function mockCanvas(width = 100, height = 40) {
  const context = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    stroke: vi.fn(),
  };
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext = vi.fn(() => context);
  return { canvas, context };
}

describe("DockWaveform", () => {
  it("renders one Level-style label row per available channel", () => {
    renderWith(rows([0.1, 0.2]));

    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    expect(screen.getByTestId("dock-waveform-labels").style.gridTemplateRows).toContain("2");
    expect(screen.getByTestId("dock-waveform-canvas")).toBeTruthy();
  });

  it("uses runtime channel labels without a single-channel view", () => {
    renderWith(rows([0.1], 3), {
      displayAudio: { peakDb: [-12, -10, -8] },
      channelCount: 3,
      peakLabelContext: { overrideLabels: ["Left", "Right", "Center"] },
    });

    expect(screen.getByText("Left")).toBeTruthy();
    expect(screen.getByText("Right")).toBeTruthy();
    expect(screen.getByText("Center")).toBeTruthy();
  });

  it("paints asymmetric min and max envelopes with stroke and token fill", () => {
    const { canvas, context } = mockCanvas();
    paintDockWaveformCanvas(canvas, {
      mins: [[-0.75, -0.75]],
      maxes: [[0.25, 0.25]],
      bucketCount: 2,
      fracPhase: 0,
      firstBucket: 0,
      lastBucket: 1,
      channelCount: 1,
    });

    expect(context.lineTo).toHaveBeenCalledWith(1, 15);
    expect(context.lineTo).toHaveBeenCalledWith(1, 35);
    expect(context.fill).toHaveBeenCalledOnce();
    expect(context.stroke).toHaveBeenCalledTimes(2);
  });

  it("strokes the envelope at the token width and leaves the zero line at 1px", () => {
    const { canvas, context } = mockCanvas();
    canvas.style.setProperty("--ui-waveform-stroke-width", "2.5");
    const lineWidths = [];
    context.stroke = vi.fn(() => lineWidths.push(context.lineWidth));

    paintDockWaveformCanvas(canvas, {
      mins: [[-0.75, -0.75]],
      maxes: [[0.25, 0.25]],
      bucketCount: 2,
      fracPhase: 0,
      firstBucket: 0,
      lastBucket: 1,
      channelCount: 1,
    });

    expect(lineWidths).toEqual([1, 2.5]);
  });

  it("bounds the rendered envelope buckets by horizontal resolution for long history", () => {
    const history = rows(Array.from({ length: 150_000 }, (_, index) => (index % 100) / 100));
    const envelope = sliceWaveformSubHistory(history, history.length, 0, 2, 300);

    expect(envelope.bucketCount).toBeLessThanOrEqual(302);
    expect(envelope.mins).toHaveLength(2);
    expect(envelope.maxes).toHaveLength(2);
  });

  it("uses indexed full-window values without reading retained history rows", () => {
    const history = rows(Array.from({ length: 4_097 }, (_, index) => ((index * 17) % 100) / 100));
    const index = new WaveformHistoryIndex(history.length);
    history.forEach((row) => index.append(row));
    let reads = 0;
    const source = {
      length: history.length,
      rowAt(entry) {
        reads += 1;
        return history[entry];
      },
    };

    const expected = sliceWaveformSubHistory(history, history.length, 0, 2, 600);
    const actual = sliceDockWaveformHistory(source, index, history.length, 2, 600);

    expect(actual).toEqual(expected);
    expect(reads).toBe(0);
  });

  it("keeps short windows at full cadence and throttles sub-pixel long-window rebuilds", () => {
    expect(dockWaveformAggregationStride(600, 300)).toBe(1);
    expect(dockWaveformAggregationStride(18_000, 300)).toBe(10);
    expect(dockWaveformAggregationStride(72_000, 300)).toBe(10);
  });
});
