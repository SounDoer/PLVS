import { decodeCentiDb, encodeCentiDb } from "./packedHistoryCodecs.js";

export const STEREO_MAP_ENERGY_STEP_DB = 0.25;
export const STEREO_MAP_ENERGY_BELOW_GATE = 254;
export const STEREO_MAP_ENERGY_INVALID = 255;

const MAX_FINITE_CODE = 253;
const MAX_FINITE_ATTENUATION_DB = MAX_FINITE_CODE * STEREO_MAP_ENERGY_STEP_DB;
const GATE_FLOOR_DB = -96;
const GATE_BELOW_PEAK_DB = 60;
const GATE_FADE_DB = 12;

function packedCentiDb(value) {
  return decodeCentiDb(encodeCentiDb(value));
}

function visibilityRegion(energyDb, gateDb) {
  if (energyDb < gateDb) return 0;
  if (energyDb < gateDb + GATE_FADE_DB) return 1;
  return 2;
}

export function stereoMapGateDb(peakDb) {
  return Math.max(GATE_FLOOR_DB, peakDb - GATE_BELOW_PEAK_DB);
}

export function encodeStereoMapRelativeEnergy(peakDb, energyDb) {
  const packedPeakDb = packedCentiDb(peakDb);
  const packedEnergyDb = packedCentiDb(energyDb);
  if (!Number.isFinite(packedPeakDb) || !Number.isFinite(packedEnergyDb)) {
    return STEREO_MAP_ENERGY_INVALID;
  }

  const attenuationDb = Math.max(0, packedPeakDb - packedEnergyDb);
  if (attenuationDb > MAX_FINITE_ATTENUATION_DB) return STEREO_MAP_ENERGY_BELOW_GATE;

  let code = Math.min(MAX_FINITE_CODE, Math.round(attenuationDb / STEREO_MAP_ENERGY_STEP_DB));
  const gateDb = stereoMapGateDb(packedPeakDb);
  const sourceRegion = visibilityRegion(packedEnergyDb, gateDb);
  let decodedRegion = visibilityRegion(packedPeakDb - code * STEREO_MAP_ENERGY_STEP_DB, gateDb);
  while (decodedRegion < sourceRegion && code > 0) {
    code -= 1;
    decodedRegion = visibilityRegion(packedPeakDb - code * STEREO_MAP_ENERGY_STEP_DB, gateDb);
  }
  while (decodedRegion > sourceRegion && code < MAX_FINITE_CODE) {
    code += 1;
    decodedRegion = visibilityRegion(packedPeakDb - code * STEREO_MAP_ENERGY_STEP_DB, gateDb);
  }
  return code;
}

export function decodeStereoMapRelativeEnergy(peakDb, code) {
  if (code === STEREO_MAP_ENERGY_INVALID) return null;
  if (code === STEREO_MAP_ENERGY_BELOW_GATE) return -Infinity;
  const packedPeakDb = packedCentiDb(peakDb);
  if (!Number.isFinite(packedPeakDb) || code < 0 || code > MAX_FINITE_CODE) return null;
  return packedPeakDb - code * STEREO_MAP_ENERGY_STEP_DB;
}

export function quantizeStereoMapEnergyForDisplay(peakDb, energyDb) {
  const packedPeakDb = packedCentiDb(peakDb);
  return decodeStereoMapRelativeEnergy(
    packedPeakDb,
    encodeStereoMapRelativeEnergy(packedPeakDb, energyDb)
  );
}
