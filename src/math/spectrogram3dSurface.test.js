import { describe, expect, it } from "vitest";
import { SPECTROGRAM_DB_MAX, SPECTROGRAM_DB_MIN } from "../config/scales.js";
import { spectrogramColorFracFromHeight } from "../theme/spectrogramColormap.js";
import { buildProjection, projectPoint } from "./spectrogram3dProjection.js";
import {
  buildRowLut,
  buildSurfaceLut,
  columnFloorSpan,
  columnStrideFor,
  edgeFade,
  LEVEL_ALPHA_FULL,
  NO_ROW,
  packArgb,
  rasterizeSurface,
  SHADE_LEVELS,
  smoothGridFrequency,
  smoothGridTime,
} from "./spectrogram3dSurface.js";

const W = 920;
const H = 300;

function proj(azimuthDeg = 135, elevationDeg = 60) {
  return buildProjection({ azimuthDeg, elevationDeg, width: W, height: H });
}

describe("columnFloorSpan", () => {
  it("returns endpoints that project back to the requested column", () => {
    const p = proj();
    const span = columnFloorSpan(W / 2, p, H);
    expect(span).not.toBeNull();

    const near = projectPoint(span.u0 + 0.5, span.v0 + 0.5, 0, p);
    const farU = span.u0 + span.du * span.steps;
    const farV = span.v0 + span.dv * span.steps;
    const far = projectPoint(farU + 0.5, farV + 0.5, 0, p);

    expect(near.x).toBeCloseTo(W / 2, 6);
    expect(far.x).toBeCloseTo(W / 2, 6);
  });

  it("starts at the near end, so screen y decreases along the walk", () => {
    const p = proj();
    const span = columnFloorSpan(W / 2, p, H);
    const near = projectPoint(span.u0 + 0.5, span.v0 + 0.5, 0, p);
    const far = projectPoint(
      span.u0 + span.du * span.steps + 0.5,
      span.v0 + span.dv * span.steps + 0.5,
      0,
      p
    );
    // Larger screen y is nearer the viewer.
    expect(near.y).toBeGreaterThan(far.y);
  });

  // At azimuth 135 the projected bounding box is symmetric, so x = W/2 makes `offset` exactly zero
  // and the reprojection test above never exercises baseU/baseV at all -- swapping their numerators
  // (mapping u <-> v) would still pass it. Off-centre columns, swept across views, close that gap:
  // they also check that the span actually reaches the floor boundary rather than being clipped to
  // some smaller square, and that the sweep is non-vacuous (at least one span is non-null).
  it("reprojects off-centre columns to the requested x and reaches the floor boundary", () => {
    let nonNullCount = 0;
    for (let az = 0; az < 360; az += 10) {
      for (const el of [5, 20, 45, 60, 85]) {
        const p = proj(az, el);
        for (const x of [W * 0.2, W * 0.35, W * 0.5, W * 0.65, W * 0.8]) {
          const span = columnFloorSpan(x, p, H);
          if (!span) continue;
          nonNullCount += 1;

          const near = projectPoint(span.u0 + 0.5, span.v0 + 0.5, 0, p);
          const far = projectPoint(
            span.u0 + span.du * span.steps + 0.5,
            span.v0 + span.dv * span.steps + 0.5,
            0,
            p
          );
          expect({ az, el, x, nearX: near.x }).toEqual({ az, el, x, nearX: expect.closeTo(x, 6) });
          expect({ az, el, x, farX: far.x }).toEqual({ az, el, x, farX: expect.closeTo(x, 6) });

          const us = [span.u0, span.u0 + span.du * span.steps];
          const vs = [span.v0, span.v0 + span.dv * span.steps];
          const touchesBoundary = [...us, ...vs].some(
            (value) => Math.abs(Math.abs(value) - 0.5) < 1e-6
          );
          expect({ az, el, x, touchesBoundary }).toEqual({ az, el, x, touchesBoundary: true });
        }
      }
    }
    expect(nonNullCount).toBeGreaterThan(0);
  });

  it("keeps both endpoints inside the floor square at every view", () => {
    for (let az = 0; az < 360; az += 10) {
      for (const el of [5, 20, 45, 60, 85]) {
        const p = proj(az, el);
        for (const x of [W * 0.2, W * 0.35, W * 0.5, W * 0.65, W * 0.8]) {
          const span = columnFloorSpan(x, p, H);
          if (!span) continue;
          const us = [span.u0, span.u0 + span.du * span.steps];
          const vs = [span.v0, span.v0 + span.dv * span.steps];
          for (const u of us) expect(Math.abs(u)).toBeLessThanOrEqual(0.5 + 1e-9);
          for (const v of vs) expect(Math.abs(v)).toBeLessThanOrEqual(0.5 + 1e-9);
          expect(span.steps).toBeGreaterThan(0);
        }
      }
    }
  });

  it("returns null for a column outside the floor silhouette", () => {
    const p = proj();
    // buildProjection fits with FIT_MARGIN 0.92, so the outermost columns are empty margin.
    expect(columnFloorSpan(0, p, H)).toBeNull();
    expect(columnFloorSpan(W - 1, p, H)).toBeNull();
  });

  it("caps the step count at maxSteps", () => {
    const p = proj();
    const span = columnFloorSpan(W / 2, p, 4);
    expect(span.steps).toBeLessThanOrEqual(4);
  });

  // `steps` is one sample per screen pixel row, and nothing above pins it: `steps > 0` and
  // `steps <= maxSteps` are satisfied just as well by one step too many or one too few, and a
  // one-sample error shows up in the rasteriser as a seam at the silhouette. Derive the screen-y
  // extent independently -- project both endpoints and take the distance -- and pin `steps` to it,
  // with the cap lifted so only the extent is under test.
  it("pins the step count to the screen-y extent between the endpoints", () => {
    let checked = 0;
    for (let az = 0; az < 360; az += 10) {
      for (const el of [5, 20, 45, 60, 85]) {
        const p = proj(az, el);
        for (const x of [W * 0.2, W * 0.35, W * 0.5, W * 0.65, W * 0.8]) {
          const span = columnFloorSpan(x, p, Number.MAX_SAFE_INTEGER);
          if (!span) continue;
          const near = projectPoint(span.u0 + 0.5, span.v0 + 0.5, 0, p);
          const far = projectPoint(
            span.u0 + span.du * span.steps + 0.5,
            span.v0 + span.dv * span.steps + 0.5,
            0,
            p
          );
          const yExtent = Math.abs(near.y - far.y);
          // Reprojecting the endpoints and taking the determinant are the same distance computed
          // two ways, so they can straddle an integer by an ulp. Which side of an integer extent
          // `steps` lands on is not a property worth pinning; skip those and count the rest.
          const frac = yExtent - Math.floor(yExtent);
          if (frac < 1e-6 || frac > 1 - 1e-6) continue;
          checked += 1;
          const expected = Math.max(1, Math.ceil(yExtent));
          expect({ az, el, x, steps: span.steps }).toEqual({ az, el, x, steps: expected });
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("buildRowLut", () => {
  it("interpolates the weight between the bracketing rows", () => {
    const tFracs = new Float64Array([0, 0.5, 1]);
    const { rows, weights } = buildRowLut(tFracs, 3, 101, 0.6);
    // Bucket 25 sits at t = 0.25, midway between rows 0 and 1; bucket 75 midway between 1 and 2.
    expect(rows[25]).toBe(0);
    expect(weights[25]).toBeCloseTo(0.5, 5);
    expect(rows[75]).toBe(1);
    expect(weights[75]).toBeCloseTo(0.5, 5);
    // Exactly on a row the weight is 0 -- the bucket reads that row alone.
    expect(rows[50]).toBe(1);
    expect(weights[50]).toBe(0);
  });

  it("marks buckets with no row within maxDistTFrac as NO_ROW", () => {
    // Rows clustered at both ends: the middle is a capture gap.
    const tFracs = new Float64Array([0, 0.05, 0.95, 1]);
    const { rows } = buildRowLut(tFracs, 4, 101, 0.1);
    expect(rows[0]).toBe(0);
    expect(rows[100]).toBe(3);
    expect(rows[50]).toBe(NO_ROW);
  });

  it("fills entirely with NO_ROW when there are no rows", () => {
    const { rows } = buildRowLut(new Float64Array(0), 0, 8, 0.1);
    expect([...rows]).toEqual(new Array(8).fill(NO_ROW));
  });

  // Across a gap there is nothing to interpolate: the bucket reads whichever end is nearer, at
  // weight 0 or 1, rather than a blend that would drag the near terrain down into the hole.
  it("snaps the weight to the gap end that covered the bucket", () => {
    const tFracs = new Float64Array([0, 0.02, 0.96, 1]);
    const { rows, weights } = buildRowLut(tFracs, 4, 101, 0.1);
    // t = 0.10 is nearer row 1 (0.02); t = 0.90 is nearer row 2 (0.96), expressed as row 1 at
    // full weight.
    expect(rows[10]).toBe(1);
    expect(weights[10]).toBe(0);
    expect(rows[90]).toBe(1);
    expect(weights[90]).toBe(1);
  });

  // A bucket before the first row but within tolerance is covered by it, and the raw weight
  // (t - tFracs[0]) / dt is NEGATIVE there -- unclamped it extrapolates the first two frames'
  // difference past the window's old end. The clamp is what makes "holds the end row" true.
  it("holds the end rows instead of extrapolating past them", () => {
    const tFracs = new Float64Array([0.02, 0.04, 0.98]);
    const { rows, weights } = buildRowLut(tFracs, 3, 101, 0.1);
    expect(rows[0]).toBe(0);
    expect(weights[0]).toBe(0);
    expect(rows[100]).toBe(2);
    expect(weights[100]).toBe(0);
  });

  // Distance exactly at the tolerance boundary must still count as covered (`>`, not `>=`).
  it("keeps a bucket exactly at maxDistTFrac as covered", () => {
    const tFracs = new Float64Array([0]);
    const { rows } = buildRowLut(tFracs, 1, 11, 0.2); // bucket 2 sits at t = 0.2, distance exactly 0.2
    expect(rows[2]).toBe(0);
    expect(rows[3]).toBe(NO_ROW);
  });

  // The last bucket must land at tFrac 1, not size/(size-1) short of it -- a `t = i / size` mutation
  // would leave every bucket slightly under-scaled and never reach 1 at all.
  it("maps the last bucket to the last row at zero weight", () => {
    const tFracs = new Float64Array([0, 1]);
    const { rows, weights } = buildRowLut(tFracs, 2, 5, 0.01);
    expect(rows[4]).toBe(1);
    expect(weights[4]).toBe(0);
  });

  // Capture start: the few captured rows all sit at the newest end of a full-width window. With a
  // tolerance scaled by the decimation stride (as the hook now passes it) rather than by the row
  // count, the empty region must stay uncovered -- a count-derived tolerance would grow with the
  // emptiness and hold each frame across time it contains no data for, which rendered as giant
  // extruded ridges at startup.
  it("leaves the empty region of a startup window uncovered", () => {
    const tFracs = new Float64Array([0.9, 0.925, 0.95, 0.975, 1]);
    const { rows, weights } = buildRowLut(tFracs, 5, 101, 1.5 * 0.025);
    expect(rows[50]).toBe(NO_ROW); // t = 0.5: no data yet
    expect(rows[85]).toBe(NO_ROW); // t = 0.85: 0.05 from the nearest row, past 1.5 strides
    expect(rows[87]).toBe(0); // t = 0.87: within tolerance of the oldest captured row
    expect(weights[87]).toBe(0); // held, not extrapolated
    expect(rows[100]).toBe(4);
    // Between the clustered rows the tolerance still admits interpolation.
    expect(rows[94]).toBe(1);
    expect(weights[94]).toBeCloseTo(0.6, 5);
  });

  // A long monotone run over a wide table, checked against every bucket by an independent
  // brute-force bracket search (not the sweep under test), to confirm the sweep reaches the last
  // row rather than stalling early. Uniform spacing with maxDist above it, so every bucket takes
  // the interpolation branch; gap snapping and NO_ROW are pinned by the dedicated tests above.
  //
  // This cannot catch a `row` reset to 0 on every bucket: that reset is observationally
  // equivalent -- a from-scratch scan lands on the same bracket every time. It only costs a
  // multiple of the work -- see the note on the `while` loop in the implementation.
  it("matches a brute-force bracket search on every bucket", () => {
    const count = 20;
    const size = 211; // not a multiple of count - 1, so buckets sit mid-interval
    const tFracs = new Float64Array(count);
    for (let i = 0; i < count; i++) tFracs[i] = i / (count - 1);
    const maxDist = 2 / (count - 1); // twice the spacing: every bucket interpolates
    const { rows, weights } = buildRowLut(tFracs, count, size, maxDist);

    for (let i = 0; i < size; i++) {
      const t = i / (size - 1);
      let lo = 0;
      for (let r = 0; r < count; r++) if (tFracs[r] <= t) lo = r;
      const hi = lo + 1 < count ? lo + 1 : lo;
      expect(rows[i]).toBe(lo);
      const dt = tFracs[hi] - tFracs[lo];
      const w = dt > 0 ? Math.min(1, Math.max(0, (t - tFracs[lo]) / dt)) : 0;
      expect(weights[i]).toBeCloseTo(w, 5);
    }
    expect(rows[size - 1]).toBe(count - 1);
  });
});

// A LUT whose low end is pure red and whose high end is pure blue, so the two are distinguishable.
function testColormapLut() {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    lut[i * 3] = 255 - i;
    lut[i * 3 + 1] = 0;
    lut[i * 3 + 2] = i;
  }
  return lut;
}

describe("buildSurfaceLut", () => {
  const INK = { r: 100, g: 200, b: 40 };

  it("ramps monochrome by level and shade together, up to full ink", () => {
    const lut = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: false,
      ink: INK,
    });
    const top = 255 * SHADE_LEVELS;
    // Level 255 at full shade is the ink untouched; at shade 0 it is the ink at the 0.55 shade
    // floor.
    expect(lut[top + (SHADE_LEVELS - 1)]).toBe(packArgb(100, 200, 40, 255));
    expect(lut[top + 0]).toBe(packArgb(55, 110, 22, 255));

    // Level carries the main contrast: a quieter sample is dimmer at the same shade -- and level
    // outweighs shade, so a mid-level sample at full shade still beats a top-level one at the
    // shade floor (213 vs 187 of luminance here).
    const lum = (argb) => (argb & 0xff) + ((argb >>> 8) & 0xff) + ((argb >>> 16) & 0xff);
    const quiet = lut[128 * SHADE_LEVELS + (SHADE_LEVELS - 1)];
    expect(quiet).not.toBe(lut[top + (SHADE_LEVELS - 1)]);
    expect(lum(quiet)).toBeLessThan(lum(lut[top + (SHADE_LEVELS - 1)]));
    expect(lum(quiet)).toBeGreaterThan(lum(lut[top + 0]));

    // Level is absolute: raising the dB floor must not re-brighten the same peak.
    const raised = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: -40,
      colorize: false,
      ink: INK,
    });
    expect(raised[top + (SHADE_LEVELS - 1)]).toBe(lut[top + (SHADE_LEVELS - 1)]);
  });

  it("ramps colorize by level, with shade only changing luminance", () => {
    const lut = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: true,
    });
    const litLow = lut[0 * SHADE_LEVELS + (SHADE_LEVELS - 1)];
    const litHigh = lut[255 * SHADE_LEVELS + (SHADE_LEVELS - 1)];
    expect(litLow).not.toBe(litHigh);

    // At full shade, the top of the ramp is the colormap's high end untouched.
    expect(litHigh).toBe(packArgb(0, 0, 255, 255));

    // Shading darkens without changing which channel dominates.
    const dimHigh = lut[255 * SHADE_LEVELS + 0];
    expect(dimHigh).not.toBe(litHigh);
    const blueOf = (argb) => (argb >>> 16) & 0xff;
    expect(blueOf(dimHigh)).toBeLessThan(blueOf(litHigh));
    expect(blueOf(dimHigh)).toBeGreaterThan(0);
  });

  // The alpha fade is what lets silence recede AND lets terrain near the floor dissolve rather
  // than end: the bottom of the range ramps from transparent to opaque, everything above it is
  // fully opaque, in both colour modes. The boundary is derived from the constant rather than
  // written out, so retuning the band's width stays a one-line change.
  it("fades to transparent at the dB floor and is fully opaque above the fade", () => {
    const fadeTop = Math.ceil(LEVEL_ALPHA_FULL * 255);
    for (const colorize of [false, true]) {
      const lut = buildSurfaceLut({
        colormapLut: testColormapLut(),
        dbFloor: SPECTROGRAM_DB_MIN,
        colorize,
        ink: INK,
      });
      expect(lut[0] >>> 24).toBe(0);
      let prev = 0;
      for (let level = 0; level < fadeTop; level++) {
        const a = lut[level * SHADE_LEVELS] >>> 24;
        expect(a).toBeGreaterThanOrEqual(prev);
        prev = a;
      }
      for (let level = fadeTop; level < 256; level++) {
        expect(lut[level * SHADE_LEVELS] >>> 24).toBe(255);
      }
    }
  });

  it("keeps colour absolute when the dB floor is raised", () => {
    const low = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: true,
    });
    const high = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: -40,
      colorize: true,
    });
    // The top of the height ramp is SPECTROGRAM_DB_MAX in both cases, so its colour is unchanged.
    const top = 255 * SHADE_LEVELS + (SHADE_LEVELS - 1);
    expect(low[top]).toBe(high[top]);
    expect(SPECTROGRAM_DB_MAX).toBeGreaterThan(-40);

    // Level 0 sits exactly on the floor, which spectrogramColorFrac pins to the bottom of the
    // ramp -- and the alpha fade takes it to transparent.
    expect(high[0 * SHADE_LEVELS + (SHADE_LEVELS - 1)]).toBe(packArgb(255, 0, 0, 0));
  });

  // A mid-height level, away from both ends of the ramp, where a raised dbFloor sends the recovered
  // dB to a colormap index that is NOT the same as the level itself. The "keeps colour absolute"
  // test above cannot catch a mutant that indexes the colormap by level directly, skipping the dB
  // round-trip: at dbFloor = SPECTROGRAM_DB_MIN the two happen to agree, and the "raised floor" case
  // only checks the top of the ramp, where they also agree (level 255 always maps to dB
  // SPECTROGRAM_DB_MAX regardless of floor). This test picks a floor and a level where they diverge,
  // and pins the result via the same shared helper (`spectrogramColorFracFromHeight`) that
  // `buildSurfaceLut` itself calls. That shared use is what stops the two from drifting apart: an
  // edit to the helper's formula moves both this expectation and the production code together, so
  // only a change to `buildSurfaceLut`'s own call site -- not the underlying maths -- can slip past
  // this test.
  it("converts level to dB before indexing the colormap, not level directly", () => {
    const dbFloor = -40;
    const colormapLut = testColormapLut();
    const lut = buildSurfaceLut({ colormapLut, dbFloor, colorize: true });
    const level = 128;

    const frac = spectrogramColorFracFromHeight(level / 255, dbFloor);
    const idx = Math.round(frac * 255) * 3;
    // Sanity check that this level/floor pair actually exercises the divergence the test relies on.
    expect(idx).not.toBe(level * 3);

    const expected = packArgb(colormapLut[idx], colormapLut[idx + 1], colormapLut[idx + 2], 255);
    expect(lut[level * SHADE_LEVELS + (SHADE_LEVELS - 1)]).toBe(expected);
  });
});

const HIGHLIGHT = packArgb(0, 255, 0, 255);

/**
 * A grid of `count` rows x `pointCount` points, each row at a uniform tFrac, with per-row heights
 * given by `rowHeights`. Mirrors the shape `sampleWaterfallGrid` returns.
 */
function fakeGrid(rowHeights, pointCount = 8) {
  const count = rowHeights.length;
  const heights = new Float32Array(count * pointCount);
  const tFracs = new Float64Array(count);
  for (let r = 0; r < count; r++) {
    tFracs[r] = count > 1 ? r / (count - 1) : 0;
    for (let q = 0; q < pointCount; q++) heights[r * pointCount + q] = rowHeights[r];
  }
  return { heights, tFracs, count, pointCount };
}

function render(
  grid,
  {
    highlightRow = -1,
    columnStride = 1,
    heightGain = 1,
    elevationDeg = 60,
    azimuthDeg = 135,
    enterFadeTFrac = 0,
    exitFadeTFrac = 0,
  } = {}
) {
  const p = proj(azimuthDeg, elevationDeg);
  const out = new Uint32Array(W * H);
  rasterizeSurface({
    out,
    width: W,
    height: H,
    proj: p,
    grid,
    rowLut: defaultRowLut(grid),
    lut: testLut(),
    heightGain,
    highlightArgb: HIGHLIGHT,
    highlightRow,
    columnStride,
    maxSteps: H,
    enterFadeTFrac,
    exitFadeTFrac,
  });
  return out;
}

function countPixels(out, argb) {
  let n = 0;
  for (let i = 0; i < out.length; i++) if (out[i] === argb) n += 1;
  return n;
}

function countOpaque(out) {
  let n = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== 0) n += 1;
  return n;
}

/** The row LUT `render` builds, for the tests that have to look rows up themselves. */
function defaultRowLut(grid) {
  return buildRowLut(grid.tFracs, grid.count, 1024, 1.5 / Math.max(1, grid.count - 1));
}

/** The colour table every rasteriser test renders through. */
function testLut() {
  return buildSurfaceLut({
    colormapLut: testColormapLut(),
    dbFloor: SPECTROGRAM_DB_MIN,
    colorize: true,
  });
}

/** `render`, with the row LUT, projection and destination buffer supplied by the caller. */
function renderWith(grid, rowLut, p, { highlightRow = -1, out = new Uint32Array(W * H) } = {}) {
  rasterizeSurface({
    out,
    width: W,
    height: H,
    proj: p,
    grid,
    rowLut,
    lut: testLut(),
    heightGain: 1,
    highlightArgb: HIGHLIGHT,
    highlightRow,
    columnStride: 1,
    maxSteps: H,
  });
  return out;
}

/** Rows clustered at both ends of the window, so its middle is a capture gap. */
function gapGrid() {
  const grid = fakeGrid([0.5, 0.5, 0.5, 0.5, 0.5]);
  grid.tFracs.set([0, 0.02, 0.04, 0.96, 1]);
  return grid;
}

/** The row LUT that turns `gapGrid`'s clustering into an uncovered middle. */
function gapRowLut(grid) {
  return buildRowLut(grid.tFracs, grid.count, 1024, 0.05);
}

/**
 * Which screen columns have a sample landing on `wantRow` (or on NO_ROW). Occlusion and gap
 * behaviour can only be asserted over the columns that actually contain the row in question.
 *
 * "Landing on" a row now means the row contributes to a sample's interpolated height: the bucket's
 * lower bracket IS the row (any weight), or the bracket is the previous row with a non-zero weight
 * towards it. With the old nearest-row table plain equality said all of this; interpolation splits
 * it into the two cases.
 */
function columnsReaching(p, grid, wantRow, rowLut = defaultRowLut(grid)) {
  const { rows, weights } = rowLut;
  const lutLast = rows.length - 1;
  const cols = [];
  for (let x = 0; x < W; x++) {
    const span = columnFloorSpan(x, p, H);
    if (!span) continue;
    for (let s = 0; s <= span.steps; s++) {
      const u = span.u0 + span.du * s;
      const bucket = Math.round((u + 0.5) * lutLast);
      const row = rows[bucket < 0 ? 0 : bucket > lutLast ? lutLast : bucket];
      const reaches =
        wantRow === NO_ROW
          ? row === NO_ROW
          : row === wantRow || (row === wantRow - 1 && weights[bucket] > 0);
      if (reaches) {
        cols.push(x);
        break;
      }
    }
  }
  return cols;
}

describe("rasterizeSurface", () => {
  it("draws a flat field as an unbroken silhouette", () => {
    const out = render(fakeGrid([0.5, 0.5, 0.5, 0.5, 0.5]));
    expect(countOpaque(out)).toBeGreaterThan(0);
    // Every column that the floor covers gets at least one pixel.
    const p = proj();
    let covered = 0;
    let painted = 0;
    for (let x = 0; x < W; x++) {
      if (!columnFloorSpan(x, p, H)) continue;
      covered += 1;
      for (let y = 0; y < H; y++) {
        if (out[y * W + x] !== 0) {
          painted += 1;
          break;
        }
      }
    }
    expect(covered).toBeGreaterThan(0);
    expect(painted).toBe(covered);
  });

  // Occlusion is a function of elevation, not just of height, and the arithmetic is worth knowing
  // before reading these two. A near sample hides a far one when
  //
  //     Δh · (rise · scaleY)  >  Δt · ty        i.e.  Δh > Δt · tan(elevation) · sin(azimuth)
  //
  // At elevation 60 and Δt = 1 that needs Δh > 1.2, which heights in 0..1 cannot reach — so a
  // low-elevation view is where a solid surface genuinely occludes its own interior. That is the
  // whole reason Lines is kept as a separate mode; see Decision #1 of the design. Elevation 20 puts
  // the threshold at Δh > 0.26, which is reachable.
  //
  // Both tests below render at azimuth 90, and that is load-bearing rather than incidental. A grid
  // row is a SLAB of the time axis, and at the default azimuth 135 `tx` and `fx` are equal, so a
  // screen column is the line `u + v = k` and covers only part of that axis: every column with
  // `k <= -1/6` contains no sample from the newest row's slab at all, and the older rows are
  // legitimately unoccluded there. A global "zero highlight pixels" assertion is therefore
  // unsatisfiable at 135 by any implementation. At azimuth 90 `tx` is zero, so a column spans the
  // WHOLE time axis and contains every row, which is what makes a whole-image count meaningful.
  // Do not "simplify" these back to the default view. Occlusion at the default azimuth is covered
  // separately, scoped to the columns where it can apply.
  it("hides a low far row behind a tall near row", () => {
    // Row 0 is oldest, row N-1 newest. `proj.ty > 0`, so the newest row is nearest: make the
    // NEAREST row tall and tag the FARTHEST one. None of it should survive.
    const grid = fakeGrid([0.05, 0.05, 0.05, 1]);
    const out = render(grid, { highlightRow: 0, elevationDeg: 20, azimuthDeg: 90 });
    expect(countPixels(out, HIGHLIGHT)).toBe(0);
  });

  it("lets a tall far row show above a low near row", () => {
    const grid = fakeGrid([1, 0.05, 0.05, 0.05]);
    const out = render(grid, { highlightRow: 0, elevationDeg: 20, azimuthDeg: 90 });
    expect(countPixels(out, HIGHLIGHT)).toBeGreaterThan(0);
  });

  // What this actually demonstrates is narrower than "a transparent stripe through the middle".
  // Every visible sample fills the wall down to the previous silhouette, so a column's painted
  // pixels stay contiguous whether or not the walk crosses a gap. The coverage drop measured here
  // comes from the gap TRUNCATING the silhouette: in a column whose far endpoint lands inside the
  // gap, the walk runs out of covered samples early and the column stops short of the height it
  // reaches when the same rows are all covered. The invariant that a gap never moves the horizon is
  // pinned by "paints each column as one contiguous run" below, not by this count.
  it("leaves a gap transparent instead of filling it", () => {
    const grid = fakeGrid([0.5, 0.5, 0.5, 0.5, 0.5]);
    // Rows clustered at the ends: nothing covers the middle of the window.
    grid.tFracs.set([0, 0.02, 0.04, 0.96, 1]);
    const rowLut = buildRowLut(grid.tFracs, grid.count, 1024, 0.05);
    const p = proj();
    const out = new Uint32Array(W * H);
    rasterizeSurface({
      out,
      width: W,
      height: H,
      proj: p,
      grid,
      rowLut,
      lut: buildSurfaceLut({
        colormapLut: testColormapLut(),
        dbFloor: SPECTROGRAM_DB_MIN,
        colorize: true,
      }),
      heightGain: 1,
      highlightArgb: HIGHLIGHT,
      highlightRow: -1,
      columnStride: 1,
      maxSteps: H,
    });
    const solid = render(grid);
    expect(countOpaque(out)).toBeLessThan(countOpaque(solid));
    expect(countOpaque(out)).toBeGreaterThan(0);
  });

  it("writes nothing outside the floor silhouette", () => {
    const out = render(fakeGrid([0.5, 0.5, 0.5]));
    const p = proj();
    for (let x = 0; x < W; x++) {
      if (columnFloorSpan(x, p, H)) continue;
      for (let y = 0; y < H; y++) expect(out[y * W + x]).toBe(0);
    }
  });

  // Replication is structural, so assert the structure rather than a coverage total: a total within
  // a few percent is also what a stride of 3 or 4 produces, which pins nothing. Under stride 2 each
  // rasterised column is copied to exactly one neighbour, so every even column must equal the odd
  // one to its right -- including the empty ones outside the silhouette, which match at zero.
  it("replicates columns when a stride is used", () => {
    const grid = fakeGrid([0.4, 0.5, 0.6]);
    const strided = render(grid, { columnStride: 2 });
    expect(countOpaque(strided)).toBeGreaterThan(0);
    const mismatches = [];
    for (let x = 0; x + 1 < W; x += 2) {
      for (let y = 0; y < H; y++) {
        const left = strided[y * W + x];
        const right = strided[y * W + x + 1];
        if (left !== right) mismatches.push({ x, y, left, right });
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it("draws nothing when the grid is empty", () => {
    const out = render(fakeGrid([]));
    expect(countOpaque(out)).toBe(0);
  });

  // A row is a SLAB of the time axis, and a screen column only covers part of that axis: at azimuth
  // 135 the floor is a rhombus, so the columns towards one side contain no sample from the newest
  // row's slab at all, and the older rows are legitimately unoccluded there. Occlusion can therefore
  // only be asserted over the columns whose span actually reaches the tall row -- which is where the
  // running horizon is the only thing standing between the far row and the framebuffer.
  //
  // The last TWO rows are tall, not just the last one. Interpolation ramps between rows 2 and 3,
  // and "reaching" row 3 includes the ramp -- with a single tall row the ramp's low early part
  // owes no occlusion, and the far row legitimately shows through it. Two tall rows make every
  // sample that reaches row 3's bracket sit at full height, so the column set and the assertion
  // mean the same thing again.
  it("hides the far row in every column the tall near row reaches", () => {
    const grid = fakeGrid([0.05, 0.05, 1, 1]);
    const out = render(grid, { highlightRow: 0, elevationDeg: 20 });
    const cols = columnsReaching(proj(135, 20), grid, grid.count - 1);
    expect(cols.length).toBeGreaterThan(0);
    let highlighted = 0;
    for (const x of cols) {
      for (let y = 0; y < H; y++) if (out[y * W + x] === HIGHLIGHT) highlighted += 1;
    }
    expect(highlighted).toBe(0);
  });

  // The horizon is seeded from the floor's near edge, not from the canvas height. With `height` the
  // nearest sample's wall runs past the front edge of the floor and paints the empty region below
  // the scene, which the "outside the silhouette" test above cannot see: those columns do have a
  // span, they are just empty below the floor.
  it("paints nothing below the floor's near edge", () => {
    const out = render(fakeGrid([0.5, 0.5, 0.5, 0.5, 0.5]));
    const p = proj();
    const below = [];
    for (let x = 0; x < W; x++) {
      const span = columnFloorSpan(x, p, H);
      if (!span) continue;
      const nearFloorY = Math.round(p.originY + span.u0 * p.ty + span.v0 * p.fy);
      for (let y = nearFloorY + 1; y < H; y++) {
        if (out[y * W + x] !== 0) below.push({ x, y, nearFloorY });
      }
    }
    expect(below.slice(0, 5)).toEqual([]);
  });

  // Depth attenuation runs from the near end towards the far end. Inverting it is invisible to every
  // coverage assertion -- the same pixels are painted either way -- so pin the direction: on a flat
  // field the bottom of a column is nearer than its top and must come out brighter.
  it("shades the near end brighter than the far end", () => {
    const out = render(fakeGrid(new Array(40).fill(0.5)));
    const x = Math.round(W / 2);
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < H; y++) {
      if (out[y * W + x] !== 0) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeGreaterThan(top);
    const lum = (argb) => (argb & 0xff) + ((argb >>> 8) & 0xff) + ((argb >>> 16) & 0xff);
    expect(lum(out[bottom * W + x])).toBeGreaterThan(lum(out[top * W + x]));
  });

  // "The terrain behind the gap stays visible through it", restricted to the columns whose walk
  // actually crosses the gap -- elsewhere the far row is reached without ever meeting a NO_ROW
  // sample, so those columns say nothing about how the gap was handled.
  it("keeps the terrain behind a gap visible through it", () => {
    const grid = gapGrid();
    const rowLut = gapRowLut(grid);
    const p = proj();
    const out = renderWith(grid, rowLut, p, { highlightRow: 0 });
    const gapCols = new Set(columnsReaching(p, grid, NO_ROW, rowLut));
    const cols = columnsReaching(p, grid, 0, rowLut).filter((x) => gapCols.has(x));
    expect(cols.length).toBeGreaterThan(0);
    let highlighted = 0;
    for (const x of cols) {
      for (let y = 0; y < H; y++) if (out[y * W + x] === HIGHLIGHT) highlighted += 1;
    }
    expect(highlighted).toBeGreaterThan(0);
  });

  // "Occluded pixels are never written, so there is no overdraw at all" is a claim about cost, but
  // it has an exact output-side form: every pixel is assigned at most once. A Proxy counts the
  // assignments, which keeps this an assertion about behaviour rather than about wall-clock time --
  // a horizon that fails to advance, or one that moves backwards during a gap, repaints pixels it
  // has already written.
  it("assigns every pixel at most once", () => {
    const gapped = gapGrid();
    for (const [grid, rowLut, p] of [
      [fakeGrid([0.2, 0.9, 0.3, 0.8, 0.1, 0.6]), null, proj(135, 20)],
      [gapped, gapRowLut(gapped), proj()],
    ]) {
      const writes = new Uint16Array(W * H);
      const out = new Proxy(new Uint32Array(W * H), {
        set(target, prop, value) {
          const i = Number(prop);
          if (Number.isInteger(i)) writes[i] += 1;
          return Reflect.set(target, prop, value);
        },
      });
      renderWith(grid, rowLut ?? defaultRowLut(grid), p, { out });
      let total = 0;
      let twice = 0;
      for (let i = 0; i < writes.length; i++) {
        total += writes[i];
        if (writes[i] > 1) twice += 1;
      }
      expect(total).toBeGreaterThan(0);
      expect(twice).toBe(0);
    }
  });

  /** Transparent pixels lying between the topmost and bottommost painted pixel of a column. */
  function holesIn(out) {
    const holes = [];
    for (let x = 0; x < W; x++) {
      let first = -1;
      let last = -1;
      for (let y = 0; y < H; y++) {
        if (out[y * W + x] !== 0) {
          if (first < 0) first = y;
          last = y;
        }
      }
      if (first < 0) continue;
      for (let y = first; y <= last; y++) {
        if (out[y * W + x] === 0) holes.push({ x, y });
      }
    }
    return holes;
  }

  // Continuous terrain must come out as one unbroken run per column: consecutive samples are at most
  // one screen row apart, so bounding each sample's wall by the floor beneath it still leaves every
  // sample's fill reaching the previous silhouette. Anything that tears a stripe out of CONTINUOUS
  // terrain is a bug in the wall arithmetic.
  it("paints continuous terrain as one contiguous run per column", () => {
    const out = render(fakeGrid([0.2, 0.9, 0.3, 0.8, 0.1, 0.6]), { elevationDeg: 20 });
    expect(countOpaque(out)).toBeGreaterThan(0);
    expect(holesIn(out).slice(0, 5)).toEqual([]);
  });

  // Uncovered stretches are the exception, and deliberately so -- this reverses the earlier decision
  // that a column stays contiguous across a gap too. Filling the first sample after a hole down to
  // the stale horizon extrudes its cross-section forward over floor the data does not reach, and
  // since the extrusion's bottom follows the floor's near boundary rather than the terrain's own
  // end, it reads as the surface spilling out from under the floor. What a hole in a solid actually
  // shows is the far terrain's front face down to ITS floor point, and empty floor below that.
  it("shows a band of empty floor through a capture gap", () => {
    const gapped = gapGrid();
    const out = renderWith(gapped, gapRowLut(gapped), proj());
    expect(countOpaque(out)).toBeGreaterThan(0);
    expect(holesIn(out).length).toBeGreaterThan(0);
  });

  // The case from a real capture start: the window is only partly filled and the empty stretch is
  // the one towards the viewer, so EVERY column walks through uncovered samples before reaching any
  // terrain, and the whole surface gets extruded forward onto empty floor. The invariant that kills
  // it is local -- no pixel may be painted below the floor point beneath the terrain that produced
  // it -- so it is asserted against the nearest covered sample of each column.
  it("paints nothing below the floor beneath the terrain when the near end is uncovered", () => {
    const grid = fakeGrid([0.5, 0.5, 0.5, 0.5]);
    grid.tFracs.set([0, 0.01, 0.02, 0.03]); // all of it at the far end; the near end holds no data
    const rowLut = buildRowLut(grid.tFracs, grid.count, 1024, 0.02);
    const p = proj();
    const out = renderWith(grid, rowLut, p);
    expect(countOpaque(out)).toBeGreaterThan(0);

    const lutLast = rowLut.rows.length - 1;
    const spills = [];
    for (let x = 0; x < W; x++) {
      const span = columnFloorSpan(x, p, H);
      if (!span) continue;
      let limit = -1;
      for (let s = 0; s <= span.steps; s++) {
        const u = span.u0 + span.du * s;
        const v = span.v0 + span.dv * s;
        if (rowLut.rows[Math.round((u + 0.5) * lutLast)] === NO_ROW) continue;
        limit = Math.round(p.originY + u * p.ty + v * p.fy);
        break;
      }
      if (limit < 0) continue;
      for (let y = limit + 1; y < H; y++) if (out[y * W + x] !== 0) spills.push({ x, y });
    }
    expect(spills.slice(0, 5)).toEqual([]);
  });

  // Slope is read before the visibility test, so a stretch that is hidden still shapes the shading
  // of what follows. A dip hidden behind a tall near row must therefore brighten the terrain behind
  // it -- the sample after the dip climbs steeply. Measuring it over the columns the tall row
  // reaches is what makes the dip hidden; elsewhere it is visible and shades those columns in any
  // case. Comparison is against a flat field of the same height, so only the slope term moves.
  it("shades from an occluded stretch as well as a visible one", () => {
    const dipped = fakeGrid([0.5, 0.5, 0.05, 0.5]);
    const flat = fakeGrid([0.5, 0.5, 0.5, 0.5]);
    const p = proj(135, 20);
    const cols = columnsReaching(p, dipped, dipped.count - 1);
    expect(cols.length).toBeGreaterThan(0);
    const lut = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: true,
    });
    const brightest = (out) => {
      const shadeOf = new Map();
      for (let k = 0; k < SHADE_LEVELS; k++) shadeOf.set(lut[128 * SHADE_LEVELS + k], k);
      let best = -1;
      for (const x of cols) {
        for (let y = 0; y < H; y++) {
          const k = shadeOf.get(out[y * W + x]);
          if (k !== undefined && k > best) best = k;
        }
      }
      return best;
    };
    const withDip = brightest(render(dipped, { elevationDeg: 20 }));
    const withoutDip = brightest(render(flat, { elevationDeg: 20 }));
    expect(withoutDip).toBeGreaterThanOrEqual(0);
    expect(withDip).toBeGreaterThan(withoutDip);
  });

  // The walk stops early once the horizon reaches the top of the canvas, which only happens when a
  // high Height Scale pushes peaks off the top. Stopping one row too soon costs the topmost row of
  // those columns and nothing else, so it is invisible to every silhouette and contiguity assertion
  // above: pin it by predicting, from the grid and `projectPoint` alone, exactly which columns reach
  // row 0. The sample achieving a column's minimum y is always visible -- the horizon is a running
  // minimum of the samples before it -- so reaching row 0 and painting it are the same thing.
  it("paints the top row of every column whose terrain clips the canvas", () => {
    const heightGain = 3;
    const grid = fakeGrid([0.2, 0.9, 0.5, 1, 0.6, 0.95]);
    const p = proj();
    const out = render(grid, { heightGain });
    const rowLut = defaultRowLut(grid);
    const lutLast = rowLut.rows.length - 1;
    const wrong = [];
    for (let x = 0; x < W; x++) {
      const span = columnFloorSpan(x, p, H);
      if (!span) continue;
      let minY = Infinity;
      for (let s = 0; s <= span.steps; s++) {
        const u = span.u0 + span.du * s;
        const v = span.v0 + span.dv * s;
        const bucket = Math.round((u + 0.5) * lutLast);
        const row = rowLut.rows[bucket];
        if (row === NO_ROW) continue;
        // The same bilinear read the walk performs -- the prediction has to share the sampling,
        // or a column whose clip margin is under a pixel flips for the wrong reason.
        const qf = (v + 0.5) * (grid.pointCount - 1);
        const q0 = Math.min(Math.floor(qf), grid.pointCount - 1);
        const q1 = Math.min(q0 + 1, grid.pointCount - 1);
        const wq = qf - q0;
        const wr = rowLut.weights[bucket];
        const r1 = row + 1 < grid.count ? row + 1 : row;
        const b0 = row * grid.pointCount;
        const b1 = r1 * grid.pointCount;
        const hLo = grid.heights[b0 + q0] + (grid.heights[b0 + q1] - grid.heights[b0 + q0]) * wq;
        const hHi = grid.heights[b1 + q0] + (grid.heights[b1 + q1] - grid.heights[b1 + q0]) * wq;
        const h = hLo + (hHi - hLo) * wr;
        const y = Math.round(p.originY + u * p.ty + v * p.fy + h * heightGain * p.hy);
        if (y < minY) minY = y;
      }
      const clips = minY <= 0;
      const paintedTopRow = out[x] !== 0;
      if (clips !== paintedTopRow) wrong.push({ x, minY, clips, paintedTopRow });
    }
    // Non-vacuous: the scene has to actually clip somewhere.
    expect(wrong.slice(0, 5)).toEqual([]);
    let clipped = 0;
    for (let x = 0; x < W; x++) if (out[x] !== 0) clipped += 1;
    expect(clipped).toBeGreaterThan(0);
  });

  // The frequency coordinate must be `qf = (v + 0.5) * (pointCount - 1)`, lerped between the two
  // bracketing points. With two points the ramp runs from q = 0 at v = -0.5 to q = 1 at v = 0.5;
  // scaling by `pointCount` instead compresses it into the left half of the floor and the top of
  // the silhouette drops with it. The prediction comes from a brute-force scan of the floor square
  // through `projectPoint`'s own formula, not from the walk. All rows are identical here, so the
  // time-axis interpolation is the identity and only the frequency mapping is under test.
  it("maps the frequency axis onto the grid's point index", () => {
    const pointCount = 2;
    const grid = fakeGrid([0, 0, 0, 0, 0, 0], pointCount);
    for (let r = 0; r < grid.count; r++) grid.heights[r * pointCount] = 0.8;
    const p = proj();
    const out = renderWith(grid, defaultRowLut(grid), p);

    let top = H;
    for (let y = 0; y < H && top === H; y++) {
      for (let x = 0; x < W; x++) {
        if (out[y * W + x] !== 0) {
          top = y;
          break;
        }
      }
    }
    let predicted = Infinity;
    for (let iu = 0; iu <= 400; iu++) {
      for (let iv = 0; iv <= 400; iv++) {
        const u = -0.5 + iu / 400;
        const v = -0.5 + iv / 400;
        const qf = (v + 0.5) * (pointCount - 1);
        const q0 = Math.min(Math.floor(qf), pointCount - 1);
        const q1 = Math.min(q0 + 1, pointCount - 1);
        const h = grid.heights[q0] + (grid.heights[q1] - grid.heights[q0]) * (qf - q0);
        const y = projectPoint(u + 0.5, v + 0.5, h, p).y;
        if (y < predicted) predicted = y;
      }
    }
    expect(Math.abs(top - predicted)).toBeLessThanOrEqual(3);
  });

  // With nearest-row sampling a grid cell covers several screen pixels at one identical height, so
  // the silhouette advances in steps of a full inter-row height difference -- the "3D bar chart"
  // look interpolation exists to remove. On a linear ramp of rows the top of each painted column
  // must therefore move by floor slope and rounding alone, not by an inter-row jump: at this
  // canvas size one inter-row step (0.8 / 11 of the height axis) is ~7 px, while a continuous
  // silhouette stays within a couple of px between neighbouring columns.
  it("interpolates heights between rows instead of stepping the silhouette", () => {
    const rows = 12;
    const ramp = [];
    for (let r = 0; r < rows; r++) ramp.push(0.1 + (0.8 * r) / (rows - 1));
    const out = render(fakeGrid(ramp));
    const tops = [];
    for (let x = 0; x < W; x++) {
      tops.push(-1);
      for (let y = 0; y < H; y++) {
        if (out[y * W + x] !== 0) {
          tops[x] = y;
          break;
        }
      }
    }
    let maxStep = 0;
    let transitions = 0;
    for (let x = 1; x < W; x++) {
      if (tops[x] < 0 || tops[x - 1] < 0) continue;
      transitions += 1;
      maxStep = Math.max(maxStep, Math.abs(tops[x] - tops[x - 1]));
    }
    expect(transitions).toBeGreaterThan(0);
    expect(maxStep).toBeLessThanOrEqual(4);
  });

  // The exit fade sinks the far edge of the terrain into the floor: on a flat field at azimuth 90
  // the silhouette top no longer sits at the far corner's full height but at the fade boundary,
  // one fade-width in from the edge. Predicted through projectPoint, not the walk.
  it("sinks the far edge into the floor over the exit fade width", () => {
    const grid = fakeGrid(new Array(20).fill(0.8));
    const p = proj(90, 60);
    const exitFadeTFrac = 0.2;
    const out = render(grid, { azimuthDeg: 90, exitFadeTFrac });
    const x = Math.round(W / 2);
    const topOf = (buf) => {
      for (let y = 0; y < H; y++) {
        if (buf[y * W + x] !== 0) return y;
      }
      return -1;
    };
    const top = topOf(out);
    expect(top).toBeGreaterThanOrEqual(0);
    const predicted = projectPoint(exitFadeTFrac, 0.5, 0.8, p).y;
    expect(Math.abs(top - predicted)).toBeLessThanOrEqual(3);
    // Sanity: without the fade the same column tops out at the far corner, visibly higher.
    const solidTop = topOf(render(grid, { azimuthDeg: 90 }));
    expect(top - solidTop).toBeGreaterThan(10);
  });

  // At the entering edge the fade ramps the held heights down to the floor, so the bottom of each
  // column's run is painted by samples whose level sits inside the alpha fade -- translucent --
  // instead of by the newest row at full level. The alpha byte is the discriminator: pixel
  // coverage is identical either way (the wall hugs the ramped terrain down to the floor).
  it("ramps the entering edge down to the floor instead of painting a full-height wall", () => {
    const grid = fakeGrid(new Array(20).fill(0.8));
    const x = Math.round(W / 2);
    const bottomOf = (buf) => {
      for (let y = H - 1; y >= 0; y--) {
        if (buf[y * W + x] !== 0) return y;
      }
      return -1;
    };
    const solid = render(grid, { azimuthDeg: 90 });
    const faded = render(grid, { azimuthDeg: 90, enterFadeTFrac: 0.1 });
    const solidBottom = bottomOf(solid);
    const fadedBottom = bottomOf(faded);
    expect(solidBottom).toBeGreaterThan(0);
    expect(fadedBottom).toBeGreaterThan(0);
    // Full wall: the newest row's level paints the run's bottom at full opacity.
    expect(solid[solidBottom * W + x] >>> 24).toBe(255);
    // Ramp: the lip is painted by sunk samples, inside the level-alpha fade.
    expect(faded[fadedBottom * W + x] >>> 24).toBeLessThan(255);
  });
});

describe("smoothGridFrequency", () => {
  it("damps an isolated spike to 3/8 and spreads it to its neighbours", () => {
    // Two 3-tap passes = one binomial 5-tap: a one-bin spike keeps 6/16 of its height.
    const heights = new Float32Array([0, 0, 1, 0, 0]);
    smoothGridFrequency(heights, 1, 5);
    expect([...heights]).toEqual([0, 0.25, 0.375, 0.25, 0]);
  });

  it("leaves a plateau unchanged", () => {
    const heights = new Float32Array(6).fill(0.5);
    smoothGridFrequency(heights, 1, 6);
    expect([...heights]).toEqual(new Array(6).fill(0.5));
  });

  it("keeps both endpoints as sampled", () => {
    const heights = new Float32Array([0.8, 0, 0, 0.2]);
    smoothGridFrequency(heights, 1, 4);
    expect(heights[0]).toBeCloseTo(0.8, 6);
    expect(heights[3]).toBeCloseTo(0.2, 6);
    // Pass 1: [0.8, 0.2, 0.05, 0.2]; pass 2 folds those in again.
    expect(heights[1]).toBeCloseTo(0.3125, 6);
    expect(heights[2]).toBeCloseTo(0.125, 6);
  });

  it("smooths each row independently, with no bleed across rows", () => {
    const heights = new Float32Array([1, 0, 0, 0, 0, 0, 0, 1]);
    smoothGridFrequency(heights, 2, 4);
    expect(heights[1]).toBeCloseTo(0.375, 6);
    expect(heights[2]).toBeCloseTo(0.0625, 6);
    expect(heights[3]).toBeCloseTo(0, 6); // row 0's far endpoint, untouched
    expect(heights[4]).toBeCloseTo(0, 6); // row 1's near endpoint, untouched
    expect(heights[5]).toBeCloseTo(0.0625, 6);
    expect(heights[6]).toBeCloseTo(0.375, 6);
  });

  it("is a no-op for degenerate shapes", () => {
    const heights = new Float32Array([0.5, 0.75]);
    smoothGridFrequency(heights, 1, 2);
    expect(heights[0]).toBeCloseTo(0.5, 6);
    expect(heights[1]).toBeCloseTo(0.75, 6);
    smoothGridFrequency(new Float32Array(0), 0, 0); // must not throw
  });
});

describe("edgeFade", () => {
  it("is 1 in the interior and ramps to 0 at both edges", () => {
    expect(edgeFade(0.5, 0.1, 0.2)).toBe(1);
    expect(edgeFade(0, 0.1, 0.2)).toBe(0);
    expect(edgeFade(1, 0.1, 0.2)).toBe(0);
    expect(edgeFade(0.1, 0.1, 0.2)).toBe(0.5); // halfway into the 0.2-wide exit ramp
    expect(edgeFade(0.95, 0.1, 0.2)).toBeCloseTo(0.5, 12); // halfway into the 0.1-wide enter ramp
    expect(edgeFade(0.2, 0.1, 0.2)).toBe(1); // exactly at the exit boundary
  });

  // The rasteriser multiplies heights by this unconditionally, so the disabled case must be an
  // exact identity, not an approximation.
  it("is exactly 1 everywhere when both widths are 0", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(edgeFade(t, 0, 0)).toBe(1);
  });

  it("never goes negative past the edges", () => {
    expect(edgeFade(-0.1, 0.1, 0.2)).toBe(0);
    expect(edgeFade(1.1, 0.1, 0.2)).toBe(0);
  });

  // A linear ramp kinks where it meets the floor and again where it reaches full height, and a
  // heightfield shows both as creases running across the frequency axis. The eased ramp has to be
  // flat at both of those ends -- that, not the midpoint, is the whole point of easing it.
  it("leaves the ramp flat where it meets the floor and where it reaches full height", () => {
    const near = (t) => edgeFade(t, 0, 1); // one full-width exit ramp, so tFrac is the ramp position
    // Quarter of the way up the ramp the eased curve is well under the linear 0.25, and three
    // quarters of the way up it is well over 0.75: the two shoulders, flattened.
    expect(near(0.25)).toBeCloseTo(0.15625, 12);
    expect(near(0.75)).toBeCloseTo(0.84375, 12);
    expect(near(0.5)).toBeCloseTo(0.5, 12);
  });

  it("stays monotonic across each ramp", () => {
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const value = edgeFade(i / 50, 0, 1);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });
});

describe("smoothGridTime", () => {
  const T = (fracs) => Float64Array.from(fracs);

  // Row 3 getting a full 0.25 (not 0.125) is what pins the kernel to ORIGINAL neighbour rows: a
  // rolling in-place read would fold the already-smoothed row 2 into row 3 and halve it again.
  it("blends interior rows with their original neighbours", () => {
    const heights = new Float32Array([0, 0, 1, 0, 0]);
    smoothGridTime(heights, T([0, 0.01, 0.02, 0.03, 0.04]), 5, 1, 0.015);
    expect([...heights]).toEqual([0, 0.25, 0.5, 0.25, 0]);
  });

  it("keeps the first row as sampled and gives the last one the causal half", () => {
    const heights = new Float32Array([0.8, 0, 0, 0.2]);
    smoothGridTime(heights, T([0, 0.01, 0.02, 0.03]), 4, 1, 0.015);
    expect(heights[0]).toBeCloseTo(0.8, 6);
    expect(heights[1]).toBeCloseTo(0.2, 6);
    expect(heights[2]).toBeCloseTo(0.05, 6);
    // 0.25 * (row 2 as sampled) + 0.75 * itself.
    expect(heights[3]).toBeCloseTo(0.15, 6);
  });

  // The reason the last row is not left raw: it is rewritten with the full kernel as soon as the
  // next row arrives, and that rewrite is a visible shape change one stride in from the entering
  // edge. The causal half cannot remove the change -- the next frame is genuinely unknown -- but it
  // must cut it down to the next row's contribution alone.
  it("halves how far the last row moves when the next row arrives", () => {
    const asLast = new Float32Array([0.2, 0.6, 1.0]);
    smoothGridTime(asLast, T([0, 0.01, 0.02]), 3, 1, 0.015);

    const withNext = new Float32Array([0.2, 0.6, 1.0, 0.4]);
    smoothGridTime(withNext, T([0, 0.01, 0.02, 0.03]), 4, 1, 0.015);

    const settled = 0.25 * 0.6 + 0.5 * 1.0 + 0.25 * 0.4;
    expect(withNext[2]).toBeCloseTo(settled, 6);
    // The jump is exactly the next row's quarter -- the previous row's quarter is already paid.
    expect(Math.abs(asLast[2] - withNext[2])).toBeCloseTo(0.25 * Math.abs(0.4 - 1.0), 6);
    // What leaving it raw would have cost, for comparison: both neighbours' quarters.
    expect(Math.abs(1.0 - withNext[2])).toBeGreaterThan(Math.abs(asLast[2] - withNext[2]));
  });

  it("leaves the last row as sampled when a gap precedes it", () => {
    const heights = new Float32Array([0, 0.5, 1]);
    smoothGridTime(heights, T([0, 0.01, 0.5]), 3, 1, 0.015);
    expect(heights[2]).toBe(1);
  });

  // Rows bracketing a capture gap are not adjacent moments; blending them would fabricate a
  // transition that never happened. Both rows touching the gap stay as sampled -- rows 1 and 2
  // here. Row 3 does not touch the gap, so it gets the causal kernel like any other last row.
  it("does not blend rows across a capture gap", () => {
    const heights = new Float32Array([0, 1, 1, 0]);
    smoothGridTime(heights, T([0, 0.01, 0.5, 0.51]), 4, 1, 0.015);
    expect([...heights]).toEqual([0, 1, 1, 0.25]);
  });

  it("smooths every frequency point independently", () => {
    // q0 carries an impulse at row 1, q1 is flat -- q1 must not move.
    const heights = new Float32Array([0, 0.4, 1, 0.4, 0, 0.4]);
    smoothGridTime(heights, T([0, 0.01, 0.02]), 3, 2, 0.015);
    expect(heights[2]).toBeCloseTo(0.5, 6);
    expect(heights[3]).toBeCloseTo(0.4, 6);
  });

  it("is a no-op for fewer than three rows", () => {
    const heights = new Float32Array([1, 0]);
    smoothGridTime(heights, T([0, 0.01]), 2, 1, 0.015);
    expect([...heights]).toEqual([1, 0]);
    smoothGridTime(new Float32Array(0), Float64Array.from([]), 0, 0, 0.015); // must not throw
  });
});

describe("columnStrideFor", () => {
  it("returns 1 for a small panel", () => {
    expect(columnStrideFor(922, 110)).toBe(1);
  });

  it("returns the stride measured for each benchmarked canvas", () => {
    // Pins scripts/spectrogram-surface-benchmark.mjs's measurements (2026-07-30) against the code,
    // so a future change to the area budget has to justify itself against real numbers again.
    expect(columnStrideFor(922, 110)).toBe(1);
    expect(columnStrideFor(1920, 600)).toBe(1);
    expect(columnStrideFor(2560, 900)).toBe(2);
    expect(columnStrideFor(3440, 1440)).toBe(4);
    expect(columnStrideFor(3840, 1200)).toBe(4);
  });

  it("never returns less than 1, including for a degenerate canvas", () => {
    expect(columnStrideFor(0, 0)).toBe(1);
    expect(columnStrideFor(0, 900)).toBe(1);
    expect(columnStrideFor(-10, -10)).toBe(1);
  });

  it("never exceeds STRIDE_MAX, including for an absurdly large canvas", () => {
    expect(columnStrideFor(20_000, 20_000)).toBeLessThanOrEqual(4);
  });

  it("is monotonic in area", () => {
    const sizes = [
      [922, 110],
      [1920, 600],
      [2560, 900],
      [3440, 1440],
      [3840, 1200],
      [7680, 2400],
    ];
    let prev = -Infinity;
    for (const [width, height] of sizes) {
      const stride = columnStrideFor(width, height);
      expect(stride).toBeGreaterThanOrEqual(prev);
      prev = stride;
    }
  });
});
