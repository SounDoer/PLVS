/**
 * Stereo Map stores how visible a band is, not how much energy it carries.
 *
 * Rendering asks three things of a band: is it below the gate (draw nothing), is it at or above
 * gate + fade (draw it solid), or is it somewhere in the 12 dB ramp between. Only a dB readout
 * needed the 63.25 dB range and 0.25 dB resolution the previous plane carried, and that readout is
 * gone -- Spectrum is where a band's level is read now.
 *
 * Four bits per band:
 *
 *   0        hidden, below the gate
 *   1..13    the ramp; each code is the centre of an equal bin strictly inside (0, 1)
 *   14       fully opaque
 *   15       no value
 *
 * Hidden and opaque own their codes, so both classifications are exact and quantization is confined
 * to the ramp -- unlike the energy plane it replaces, which quantized across the gate boundary and
 * hid 0.083% of the bands that should have been faintly visible. Measured by
 * `npm run experiment:stereo-map-opacity-codec`; the numbers are in `docs/working/perf/stereo-map.md`
 * §3.2b.
 */
const GATE_FLOOR_DB = -96;
const GATE_BELOW_PEAK_DB = 60;
const GATE_FADE_DB = 12;

export const STEREO_MAP_OPACITY_HIDDEN = 0;
export const STEREO_MAP_OPACITY_OPAQUE = 14;
export const STEREO_MAP_OPACITY_INVALID = 15;
/** Codes 1..13. */
export const STEREO_MAP_OPACITY_RAMP_LEVELS = STEREO_MAP_OPACITY_OPAQUE - 1;
/** Worst error a ramp code can carry: half a bin. */
export const STEREO_MAP_OPACITY_WORST_ERROR = 0.5 / STEREO_MAP_OPACITY_RAMP_LEVELS;

export function stereoMapGateDb(peakDb) {
  return Math.max(GATE_FLOOR_DB, peakDb - GATE_BELOW_PEAK_DB);
}

/**
 * @param {number} peakDb the row's full-grid peak
 * @param {number} energyDb the band's energy
 * @returns {number} a code in 0..15
 */
export function encodeStereoMapOpacity(peakDb, energyDb) {
  if (!Number.isFinite(peakDb) || !Number.isFinite(energyDb)) return STEREO_MAP_OPACITY_INVALID;
  const gateDb = stereoMapGateDb(peakDb);
  // `<=`, not `<`: at exactly the gate the opacity is 0, which draws nothing. Sending that into the
  // ramp would light a band the renderer leaves invisible.
  if (energyDb <= gateDb) return STEREO_MAP_OPACITY_HIDDEN;
  if (energyDb >= gateDb + GATE_FADE_DB) return STEREO_MAP_OPACITY_OPAQUE;
  const fraction = (energyDb - gateDb) / GATE_FADE_DB;
  const code = Math.floor(fraction * STEREO_MAP_OPACITY_RAMP_LEVELS) + 1;
  return Math.min(STEREO_MAP_OPACITY_RAMP_LEVELS, Math.max(1, code));
}

/** @returns {number | null} opacity in [0, 1], or null when the band has no value. */
export function decodeStereoMapOpacity(code) {
  if (code === STEREO_MAP_OPACITY_INVALID) return null;
  if (code === STEREO_MAP_OPACITY_HIDDEN) return 0;
  if (code === STEREO_MAP_OPACITY_OPAQUE) return 1;
  return (code - 0.5) / STEREO_MAP_OPACITY_RAMP_LEVELS;
}

/** The opacity a live row renders with, without going through storage. */
export function stereoMapOpacityFor(peakDb, energyDb) {
  if (!Number.isFinite(peakDb) || !Number.isFinite(energyDb)) return null;
  const gateDb = stereoMapGateDb(peakDb);
  return Math.min(1, Math.max(0, (energyDb - gateDb) / GATE_FADE_DB));
}

/**
 * Two bands per byte. A fresh plane reads as "no value" everywhere, because a chunk is allocated
 * before its rows exist and an unwritten band must not render as hidden -- hidden is a real state.
 *
 * @param {number} entryCount rows x bands
 */
export function createStereoMapOpacityPlane(entryCount) {
  return new Uint8Array((entryCount + 1) >> 1).fill(0xff);
}

/** @returns {Uint8Array} a copy holding the first `entryCount` entries. */
export function sliceStereoMapOpacityPlane(plane, entryCount) {
  return plane.slice(0, (entryCount + 1) >> 1);
}

export function readStereoMapOpacityCode(plane, index) {
  return (plane[index >> 1] >> ((index & 1) << 2)) & 0x0f;
}

export function writeStereoMapOpacityCode(plane, index, code) {
  const byte = index >> 1;
  const shift = (index & 1) << 2;
  plane[byte] = (plane[byte] & ~(0x0f << shift)) | ((code & 0x0f) << shift);
}
