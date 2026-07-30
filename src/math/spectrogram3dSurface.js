/**
 * Geometry and colour for the 3D spectrogram Surface mode: clipping a screen column against the
 * floor plane, mapping a column sample to the grid row it should read, building the (level x shade)
 * colour table, and walking the columns to rasterise the surface.
 *
 * Pure: no canvas, no React, no data access. `rasterizeSurface` writes ARGB words into a buffer the
 * caller supplies -- in the app, a `Uint32Array` view over an offscreen canvas's `ImageData` -- and
 * the other three exports are the tables and geometry it consumes.
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

/** Slope-to-shade sensitivity, and the mid-grey a flat sample sits at. Tuned by eye. */
const SHADE_MID = 0.5;
const SHADE_SLOPE_GAIN = 6;
/** How far the far end is darkened. Mild: it carries recession, it should not hide data. */
const DEPTH_FADE_FLOOR = 0.65;

/**
 * Rasterise the whole surface into `out`, one screen column at a time.
 *
 * Each column is walked FRONT TO BACK with a running minimum (`horizon`) of the topmost pixel
 * already written. A sample is visible only where it rises above that, and the span between the two
 * is the vertical wall that makes the result read as solid rather than as a stack of contours.
 * Occluded pixels are never written, so there is no overdraw at all.
 *
 * Walking back to front instead would let the farthest sample fill the entire lower column, after
 * which every nearer sample fails the same `y < horizon` test and nothing else is ever drawn.
 *
 * `out` must be zero-filled by the caller. Pixels this leaves at 0 are transparent, which is what
 * lets the panel background and the floor grid show through.
 *
 * @param {object} args
 * @param {Uint32Array} args.out ARGB words, `width * height`, zero-filled
 * @param {number} args.width
 * @param {number} args.height
 * @param {object} args.proj from `buildProjection`
 * @param {{ heights: Float32Array, tFracs: Float64Array, count: number, pointCount: number }} args.grid
 *        from `sampleWaterfallGrid`. `heights` are floor-relative fractions in 0..1. `count` should
 *        stay at or below the `steps` a column yields -- roughly the canvas height -- because a
 *        column point-samples the time axis at `steps + 1` positions: with more rows than that,
 *        nearest-row sampling aliases and a large share of the sampled rows re-bind on a sub-row
 *        window slide, which is the shimmer `spectrogram3dGrid.js` exists to prevent. Cost does not
 *        scale with row count, but stability does.
 * @param {Uint16Array} args.rowLut from `buildRowLut`
 * @param {Uint32Array} args.lut from `buildSurfaceLut`
 * @param {number} args.heightGain the Height Scale multiplier
 * @param {number} args.highlightArgb colour for the scrubbed row
 * @param {number} args.highlightRow grid row to highlight, or -1
 * @param {number} args.columnStride rasterise every Nth column and replicate
 * @param {number} args.maxSteps per-column sample cap
 */
export function rasterizeSurface({
  out,
  width,
  height,
  proj,
  grid,
  rowLut,
  lut,
  heightGain,
  highlightArgb,
  highlightRow = -1,
  columnStride = 1,
  maxSteps,
}) {
  const { heights, count, pointCount } = grid;
  if (count <= 0 || pointCount <= 0) return;

  const lastPoint = pointCount - 1;
  const lutLast = rowLut.length - 1;
  const stride = Math.max(1, Math.floor(columnStride));
  const stepCap = Math.max(1, Math.floor(maxSteps ?? height));
  // The projection terms the walk uses, read once. Individually this is noise; together with the
  // fill loop below it keeps enough of the body in registers to matter at full-panel sizes.
  const { originY, ty, fy } = proj;
  const hyGain = heightGain * proj.hy;

  for (let x = 0; x < width; x += stride) {
    const span = columnFloorSpan(x, proj, stepCap);
    if (!span) continue;

    // Seed the horizon at the floor's NEAR edge for this column, not at the canvas bottom. With
    // `height` the nearest sample's wall would extend past the front edge of the floor and paint
    // the empty area below the scene.
    const nearFloorY = originY + span.u0 * ty + span.v0 * fy;
    let horizon = Math.min(height, Math.round(nearFloorY) + 1);
    if (horizon <= 0) continue;

    // How many columns this one is replicated across: invariant per column, not per sample.
    const kEnd = Math.min(stride, width - x);
    const steps = span.steps;
    let u = span.u0;
    let v = span.v0;
    let prevH = NaN;

    for (let s = 0; s <= steps; s++, u += span.du, v += span.dv) {
      // `columnFloorSpan` clips to the floor square, so `u` is in -0.5..0.5 and the bucket lands
      // inside the table. Same convention as `unprojectFloor`: no degenerate guard is needed.
      const row = rowLut[Math.round((u + 0.5) * lutLast)];
      if (row === NO_ROW) {
        // A capture gap: contribute nothing and leave the horizon alone, so what is behind the gap
        // stays visible through it.
        prevH = NaN;
        continue;
      }

      // `v` is inside the square for the same reason, so `q` lands in 0..lastPoint unaided.
      const h = heights[row * pointCount + Math.round((v + 0.5) * lastPoint)];

      // Slope along the view ray, measured before the visibility test: an occluded stretch still
      // shapes the terrain, so skipping it here would corrupt the shading of whatever follows.
      const slope = Number.isFinite(prevH) ? h - prevH : 0;
      prevH = h;

      const y = Math.round(originY + u * ty + v * fy + h * hyGain);
      if (y >= horizon) continue;
      // Clamping to the top of the canvas can push a visible sample back onto the horizon, so the
      // test is repeated after the clamp. It also subsumes the `y === horizon` boundary above, which
      // is why that comparison's exact strictness has no observable effect either way.
      const top = y < 0 ? 0 : y;
      if (top >= horizon) continue;

      let argb;
      if (row === highlightRow) {
        argb = highlightArgb;
      } else {
        // Headlight shading: the ray always lies along the view direction, so this stays stable
        // while the user rotates, where a world-fixed light would darken whole faces.
        let shade = SHADE_MID + slope * SHADE_SLOPE_GAIN;
        shade = shade < 0 ? 0 : shade > 1 ? 1 : shade;
        // Depth attenuation. s runs 0 at the near end to steps at the far end, and `steps` is at
        // least 1 by construction.
        const near = 1 - s / steps;
        shade *= DEPTH_FADE_FLOOR + (1 - DEPTH_FADE_FLOOR) * near;
        // `shade` is clamped to 0..1 above and the depth factor only ever lowers it, and heights are
        // 0..1 per this function's contract, so both indices are already inside their tables.
        const shadeIdx = (shade * (SHADE_LEVELS - 1) + 0.5) | 0;
        const level = (h * 255 + 0.5) | 0;
        argb = lut[level * SHADE_LEVELS + shadeIdx];
      }

      // Walk the row base by `width` instead of multiplying per row. The stride-1 case is the
      // default and gets its own loop, so the common path carries no inner loop at all.
      let base = top * width + x;
      if (kEnd === 1) {
        for (let yy = top; yy < horizon; yy++, base += width) out[base] = argb;
      } else {
        for (let yy = top; yy < horizon; yy++, base += width) {
          for (let k = 0; k < kEnd; k++) out[base + k] = argb;
        }
      }
      horizon = top;
      // The horizon has reached the top of the canvas: every remaining sample in this column is
      // above it and therefore invisible. Reachable at a high Height Scale, where peaks clip.
      if (horizon === 0) break;
    }
  }
}

/**
 * Default column stride: rasterise every Nth column and replicate.
 *
 * Measured with scripts/spectrogram-surface-benchmark.mjs on 2026-07-30, medians (and best-of-60)
 * of 60 repaints, `buildRowLut` + `out.fill(0)` + `rasterizeSurface` timed together per the timing
 * boundary documented in that script -- `buildSurfaceLut` is amortised (rebuilt only on a theme or
 * control change, not per repaint) and is measured separately:
 *
 *   922x110    stride 1: 1.09 ms (0.82)   stride 2: 0.46 ms (0.42)
 *              stride 3: 0.29 ms (0.28)   stride 4: 0.21 ms (0.20)
 *   2560x900   stride 1: 18.71 ms (16.58) OVER on median
 *              stride 2: 10.89 ms (9.49)  stride 3: 7.98 ms (6.61)   stride 4: 6.64 ms (5.31)
 *   3840x1200  stride 1: 38.40 ms (35.88) OVER   stride 2: 22.31 ms (20.48) OVER
 *              stride 3: 16.12 ms (14.53) -- only ~0.6 ms under the 16.7 ms budget on median
 *              stride 4: 14.33 ms (11.93)
 *   buildSurfaceLut (amortised, not counted above): 0.03 ms median.
 *
 * Node is not WebView2 and nothing else is competing for the main thread there, so these are a
 * lower bound. Stride 1 already clears budget at 922x110 but not at the larger sizes: 2560x900's
 * median sits over budget at stride 1 and only becomes comfortable (roughly 65% of budget) at
 * stride 2, while 3840x1200 needs stride 3 just to land under budget at all and stays within ~4%
 * of the line there across repeated runs -- too close to call comfortable given this harness is a
 * lower bound. Stride 4 is the smallest stride that puts every measured canvas, including
 * 3840x1200, at a comfortable margin (roughly 70-85% of budget or better), so it is the shipped
 * default. A size-dependent stride (stride 2 for the common 2560x900 case, coarser only for larger
 * canvases) is possible but out of scope here -- the design calls for one constant.
 */
export const DEFAULT_COLUMN_STRIDE = 4;
