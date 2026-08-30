import { fileURLToPath } from "node:url";

import { decodeCentiDb, encodeCentiDb } from "../src/lib/packedHistoryCodecs.js";
import {
  decodeStereoMapRelativeEnergy,
  encodeStereoMapRelativeEnergy,
  STEREO_MAP_ENERGY_BELOW_GATE,
  STEREO_MAP_ENERGY_INVALID,
  STEREO_MAP_ENERGY_STEP_DB,
} from "../src/lib/stereoMapEnergyCodec.js";

export const RELATIVE_ENERGY_NO_VALUE = 255;
export const RELATIVE_ENERGY_STEP_DB = 0.25;
export const RELATIVE_ENERGY_MAX_DB = 254 * RELATIVE_ENERGY_STEP_DB;

const GATE_FLOOR_DB = -96;
const GATE_BELOW_PEAK_DB = 60;
const GATE_FADE_DB = 12;

export function encodeRelativeEnergy(peakDb, energyDb, rounding = "nearest") {
  if (!Number.isFinite(peakDb) || !Number.isFinite(energyDb)) {
    return RELATIVE_ENERGY_NO_VALUE;
  }
  const attenuationDb = Math.max(0, peakDb - energyDb);
  if (attenuationDb > RELATIVE_ENERGY_MAX_DB) return RELATIVE_ENERGY_NO_VALUE;
  const scaled = attenuationDb / RELATIVE_ENERGY_STEP_DB;
  let code = rounding === "ceiling" ? Math.ceil(scaled) : Math.round(scaled);
  code = Math.min(254, code);
  if (rounding === "gateSafe") {
    const gateDb = Math.max(GATE_FLOOR_DB, peakDb - GATE_BELOW_PEAK_DB);
    const baselineVisible = energyDb >= gateDb;
    const decodedVisible = peakDb - code * RELATIVE_ENERGY_STEP_DB >= gateDb;
    if (baselineVisible && !decodedVisible) code = Math.max(0, code - 1);
    if (!baselineVisible && decodedVisible) code = Math.min(254, code + 1);
  }
  return code;
}

export function decodeRelativeEnergy(peakDb, code) {
  if (!Number.isFinite(peakDb) || code === RELATIVE_ENERGY_NO_VALUE) return null;
  return peakDb - code * RELATIVE_ENERGY_STEP_DB;
}

function opacity(energyDb, gateDb) {
  if (energyDb === null) return 0;
  return Math.min(1, Math.max(0, (energyDb - gateDb) / GATE_FADE_DB));
}

function createMetrics() {
  return {
    samples: 0,
    finiteBaseline: 0,
    sentinel: 0,
    falseVisible: 0,
    falseHidden: 0,
    falseOpaque: 0,
    falseTranslucent: 0,
    opacityCompared: 0,
    opacityAbsoluteErrorTotal: 0,
    opacityAbsoluteErrorMax: 0,
    hudCompared: 0,
    hudChanged: 0,
    visibleHudCompared: 0,
    visibleHudChanged: 0,
    hudMissing: 0,
    energyAbsoluteErrorMaxDb: 0,
  };
}

function compareSample(metrics, peakDb, energyDb, rounding) {
  metrics.samples += 1;
  if (!Number.isFinite(energyDb)) return;
  metrics.finiteBaseline += 1;
  const gateDb = Math.max(GATE_FLOOR_DB, peakDb - GATE_BELOW_PEAK_DB);
  const baselineVisible = energyDb >= gateDb;
  const baselineOpaque = energyDb >= gateDb + GATE_FADE_DB;
  const code =
    rounding === "production"
      ? encodeStereoMapRelativeEnergy(peakDb, energyDb)
      : encodeRelativeEnergy(peakDb, energyDb, rounding);
  const decoded =
    rounding === "production"
      ? decodeStereoMapRelativeEnergy(peakDb, code)
      : decodeRelativeEnergy(peakDb, code);
  if (decoded === null || decoded === -Infinity) {
    metrics.sentinel += 1;
    if (rounding !== "production") metrics.hudMissing += 1;
  } else {
    const candidateVisible = decoded >= gateDb;
    const candidateOpaque = decoded >= gateDb + GATE_FADE_DB;
    if (candidateVisible && !baselineVisible) metrics.falseVisible += 1;
    if (!candidateVisible && baselineVisible) metrics.falseHidden += 1;
    if (candidateOpaque && !baselineOpaque) metrics.falseOpaque += 1;
    if (!candidateOpaque && baselineOpaque) metrics.falseTranslucent += 1;
    const opacityError = Math.abs(opacity(decoded, gateDb) - opacity(energyDb, gateDb));
    metrics.opacityCompared += 1;
    metrics.opacityAbsoluteErrorTotal += opacityError;
    metrics.opacityAbsoluteErrorMax = Math.max(metrics.opacityAbsoluteErrorMax, opacityError);
    metrics.energyAbsoluteErrorMaxDb = Math.max(
      metrics.energyAbsoluteErrorMaxDb,
      Math.abs(decoded - energyDb)
    );
    metrics.hudCompared += 1;
    if (decoded.toFixed(1) !== energyDb.toFixed(1)) metrics.hudChanged += 1;
    if (baselineVisible) {
      metrics.visibleHudCompared += 1;
      if (decoded.toFixed(1) !== energyDb.toFixed(1)) metrics.visibleHudChanged += 1;
    }
  }
}

function finishMetrics(metrics) {
  return {
    ...metrics,
    gateMismatchRate:
      (metrics.falseVisible + metrics.falseHidden) / Math.max(1, metrics.finiteBaseline),
    opaqueMismatchRate:
      (metrics.falseOpaque + metrics.falseTranslucent) / Math.max(1, metrics.finiteBaseline),
    sentinelRate: metrics.sentinel / Math.max(1, metrics.finiteBaseline),
    meanOpacityAbsoluteError:
      metrics.opacityAbsoluteErrorTotal / Math.max(1, metrics.opacityCompared),
    hudChangedRate: metrics.hudChanged / Math.max(1, metrics.hudCompared),
    visibleHudChangedRate: metrics.visibleHudChanged / Math.max(1, metrics.visibleHudCompared),
  };
}

function runSweep(rounding) {
  const metrics = createMetrics();
  for (let peakCentiDb = -12_000; peakCentiDb <= 2400; peakCentiDb += 25) {
    const peakDb = decodeCentiDb(encodeCentiDb(peakCentiDb / 100));
    for (let attenuationCentiDb = 0; attenuationCentiDb <= 12_000; attenuationCentiDb += 1) {
      const energyDb = decodeCentiDb(encodeCentiDb(peakDb - attenuationCentiDb / 100));
      compareSample(metrics, peakDb, energyDb, rounding);
    }
  }
  return finishMetrics(metrics);
}

function runRepresentativeRows(rounding) {
  const metrics = createMetrics();
  const rows = 512;
  const bands = 958;
  for (let row = 0; row < rows; row += 1) {
    const peakDb = decodeCentiDb(encodeCentiDb(-120 + ((row * 37) % 14_401) / 100));
    for (let band = 0; band < bands; band += 1) {
      if ((row * bands + band) % 997 === 0) {
        compareSample(metrics, peakDb, -Infinity, rounding);
        continue;
      }
      const attenuationDb = ((row * 1543 + band * 7919) % 12_001) / 100;
      const energyDb = decodeCentiDb(encodeCentiDb(peakDb - attenuationDb));
      compareSample(metrics, peakDb, energyDb, rounding);
    }
  }
  return finishMetrics(metrics);
}

export function runExperiment() {
  return {
    codec: {
      bytesPerBand: 1,
      stepDb: RELATIVE_ENERGY_STEP_DB,
      maxAttenuationDb: RELATIVE_ENERGY_MAX_DB,
      sentinel: RELATIVE_ENERGY_NO_VALUE,
      production: {
        stepDb: STEREO_MAP_ENERGY_STEP_DB,
        belowGate: STEREO_MAP_ENERGY_BELOW_GATE,
        invalid: STEREO_MAP_ENERGY_INVALID,
        maxAttenuationDb: 253 * STEREO_MAP_ENERGY_STEP_DB,
      },
    },
    sweep: {
      fixture: "peaks -120..24 dB in 0.25 dB steps; attenuation 0..120 dB in 0.01 dB steps",
      nearest: runSweep("nearest"),
      gateSafe: runSweep("gateSafe"),
      production: runSweep("production"),
      ceiling: runSweep("ceiling"),
    },
    representative: {
      fixture: "512 deterministic rows x 958 bands; peaks -120..24 dB; attenuation 0..120 dB",
      nearest: runRepresentativeRows("nearest"),
      gateSafe: runRepresentativeRows("gateSafe"),
      production: runRepresentativeRows("production"),
      ceiling: runRepresentativeRows("ceiling"),
    },
  };
}

function main() {
  const result = runExperiment();
  console.log(JSON.stringify(result, null, 2));
  console.log(`STEREO_MAP_ENERGY_CODEC_RESULT=${JSON.stringify(result)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
