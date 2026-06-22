// Throwaway microbenchmark [DEBUG-spec-perf]: measures the per-visual-tick cost of
// FrameIntake.pushVisualHistRow (which rebuilds slab.toArray() every tick) and the
// one-shot snapshotVisualSpectrumByKey() cost, as a function of ring fill level.
// Run: node bench-spectrogram-snap.mjs ; delete when done.
import { FrameIntake } from "./src/lib/FrameIntake.js";
import { buildRtaBands } from "./src/config/scales.js";

const VISUAL_MAX = 180_000; // 2h @ 25Hz, matches App.jsx VISUAL_MAX_SAMPLES
const bands = buildRtaBands(20, 20000, "1/24");
const centers = bands.map((b) => b.fCenter);
const bandCount = centers.length;
console.log(`bandCount=${bandCount}, visualMax=${VISUAL_MAX}`);

function makeRow(ts) {
  const smoothDb = new Float32Array(bandCount);
  for (let i = 0; i < bandCount; i++) smoothDb[i] = -60 + ((i + ts) % 40);
  return {
    waveformMin: [],
    waveformMax: [],
    timestampMs: ts,
    spectrumByKey: {
      "spectrum:single:0:combined": { bandCentersHz: centers, smoothDb, smoothDbB: undefined },
    },
  };
}

// Pre-fill cheaply: push straight into the per-key slab (O(n)) instead of through
// pushVisualHistRow (which would pay an O(fill) toArray every iteration -> O(n^2) setup).
function makeFilledIntake(fill) {
  const intake = new FrameIntake();
  if (fill > 0) intake.pushVisualHistRow(makeRow(0), VISUAL_MAX); // create the slab
  const slab = intake.getVisualSpectrumHistByKey("spectrum:single:0:combined");
  for (let i = 1; i < fill; i++) {
    const smoothDb = new Float32Array(bandCount);
    for (let j = 0; j < bandCount; j++) smoothDb[j] = -60 + ((j + i) % 40);
    slab.push({ bands: slab.bands, dbList: smoothDb, dbListB: undefined, timestampMs: i });
  }
  return intake;
}

// Measure the average cost of one pushVisualHistRow once the ring already holds `fill` rows.
function measurePushAtFill(fill, sampleTicks = 100) {
  const intake = makeFilledIntake(fill);
  for (let i = 0; i < 10; i++) intake.pushVisualHistRow(makeRow(fill + i), VISUAL_MAX); // warm
  const t0 = performance.now();
  for (let i = 0; i < sampleTicks; i++) intake.pushVisualHistRow(makeRow(fill + 100 + i), VISUAL_MAX);
  const t1 = performance.now();
  return (t1 - t0) / sampleTicks; // ms per tick
}

function measureSnapshotAtFill(fill, reps = 5) {
  const intake = makeFilledIntake(fill);
  intake.snapshotVisualSpectrumByKey(); // warm
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) intake.snapshotVisualSpectrumByKey();
  const t1 = performance.now();
  return (t1 - t0) / reps;
}

const fills = [0, 1500 /*1min*/, 9000 /*6min*/, 90_000 /*1h*/, 180_000 /*2h*/];
console.log("\n--- pushVisualHistRow: ms per 25Hz tick (budget = 40ms/tick) ---");
for (const f of fills) {
  const ms = measurePushAtFill(f);
  const pctBudget = ((ms / 40) * 100).toFixed(1);
  console.log(`fill=${String(f).padStart(7)} (${(f / 25 / 60).toFixed(0)}min)  ${ms.toFixed(3)} ms/tick  (${pctBudget}% of 40ms budget)`);
}

console.log("\n--- snapshotVisualSpectrumByKey: ms (one-shot on entering snapshot) ---");
for (const f of fills) {
  const ms = measureSnapshotAtFill(f);
  console.log(`fill=${String(f).padStart(7)} (${(f / 25 / 60).toFixed(0)}min)  ${ms.toFixed(2)} ms`);
}
