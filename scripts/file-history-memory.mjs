import { mkdir, writeFile } from "node:fs/promises";
import { FrameIntake } from "../src/lib/FrameIntake.js";
import { estimateRetainedBytes } from "../src/lib/fileHistoryBudget.js";

const cases = [
  { name: "stereo-3m", seconds: 180, channels: 2, bands: 256, keys: 1 },
  { name: "stereo-30m", seconds: 1800, channels: 2, bands: 256, keys: 1 },
  { name: "stereo-2h", seconds: 7200, channels: 2, bands: 256, keys: 1 },
  { name: "stereo-4h", seconds: 14400, channels: 2, bands: 256, keys: 1 },
  { name: "8ch-30m-two-requests", seconds: 1800, channels: 8, bands: 512, keys: 2 },
  { name: "16ch-30m-two-requests", seconds: 1800, channels: 16, bands: 512, keys: 2 },
  {
    name: "stereo-10m-all-visuals",
    seconds: 600,
    channels: 2,
    bands: 256,
    keys: 1,
    allVisuals: true,
  },
  {
    name: "unknown-duration-30m",
    seconds: 1800,
    channels: 2,
    bands: 256,
    keys: 1,
    unknownDuration: true,
  },
];
const measurements = [];
for (const fixture of cases) {
  global.gc?.();
  const before = process.memoryUsage();
  let intake = new FrameIntake();
  const waveformMin = Array(fixture.channels).fill(-0.5),
    waveformMax = Array(fixture.channels).fill(0.5);
  const centers = Array.from({ length: fixture.bands }, (_, index) => 20 + index * 20);
  const spectrumByKey = Object.fromEntries(
    Array.from({ length: fixture.keys }, (_, index) => [
      `spectrum-${index}`,
      {
        bandCentersHz: centers,
        smoothDb: Array(fixture.bands).fill(-24),
        smoothDbB: Array(fixture.bands).fill(-27),
      },
    ])
  );
  for (let index = 0; index < fixture.seconds * 10; index++) {
    const row = {
      timestampMs: index * 100,
      waveformMin,
      waveformMax,
      lufsMomentary: -23,
      lufsShortTerm: -23,
      integrated: -23,
      rmsDb: waveformMin,
    };
    intake.pushHistRow(row, fixture.unknownDuration ? Number.MAX_SAFE_INTEGER : 144000);
    intake.pushVisualHistRow(
      {
        ...row,
        spectrumByKey,
        ...(fixture.allVisuals
          ? {
              vectorscopeByKey: { vector: { pairs: Array(512).fill(0.25), correlation: 0.9 } },
              stereoMapByKey: {
                map: {
                  bandCentersHz: centers,
                  pl: Array(fixture.bands).fill(1),
                  pr: Array(fixture.bands).fill(0.5),
                  c: Array(fixture.bands).fill(0.5),
                },
              },
            }
          : {}),
      },
      fixture.unknownDuration ? Number.MAX_SAFE_INTEGER : 360000,
      48000
    );
  }
  const started = performance.now();
  const retainedEstimate = estimateRetainedBytes([intake]);
  const accountingMs = performance.now() - started;
  global.gc?.();
  const after = process.memoryUsage();
  const result = {
    ...fixture,
    retainedEstimate,
    accountingMs,
    arrayBuffersDelta: after.arrayBuffers - before.arrayBuffers,
    rss: after.rss,
  };
  measurements.push(result);
  console.log(JSON.stringify(result));
  intake = null;
  global.gc?.();
}
await mkdir("artifacts/file-mode-history", { recursive: true });
await writeFile(
  "artifacts/file-mode-history/memory.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      runtime: process.version,
      platform: process.platform,
      note: "Synthetic 10 Hz File checkpoints; retained estimate is not WebView or process RSS.",
      measurements,
    },
    null,
    2
  ) + "\n"
);
