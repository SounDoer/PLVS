/**
 * Per-frame CPU cost of the Waveform panel's render chain, off the app.
 *
 * Three stages run between a history row arriving and pixels appearing, and each is pure
 * computation over history rows, which is what makes them measurable without a window:
 *
 *   1. `sliceWaveformSubHistory[FromIndex]` -- decimate the visible window to one min/max bucket
 *      per device pixel. Two implementations, chosen by zoom level.
 *   2. `sliceSpectralWaveformMetrics` -- align the 25 Hz spectral ring onto the same buckets.
 *   3. `drawWaveformCanvas` -- walk the buckets and issue canvas calls.
 *
 * Stage 3 is measured against a recording stub context, so the number is the **JavaScript half
 * only**: the loop, the colour math, and the call overhead. The native rasterisation behind each
 * `fill` / `stroke` is not in it, and cannot be -- there is no canvas in Node. That is why this
 * script also reports the **canvas op count**, which is a structural fact rather than a timing and
 * therefore says what the browser is being asked to do.
 *
 * Every cost here is **per lane**: the panel renders one canvas per channel.
 *
 * Run: node scripts/waveform-render-benchmark.mjs
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

/** `drawWaveformCanvas` resolves two theme tokens through the per-theme cache. */
function installDomStubs() {
  const documentElement = { nodeType: 1 };
  globalThis.document = { documentElement };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => (name === "--ui-waveform-fill-opacity" ? "0.22" : "1"),
  });
}
installDomStubs();

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `drawWaveformCanvas` lives in a `.jsx` module behind the `@` alias, which Node cannot load and
 * this benchmark must not restructure the app to work around. esbuild resolves both, once, before
 * the clock starts; the bundling cost is not part of any measurement.
 */
async function loadPainter() {
  const outDir = mkdtempSync(join(tmpdir(), "plvs-waveform-bench-"));
  const entry = join(outDir, "entry.mjs");
  const outfile = join(outDir, "bundle.mjs");
  writeFileSync(
    entry,
    'export { drawWaveformCanvas } from "@/components/panels/WaveformPanel.jsx";\n'
  );
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "error",
    alias: { "@": join(repoRoot, "src") },
    loader: { ".jsx": "jsx" },
    jsx: "automatic",
  });
  return import(pathToFileURL(outfile).href);
}

const { sliceWaveformSubHistory, sliceWaveformSubHistoryFromIndex } =
  await import("../src/math/waveformMath.js");
const { WaveformHistoryIndex } = await import("../src/math/waveformHistoryIndex.js");
const { LoudnessHistorySlab } = await import("../src/lib/LoudnessHistorySlab.js");
const { sliceSpectralWaveformMetrics, parseCssRgb, waveformFrequencyRgb } = await import(
  "../src/math/spectralWaveformMath.js"
);
const { DEFAULT_WAVEFORM_CANVAS_COLORS } = await import("../src/theme/themeCanvasSelectors.js");
const { drawWaveformCanvas } = await loadPainter();

const CHANNELS = 2;
/** `HIST_EMIT_MS = 95` in the Rust pipeline: the scalar history advances ~10.5 times a second. */
const ROW_MS = 95;
/** `VISUAL_EMIT_MS = 40`: the spectral ring behind the frequency colours advances 25 times a second. */
const SPECTRAL_ROW_MS = 40;
/** 95 ms at 48 kHz is 4560 samples; `SUBBLOCK_SAMPLES = 256` in the accumulator. */
const SUB_COUNT = 18;
const FRAME_BUDGET_MS = 16;
const HISTORY_ROWS = 45000; // ~71 minutes of scalar history
const SPECTRAL_ROWS = 6000; // ~4 minutes of the visual ring
const FRAMES = 60;

const WIDTHS = [600, 1200];
/** Zoom levels: the 5 s floor, the 60 s default, and the 2 h ceiling. */
const WINDOWS_SEC = [5, 60, 7200];

function makeRows() {
  const rows = [];
  const stride = 2 * CHANNELS;
  for (let i = 0; i < HISTORY_ROWS; i += 1) {
    const pairs = new Float32Array(SUB_COUNT * stride);
    for (let s = 0; s < SUB_COUNT; s += 1) {
      for (let ch = 0; ch < CHANNELS; ch += 1) {
        const amplitude = 0.5 * Math.sin((i * SUB_COUNT + s) * 0.013 + ch);
        pairs[s * stride + ch * 2] = -Math.abs(amplitude);
        pairs[s * stride + ch * 2 + 1] = Math.abs(amplitude);
      }
    }
    rows.push({
      timestampMs: i * ROW_MS,
      waveformMin: [-0.5, -0.4],
      waveformMax: [0.5, 0.4],
      waveformSubPairs: pairs,
      waveformSubCount: SUB_COUNT,
    });
  }
  return rows;
}

/**
 * What the panel actually reads. A plain array hands the slice a row object that already exists;
 * the slab materialises one per row from packed columns, which is the cost the index path exists
 * to skip. Measuring only against the array would credit the scan with a saving it does not have.
 */
function makeSlab(rows) {
  const slab = new LoudnessHistorySlab(HISTORY_ROWS);
  for (const row of rows) slab.push(row);
  return slab;
}

function makeIndex(rows) {
  const index = new WaveformHistoryIndex(HISTORY_ROWS);
  for (const row of rows) index.append(row);
  return index;
}

function makeSpectralRows() {
  const rows = [];
  for (let i = 0; i < SPECTRAL_ROWS; i += 1) {
    rows.push({
      timestampMs: HISTORY_ROWS * ROW_MS - (SPECTRAL_ROWS - i) * SPECTRAL_ROW_MS,
      dominantFrequencyHz: [200 + (i % 400) * 20, 300 + (i % 300) * 25],
      spectralCentroidHz: [800 + (i % 200) * 30, 900 + (i % 250) * 28],
      tonality: [0.25 + 0.5 * Math.abs(Math.sin(i * 0.05)), 0.3],
    });
  }
  return rows;
}

/**
 * Counts what the painter asks the browser to do. The bucket loop and the path building are kept,
 * because they are what is under measurement; nothing is rasterised, because nothing can be.
 */
function recordingContext() {
  const counts = { fill: 0, stroke: 0, beginPath: 0, moveTo: 0, lineTo: 0, styleWrites: 0 };
  const noop = () => {};
  const context = {
    clearRect: noop,
    closePath: noop,
    beginPath: () => {
      counts.beginPath += 1;
    },
    moveTo: () => {
      counts.moveTo += 1;
    },
    lineTo: () => {
      counts.lineTo += 1;
    },
    fill: () => {
      counts.fill += 1;
    },
    stroke: () => {
      counts.stroke += 1;
    },
    counts,
  };
  for (const property of ["fillStyle", "strokeStyle", "lineWidth", "globalAlpha"]) {
    let stored;
    Object.defineProperty(context, property, {
      get: () => stored,
      set: (value) => {
        counts.styleWrites += 1;
        stored = value;
      },
    });
  }
  return context;
}

function fakeCanvas(width, height) {
  const context = recordingContext();
  return { width, height, getContext: () => context, counts: context.counts };
}

function bench(label, iterations, run) {
  for (let i = 0; i < 5; i += 1) run(i); // warm the JIT before the clock starts
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) run(i);
  const elapsed = performance.now() - start;
  return { label, perFrame: elapsed / iterations };
}

function percentOfBudget(ms) {
  return `${((ms / FRAME_BUDGET_MS) * 100).toFixed(1)}% of budget`;
}

function report(rows, log) {
  const width = Math.max(...rows.map((row) => row.label.length));
  for (const row of rows) {
    log(
      `  ${row.label.padEnd(width)}  ${row.perFrame.toFixed(3)} ms   ${percentOfBudget(row.perFrame)}`
    );
  }
}

function spectralGrid(slice, visibleSamples, W, rows, newestVisibleTimestampMs) {
  return {
    newestVisibleTimestampMs,
    visibleSamples,
    pixelWidth: W,
    fracPhase: slice.fracPhase,
    waveformRows: rows,
    effectiveOffsetSamples: 0,
    nominalIntervalMs: ROW_MS,
  };
}

/**
 * Splits the per-bucket colour work into the pieces a fix could remove, so the fix is aimed rather
 * than guessed. Every stage below produces the **same bytes** as the one above it -- these are
 * loop-invariant hoisting and allocation removal, not approximations, so none of them is a
 * quality trade.
 */
function colourProbe(buckets) {
  const palette = {
    low: parseCssRgb(DEFAULT_WAVEFORM_CANVAS_COLORS.frequencyLow),
    mid: parseCssRgb(DEFAULT_WAVEFORM_CANVAS_COLORS.frequencyMid),
    high: parseCssRgb(DEFAULT_WAVEFORM_CANVAS_COLORS.frequencyHigh),
    neutral: parseCssRgb(DEFAULT_WAVEFORM_CANVAS_COLORS.frequencyNeutral),
  };
  const splits = { lowMidSplitHz: 250, midHighSplitHz: 2000 };
  const frequencies = new Float32Array(buckets);
  const tonalities = new Float32Array(buckets);
  for (let i = 0; i < buckets; i += 1) {
    frequencies[i] = 40 * Math.exp((Math.log(500) * (i % 400)) / 400);
    tonalities[i] = 0.2 + 0.7 * Math.abs(Math.sin(i * 0.031));
  }

  let sink = "";
  const results = [];

  results.push(
    bench("as shipped: waveformFrequencyRgb + join", FRAMES, () => {
      for (let i = 0; i < buckets; i += 1) {
        const rgb = waveformFrequencyRgb(frequencies[i], tonalities[i], splits, palette);
        sink = `rgb(${rgb.join(" ")})`;
      }
    })
  );

  results.push(
    bench("colour only, no string", FRAMES, () => {
      for (let i = 0; i < buckets; i += 1) {
        sink = waveformFrequencyRgb(frequencies[i], tonalities[i], splits, palette);
      }
    })
  );

  // The three anchors and their logs depend only on the two split controls, yet the shipped
  // function recomputes all six every bucket.
  const lowAnchor = Math.sqrt(20 * splits.lowMidSplitHz);
  const midAnchor = Math.sqrt(splits.lowMidSplitHz * splits.midHighSplitHz);
  const highAnchor = Math.sqrt(splits.midHighSplitHz * 20000);
  const logLow = Math.log(lowAnchor);
  const logMid = Math.log(midAnchor);
  const logHigh = Math.log(highAnchor);
  const { low, mid, high, neutral } = palette;

  results.push(
    bench("anchors hoisted, no array allocation", FRAMES, () => {
      for (let i = 0; i < buckets; i += 1) {
        const frequencyHz = frequencies[i];
        let hr;
        let hg;
        let hb;
        if (!(frequencyHz > 0)) {
          hr = neutral[0];
          hg = neutral[1];
          hb = neutral[2];
        } else {
          const logFrequency = Math.log(Math.max(20, frequencyHz));
          if (frequencyHz <= lowAnchor) {
            [hr, hg, hb] = low;
          } else if (frequencyHz < midAnchor) {
            const t = (logFrequency - logLow) / (logMid - logLow);
            hr = Math.round(low[0] + (mid[0] - low[0]) * t);
            hg = Math.round(low[1] + (mid[1] - low[1]) * t);
            hb = Math.round(low[2] + (mid[2] - low[2]) * t);
          } else if (frequencyHz < highAnchor) {
            const t = (logFrequency - logMid) / (logHigh - logMid);
            hr = Math.round(mid[0] + (high[0] - mid[0]) * t);
            hg = Math.round(mid[1] + (high[1] - mid[1]) * t);
            hb = Math.round(mid[2] + (high[2] - mid[2]) * t);
          } else {
            [hr, hg, hb] = high;
          }
          const chroma = Math.pow(Math.max(0, Math.min(1, tonalities[i])), 0.35);
          hr = Math.round(neutral[0] + (hr - neutral[0]) * chroma);
          hg = Math.round(neutral[1] + (hg - neutral[1]) * chroma);
          hb = Math.round(neutral[2] + (hb - neutral[2]) * chroma);
        }
        sink = `rgb(${hr} ${hg} ${hb})`;
      }
    })
  );

  results.push(
    bench("  the same, minus the string build", FRAMES, () => {
      let acc = 0;
      for (let i = 0; i < buckets; i += 1) {
        const frequencyHz = frequencies[i];
        const logFrequency = Math.log(Math.max(20, frequencyHz));
        const chroma = Math.pow(Math.max(0, Math.min(1, tonalities[i])), 0.35);
        acc += logFrequency + chroma;
      }
      sink = acc;
    })
  );

  if (sink === undefined) throw new Error("unreachable");
  return results;
}

export function runBenchmark(log = console.log) {
  const rows = makeRows();
  const slab = makeSlab(rows);
  const index = makeIndex(rows);
  const spectralRows = makeSpectralRows();
  const sliceResults = [];
  const drawResults = [];
  const opCounts = [];

  for (const W of WIDTHS) {
    for (const windowSec of WINDOWS_SEC) {
      const visibleSamples = Math.max(1, Math.round(windowSec / (ROW_MS / 1000)));
      const coordsPerBucket = visibleSamples / W;
      const usesIndex = coordsPerBucket >= 1;
      const tag = `${W}px  ${windowSec}s window (${coordsPerBucket.toFixed(2)} rows/px)`;

      sliceResults.push(
        bench(`${tag}  scan, array fixture`, FRAMES, () =>
          sliceWaveformSubHistory(rows, visibleSamples, 0, CHANNELS, W)
        ),
        bench(`${tag}  scan, history slab`, FRAMES, () =>
          sliceWaveformSubHistory(slab, visibleSamples, 0, CHANNELS, W)
        )
      );
      if (usesIndex) {
        sliceResults.push(
          bench(`${tag}  via index`, FRAMES, () =>
            sliceWaveformSubHistoryFromIndex(slab, index, visibleSamples, 0, CHANNELS, W)
          )
        );
      }

      const slice = usesIndex
        ? sliceWaveformSubHistoryFromIndex(slab, index, visibleSamples, 0, CHANNELS, W)
        : sliceWaveformSubHistory(slab, visibleSamples, 0, CHANNELS, W);
      const newestVisibleTimestampMs = rows[rows.length - 1].timestampMs;
      const startTimestampMs = newestVisibleTimestampMs - visibleSamples * ROW_MS;
      const grid = spectralGrid(slice, visibleSamples, W, slab, newestVisibleTimestampMs);

      sliceResults.push(
        bench(`${tag}  spectral metrics`, FRAMES, () =>
          sliceSpectralWaveformMetrics(
            spectralRows,
            startTimestampMs,
            newestVisibleTimestampMs,
            slice.bucketCount,
            CHANNELS,
            grid
          )
        )
      );

      const metrics = sliceSpectralWaveformMetrics(
        spectralRows,
        startTimestampMs,
        newestVisibleTimestampMs,
        slice.bucketCount,
        CHANNELS,
        grid
      );

      const H = W === 600 ? 150 : 300; // one lane of a two-channel panel
      const variants = [
        ["classic", { frequencyColor: false, centroid: false }],
        ["classic + centroid", { frequencyColor: false, centroid: true }],
        ["frequency colour", { frequencyColor: true, centroid: false }],
        ["frequency colour + centroid", { frequencyColor: true, centroid: true }],
      ];
      for (const [name, flags] of variants) {
        const params = {
          mins: slice.mins[0],
          maxes: slice.maxes[0],
          bucketCount: slice.bucketCount,
          fracPhase: slice.fracPhase,
          firstBucket: slice.firstBucket,
          lastBucket: slice.lastBucket,
          selected: false,
          lowMidSplitHz: 250,
          midHighSplitHz: 2000,
          dominantFrequencyHz: metrics.dominantFrequencyHz[0],
          spectralCentroidHz: metrics.spectralCentroidHz[0],
          tonality: metrics.tonality[0],
          themeColors: DEFAULT_WAVEFORM_CANVAS_COLORS,
          ...flags,
        };
        const canvas = fakeCanvas(W, H);
        drawResults.push(
          bench(`${tag}  draw, ${name}`, FRAMES, () => drawWaveformCanvas(canvas, params))
        );

        const counting = fakeCanvas(W, H);
        drawWaveformCanvas(counting, params);
        opCounts.push({
          label: `${tag}  ${name}`,
          buckets: slice.lastBucket - slice.firstBucket + 1,
          ...counting.counts,
        });
      }
    }
  }

  log("");
  log(`Waveform slice + spectral alignment (${CHANNELS} channels, ${FRAME_BUDGET_MS} ms budget):`);
  report(sliceResults, log);
  log("");
  log("Reading one timestamp out of the slab, 1200 rows (one per pixel at 1200px):");
  const probes = Array.from({ length: 1200 }, (_, i) => HISTORY_ROWS - 1200 + i);
  const materialised = bench("  whole row via at()", FRAMES, () => {
    let sum = 0;
    for (const i of probes) sum += slab.at(i).timestampMs;
    return sum;
  });
  const direct = bench("  timestamp via timestampAt()", FRAMES, () => {
    let sum = 0;
    for (const i of probes) sum += slab.timestampAt(i);
    return sum;
  });
  report([materialised, direct], log);

  log("");
  log("Waveform draw, JavaScript half only, per lane:");
  report(drawResults, log);
  log("");
  log("Inside the Frequency Color loop, 1200 buckets (what a 1200px lane costs per draw):");
  report(colourProbe(1200), log);
  log("");
  log("Canvas operations issued per draw, per lane:");
  const width = Math.max(...opCounts.map((row) => row.label.length));
  for (const row of opCounts) {
    log(
      `  ${row.label.padEnd(width)}  ${String(row.buckets).padStart(5)} buckets   ` +
        `${String(row.fill).padStart(5)} fill   ${String(row.stroke).padStart(5)} stroke   ` +
        `${String(row.beginPath).padStart(5)} beginPath   ` +
        `${String(row.styleWrites).padStart(6)} style writes`
    );
  }
  return { sliceResults, drawResults, opCounts };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBenchmark();
}
