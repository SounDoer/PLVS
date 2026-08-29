import { performance } from "node:perf_hooks";

import { VectorscopeHistorySlab } from "../src/lib/VectorscopeHistorySlab.js";
import { buildVectorscopeSvgFromPairs } from "../src/math/vectorscopeMath.js";
import {
  drawPersistenceWindow,
  PERSISTENCE_WINDOW_MS,
  selectPersistenceWindow,
} from "../src/math/vectorscopePersistence.js";
import {
  aggregatePolarLevel,
  POLAR_LEVEL_WINDOW_MS,
  POLAR_SAMPLE_WINDOW_MS,
  projectPairToPolar,
  selectPolarWindow,
} from "../src/math/vectorscopePolarMath.js";

const PAIR_COUNT = 100;
const PAIR_VALUE_COUNT = PAIR_COUNT * 2;
const VISUAL_TICK_MS = 40;
const LIVE_POINT_COUNT = Math.ceil(4096 / 6);

let benchmarkSink;

function deterministicPairs(pairCount, phase = 0) {
  const pairs = new Float32Array(pairCount * 2);
  for (let index = 0; index < pairCount; index += 1) {
    const angle = phase + index * 0.071;
    pairs[index * 2] = Math.fround(Math.sin(angle) * 0.73);
    pairs[index * 2 + 1] = Math.fround(Math.sin(angle * 1.013 + 0.41) * 0.67);
  }
  return pairs;
}

function averageMs(callback, iterations) {
  for (let index = 0; index < 20; index += 1) benchmarkSink = callback();
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) benchmarkSink = callback();
  return (performance.now() - started) / iterations;
}

function recordingContext() {
  const counts = {
    clearRect: 0,
    beginPath: 0,
    moveTo: 0,
    lineTo: 0,
    stroke: 0,
  };
  return {
    counts,
    clearRect() {
      counts.clearRect += 1;
    },
    beginPath() {
      counts.beginPath += 1;
    },
    moveTo() {
      counts.moveTo += 1;
    },
    lineTo() {
      counts.lineTo += 1;
    },
    stroke() {
      counts.stroke += 1;
    },
    set globalAlpha(value) {
      benchmarkSink = value;
    },
  };
}

function populatedSlab(rowCount) {
  const slab = new VectorscopeHistorySlab(rowCount, PAIR_VALUE_COUNT);
  for (let index = 0; index < rowCount; index += 1) {
    slab.push({
      pairs: deterministicPairs(PAIR_COUNT, index * 0.013),
      correlation: Math.sin(index * 0.01),
      sideToMidDb: -6,
      midEnergy: 0.5,
      sideEnergy: 0.25,
      timestampMs: index * VISUAL_TICK_MS,
    });
  }
  return slab;
}

function projectPolarSampleRows(rows) {
  let checksum = 0;
  for (const row of rows) {
    for (let index = 0; index + 1 < row.pairs.length; index += 2) {
      const point = projectPairToPolar(row.pairs[index], row.pairs[index + 1]);
      checksum += point.x + point.y + point.radius + point.angle;
    }
  }
  return checksum;
}

function projectedVectorscopeHistoryBytes(rows, keyCount = 1) {
  const chunkRows = 1024;
  const chunkCount = Math.ceil(rows / chunkRows);
  const timestamps = rows * Float64Array.BYTES_PER_ELEMENT;
  const pairs = rows * PAIR_VALUE_COUNT * Int16Array.BYTES_PER_ELEMENT;
  const metrics = rows * 4 * Float64Array.BYTES_PER_ELEMENT;
  const polarMax = chunkCount * 64 * Float64Array.BYTES_PER_ELEMENT;
  const perKeyTotal = timestamps + pairs + metrics + polarMax;
  return {
    rows,
    timestamps,
    pairs,
    metrics,
    polarMax,
    perKeyTotal,
    keyCount,
    total: perKeyTotal * keyCount,
  };
}

function benchmarkPolarMaxHoldLookup() {
  // Full-chunk lookup cost depends on chunk count and 64 polar bins, not on row width. Keeping one
  // pair per row makes the four-hour fixture small while preserving the production query shape.
  const rows = 360_000;
  const slab = new VectorscopeHistorySlab(rows, 2);
  const pairs = new Float32Array([0.25, 0.25]);
  for (let index = 0; index < rows; index += 1) {
    slab.push({
      pairs,
      correlation: 1,
      sideToMidDb: -48,
      midEnergy: 0.25 * Math.SQRT2,
      sideEnergy: 0,
      timestampMs: index * VISUAL_TICK_MS,
    });
  }
  return {
    rows,
    chunkCount: Math.ceil(rows / 1024),
    middleMs: averageMs(() => slab.polarMaxHoldAt(Math.floor(rows / 2)), 200),
    newestMs: averageMs(() => slab.polarMaxHoldAt(rows - 1), 200),
  };
}

function payloadSizes() {
  const key = "vectorscope:pair:0:1";
  const livePairs = deterministicPairs(LIVE_POINT_COUNT);
  const path = buildVectorscopeSvgFromPairs(livePairs);
  const metrics = {
    correlation: 0.518273645812,
    sideToMidDb: -7.2841638172,
    midEnergy: 0.4827364518,
    sideEnergy: 0.193746281,
  };
  const live = JSON.stringify({
    vectorscopeResultsByKey: {
      [key]: { path, ...metrics, pairX: 0, pairY: 1 },
    },
  });
  const visual = JSON.stringify({
    vectorscopeByKey: {
      [key]: { pairs: Array.from(deterministicPairs(PAIR_COUNT)), ...metrics },
    },
  });
  return {
    pathPoints: LIVE_POINT_COUNT,
    pathUtf8Bytes: Buffer.byteLength(path),
    liveFragmentUtf8Bytes: Buffer.byteLength(live),
    visualFragmentUtf8Bytes: Buffer.byteLength(visual),
    liveKiBPerSecond: (Buffer.byteLength(live) * 62.5) / 1024,
    visualKiBPerSecond: (Buffer.byteLength(visual) * 25) / 1024,
  };
}

function main() {
  const slab = populatedSlab(32);
  const persistenceRows = selectPersistenceWindow(slab, PERSISTENCE_WINDOW_MS);
  const polarRows = selectPolarWindow(slab, POLAR_SAMPLE_WINDOW_MS);
  const polarLevelRows = polarRows.filter((row) => row.ageMs <= POLAR_LEVEL_WINDOW_MS);
  const ctx = recordingContext();
  drawPersistenceWindow(ctx, persistenceRows, {
    width: 600,
    height: 600,
    windowMs: PERSISTENCE_WINDOW_MS,
  });

  const result = {
    fixture: {
      historyRows: slab.length,
      pairCountPerRow: PAIR_COUNT,
      persistenceRows: persistenceRows.length,
      polarSampleRows: polarRows.length,
      polarLevelRows: polarLevelRows.length,
    },
    perDrawMs: {
      lissajousLivePath683Points: averageMs(
        () => buildVectorscopeSvgFromPairs(deterministicPairs(LIVE_POINT_COUNT)),
        2000
      ),
      lissajousPersistence25x100Points: averageMs(() => {
        const drawCtx = recordingContext();
        drawPersistenceWindow(drawCtx, persistenceRows, {
          width: 600,
          height: 600,
          windowMs: PERSISTENCE_WINDOW_MS,
        });
        return drawCtx.counts;
      }, 2000),
      polarSampleProjection10x100Points: averageMs(() => projectPolarSampleRows(polarRows), 5000),
      polarLevelAggregate5x100Points: averageMs(() => aggregatePolarLevel(polarLevelRows), 5000),
      selectPersistenceWindow26x100Points: averageMs(
        () => selectPersistenceWindow(slab, PERSISTENCE_WINDOW_MS),
        5000
      ),
      selectPolarWindow11x100Points: averageMs(
        () => selectPolarWindow(slab, POLAR_SAMPLE_WINDOW_MS),
        5000
      ),
    },
    persistenceCanvasCommands: ctx.counts,
    historyRetention: {
      oneKey: projectedVectorscopeHistoryBytes(360_000),
      fourKeys: projectedVectorscopeHistoryBytes(360_000, 4),
      polarMaxHoldLookup: benchmarkPolarMaxHoldLookup(),
    },
    payload: payloadSizes(),
  };
  console.log(JSON.stringify(result, null, 2));
  console.log(`VECTORSCOPE_RENDER_RESULT=${JSON.stringify(result)}`);
}

main();
