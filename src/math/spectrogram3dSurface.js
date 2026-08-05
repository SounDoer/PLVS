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
 * Quantised row-bracket lookup over tFrac, so the inner loop costs two array reads instead of a
 * binary search. Rows sit at irregular timestamps, which is why a divide cannot replace this.
 *
 * Each bucket resolves to the LOWER of the two rows bracketing it plus a weight towards the next
 * one, because the rasteriser interpolates between them. Snapping to the nearest row instead is what
 * made the surface render as a 3D bar chart: a grid cell covers several screen pixels, every sample
 * inside it read one identical height, and the cell came out as a flat top plus a vertical wall,
 * with `h - prevH` zero inside the cell and a cliff at its edge, so shading had nothing to work
 * with either.
 *
 * Buckets with no row within `maxDistTFrac` get NO_ROW. That is how a real capture gap becomes a
 * hole in the surface: the rasteriser skips those samples and leaves the horizon where it was, so
 * the terrain behind the gap stays visible through it. Substituting the dB floor instead would draw
 * a gap as a flat plain, which is data that does not exist.
 *
 * Two things are deliberately NOT interpolated:
 *
 * - **Across a gap.** When the bracketing rows are further apart than `maxDistTFrac` they are the
 *   two sides of a capture gap, not a continuous stretch, so the weight snaps to whichever end
 *   covered the bucket. Lerping there would drag the newest terrain down into the hole and the old
 *   terrain up out of it.
 * - **Past the ends.** Before the first row and after the last one there is nothing to interpolate
 *   towards, so the weight holds the end row. Treating that as uncovered would delete the newest
 *   frame -- the live edge the user is watching -- which is a worse artefact than the one this
 *   interpolation exists to remove.
 *
 * @param {Float64Array} tFracs row positions in 0..1, ascending
 * @param {number} count how many entries of `tFracs` are valid. Must stay below `NO_ROW`, or a
 *        real row index would be indistinguishable from the sentinel.
 * @param {number} size table resolution
 * @param {number} maxDistTFrac beyond this distance a bucket counts as uncovered, and further apart
 *        than this two rows count as the two sides of a gap rather than one interval
 * @returns {{ rows: Uint16Array, weights: Float32Array, firstCoveredTFrac: number,
 *          lastCoveredTFrac: number }} `rows[i]` is the lower bracketing row or NO_ROW;
 *          `weights[i]` is 0 at that row and 1 at `rows[i] + 1`. The two tFracs bound the covered
 *          region -- where the terrain actually begins and ends, which is the end row plus however
 *          far `maxDistTFrac` holds it, NOT the window edge. `edgeFade` has to sink the terrain at
 *          those two positions rather than at 0 and 1; see the note on its edge parameters. Both
 *          are NaN when nothing is covered.
 */
export function buildRowLut(tFracs, count, size, maxDistTFrac) {
  const rows = new Uint16Array(size);
  const weights = new Float32Array(size);
  if (count <= 0) {
    rows.fill(NO_ROW);
    return { rows, weights, firstCoveredTFrac: NaN, lastCoveredTFrac: NaN };
  }
  let firstCovered = -1;
  let lastCovered = -1;
  let row = 0;
  for (let i = 0; i < size; i++) {
    const t = size > 1 ? i / (size - 1) : 0;
    // tFracs ascends, so the bracket only ever moves forward as i advances. `row` carries forward
    // across iterations of `i` rather than restarting at 0 -- that forward-only cursor is what makes
    // the sweep O(size + count) instead of O(size * count). Resetting it each iteration would still
    // land on the correct bracket, so it would not show up as a bug; it would only cost a multiple
    // that grows with the table size.
    while (row + 1 < count && tFracs[row + 1] <= t) row += 1;

    // Coverage is decided by the NEAREST row, not by the lower one: a bucket sitting just before a
    // row is covered by it, and the bracket's lower end may be a whole gap away.
    const distLo = Math.abs(tFracs[row] - t);
    const hasNext = row + 1 < count;
    const distHi = hasNext ? Math.abs(tFracs[row + 1] - t) : Infinity;
    if (Math.min(distLo, distHi) > maxDistTFrac) {
      rows[i] = NO_ROW;
      continue;
    }

    rows[i] = row;
    if (firstCovered < 0) firstCovered = i;
    lastCovered = i;
    if (!hasNext) continue;
    const dt = tFracs[row + 1] - tFracs[row];
    if (dt > maxDistTFrac) {
      // The two sides of a gap: hold whichever end covered this bucket.
      weights[i] = distLo <= distHi ? 0 : 1;
    } else if (dt > 0) {
      // Clamped: a bucket sitting just BEFORE the first row (within tolerance, so covered by it)
      // would otherwise get a negative weight and extrapolate the two newest-oldest frames'
      // difference past the window's old end. The cursor guarantees tFracs[row] <= t for row > 0,
      // so row 0 is the only place this can go negative; the 1 end is clamped for symmetry.
      weights[i] = Math.min(1, Math.max(0, (t - tFracs[row]) / dt));
    }
  }
  const toTFrac = (i) => (i < 0 ? NaN : size > 1 ? i / (size - 1) : 0);
  return {
    rows,
    weights,
    firstCoveredTFrac: toTFrac(firstCovered),
    lastCoveredTFrac: toTFrac(lastCovered),
  };
}

/**
 * Two 3-tap `[0.25, 0.5, 0.25]` passes along the frequency axis of every row, in place --
 * equivalent to one binomial 5-tap `[1, 4, 6, 4, 1] / 16`, but endpoints need handling once.
 *
 * The grid samples single FFT bins per point (`sampleWaterfallGrid` via `yToBand`), and raw bin
 * levels jitter by 10+ dB between neighbours. The 2D heatmap reads that as texture; as a
 * heightfield every jittered bin becomes a tower of its own, and the headlight shading -- which
 * keys on the height delta -- turns the same jitter into salt-and-pepper. Bilinear interpolation
 * makes the surface continuous but does not remove the towers: a spike survives interpolation at
 * full height, just with sloped sides. Smoothing along frequency is what actually flattens them,
 * and it matches what the eye already does with the 2D heatmap's per-pixel columns.
 *
 * Two passes rather than one: a single pass only halves an isolated bin spike, and at half height
 * it still reads as a needle on the silhouette. The second pass takes it to 3/8 while leaving
 * structure that spans several points -- tonal content -- essentially intact.
 *
 * Endpoints are kept as sampled: there is no out-of-range neighbour to fold in, and renormalising
 * a two-sample window would shift the edge bins' energy rather than smooth it.
 *
 * Only the Surface branch calls this. Lines strokes the same grid unsmoothed -- its curves carry
 * the same bin jitter, but a stroked polyline reads it as texture the same way the heatmap does.
 *
 * @param {Float32Array} heights `count * pointCount` floor-relative fractions, modified in place
 * @param {number} count
 * @param {number} pointCount
 */
export function smoothGridFrequency(heights, count, pointCount) {
  if (pointCount < 3) return;
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < count; r++) {
      const base = r * pointCount;
      let prev = heights[base];
      for (let q = 1; q < pointCount - 1; q++) {
        const cur = heights[base + q];
        heights[base + q] = (prev + 2 * cur + heights[base + q + 1]) * 0.25;
        prev = cur;
      }
    }
  }
}

/**
 * One 3-tap `[0.25, 0.5, 0.25]` pass along the TIME axis, in place.
 *
 * Frame-to-frame level noise is the same jitter `smoothGridFrequency` flattens per row, but along
 * time it reads differently: in 2D it is texture, in a heightfield it is MOTION -- the terrain
 * visibly breathes as the window flows. Interpolation between rows makes the motion smooth but
 * does not damp it; a light symmetric kernel does, at the cost of half a decimation stride of lag
 * -- tens of ms at short windows, still under one visible row at long ones, so transients keep
 * their shape.
 *
 * The last row cannot have the symmetric kernel -- it has no next row yet -- but leaving it as
 * sampled is worse than it looks. A row is raw only while it is last; the moment the next one
 * arrives it is rewritten with the full kernel, so its shape CHANGES DISCONTINUOUSLY once, one
 * decimation stride in from the entering edge, where the edge fade has just let it up to full
 * height and nothing occludes it. That is a settle-pop at the row rate -- a few Hz, the most
 * visible band there is. So the last row gets the causal half of the kernel instead,
 * `0.75*cur + 0.25*prev`: the later rewrite then moves it by `0.25*(next - cur)` rather than by
 * both neighbours' deltas, halving the jump for the only cost a causal filter can have here,
 * which is that the newest row is no longer bit-exact with its frame. Removing the jump entirely
 * would take knowing the next frame, i.e. a row of latency at the live edge, which monitoring
 * cannot pay.
 *
 * Two exclusions, both deliberate:
 *
 * - **Across a capture gap.** Rows bracketing a gap are not adjacent moments, so blending them
 *   fabricates a transition that never happened. A row touches a gap on either side and it is
 *   left as sampled. The caller derives `maxIntervalTFrac` from the same stride the row LUT's
 *   tolerance uses, so "gap" means the same thing in both places.
 * - **The first row.** There is no previous row to blend it against, and it sits at the exiting
 *   edge where the fade has already taken it under.
 *
 * Blending uses the ORIGINAL neighbour rows, not the already-smoothed ones: a rolling in-place
 * pass would make the kernel effectively wider on one side, so an impulse would bleed further
 * forward than back. One row buffer is kept for that. The last row is written after the loop for
 * the same reason -- interior row `count - 2` must still read it unsmoothed.
 *
 * Only the Surface branch calls this, for the same reason as the frequency pass.
 *
 * @param {Float32Array} heights `count * pointCount` floor-relative fractions, modified in place
 * @param {Float64Array} tFracs row positions in 0..1, ascending
 * @param {number} count
 * @param {number} pointCount
 * @param {number} maxIntervalTFrac rows further apart than this count as the two sides of a gap
 */
export function smoothGridTime(heights, tFracs, count, pointCount, maxIntervalTFrac) {
  if (count < 3 || pointCount < 1) return;
  // Original values of the row above the one being blended, so the kernel reads unsmoothed
  // neighbours. Row r + 1 needs no copy: it has not been written yet at iteration r. Starts as
  // row 0, which is an endpoint and never written.
  let prevOriginal = new Float32Array(pointCount);
  prevOriginal.set(heights.subarray(0, pointCount));
  let curOriginal = new Float32Array(pointCount);
  for (let r = 1; r < count - 1; r++) {
    const base = r * pointCount;
    curOriginal.set(heights.subarray(base, base + pointCount));
    const nearGap =
      tFracs[r] - tFracs[r - 1] > maxIntervalTFrac || tFracs[r + 1] - tFracs[r] > maxIntervalTFrac;
    if (!nearGap) {
      for (let q = 0; q < pointCount; q++) {
        heights[base + q] =
          (prevOriginal[q] + 2 * curOriginal[q] + heights[base + pointCount + q]) * 0.25;
      }
    }
    [prevOriginal, curOriginal] = [curOriginal, prevOriginal];
  }

  // `prevOriginal` now holds row `count - 2` as sampled, which is exactly the neighbour the causal
  // kernel needs.
  const last = count - 1;
  if (tFracs[last] - tFracs[last - 1] > maxIntervalTFrac) return;
  const base = last * pointCount;
  for (let q = 0; q < pointCount; q++) {
    heights[base + q] = prevOriginal[q] * 0.25 + heights[base + q] * 0.75;
  }
}

/**
 * Shade quantisation.
 *
 * 16 was chosen to keep the LUT small, on the assumption that a bigger table would cost something in
 * the inner loop. It does not. The rasteriser reads `lut[level * SHADE_LEVELS + shadeIdx]` and
 * `level` tracks the terrain, so consecutive samples land near each other in the table however wide
 * it is -- the access has spatial locality, and a 64 KB table never behaves like a random probe into
 * 64 KB. Measured on 2560x900 at stride 2, alternating three times to keep drift out of the
 * comparison: 16 levels gave 10.96 / 11.17 / 11.16 ms median, 64 gave 11.21 / 11.00 / 11.05 -- the
 * difference is inside a single run's own spread.
 *
 * What 16 did cost is visible: shading is what carries relief on this surface, and 16 tones across
 * the range prints its own contour bands on terrain gentle enough for the shade to drift slowly.
 * The table is rebuilt only on a theme or control change (0.029 ms at 16, ~0.12 ms at 64), never per
 * repaint, so the whole price is 48 KB of memory.
 */
export const SHADE_LEVELS = 64;

/** How far Colorize lets shading move luminance. Small on purpose: colour must stay readable. */
const COLORIZE_SHADE_FLOOR = 0.75;

/**
 * The two bands Monochrome multiplies together, both as fractions of the ink colour.
 *
 * LEVEL carries the main contrast: absolute level drives luminance from MONO_LEVEL_FLOOR to full
 * ink, so loud and quiet terrain are distinguishable at a glance -- without it everything above
 * the alpha fade rendered as one uniform grey, and the relief had nothing to play against.
 *
 * SHADE then modulates within a narrower band. It only shapes the relief now, so it can afford to
 * be gentle: slope noise at the bottom of a wide band printed as dark speckles against the lit
 * terrain, the most visible artefact of the first monochrome renders.
 */
const MONO_LEVEL_FLOOR = 0.25;
const MONO_SHADE_FLOOR = 0.55;

/**
 * Levels below this fraction of the range fade to transparent. Matches what the 2D heatmap has
 * always done (`paintSpan` writes `t * 255` into alpha) and what Lines does with its gradient:
 * silence recedes instead of occupying the screen.
 *
 * Wide on purpose. The band is what makes terrain near the floor DISSOLVE rather than end, and a
 * narrow one only reads as a fade where the surface approaches the floor slowly. A decaying
 * passage does not: it drops through the range fast, so with a quarter of the range the terrain
 * looks like it falls to the floor and only then blinks out, and the same narrowness makes the
 * sunk end of the entering ramp a hard-edged sliver of full-strength colour ruled along the
 * window boundary. Widening it costs contrast in quiet passages -- everything below the band is
 * translucent, so faint detail sits against the background rather than on it.
 *
 * Settled at 0.15 against real material after being briefly exposed as a control: wider bands
 * washed quiet passages out, and the dissolve reads as a dissolve well before the band gets wide
 * enough to cost that. The control came back out because nothing was left for it to decide.
 */
export const LEVEL_ALPHA_FULL = 0.15;

/**
 * Pack one ARGB word for a Uint32Array view over ImageData.
 *
 * The byte order assumes a little-endian host, which every platform PLVS targets. On a
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
 * Monochrome multiplies two fractions of the theme ink: LEVEL (absolute, through the same
 * `spectrogramColorFracFromHeight` conversion Colorize uses, so the dB Floor cannot re-brighten a
 * peak) ramps luminance from `MONO_LEVEL_FLOOR` to full ink, and SHADE modulates that within
 * `MONO_SHADE_FLOOR`..1. Level carries the main contrast -- without it everything above the alpha
 * fade is one uniform grey and loud and quiet terrain are indistinguishable -- while shade only
 * shapes the relief. The ink is `--foreground`, resolved by the caller. (Earlier versions ramped
 * between the colormap's two ends -- a duotone of whatever the colormap's extremes happened to be
 * -- and then on shade alone against `--muted-foreground`; the first read as a colour choice
 * nobody made, the second washed every contrast out at once.)
 *
 * Alpha tracks level below `LEVEL_ALPHA_FULL` -- silence fades out and the floor grid shows
 * through, which is the recession the 2D heatmap and Lines have always given quiet passages. This
 * reverses an earlier alpha-always-255 decision: the argument then was that a quiet sample is
 * still terrain occupying its pixel, so floor bleed would read as a hole. In practice the opaque
 * version filled the entire floor silhouette with a solid painted slab wherever the signal sat at
 * the dB floor, and that slab read as the floor itself, but in the wrong colour. The bleed is the
 * better lie. Each pixel is still written at most once, so the fade never compounds.
 *
 * The table is built at full size (256 x SHADE_LEVELS) in both modes: that keeps the rasteriser's
 * inner loop a single unconditional read, with no branch on `colorize` to skip dimensions.
 *
 * @param {object} args
 * @param {Uint8Array|number[]} args.colormapLut 256 RGB triplets
 * @param {number} args.dbFloor current dB floor
 * @param {boolean} args.colorize
 * @param {{ r: number, g: number, b: number }} [args.ink] theme ink for Monochrome; unused when
 *        `colorize` is set. Defaults to white.
 * @returns {Uint32Array} length 256 * SHADE_LEVELS
 */
export function buildSurfaceLut({ colormapLut, dbFloor, colorize, ink }) {
  const lut = new Uint32Array(256 * SHADE_LEVELS);
  const alphaTop = LEVEL_ALPHA_FULL * 255;
  const inkR = ink?.r ?? 255;
  const inkG = ink?.g ?? 255;
  const inkB = ink?.b ?? 255;

  for (let level = 0; level < 256; level++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let levelMul = 1;
    if (colorize) {
      const t = spectrogramColorFracFromHeight(level / 255, dbFloor);
      const idx = Math.round(t * 255) * 3;
      r = colormapLut[idx];
      g = colormapLut[idx + 1];
      b = colormapLut[idx + 2];
    } else {
      levelMul =
        MONO_LEVEL_FLOOR +
        (1 - MONO_LEVEL_FLOOR) * spectrogramColorFracFromHeight(level / 255, dbFloor);
    }
    const alpha = level >= alphaTop ? 255 : Math.round((level / alphaTop) * 255);
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
        const mul = levelMul * (MONO_SHADE_FLOOR + (1 - MONO_SHADE_FLOOR) * s);
        outR = Math.round(inkR * mul);
        outG = Math.round(inkG * mul);
        outB = Math.round(inkB * mul);
      }
      lut[level * SHADE_LEVELS + shade] = packArgb(outR, outG, outB, alpha);
    }
  }
  return lut;
}

/** The mid-grey a flat sample sits at; slope moves the shade either side of it. */
const SHADE_MID = 0.5;
/** How hard slope drives shade. See `slopeShade`. */
const SHADE_SLOPE_GAIN = 4;

/**
 * Slope to shade, `0` fully dark and `1` fully lit, `SHADE_MID` where the terrain is level.
 *
 * The mapping matters more than the gain. The obvious `SHADE_MID + slope * gain` clamped to 0..1
 * cannot work here, and the reason is a units mismatch that no choice of gain fixes: `slope` is per
 * unit of FLOOR DISTANCE while consecutive samples are about one screen row apart, so on real
 * material its magnitude runs roughly 0.5 to 8 (median near 3). Measured against a realistic grid,
 * a gain of 6 clamps 97.9% of samples and even a gain of 2 clamps 94.8% -- the surface shades in
 * two tones, and changing the gain repaints about 1% of the surface. This was briefly a user
 * control, which is how that got noticed: the control did nothing at any setting.
 *
 * The soft saturation `s / (1 + |s|)` maps the whole real line into (-1, 1) with no hard edge, so
 * the gain sets how quickly shading approaches the ends rather than how much of the surface is
 * pinned to them, and the tone quantisation has gradations to work with. Costs one divide per
 * sample; the benchmark could not tell it from the clamp.
 *
 * @param {number} slope terrain gradient along the view ray, per unit of floor distance
 * @returns {number} strictly inside 0..1, so callers need no clamp
 */
export function slopeShade(slope) {
  const s = slope * SHADE_SLOPE_GAIN;
  return SHADE_MID + SHADE_MID * (s / (1 + (s < 0 ? -s : s)));
}
/** How far the far end is darkened. Mild: it carries recession, it should not hide data. */
const DEPTH_FADE_FLOOR = 0.65;

/**
 * Height multiplier for the two window edges, where the terrain sinks into the floor.
 *
 * Both ends of the time window have the same pop mechanism without it: the region past the last
 * row renders the end row's data held constant (the row LUT clamps the weight there), so when a
 * frame enters its bucket at the newest end, or leaves the window at the oldest, the held region
 * is replaced with different data in a single update -- a full-height cross-section blinking in or
 * out. Scaling heights down to 0 towards the edge turns the end face from a wall into a ramp: new
 * cross-sections grow out of the floor instead of popping, and old terrain submerges instead of
 * vanishing. The level-driven alpha fade picks up below 25% height, so the sink doubles as a
 * dissolve for free.
 *
 * Heights are faded, not alpha: a solid gone translucent reads as glass, while a sunk solid keeps
 * its occlusion semantics. Applied before the slope term, so the ramp itself is shaded like any
 * other terrain.
 *
 * The ramp is eased rather than linear. A linear ramp is C1-discontinuous at BOTH of its ends, and
 * both kinks are visible in a heightfield: at the interior end the terrain stops rising in a crease
 * that runs across the whole frequency axis, and at the floor end it meets the plane at a fixed
 * angle, so a loud passage arrives as a wedge driven up out of the floor rather than as something
 * surfacing. `smoothstep` flattens both, and since the rasteriser's shading keys on the height
 * delta, removing the kinks removes two bands of false relief with them.
 *
 * The widths still differ by end, mirroring the line waterfall's asymmetry (its newest ridge is
 * deliberately NOT faded), but the entering edge is no longer as narrow as it can be. One stride
 * made the ramp steeper than the exiting edge's by a factor of 2.5, which is what made arrival read
 * as a pop and departure read as a dissolve even though both are the same mechanism. Two strides
 * costs a few percent of the window and buys the entering end an approach the eye can follow; the
 * exiting edge keeps the 2.5 strides Lines fades its ridges over.
 *
 * The two ramps land on `exitEdge` and `enterEdge`, which are where the TERRAIN ends, not where the
 * window does. Those are not the same position and defaulting them to 0 and 1 was a bug. Rows sit at
 * captured timestamps and the newest one lands short of the window's newest edge -- the edge comes
 * from the 10 Hz loudness timeline while frames arrive at 25 Hz, so the last row trails it by up to
 * a frame period, and the terrain stops there plus however far the row LUT holds it. Sink at 1 and
 * the ramp is still partway down when the data runs out, which renders as the end face standing
 * up off the floor: measured at a 5 s window with the newest frame 40 ms behind the edge, the face
 * stood at 22% of full height, and at 120 ms behind it stood at 97%. It reads as the surface having
 * been sliced off. The same applies at the oldest end, and at capture start, where the first row can
 * be most of a window away from tFrac 0.
 *
 * @param {number} tFrac sample position in the window, 0 = oldest (exiting) end, 1 = newest
 * @param {number} enterWidth fade width at the `enterEdge` end, in tFrac; 0 disables
 * @param {number} exitWidth fade width at the `exitEdge` end, in tFrac; 0 disables
 * @param {number} [exitEdge] where the terrain's oldest end sits; the exit ramp reaches 0 here
 * @param {number} [enterEdge] where the terrain's newest end sits; the enter ramp reaches 0 here
 * @returns {number} 0..1, exactly 1 everywhere when both widths are 0
 */
export function edgeFade(tFrac, enterWidth, exitWidth, exitEdge = 0, enterEdge = 1) {
  let fade = 1;
  if (exitWidth > 0) fade = Math.min(fade, (tFrac - exitEdge) / exitWidth);
  if (enterWidth > 0) fade = Math.min(fade, (enterEdge - tFrac) / enterWidth);
  // Easing after the min is the same as easing each ramp before it -- smoothstep is monotonic --
  // and it keeps the disabled case an exact identity, since smoothstep(1) is exactly 1.
  const t = fade < 0 ? 0 : fade > 1 ? 1 : fade;
  return t * t * (3 - 2 * t);
}

/**
 * Rasterise the whole surface into `out`, one screen column at a time.
 *
 * Each column is walked FRONT TO BACK with a running minimum (`horizon`) of the topmost pixel
 * already written. A sample is visible only where it rises above that, and it fills from there down
 * to whichever comes first, `horizon` or the floor directly beneath it -- the vertical wall that
 * makes the result read as solid rather than as a stack of contours. Occluded pixels are never
 * written, so there is no overdraw at all.
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
 *        from `sampleWaterfallGrid`, smoothed by `smoothGridFrequency`. `heights` are
 *        floor-relative fractions in 0..1. `count` should stay at or below the `steps` a column
 *        yields -- roughly the canvas height. Cost does not scale with row count, but a column
 *        samples the time axis at only `steps + 1` positions, so rows past that add grid-build
 *        cost without adding a single resolvable sample. (Nearest-row sampling would additionally
 *        ALIAS there; interpolation between rows is what keeps a sub-row window slide smooth.)
 * @param {Uint16Array} args.rowLut from `buildRowLut`
 * @param {Uint32Array} args.lut from `buildSurfaceLut`
 * @param {number} args.heightGain the Height Scale multiplier
 * @param {number} args.highlightArgb colour for the scrubbed row
 * @param {number} args.highlightRow grid row to highlight, or -1
 * @param {number} args.columnStride rasterise every Nth column and replicate
 * @param {number} args.maxSteps per-column sample cap
 * @param {number} [args.enterFadeTFrac] height fade width at the newest window edge; see edgeFade
 * @param {number} [args.exitFadeTFrac] height fade width at the oldest window edge; see edgeFade
 * @param {number} [args.enterEdgeTFrac] where the terrain's newest end sits; `rowLut`'s
 *        `lastCoveredTFrac`. Defaults to the window edge, which is only correct when a row happens
 *        to land on it -- see edgeFade.
 * @param {number} [args.exitEdgeTFrac] where the terrain's oldest end sits; `rowLut`'s
 *        `firstCoveredTFrac`
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
  enterFadeTFrac = 0,
  exitFadeTFrac = 0,
  enterEdgeTFrac = 1,
  exitEdgeTFrac = 0,
}) {
  const { heights, count, pointCount } = grid;
  if (count <= 0 || pointCount <= 0) return;

  const lastPoint = pointCount - 1;
  const { rows: rowIdx, weights: rowWeight } = rowLut;
  const lutLast = rowIdx.length - 1;
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
    // Floor distance one step covers, in unit-square coordinates. Constant along a column, so the
    // per-unit-distance gradient below costs a multiply rather than a divide per sample.
    const invStepDist = 1 / Math.hypot(span.du, span.dv);
    let u = span.u0;
    let v = span.v0;
    let prevH = NaN;
    // Set whenever the walk has no painted terrain immediately in front of it: at the column's
    // near end, and again after every uncovered stretch. See the wall bound below.
    let resumed = true;

    for (let s = 0; s <= steps; s++, u += span.du, v += span.dv) {
      // `columnFloorSpan` clips to the floor square, so `u` is in -0.5..0.5 and the bucket lands
      // inside the table. Same convention as `unprojectFloor`: no degenerate guard is needed.
      const bucket = Math.round((u + 0.5) * lutLast);
      const row = rowIdx[bucket];
      if (row === NO_ROW) {
        // A capture gap: contribute nothing and leave the horizon alone, so what is behind the gap
        // stays visible through it.
        prevH = NaN;
        resumed = true;
        continue;
      }

      // Bilinear over the four grid samples bracketing this point. `v` is inside the square for the
      // same reason `u` is, so the frequency index needs no clamp beyond the end of the axis, where
      // there is no next point to interpolate towards.
      const qf = (v + 0.5) * lastPoint;
      const q0 = qf | 0;
      const q1 = q0 < lastPoint ? q0 + 1 : q0;
      const wq = qf - q0;
      const wRow = rowWeight[bucket];
      const base0 = row * pointCount;
      const base1 = (row + 1 < count ? row + 1 : row) * pointCount;
      const hLo = heights[base0 + q0] + (heights[base0 + q1] - heights[base0 + q0]) * wq;
      const hHi = heights[base1 + q0] + (heights[base1 + q1] - heights[base1 + q0]) * wq;
      // The edge fade shapes the terrain itself (see edgeFade), so it applies BEFORE the slope:
      // the ramp at the window edge is shaded like any other slope, not painted grey.
      const h =
        (hLo + (hHi - hLo) * wRow) *
        edgeFade(u + 0.5, enterFadeTFrac, exitFadeTFrac, exitEdgeTFrac, enterEdgeTFrac);

      // Terrain gradient along the view ray, measured before the visibility test: an occluded stretch
      // still shapes the terrain, so skipping it here would corrupt the shading of whatever follows.
      // Per unit of FLOOR DISTANCE, not per sample: samples per unit distance depend on the canvas
      // size, so a raw per-sample delta would shade the same audio differently on a resized panel.
      const hPrev = prevH;
      const slope = Number.isFinite(hPrev) ? (h - hPrev) * invStepDist : 0;
      prevH = h;

      const yFloor = originY + u * ty + v * fy;
      const y = Math.round(yFloor + h * hyGain);
      if (y >= horizon) continue;
      // Clamping to the top of the canvas can push a visible sample back onto the horizon, so the
      // test is repeated after the clamp. It also subsumes the `y === horizon` boundary above, which
      // is why that comparison's exact strictness has no observable effect either way.
      const top = y < 0 ? 0 : y;
      if (top >= horizon) continue;

      let argb;
      let shadeIdx = 0;
      // The scrubbed row is one captured frame, so the highlight stays a discrete band: it follows
      // whichever bracketing row this sample sits nearer to, even though the height between them is
      // interpolated.
      const highlighted = (wRow < 0.5 ? row : row + 1) === highlightRow;
      if (highlighted) {
        argb = highlightArgb;
      } else {
        // Headlight shading: the ray always lies along the view direction, so this stays stable
        // while the user rotates, where a world-fixed light would darken whole faces.
        let shade = slopeShade(slope);
        // Depth attenuation. s runs 0 at the near end to steps at the far end, and `steps` is at
        // least 1 by construction.
        const near = 1 - s / steps;
        shade *= DEPTH_FADE_FLOOR + (1 - DEPTH_FADE_FLOOR) * near;
        // `shade` is clamped to 0..1 above and the depth factor only ever lowers it, and heights are
        // 0..1 per this function's contract, so both indices are already inside their tables.
        shadeIdx = (shade * (SHADE_LEVELS - 1) + 0.5) | 0;
        const level = (h * 255 + 0.5) | 0;
        argb = lut[level * SHADE_LEVELS + shadeIdx];
      }

      // Normally the wall runs down to `horizon`, and everything below `horizon` is already
      // painted. The first sample after an UNCOVERED stretch is the exception: `horizon` is
      // deliberately left alone across a capture gap (and across the empty part of a not-yet-full
      // window), so filling down to it extrudes that cross-section forward over floor the data
      // does not reach -- at capture start, all the way to the floor's near edge. Because the
      // extrusion's bottom then follows the floor's near boundary rather than the terrain's own
      // end, it reads as the surface spilling out from under the floor.
      //
      // What actually bounds a sample is the floor DIRECTLY BENEATH IT: the solid is the terrain
      // extruded onto the floor plane, and in this projection the point below `(u, v, h)` is
      // `(u, v, 0)`, i.e. `yFloor`. Only the resuming sample needs it -- for continuous terrain
      // consecutive samples are at most one screen row apart, so `horizon` is already at or above
      // the next sample's own floor and the clamp could never bind. Testing `resumed` rather than
      // clamping unconditionally keeps a rounding out of the per-sample path, and keeps the
      // "below the horizon is painted" invariant everywhere the walk has not crossed a hole.
      let bottom = horizon;
      if (resumed) {
        // Truncation rather than Math.round: this is a hot path, and the two differ only for a
        // negative `yFloor`, where the floor point is off the top of the canvas and both give a
        // bound that paints nothing.
        const ownFloor = ((yFloor + 0.5) | 0) + 1;
        if (ownFloor < bottom) bottom = ownFloor;
        resumed = false;
      }
      // Walk the row base by `width` instead of multiplying per row. The stride-1 case is the
      // default and gets its own loop, so the common path carries no inner loop at all.
      let base = top * width + x;
      // The span is not a slab of one height. It is the surface between the previous sample and
      // this one, seen edge-on: height `hPrev` where it meets the horizon at the bottom, `h` at
      // this sample's own row on top. Painting it in `argb` alone -- this sample's colour -- is
      // flat shading, and on real material that is the dominant artefact the mode has. Measured by
      // counting vertical runs of one identical word in the output at 1920x600: 40% of painted
      // pixels sat in runs taller than 4 px. Those runs are the terrain's steep faces -- spectral
      // cliffs and transient onsets -- each printed as one uniform block, which is what reads as
      // the surface being built out of steps.
      //
      // Ramping `level` down the span is not an effect added on top; it is the height that was
      // already computed and then thrown away. Alpha rides `level` through the same LUT, so a face
      // running down towards the floor now dissolves over its own length instead of ending in a
      // hard edge.
      //
      // Interpolate against the sample rows `y` and `horizon`, not against the clamped `top` and
      // `bottom`: `top` is `y` clipped to the canvas, and anchoring the ramp to the clip would tilt
      // it whenever a peak leaves the top of the frame.
      //
      // Three spans keep the flat path. A highlight is a marker rather than terrain. A resuming
      // sample has no previous height to ramp from (`hPrev` is NaN across a gap), and its span is
      // the solid's cut end face, not a surface segment. And a span of a couple of pixels cannot
      // show a ramp, so it would only pay for one.
      const gouraud = !highlighted && bottom - top > 2 && hPrev === hPrev;
      if (!gouraud) {
        if (kEnd === 1) {
          for (let yy = top; yy < bottom; yy++, base += width) out[base] = argb;
        } else {
          for (let yy = top; yy < bottom; yy++, base += width) {
            for (let k = 0; k < kEnd; k++) out[base + k] = argb;
          }
        }
      } else {
        // `horizon > y` holds here (the visibility test above returned otherwise), so the divide is
        // safe and `level` stays between the two samples' own heights -- both inside 0..1 per this
        // function's contract, so the LUT index needs no clamp.
        const levelPerY = ((hPrev - h) * 255) / (horizon - y);
        let level = h * 255 + (top - y) * levelPerY + 0.5;
        if (kEnd === 1) {
          for (let yy = top; yy < bottom; yy++, base += width, level += levelPerY) {
            out[base] = lut[(level | 0) * SHADE_LEVELS + shadeIdx];
          }
        } else {
          for (let yy = top; yy < bottom; yy++, base += width, level += levelPerY) {
            const word = lut[(level | 0) * SHADE_LEVELS + shadeIdx];
            for (let k = 0; k < kEnd; k++) out[base + k] = word;
          }
        }
      }
      horizon = top;
      // The horizon has reached the top of the canvas: every remaining sample in this column is
      // above it and therefore invisible. Reachable at a high Height Scale, where peaks clip.
      if (horizon === 0) break;
    }
  }
}

/** Never coarsen past this. Beyond the measured range we accept frame time over resolution: past
 * some point losing horizontal detail costs more than an occasional missed repaint, and the
 * repaint-skip guard already holds repaints near 25 Hz rather than 60, so a slow frame is not a
 * dropped one. */
const STRIDE_MAX = 4;

/**
 * Device pixels of canvas area one column-stride step buys. Cost tracks `width * height`, not
 * `width` alone -- see `columnStrideFor`'s doc for the model and the measurements that pinned this
 * number.
 */
const STRIDE_AREA_BUDGET = 1_200_000;

/**
 * Column stride for a canvas of this size: rasterise every Nth column and replicate. Same shape as
 * `ridgeCountFor` / `pointCountFor` in `useSpectrogram3dCanvas.js` -- a performance parameter
 * derived from canvas size with min/max caps -- rather than a fixed constant, because a single
 * constant cannot fit: the interactive budget is 16.7 ms and the rasteriser's actual cost spans
 * two orders of magnitude across the panel sizes PLVS ships (a 3840x1200 canvas is not a stress
 * test -- Focus View puts a 1920x600 CSS panel at exactly that many device pixels on a 2x display).
 * One stride tuned for the small end is 35+ ms at the large end; one tuned for the large end
 * quarters horizontal resolution on the small end for no reason.
 *
 * The rasteriser's cost is columns/stride times steps-per-column, and `steps` is bounded by canvas
 * height (`columnFloorSpan` caps it there), so cost scales with `width * height / stride` -- plain
 * device-pixel area divided by stride. That is the whole model: divide area by a per-stride-step
 * budget and round up, floor 1, ceiling `STRIDE_MAX`.
 *
 * Measured with scripts/spectrogram-surface-benchmark.mjs on 2026-07-30, medians (and best-of-60)
 * of 60 repaints, `buildRowLut` + `smoothGridFrequency` + `smoothGridTime` + `out.fill(0)` +
 * `rasterizeSurface` timed together per the timing boundary documented in that script --
 * `buildSurfaceLut` is amortised (rebuilt only on a theme or control change, not per repaint:
 * measured separately at 0.029 ms median) and excluded here. Node is not WebView2 and nothing
 * else is competing for the main thread there, so treat these as a lower bound; a canvas passing
 * at 90% of budget in Node is not a canvas with margin in WebView2.
 *
 *   922x110    (0.10 M px) stride 1: 1.02 ms (best 0.94)  -- picked: stride 1
 *   1920x600   (1.15 M px) stride 1: 8.96 ms (best 8.35)  -- picked: stride 1
 *   2560x900   (2.30 M px) stride 1: 16.31 ms (best 15.43) -- close to budget on median
 *                          stride 2: 9.51 ms (best 8.86)  -- picked: stride 2
 *   3440x1440  (4.95 M px) stride 3: 14.92 ms (best 13.95)
 *                          stride 4: 12.14 ms (best 11.05) -- picked: stride 4 (capped at STRIDE_MAX)
 *   3840x1200  (4.61 M px) stride 3: 14.37 ms (best 13.42)
 *                          stride 4: 11.79 ms (best 10.98) -- picked: stride 4
 *
 * Re-measured 2026-08-03 after the row cap moved to `SURFACE_RIDGE_MAX` and the spans started being
 * shaded rather than flat-filled: 1920x600 stride 1 at 9.65 ms, 2560x900 stride 2 at 10.60,
 * 3840x1200 stride 4 at 13.91. Every picked stride is the same one the area model already gave, and
 * the table below is kept as the measurement that fitted the budget rather than being rewritten.
 *
 * 2560x900 at stride 1 flips between just-under and just-over budget on median across runs on this
 * machine (as high as 18.71 ms in an earlier run of this same script) -- exactly the "right at the
 * budget line" case that makes a single-run median untrustworthy, which is why the picked stride
 * comes from the area model, not from re-reading this table after every run.
 *
 * 922x110 and 2560x900 are the two panel sizes Lines was measured at; 1920x600 and 3440x1440 are
 * added in between so the budget below is not fitted to only two data points; 3840x1200 is Focus
 * View at 2x. 1,200,000 device pixels per stride step is the budget that lands on the stride each
 * row above needed: small enough that 2560x900 needs stride 2 rather than trusting an
 * occasionally-under-budget median at stride 1, large enough that 1920x600 stays at stride 1 rather
 * than being pushed to stride 2 for no reason. `STRIDE_MAX` caps the two largest canvases at stride 4 even
 * though the raw formula would ask for 5 at 3440x1440 -- past the sizes actually measured here we
 * are extrapolating, and the doc comment on `STRIDE_MAX` explains why frame time loses that
 * trade-off beyond this range.
 *
 * @param {number} width canvas width, device pixels
 * @param {number} height canvas height, device pixels
 * @returns {number} stride, at least 1 and at most STRIDE_MAX
 */
export function columnStrideFor(width, height) {
  const area = Math.max(0, width) * Math.max(0, height);
  return Math.max(1, Math.min(STRIDE_MAX, Math.ceil(area / STRIDE_AREA_BUDGET)));
}
