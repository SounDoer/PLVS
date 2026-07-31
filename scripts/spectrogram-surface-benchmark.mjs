import { performance } from "node:perf_hooks";

import { SPECTROGRAM_DB_MIN } from "../src/config/scales.js";
import { buildProjection } from "../src/math/spectrogram3dProjection.js";
import {
  buildRowLut,
  buildSurfaceLut,
  columnStrideFor,
  packArgb,
  rasterizeSurface,
  smoothGridFrequency,
  smoothGridTime,
} from "../src/math/spectrogram3dSurface.js";

// 922x110 and 2560x900 are the two real panel sizes the Lines mode was measured at, in device
// pixels. 1920x600 and 3440x1440 sit in between so `columnStrideFor`'s area budget is fitted
// against more than the two endpoints. 3840x1200 is Focus View at 2x -- a 1920x600 CSS panel given
// the whole window on a 2x display -- not a stress-test artefact. Row counts respect the
// precondition documented on `rasterizeSurface`'s grid parameter: `grid.count` must stay at or
// below the `steps` a column yields (roughly the canvas height), or nearest-row sampling aliases
// as the window slides. 300 rows keeps that margin at every size here at or above 600 tall.
const CANVASES = [
  { width: 922, height: 110, rows: 66, points: 154 },
  { width: 1920, height: 600, rows: 300, points: 320 },
  { width: 2560, height: 900, rows: 300, points: 320 },
  { width: 3440, height: 1440, rows: 300, points: 320 },
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
// `buildRowLut` and the two smoothers ARE inside the timed region: all three depend on the grid,
// which the hook rebuilds whenever history advances, so all three run on every repaint. Excluding
// them would understate per-frame cost. The smoothers mutate the grid in place, so each iteration
// first restores the pristine heights -- the restore stands in for `sampleWaterfallGrid`'s
// rebuild, which the timing boundary has always excluded.
function measure({ width, height, rows, points }, columnStride, lut) {
  const proj = buildProjection({ azimuthDeg: 135, elevationDeg: 60, width, height });
  const grid = syntheticGrid(rows, points);
  const pristine = new Float32Array(grid.heights);
  const out = new Uint32Array(width * height);
  const samples = [];

  for (let i = 0; i < ITERATIONS; i++) {
    grid.heights.set(pristine);
    const started = performance.now();
    const rowGapTFrac = 1.5 / Math.max(1, grid.count - 1);
    const rowLut = buildRowLut(grid.tFracs, grid.count, 1024, rowGapTFrac);
    smoothGridFrequency(grid.heights, grid.count, grid.pointCount);
    smoothGridTime(grid.heights, grid.tFracs, grid.count, grid.pointCount, rowGapTFrac);
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
      // Same widths the hook passes: 1 stride at the entering edge, 2.5 at the exiting one.
      enterFadeTFrac: 1 / Math.max(1, grid.count - 1),
      exitFadeTFrac: 2.5 / Math.max(1, grid.count - 1),
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

// Re-validates the shipped choice: running this script re-checks `columnStrideFor`'s pick against
// the full sweep rather than producing a table someone has to interpret by hand.
for (const canvas of CANVASES) {
  const area = canvas.width * canvas.height;
  const picked = columnStrideFor(canvas.width, canvas.height);
  const label =
    `${canvas.width}x${canvas.height} (${(area / 1e6).toFixed(2)} M px, ` +
    `${canvas.rows} rows x ${canvas.points} pts) -- columnStrideFor picks stride ${picked}`;
  const parts = STRIDES.map((stride) => {
    const { median: med, best } = measure(canvas, stride, sharedLut);
    const medFlag = med > BUDGET_MS ? "  OVER" : "";
    const bestFlag = best > BUDGET_MS ? "  OVER" : "";
    const chosen = stride === picked ? "  <- picked" : "";
    return (
      `stride ${stride}: median ${med.toFixed(2)} ms${medFlag}, ` +
      `best-of-${ITERATIONS} ${best.toFixed(2)} ms${bestFlag}${chosen}`
    );
  });
  console.log(`${label}\n  ${parts.join("\n  ")}\n`);
}
