import { performance } from "node:perf_hooks";

import { SPECTROGRAM_DB_MIN } from "../src/config/scales.js";
import { buildProjection } from "../src/math/spectrogram3dProjection.js";
import {
  buildRowLut,
  buildSurfaceLut,
  packArgb,
  rasterizeSurface,
} from "../src/math/spectrogram3dSurface.js";

// The two real panel sizes the Lines mode was measured at, in device pixels, plus a larger canvas
// to see where the cost trend goes. Row counts respect the precondition documented on
// `rasterizeSurface`'s grid parameter: `grid.count` must stay at or below the `steps` a column
// yields (roughly the canvas height), or nearest-row sampling aliases as the window slides. 300
// rows at 3840x1200 keeps that margin the same way it does at 2560x900.
const CANVASES = [
  { width: 922, height: 110, rows: 66, points: 154 },
  { width: 2560, height: 900, rows: 300, points: 320 },
  { width: 3840, height: 1200, rows: 300, points: 320 },
];
const STRIDES = [1, 2, 3, 4];
const ITERATIONS = 60;
const BUDGET_MS = 16.7;

function syntheticGrid(rows, points) {
  const heights = new Float32Array(rows * points);
  const tFracs = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    tFracs[r] = rows > 1 ? r / (rows - 1) : 0;
    for (let q = 0; q < points; q++) {
      // Something with real spectral shape: a decaying tilt plus a couple of resonances.
      const f = q / Math.max(1, points - 1);
      const tilt = 1 - f * 0.8;
      const res =
        0.25 * Math.exp(-(((f - 0.2) / 0.03) ** 2)) + 0.2 * Math.exp(-(((f - 0.55) / 0.05) ** 2));
      const env = 0.6 + 0.4 * Math.sin((r / rows) * Math.PI * 6);
      heights[r * points + q] = Math.min(1, Math.max(0, (tilt * 0.6 + res) * env));
    }
  }
  return { heights, tFracs, count: rows, pointCount: points };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function bestOf(values) {
  return Math.min(...values);
}

// Timing boundary: `buildSurfaceLut` is deliberately OUTSIDE the timed region. Task 9's hook
// caches it keyed on `(colorize, dbFloor, colormapLut)`, so in the running app it is rebuilt only
// on a theme or control change, not on every repaint -- including it here would overstate
// per-frame cost. Its own cost is measured separately, once, below.
//
// `buildRowLut` IS inside the timed region: it depends on `grid.tFracs`, which changes whenever
// history advances, so the hook rebuilds it every repaint. Excluding it would understate
// per-frame cost.
function measure({ width, height, rows, points }, columnStride, lut) {
  const proj = buildProjection({ azimuthDeg: 135, elevationDeg: 60, width, height });
  const grid = syntheticGrid(rows, points);
  const out = new Uint32Array(width * height);
  const samples = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const started = performance.now();
    const rowLut = buildRowLut(grid.tFracs, grid.count, 1024, 1.5 / Math.max(1, grid.count - 1));
    out.fill(0);
    rasterizeSurface({
      out,
      width,
      height,
      proj,
      grid,
      rowLut,
      lut,
      heightGain: 1,
      highlightArgb: packArgb(0, 255, 0, 255),
      highlightRow: -1,
      columnStride,
      maxSteps: height,
    });
    samples.push(performance.now() - started);
  }
  return { median: median(samples), best: bestOf(samples) };
}

function measureBuildSurfaceLut() {
  const colormapLut = new Uint8Array(256 * 3).fill(128);
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const started = performance.now();
    buildSurfaceLut({ colormapLut, dbFloor: SPECTROGRAM_DB_MIN, colorize: true });
    samples.push(performance.now() - started);
  }
  return { median: median(samples), best: bestOf(samples) };
}

console.log(`iterations per cell: ${ITERATIONS}, budget: ${BUDGET_MS} ms`);
console.log(
  "Node is not WebView2: no competing load from audio capture, DSP, or other panels, and the " +
    "JIT warms up differently than in a long-running webview. These numbers are a lower bound.\n"
);

const lutCost = measureBuildSurfaceLut();
console.log(
  `buildSurfaceLut (amortised, NOT in per-repaint numbers below): ` +
    `median ${lutCost.median.toFixed(3)} ms, best-of-${ITERATIONS} ${lutCost.best.toFixed(3)} ms\n`
);

// One colour LUT reused across strides per canvas, matching the amortised-cost assumption above.
const sharedLut = buildSurfaceLut({
  colormapLut: new Uint8Array(256 * 3).fill(128),
  dbFloor: SPECTROGRAM_DB_MIN,
  colorize: true,
});

for (const canvas of CANVASES) {
  const label = `${canvas.width}x${canvas.height} (${canvas.rows} rows x ${canvas.points} pts)`;
  const parts = STRIDES.map((stride) => {
    const { median: med, best } = measure(canvas, stride, sharedLut);
    const medFlag = med > BUDGET_MS ? "  OVER" : "";
    const bestFlag = best > BUDGET_MS ? "  OVER" : "";
    return (
      `stride ${stride}: median ${med.toFixed(2)} ms${medFlag}, ` +
      `best-of-${ITERATIONS} ${best.toFixed(2)} ms${bestFlag}`
    );
  });
  console.log(`${label}\n  ${parts.join("\n  ")}\n`);
}
