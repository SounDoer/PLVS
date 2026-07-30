/**
 * Geometry and colour for the 3D spectrogram Surface mode: clipping a screen column against the
 * floor plane, mapping a column sample to the grid row it should read, and building the
 * (level x shade) colour table the rasteriser reads per sample.
 *
 * Pure: no canvas, no React, no data access. This module will grow into a per-pixel renderer that
 * writes ARGB words into buffers the caller supplies; today it contains the column-clipping step,
 * the row lookup, and the colour table that the rasteriser will walk.
 *
 * The column walk rests on one property of the orthographic projection: for a fixed screen column
 * the set of floor points landing in it is a straight line, so a column can be walked with constant
 * additions and given exact hidden-surface removal by a single running minimum. That is cheaper and
 * more robust than filling geometry, which is what the Lines mode's abandoned hidden-line attempt
 * tried -- see the Reversed section of the 2026-07-28 design.
 */

import { spectrogramColorFracFromHeight } from "../theme/spectrogramColormap.js";

const EPS = 1e-9;

/**
 * Where screen column `x` enters and leaves the floor square, in centred unit coordinates.
 *
 * Returns the NEAR endpoint plus a constant per-step delta pointing at the far end, because the
 * rasteriser walks front to back. `(-fx, tx)` is the direction of increasing screen y, i.e. toward
 * the viewer, so the near end is the one at the larger line parameter.
 *
 * @param {number} x screen column, device pixels. Must be finite (a loop index always is).
 * @param {object} proj from `buildProjection`
 * @param {number} maxSteps upper bound on the returned `steps`. Must be finite (a canvas dimension
 *        always is).
 * @returns {{ u0: number, v0: number, du: number, dv: number, steps: number } | null}
 *          null when the column misses the floor entirely. Otherwise the walk from `(u0, v0)`
 *          toward the far end visits `steps + 1` points: `(u0 + du*s, v0 + dv*s)` for
 *          `s = 0 .. steps` inclusive.
 */
export function columnFloorSpan(x, proj, maxSteps) {
  const offset = x - proj.originX;
  const denom = proj.tx * proj.tx + proj.fx * proj.fx;
  if (!(denom > 0)) return null;

  // Any point on the line `u*tx + v*fx = offset`; the one closest to the centre is convenient.
  const baseU = (offset * proj.tx) / denom;
  const baseV = (offset * proj.fx) / denom;
  const dirU = -proj.fx;
  const dirV = proj.tx;

  // Slab-clip the line parameter against both axes of the square.
  let sMin = -Infinity;
  let sMax = Infinity;
  for (const [base, dir] of [
    [baseU, dirU],
    [baseV, dirV],
  ]) {
    if (Math.abs(dir) < EPS) {
      // The line is constant along this axis: either wholly inside the slab or wholly outside.
      if (base < -0.5 - EPS || base > 0.5 + EPS) return null;
      continue;
    }
    const a = (-0.5 - base) / dir;
    const b = (0.5 - base) / dir;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    if (lo > sMin) sMin = lo;
    if (hi < sMax) sMax = hi;
  }
  if (!(sMax > sMin)) return null;

  // `det` is the screen-y rate per unit of the line parameter `s`: `det = depth·scaleX·scaleY > 0`
  // at every elevation `clampViewParams` allows, which is also why `(-fx, tx)` always points at the
  // viewer -- see `unprojectFloor`, which relies on the same determinant without an `abs`. Screen-y
  // extent of the clipped segment follows directly; one sample per screen pixel row is as fine as
  // the output can show, and it self-limits: a compressed low-elevation view needs fewer samples.
  const det = proj.tx * proj.fy - proj.ty * proj.fx;
  const yExtent = det * (sMax - sMin);
  const cap = Math.max(1, Math.floor(maxSteps));
  const steps = Math.max(1, Math.min(cap, Math.ceil(yExtent)));

  // Start at sMax -- the near end -- and step back toward sMin.
  const travel = sMin - sMax;
  return {
    u0: baseU + sMax * dirU,
    v0: baseV + sMax * dirV,
    du: (travel * dirU) / steps,
    dv: (travel * dirV) / steps,
    steps,
  };
}

/** Sentinel for "no grid row covers this time". Uint16Array-safe. */
export const NO_ROW = 0xffff;

/**
 * Quantised nearest-row lookup over tFrac, so the inner loop costs one array read instead of a
 * binary search. Rows sit at irregular timestamps, which is why a divide cannot replace this.
 *
 * Buckets with no row within `maxDistTFrac` get NO_ROW. That is how a real capture gap becomes a
 * hole in the surface: the rasteriser skips those samples and leaves the horizon where it was, so
 * the terrain behind the gap stays visible through it. Substituting the dB floor instead would draw
 * a gap as a flat plain, which is data that does not exist.
 *
 * @param {Float64Array} tFracs row positions in 0..1, ascending
 * @param {number} count how many entries of `tFracs` are valid. Must stay below `NO_ROW`, or a
 *        real row index would be indistinguishable from the sentinel.
 * @param {number} size table resolution
 * @param {number} maxDistTFrac beyond this distance a bucket counts as uncovered
 * @returns {Uint16Array}
 */
export function buildRowLut(tFracs, count, size, maxDistTFrac) {
  const lut = new Uint16Array(size);
  if (count <= 0) {
    lut.fill(NO_ROW);
    return lut;
  }
  let row = 0;
  for (let i = 0; i < size; i++) {
    const t = size > 1 ? i / (size - 1) : 0;
    // tFracs ascends, so the nearest row only ever moves forward as i advances. `row` carries
    // forward across iterations of `i` rather than restarting at 0 -- that forward-only cursor is
    // what makes the sweep O(size + count) instead of O(size * count). Resetting it each iteration
    // would still land on the correct row (the distance to `t` is a single valley), so it would
    // not show up as a bug; it would only cost a multiple that grows with the table size.
    while (row + 1 < count && Math.abs(tFracs[row + 1] - t) <= Math.abs(tFracs[row] - t)) {
      row += 1;
    }
    lut[i] = Math.abs(tFracs[row] - t) > maxDistTFrac ? NO_ROW : row;
  }
  return lut;
}

/** Shade quantisation. 16 keeps the LUT at 4096 words -- cheap to rebuild, fine enough to read. */
export const SHADE_LEVELS = 16;

/** How far Colorize lets shading move luminance. Small on purpose: colour must stay readable. */
const COLORIZE_SHADE_FLOOR = 0.75;

/**
 * Pack one ARGB word for a Uint32Array view over ImageData.
 *
 * The byte order assumes a little-endian host, which every platform PLVS targets is. On a
 * big-endian host the channels would come out reversed.
 */
export function packArgb(r, g, b, a) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * The (level x shade) colour table the rasteriser indexes with `level * SHADE_LEVELS + shade`.
 *
 * `level` is the sample's FLOOR-RELATIVE height fraction, quantised to 0..255 -- the same quantity
 * `sampleWaterfallGrid` stores. Colour, however, must be ABSOLUTE against the fixed dB range, so
 * that raising the dB Floor never recolours a peak (Decision #8 of the 2026-07-28 design). The
 * conversion happens here, once per repaint, through `spectrogramColorFracFromHeight` -- the same
 * helper `buildStopColors` uses for Lines, so the two renderers cannot drift apart on colour.
 *
 * Monochrome ignores `level` entirely and ramps on `shade`, between the colormap's two ends. The
 * relief IS the information in that state; height carries level, and colour carries shape.
 *
 * Alpha is always 255, unlike `buildStopColors`, which tracks level in alpha so silence doesn't
 * draw as a dense opaque stack of lines. That reasoning doesn't transfer here: the horizon walk
 * writes each screen pixel exactly once, so a quiet sample is still terrain occupying that pixel,
 * not an extra layer piling on top of others. Level-tracking alpha would let the floor grid bleed
 * through a quiet surface and read as a hole, which is not what a quiet passage is. Pixels the
 * horizon walk never reaches -- outside the floor's screen silhouette -- are left at alpha 0 by
 * the caller-supplied buffer, not by this table.
 *
 * The table is built at full size (256 x SHADE_LEVELS) even in Monochrome, where every level row
 * is identical, rather than a 1 x SHADE_LEVELS ramp reused per level: that keeps the rasteriser's
 * inner loop a single unconditional read, with no branch on `colorize` to skip the level dimension.
 *
 * @param {object} args
 * @param {Uint8Array|number[]} args.colormapLut 256 RGB triplets
 * @param {number} args.dbFloor current dB floor
 * @param {boolean} args.colorize
 * @returns {Uint32Array} length 256 * SHADE_LEVELS
 */
export function buildSurfaceLut({ colormapLut, dbFloor, colorize }) {
  const lut = new Uint32Array(256 * SHADE_LEVELS);
  const lowR = colormapLut[0];
  const lowG = colormapLut[1];
  const lowB = colormapLut[2];
  const highR = colormapLut[255 * 3];
  const highG = colormapLut[255 * 3 + 1];
  const highB = colormapLut[255 * 3 + 2];

  for (let level = 0; level < 256; level++) {
    let r = 0;
    let g = 0;
    let b = 0;
    if (colorize) {
      const t = spectrogramColorFracFromHeight(level / 255, dbFloor);
      const idx = Math.round(t * 255) * 3;
      r = colormapLut[idx];
      g = colormapLut[idx + 1];
      b = colormapLut[idx + 2];
    }
    for (let shade = 0; shade < SHADE_LEVELS; shade++) {
      const s = SHADE_LEVELS > 1 ? shade / (SHADE_LEVELS - 1) : 1;
      let outR;
      let outG;
      let outB;
      if (colorize) {
        const mul = COLORIZE_SHADE_FLOOR + (1 - COLORIZE_SHADE_FLOOR) * s;
        outR = Math.round(r * mul);
        outG = Math.round(g * mul);
        outB = Math.round(b * mul);
      } else {
        outR = Math.round(lowR + (highR - lowR) * s);
        outG = Math.round(lowG + (highG - lowG) * s);
        outB = Math.round(lowB + (highB - lowB) * s);
      }
      lut[level * SHADE_LEVELS + shade] = packArgb(outR, outG, outB, 255);
    }
  }
  return lut;
}
