/**
 * Per-frame CPU cost of the Spectrogram's two painters, off the app.
 *
 * The Spectrogram inherits its rows, its request key and its band grid from the Spectrum, so the
 * open questions here are all rendering ones. Both painters are pure computation over history
 * rows, which is what makes them measurable without a window; what stays out of reach is the
 * `putImageData` upload and the canvas compositing that follow.
 *
 * Run: node scripts/spectrogram-render-benchmark.mjs
 */
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { SpectrumHistorySlab } from "../src/lib/SpectrumHistorySlab.js";
import {
  paintSpectrogramImageData,
  scrollSpectrogramImageData,
  spectrogramScrollPlan,
} from "../src/hooks/useSpectrogramCanvas.js";
import { buildYToBand, buildYTiltDb } from "../src/math/spectrogramMath.js";
import { inWindowRange, spectrogramFrameEndMs } from "../src/math/spectrogramTimeline.js";
import { sampleWaterfallGrid } from "../src/math/spectrogram3dGrid.js";

const BANDS = 958;
/** `VISUAL_EMIT_MS = 40` in the Rust pipeline: the Spectrogram advances 25 times a second. */
const ROW_MS = 40;
const FRAME_BUDGET_MS = 16;
const SIZES = [
  [600, 300],
  [1200, 600],
];
const WINDOW_SEC = 60;
const FRAMES = 120;

function makeBands() {
  return Array.from({ length: BANDS }, (_, i) => ({ fCenter: 20 * 2 ** (i / 96) }));
}

function makeSlab(bands, rows) {
  const slab = new SpectrumHistorySlab(rows * 2, bands);
  for (let i = 0; i < rows; i += 1) {
    slab.push({
      timestampMs: i * ROW_MS,
      bands,
      dbList: Array.from(
        { length: BANDS },
        (_, b) => -30 - 40 * Math.abs(Math.sin(b * 0.02 + i * 0.05))
      ),
      dbListB: [],
    });
  }
  return slab;
}

/**
 * A 256-entry RGB ramp, the shape `buildSpectrogramLut` produces. Its contents cannot change the
 * cost -- every pixel is one indexed lookup either way -- so this keeps the theme out of a
 * measurement that is about the painter.
 */
function makeLut() {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    lut[i * 3] = i;
    lut[i * 3 + 1] = (i * 3) % 256;
    lut[i * 3 + 2] = 255 - i;
  }
  return lut;
}

/** Stands in for the canvas ImageData the painter writes into. */
function fakeImageData(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

/**
 * Candidate: one 32-bit store per pixel instead of four byte stores, against a packed RGBA table
 * indexed by the same 0..255 colour step the painter already quantises to. Same output, so this
 * measures how much of the cost is the write pattern rather than the work.
 */
function packedLut(lut) {
  const packed = new Uint32Array(256);
  const probe = new Uint8Array(4);
  const view = new Uint32Array(probe.buffer);
  for (let i = 0; i < 256; i += 1) {
    probe[0] = lut[i * 3];
    probe[1] = lut[i * 3 + 1];
    probe[2] = lut[i * 3 + 2];
    probe[3] = i;
    packed[i] = view[0];
  }
  return packed;
}

/**
 * The production painter with the colour math inlined into the pixel loop instead of going through
 * `spectrogramColorFrac`. Everything else matches, so this prices that per-pixel call -- the cost
 * of keeping the ramp's definition in one place.
 *
 * `dbList` is deliberately not used: it materialises all 958 values per row, which is what the
 * row's `dbAt` exists to avoid, and reading it in a pixel loop costs ten times the paint.
 */
function paintPacked(
  imageData,
  snaps,
  startIdx,
  endIdx,
  oldestMs,
  span,
  sampleMs,
  yToBand,
  packed,
  dbFloor,
  yTiltDb
) {
  const { data, width: W, height: H } = imageData;
  const words = new Uint32Array(data.buffer);
  words.fill(0);
  const scale = 255 / (0 - -100);
  for (let i = startIdx; i <= endIdx; i += 1) {
    const snap = snaps.rowAt(i);
    if (!snap || !Number.isFinite(snap.timestampMs)) continue;
    const xStart = Math.max(0, Math.round(((snap.timestampMs - oldestMs) / span) * W));
    const endMs = spectrogramFrameEndMs(snaps, i, sampleMs);
    const xEnd = Math.min(W, Math.round(((endMs - oldestMs) / span) * W));
    if (xEnd - xStart <= 0) continue;
    for (let y = 0; y < H; y += 1) {
      const raw = snap.dbAt(yToBand[y]);
      const db = yTiltDb ? raw + yTiltDb[y] : raw;
      const step = !(db > dbFloor) ? 0 : Math.round(Math.max(0, Math.min(255, (db + 100) * scale)));
      const word = packed[step];
      const rowBase = y * W;
      for (let x = xStart; x < xEnd; x += 1) words[rowBase + x] = word;
    }
  }
}

function bench(label, iterations, fn) {
  for (let i = 0; i < 10; i += 1) fn(i);
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn(i);
  return { label, perFrame: (performance.now() - started) / iterations };
}

export function runBenchmark(log = console.log) {
  const bands = makeBands();
  const lut = makeLut();
  const packed = packedLut(lut);
  const rows = (WINDOW_SEC * 1000) / ROW_MS;
  const view = makeSlab(bands, rows).view?.() ?? makeSlab(bands, rows);
  const newestMs = (rows - 1) * ROW_MS;
  const oldestMs = newestMs - WINDOW_SEC * 1000;

  log(
    `Spectrogram render cost — ${BANDS} bands, ${rows} rows in view, ${FRAME_BUDGET_MS} ms budget`
  );
  log("");

  const results = [];
  for (const [W, H] of SIZES) {
    const yToBand = buildYToBand(bands, H, 20, 20000);
    const yTilt = buildYTiltDb(yToBand, bands, 3);
    const full = fakeImageData(W, H);
    const column = fakeImageData(1, H);

    results.push(
      bench(`${W}x${H}  full repaint`, FRAMES, () =>
        paintSpectrogramImageData(
          full,
          view,
          0,
          rows - 1,
          oldestMs,
          WINDOW_SEC * 1000,
          ROW_MS,
          yToBand,
          lut,
          -84,
          yTilt
        )
      )
    );
    results.push(
      bench(`${W}x${H}  full, colour math inlined`, FRAMES, () =>
        paintPacked(
          full,
          view,
          0,
          rows - 1,
          oldestMs,
          WINDOW_SEC * 1000,
          ROW_MS,
          yToBand,
          packed,
          -84,
          yTilt
        )
      )
    );
    // What a live panel actually does now: slide, then repaint only the strip that came into view.
    // Averaged over consecutive frames, because most of them do not earn a whole column.
    let paintedOldestMs = oldestMs;
    paintSpectrogramImageData(
      full,
      view,
      0,
      rows - 1,
      oldestMs,
      WINDOW_SEC * 1000,
      ROW_MS,
      yToBand,
      lut,
      -84,
      yTilt
    );
    results.push(
      bench(`${W}x${H}  live frame (slide + strip)`, FRAMES, (i) => {
        const frameOldest = oldestMs + i * ROW_MS;
        const plan = spectrogramScrollPlan(paintedOldestMs, frameOldest, WINDOW_SEC * 1000, W);
        if (plan.xFrom > 0) scrollSpectrogramImageData(full, plan.shiftPx);
        paintedOldestMs = plan.paintedOldestMs;
        // Narrowed the way the hook narrows it: only the rows the strip can contain.
        const stripOldest = paintedOldestMs + (plan.xFrom / W) * (WINDOW_SEC * 1000);
        const strip = inWindowRange(
          view,
          stripOldest - ROW_MS,
          paintedOldestMs + WINDOW_SEC * 1000
        );
        if (strip.endIdx >= strip.startIdx) {
          paintSpectrogramImageData(
            full,
            view,
            strip.startIdx,
            strip.endIdx,
            paintedOldestMs,
            WINDOW_SEC * 1000,
            ROW_MS,
            yToBand,
            lut,
            -84,
            yTilt,
            plan.xFrom,
            W
          );
        }
      })
    );
    results.push(
      bench(`${W}x${H}  one column`, FRAMES, () =>
        paintSpectrogramImageData(
          column,
          view,
          rows - 2,
          rows - 1,
          newestMs - ROW_MS,
          ROW_MS,
          ROW_MS,
          yToBand,
          lut,
          -84,
          yTilt
        )
      )
    );
  }

  const width = Math.max(...results.map((r) => r.label.length));
  for (const row of results) {
    log(
      `  ${row.label.padEnd(width)}  ${row.perFrame.toFixed(3)} ms   ` +
        `${((row.perFrame / FRAME_BUDGET_MS) * 100).toFixed(1)}% of budget`
    );
  }

  log("");
  log("3D waterfall grid sampling:");
  for (const [W, H] of SIZES) {
    const points = Math.min(BANDS, W);
    const yToBand = buildYToBand(bands, points, 20, 20000);
    const yTilt = buildYTiltDb(yToBand, bands, 3);
    for (const maxRidges of [64, 160]) {
      const result = bench(`${W}x${H}  ${maxRidges} ridges x ${points} pts`, FRAMES, () =>
        sampleWaterfallGrid({
          view,
          startIdx: 0,
          endIdx: rows - 1,
          oldestMs,
          span: WINDOW_SEC * 1000,
          sampleMs: ROW_MS,
          maxRidges,
          yToBand,
          yTiltDb: yTilt,
          dbFloor: -84,
          pinLiveRow: true,
        })
      );
      log(
        `  ${result.label.padEnd(width)}  ${result.perFrame.toFixed(3)} ms   ` +
          `${((result.perFrame / FRAME_BUDGET_MS) * 100).toFixed(1)}% of budget`
      );
    }
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBenchmark();
}
