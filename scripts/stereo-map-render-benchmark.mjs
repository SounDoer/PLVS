import { performance } from "node:perf_hooks";

import {
  createStereoMapDerivationScratch,
  deriveStereoMapRow,
  STEREO_MAP_MODES,
  visitSelectedStereoMapDerivedPoints,
} from "../src/math/stereoMapMath.js";

const BAND_COUNT = 958;
const MODES = Object.values(STEREO_MAP_MODES);
const RANGES = {
  position: { lowerBound: -1, upperBound: 1 },
  correlation: { lowerBound: -1, upperBound: 1 },
  monoLossDb: { lowerBound: -24, upperBound: 0 },
  msRatioDb: { lowerBound: -48, upperBound: 24 },
};
let sink;

function fixture() {
  const bandCentersHz = new Float32Array(BAND_COUNT);
  const pl = new Float32Array(BAND_COUNT);
  const pr = new Float32Array(BAND_COUNT);
  const c = new Float32Array(BAND_COUNT);
  for (let index = 0; index < BAND_COUNT; index += 1) {
    const phase = index * 0.071;
    bandCentersHz[index] = Math.fround(20 * 2 ** (index / 96));
    pl[index] = Math.fround(0.02 + 0.7 * (0.5 + 0.5 * Math.sin(phase)));
    pr[index] = Math.fround(0.02 + 0.6 * (0.5 + 0.5 * Math.cos(phase * 1.03)));
    c[index] = Math.fround(Math.sin(phase * 0.37) * Math.sqrt(pl[index] * pr[index]));
  }
  return { bandCentersHz, pl, pr, c };
}

function averageMs(callback, iterations) {
  for (let index = 0; index < 20; index += 1) sink = callback();
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) sink = callback();
  return (performance.now() - started) / iterations;
}

function main() {
  const row = fixture();
  const scratch = createStereoMapDerivationScratch(BAND_COUNT);
  const result = {
    fixture: { bands: BAND_COUNT },
    deriveRowMs: Object.fromEntries(
      MODES.map((mode) => [
        mode,
        averageMs(() => deriveStereoMapRow(mode, row, RANGES[mode]), 2000),
      ])
    ),
    selectedVisitMs: {
      oneMode: averageMs(() => {
        let checksum = 0;
        visitSelectedStereoMapDerivedPoints(
          row,
          [STEREO_MAP_MODES.POSITION],
          (_mode, _band, value) => {
            checksum += Number.isFinite(value) ? value : 0;
          },
          scratch
        );
        return checksum;
      }, 5000),
      fourModes: averageMs(() => {
        let checksum = 0;
        visitSelectedStereoMapDerivedPoints(
          row,
          MODES,
          (_mode, _band, value) => {
            checksum += Number.isFinite(value) ? value : 0;
          },
          scratch
        );
        return checksum;
      }, 5000),
    },
  };
  console.log(JSON.stringify(result, null, 2));
  console.log(`STEREO_MAP_RENDER_RESULT=${JSON.stringify(result)}`);
}

main();
