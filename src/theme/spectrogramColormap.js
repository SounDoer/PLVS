import { SPEC_DB_MAX, SPEC_DB_MIN } from "../config/scales.js";

export const INFERNO_COLORMAP_STOPS = Object.freeze([
  [0, [0, 0, 4]],
  [26, [30, 12, 47]],
  [51, [66, 15, 110]],
  [77, [113, 12, 140]],
  [102, [158, 12, 143]],
  [128, [203, 25, 127]],
  [153, [231, 65, 82]],
  [179, [245, 130, 30]],
  [204, [251, 196, 10]],
  [230, [252, 235, 100]],
  [255, [252, 255, 164]],
]);

export const LIGHT_SPECTROGRAM_COLORMAP_STOPS = Object.freeze([
  [0, [247, 249, 252]],
  [26, [221, 231, 242]],
  [51, [179, 209, 231]],
  [77, [124, 184, 218]],
  [102, [71, 154, 198]],
  [128, [34, 122, 178]],
  [153, [38, 99, 151]],
  [179, [77, 80, 136]],
  [204, [128, 61, 117]],
  [230, [190, 70, 92]],
  [255, [232, 108, 70]],
]);

/**
 * @typedef {readonly [number, readonly [number, number, number]]} SpectrogramColorStop
 * @typedef {readonly SpectrogramColorStop[]} SpectrogramColorStops
 */

/**
 * @param {SpectrogramColorStops} stops
 * @returns {Uint8Array}
 */
export function buildSpectrogramLut(stops) {
  const normalizedStops = Array.isArray(stops) && stops.length > 0 ? stops : INFERNO_COLORMAP_STOPS;
  const flat = new Uint8Array(256 * 3);

  for (let i = 0; i < 256; i += 1) {
    let lo = normalizedStops[0];
    let hi = normalizedStops[normalizedStops.length - 1];
    for (let j = 0; j < normalizedStops.length - 1; j += 1) {
      if (i >= normalizedStops[j][0] && i <= normalizedStops[j + 1][0]) {
        lo = normalizedStops[j];
        hi = normalizedStops[j + 1];
        break;
      }
    }
    const span = hi[0] - lo[0];
    const t = span === 0 ? 0 : (i - lo[0]) / span;
    flat[i * 3] = Math.round(lo[1][0] + t * (hi[1][0] - lo[1][0]));
    flat[i * 3 + 1] = Math.round(lo[1][1] + t * (hi[1][1] - lo[1][1]));
    flat[i * 3 + 2] = Math.round(lo[1][2] + t * (hi[1][2] - lo[1][2]));
  }

  return flat;
}

/**
 * @param {number} db
 * @param {Uint8Array} lut
 * @returns {[number, number, number]}
 */
export function spectrogramColorFromLut(db, lut) {
  const safeLut = lut && lut.length >= 256 * 3 ? lut : buildSpectrogramLut(INFERNO_COLORMAP_STOPS);
  const t = Number.isFinite(db)
    ? Math.max(0, Math.min(1, (db - SPEC_DB_MIN) / (SPEC_DB_MAX - SPEC_DB_MIN)))
    : 0;
  const idx = Math.round(t * 255) * 3;
  return [safeLut[idx], safeLut[idx + 1], safeLut[idx + 2]];
}
