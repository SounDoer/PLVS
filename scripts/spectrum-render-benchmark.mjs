/**
 * Per-frame CPU cost of the Spectrum panel's render pipeline, in isolation from React.
 *
 * Everything here is pure computation the panel redoes for every frame it draws, so it can be
 * measured off the app. What it deliberately does not cover is React's commit and the browser's
 * paint; those need a profiling session in the real window.
 *
 * Run: node scripts/spectrum-render-benchmark.mjs
 */
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { buildSpectrumDataSnapshot } from "../src/lib/FrameIntake.js";
import {
  applySpectrumTilt,
  buildSpectrumSvgFromBandsAndDb,
  findSpectrumPeakCandidates,
  spectrumTiltOffsets,
} from "../src/math/spectrumMath.js";
import { accumulateSpectrumMaxHold } from "../src/math/spectrumMaxHold.js";

/** Production grid: 96 points per octave over 20 Hz - 20 kHz. */
const BANDS = 958;
/** `FRAME_EMIT_MS = 16` in the Rust pipeline. */
const FRAME_BUDGET_MS = 16;
/** A panel this wide is a large one; the default workspace fits several across. */
const PANEL_CSS_WIDTH = 600;
const FRAMES = 400;

export function makeGrid(count = BANDS) {
  const minHz = 20;
  const perOctave = (count - 1) / Math.log2(20000 / minHz);
  return Array.from({ length: count }, (_, i) => minHz * 2 ** (i / perOctave));
}

export function makeRow(centers, phase) {
  return centers.map(
    (f, i) => -30 - 20 * Math.abs(Math.sin(i * 0.017 + phase)) - 3 * Math.log2(f / 1000)
  );
}

const RANGE = { minHz: 20, maxHz: 20000, yMinDb: -96, yMaxDb: -12 };

/**
 * Path builder that samples the grid with a stride instead of materialising a decimated copy.
 * Decimating into new arrays first costs about as much as the points it removes, which is why the
 * open question "are 958 points worth drawing" has to be asked this way to get an honest answer.
 */
function pathStrided(centers, db, stride) {
  if (!centers.length || centers.length !== db.length) return "";
  const logMin = Math.log10(RANGE.minHz);
  const den = Math.log10(RANGE.maxHz) - logMin;
  const span = RANGE.yMaxDb - RANGE.yMinDb;
  const parts = [];
  for (let i = 0; i < centers.length; i += stride) {
    const x = ((Math.log10(centers[i]) - logMin) / den) * 1000;
    const clamped = Math.max(RANGE.yMinDb, Math.min(RANGE.yMaxDb, db[i]));
    const y = 260 - 4 - ((clamped - RANGE.yMinDb) / span) * 246;
    parts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M ${parts.join(" L ")}`;
}

function bench(label, iterations, fn) {
  for (let i = 0; i < 40; i += 1) fn(i);
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn(i);
  return { label, perFrame: (performance.now() - started) / iterations };
}

export function runBenchmark(log = console.log) {
  const centers = makeGrid();
  const tilt = spectrumTiltOffsets(centers, 3);
  const rows = [makeRow(centers, 0), makeRow(centers, 1)];
  const data = buildSpectrumDataSnapshot({
    spectrumBandCentersHz: centers,
    spectrumSmoothDb: rows[0],
    spectrumSmoothDbB: rows[1],
  });
  let hold = null;
  for (let i = 0; i < 10; i += 1) hold = accumulateSpectrumMaxHold(hold, data.dbList);

  log(`Spectrum render cost — ${BANDS} bands, ${FRAMES} frames, ${FRAME_BUDGET_MS} ms frame budget`);
  log("");
  log("Per frame, one stage at a time:");
  const stages = [
    bench("tilt one row", FRAMES, () => applySpectrumTilt(rows[0], tilt)),
    bench("buildSpectrumDataSnapshot", FRAMES, (i) =>
      buildSpectrumDataSnapshot({
        spectrumBandCentersHz: centers,
        spectrumSmoothDb: rows[i % 2],
        spectrumSmoothDbB: rows[1],
      })
    ),
    bench("unwrap band centers", FRAMES, () => data.bands.map((band) => band.fCenter)),
    bench("one path", FRAMES, () => buildSpectrumSvgFromBandsAndDb(centers, data.dbList, RANGE)),
    bench("Max hold fold", FRAMES, () => accumulateSpectrumMaxHold(hold, data.dbList)),
    bench("peak label candidates", FRAMES, () =>
      findSpectrumPeakCandidates(data.bands, data.dbList, {
        minProminenceDb: 6,
        minHz: RANGE.minHz,
        maxHz: RANGE.maxHz,
      })
    ),
    // Open: the panel is a few hundred CSS pixels wide, so most of these points land on one
    // already occupied. Cheaper, but it changes what is drawn, so it is a product call.
    bench(`one path, strided to ${PANEL_CSS_WIDTH} px`, FRAMES, () =>
      pathStrided(centers, data.dbList, Math.ceil(BANDS / PANEL_CSS_WIDTH))
    ),
  ];
  const width = Math.max(...stages.map((stage) => stage.label.length));
  for (const stage of stages) {
    log(
      `  ${stage.label.padEnd(width)}  ${stage.perFrame.toFixed(3)} ms   ` +
        `${((stage.perFrame / FRAME_BUDGET_MS) * 100).toFixed(1)}% of budget`
    );
  }

  const onePath = stages.find((stage) => stage.label === "one path").perFrame;
  log("");
  log("A frame of one panel, by what it draws:");
  for (const [label, paths] of [
    ["combined, Max off", 1],
    ["combined, Max on", 3],
    ["lr/ms, Max off", 2],
    ["lr/ms, Max on", 6],
  ]) {
    const total = onePath * paths;
    log(
      `  ${label.padEnd(18)} ${paths} path(s)  ${total.toFixed(2)} ms   ` +
        `${((total / FRAME_BUDGET_MS) * 100).toFixed(0)}% of budget`
    );
  }

  log("");
  log(`Path string: ${buildSpectrumSvgFromBandsAndDb(centers, data.dbList, RANGE).length} chars`);
  log(`  strided to ${PANEL_CSS_WIDTH} px: ${pathStrided(centers, data.dbList, Math.ceil(BANDS / PANEL_CSS_WIDTH)).length} chars`);
  return stages;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBenchmark();
}
