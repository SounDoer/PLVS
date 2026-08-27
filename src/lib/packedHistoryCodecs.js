export const CENTI_DB_NO_VALUE = -32768;
export const NORMALIZED_INVALID = -32768;

const CENTI_DB_MIN = -32767;
const CENTI_DB_MAX = 32767;
const NORMALIZED_SCALE = 32767;
const STEREO_MAP_INVALID = -32768;
const STEREO_MAP_NEGATIVE_INFINITY = -32767;
const STEREO_MAP_POSITIVE_INFINITY = 32767;
const STEREO_MAP_FINITE_MIN = -32766;
const STEREO_MAP_FINITE_MAX = 32766;
const NORMALIZED_STEREO_MAP_MODES = new Set(["position", "correlation"]);
const DB_STEREO_MAP_MODES = new Set(["monoLossDb", "msRatioDb"]);

export function encodeCentiDb(value) {
  if (!Number.isFinite(value)) return CENTI_DB_NO_VALUE;
  return Math.max(CENTI_DB_MIN, Math.min(CENTI_DB_MAX, Math.round(value * 100)));
}

export function decodeCentiDb(value) {
  return value === CENTI_DB_NO_VALUE ? -Infinity : value / 100;
}

export function encodeNormalized(value) {
  if (!Number.isFinite(value)) return NORMALIZED_INVALID;
  return Math.round(Math.max(-1, Math.min(1, value)) * NORMALIZED_SCALE);
}

export function decodeNormalized(value) {
  return value === NORMALIZED_INVALID ? null : value / NORMALIZED_SCALE;
}

function assertStereoMapMode(mode) {
  if (!NORMALIZED_STEREO_MAP_MODES.has(mode) && !DB_STEREO_MAP_MODES.has(mode)) {
    throw new TypeError(`Unknown Stereo Map mode: ${String(mode)}`);
  }
}

export function encodeStereoMapValue(mode, value) {
  assertStereoMapMode(mode);
  if (value === null || Number.isNaN(value)) return STEREO_MAP_INVALID;
  if (value === -Infinity) return STEREO_MAP_NEGATIVE_INFINITY;
  if (value === Infinity) return STEREO_MAP_POSITIVE_INFINITY;
  if (!Number.isFinite(value)) return STEREO_MAP_INVALID;
  if (NORMALIZED_STEREO_MAP_MODES.has(mode)) return encodeNormalized(value);
  return Math.max(STEREO_MAP_FINITE_MIN, Math.min(STEREO_MAP_FINITE_MAX, Math.round(value * 100)));
}

export function decodeStereoMapValue(mode, value) {
  assertStereoMapMode(mode);
  if (value === STEREO_MAP_INVALID) return null;
  if (NORMALIZED_STEREO_MAP_MODES.has(mode)) return decodeNormalized(value);
  if (value === STEREO_MAP_NEGATIVE_INFINITY) return -Infinity;
  if (value === STEREO_MAP_POSITIVE_INFINITY) return Infinity;
  return value / 100;
}
