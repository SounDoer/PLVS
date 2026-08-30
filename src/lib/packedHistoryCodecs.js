export const CENTI_DB_NO_VALUE = -32768;
export const NORMALIZED_INVALID = -32768;

const CENTI_DB_MIN = -32767;
const CENTI_DB_MAX = 32767;
const NORMALIZED_SCALE = 32767;

/**
 * Stereo Map history values are kept 12 bits wide rather than 16.
 *
 * The panel resolves about 0.0033 of a normalized mode's range and 0.24 dB per pixel in a dB mode,
 * and the readout shows two decimals and 0.1 dB; an Int16 plane was therefore carrying four to six
 * bits nothing downstream can express, on the largest array the panel retains. Twelve bits put the
 * worst case at 0.00024 and 0.024 dB -- an order of magnitude under what either the plot or the
 * readout can show, so nothing visible changes.
 *
 * The code space is ordered, because Hold summaries take min/max over raw codes and must keep
 * doing so: invalid sits at 0 and is skipped explicitly, then -Infinity, the ascending finite run,
 * then +Infinity. A normalized mode has no infinities -- Position and Correlation are defined on
 * [-1, 1] -- so its finite run simply spans the rest of the space, and an infinite input clamps to
 * the bound exactly as it did when both families shared the Int16 space.
 */
export const STEREO_MAP_VALUE_INVALID = 0;
const STEREO_MAP_VALUE_NEGATIVE_INFINITY = 1;
const STEREO_MAP_VALUE_POSITIVE_INFINITY = 4095;
const DB_FIRST_FINITE_CODE = 2;
const DB_FINITE_STEPS = 4092;
const DB_FLOOR = -128;
const DB_CEILING = 64;
const DB_SPAN = DB_CEILING - DB_FLOOR;
const NORMALIZED_FIRST_CODE = 1;
const NORMALIZED_STEPS = 4094;
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
  if (value === null || Number.isNaN(value)) return STEREO_MAP_VALUE_INVALID;
  if (NORMALIZED_STEREO_MAP_MODES.has(mode)) {
    const clamped = Math.max(-1, Math.min(1, value));
    return NORMALIZED_FIRST_CODE + Math.round(((clamped + 1) / 2) * NORMALIZED_STEPS);
  }
  if (value === -Infinity) return STEREO_MAP_VALUE_NEGATIVE_INFINITY;
  if (value === Infinity) return STEREO_MAP_VALUE_POSITIVE_INFINITY;
  if (!Number.isFinite(value)) return STEREO_MAP_VALUE_INVALID;
  const clamped = Math.max(DB_FLOOR, Math.min(DB_CEILING, value));
  return DB_FIRST_FINITE_CODE + Math.round(((clamped - DB_FLOOR) / DB_SPAN) * DB_FINITE_STEPS);
}

export function decodeStereoMapValue(mode, code) {
  assertStereoMapMode(mode);
  if (code === STEREO_MAP_VALUE_INVALID) return null;
  if (NORMALIZED_STEREO_MAP_MODES.has(mode)) {
    return ((code - NORMALIZED_FIRST_CODE) / NORMALIZED_STEPS) * 2 - 1;
  }
  if (code === STEREO_MAP_VALUE_NEGATIVE_INFINITY) return -Infinity;
  if (code === STEREO_MAP_VALUE_POSITIVE_INFINITY) return Infinity;
  return DB_FLOOR + ((code - DB_FIRST_FINITE_CODE) / DB_FINITE_STEPS) * DB_SPAN;
}

/**
 * A value plane: one byte per entry for the code's high eight bits, one nibble for its low four.
 *
 * Split rather than packed three-bytes-per-two-entries so the high plane stays directly indexable
 * -- it carries the ordering, so a comparison can often stop there -- and only the nibble needs
 * shifting. A fresh plane reads as invalid everywhere, since that is code 0.
 *
 * @param {number} entryCount rows x bands
 */
export function createStereoMapValuePlane(entryCount) {
  return { hi: new Uint8Array(entryCount), lo: new Uint8Array((entryCount + 1) >> 1) };
}

/** @returns {{ hi: Uint8Array, lo: Uint8Array }} a copy holding the first `entryCount` entries. */
export function sliceStereoMapValuePlane(plane, entryCount) {
  return {
    hi: plane.hi.slice(0, entryCount),
    lo: plane.lo.slice(0, (entryCount + 1) >> 1),
  };
}

export function stereoMapValuePlaneBytes(plane) {
  return plane.hi.byteLength + plane.lo.byteLength;
}

export function readStereoMapValueCode(plane, index) {
  const nibble = (plane.lo[index >> 1] >> ((index & 1) << 2)) & 0x0f;
  return (plane.hi[index] << 4) | nibble;
}

export function writeStereoMapValueCode(plane, index, code) {
  plane.hi[index] = code >> 4;
  const byte = index >> 1;
  const shift = (index & 1) << 2;
  plane.lo[byte] = (plane.lo[byte] & ~(0x0f << shift)) | ((code & 0x0f) << shift);
}
