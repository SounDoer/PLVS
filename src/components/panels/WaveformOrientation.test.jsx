/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest";
import { drawWaveformCanvas } from "./WaveformPanel.jsx";

it.each([
  ["right-to-left", 0, 20],
  ["left-to-right", 200, 20],
  ["bottom-to-top", 150, 0],
  ["top-to-bottom", 150, 80],
])("draws positive amplitude on the correct side in %s", (orientation, x, y) => {
  const context = Object.fromEntries(
    [
      "clearRect",
      "beginPath",
      "moveTo",
      "lineTo",
      "closePath",
      "fill",
      "stroke",
      "setTransform",
    ].map((key) => [key, vi.fn()])
  );
  const canvas = {
    width: 200,
    height: 80,
    clientWidth: 100,
    clientHeight: 80,
    getContext: () => context,
  };
  drawWaveformCanvas(canvas, {
    orientation,
    mins: [-0.5, -0.5],
    maxes: [0.5, 0.5],
    bucketCount: 2,
    firstBucket: 0,
    lastBucket: 1,
    fracPhase: 0,
    selected: false,
    frequencyColor: false,
    centroid: false,
    lowMidSplitHz: 200,
    midHighSplitHz: 2000,
    dominantFrequencyHz: [],
    spectralCentroidHz: [],
    tonality: [],
  });
  expect(context.moveTo).toHaveBeenNthCalledWith(1, x, y);
  expect(context.clearRect).toHaveBeenCalledWith(0, 0, 200, 80);
  expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 1, 0, 0);
  expect(context.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
});
