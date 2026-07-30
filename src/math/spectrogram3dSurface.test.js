import { describe, expect, it } from "vitest";
import { SPECTROGRAM_DB_MAX, SPECTROGRAM_DB_MIN } from "../config/scales.js";
import { spectrogramColorFracFromHeight } from "../theme/spectrogramColormap.js";
import { buildProjection, projectPoint } from "./spectrogram3dProjection.js";
import {
  buildRowLut,
  buildSurfaceLut,
  columnFloorSpan,
  columnStrideFor,
  NO_ROW,
  packArgb,
  rasterizeSurface,
  SHADE_LEVELS,
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
  it("maps each bucket to the nearest row", () => {
    const tFracs = new Float64Array([0, 0.5, 1]);
    const lut = buildRowLut(tFracs, 3, 101, 0.4);
    expect(lut[0]).toBe(0);
    expect(lut[50]).toBe(1);
    expect(lut[100]).toBe(2);
    expect(lut[10]).toBe(0);
    expect(lut[40]).toBe(1);
  });

  it("marks buckets with no row within maxDistTFrac as NO_ROW", () => {
    // Rows clustered at both ends: the middle is a capture gap.
    const tFracs = new Float64Array([0, 0.05, 0.95, 1]);
    const lut = buildRowLut(tFracs, 4, 101, 0.1);
    expect(lut[0]).toBe(0);
    expect(lut[100]).toBe(3);
    expect(lut[50]).toBe(NO_ROW);
  });

  it("fills entirely with NO_ROW when there are no rows", () => {
    const lut = buildRowLut(new Float64Array(0), 0, 8, 0.1);
    expect([...lut]).toEqual(new Array(8).fill(NO_ROW));
  });

  // Ties: bucket exactly midway between two rows must resolve to the LATER row (`<=`, not `<`).
  // A `<` mutation would leave the earlier row selected instead, which this pins down directly.
  it("breaks exact ties in favour of the later row", () => {
    const tFracs = new Float64Array([0, 1]);
    const lut = buildRowLut(tFracs, 2, 3, 1); // buckets at t = 0, 0.5, 1
    expect(lut[1]).toBe(1);
  });

  // Distance exactly at the tolerance boundary must still count as covered (`>`, not `>=`).
  it("keeps a bucket exactly at maxDistTFrac as covered", () => {
    const tFracs = new Float64Array([0]);
    const lut = buildRowLut(tFracs, 1, 11, 0.2); // bucket 2 sits at t = 0.2, distance exactly 0.2
    expect(lut[2]).toBe(0);
    expect(lut[3]).toBe(NO_ROW);
  });

  // The last bucket must land at tFrac 1, not size/(size-1) short of it -- a `t = i / size` mutation
  // would leave every bucket slightly under-scaled and never reach 1 at all.
  it("maps the last bucket to tFrac exactly 1", () => {
    const tFracs = new Float64Array([0, 1]);
    const lut = buildRowLut(tFracs, 2, 5, 0.01);
    expect(lut[4]).toBe(1);
  });

  // A long monotone run over a wide table, checked against every bucket by an independent
  // brute-force nearest-row search (not the sweep under test), to confirm the sweep reaches the
  // last row rather than stalling early.
  //
  // This cannot catch a `row` reset to 0 on every bucket: that reset is observationally
  // equivalent, because the distance to `t` is a single valley and a from-scratch scan from 0
  // lands on the same nearest row every time. It only costs a multiple of the work -- see the
  // note on the `while` loop above.
  it("reaches rows past index 1 as the sweep advances", () => {
    const count = 20;
    const size = 21;
    const tFracs = new Float64Array(count);
    for (let i = 0; i < count; i++) tFracs[i] = i / (count - 1);
    const lut = buildRowLut(tFracs, count, size, 0.1);

    const expected = [];
    for (let i = 0; i < size; i++) {
      const t = i / (size - 1);
      let best = 0;
      for (let row = 1; row < count; row++) {
        if (Math.abs(tFracs[row] - t) < Math.abs(tFracs[best] - t)) best = row;
      }
      expected.push(best);
    }
    expect([...lut]).toEqual(expected);
    expect(lut[20]).toBe(count - 1);
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
  it("ramps monochrome by shade alone, ignoring level", () => {
    const lut = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: false,
    });
    const darkest = lut[0 * SHADE_LEVELS + 0];
    const brightest = lut[0 * SHADE_LEVELS + (SHADE_LEVELS - 1)];
    // Low end of the colormap is red, high end is blue.
    expect(darkest).toBe(packArgb(255, 0, 0, 255));
    expect(brightest).toBe(packArgb(0, 0, 255, 255));
    // Level does not move the colour.
    expect(lut[255 * SHADE_LEVELS + 0]).toBe(darkest);
    expect(lut[128 * SHADE_LEVELS + (SHADE_LEVELS - 1)]).toBe(brightest);
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

  it("is fully opaque everywhere", () => {
    const lut = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: true,
    });
    for (let i = 0; i < lut.length; i++) {
      expect(lut[i] >>> 24).toBe(255);
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

    // Level 0 sits exactly on the floor, which spectrogramColorFrac pins to the bottom of the ramp.
    expect(high[0 * SHADE_LEVELS + (SHADE_LEVELS - 1)]).toBe(packArgb(255, 0, 0, 255));
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
  { highlightRow = -1, columnStride = 1, heightGain = 1, elevationDeg = 60, azimuthDeg = 135 } = {}
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
 */
function columnsReaching(p, grid, wantRow, rowLut = defaultRowLut(grid)) {
  const lutLast = rowLut.length - 1;
  const cols = [];
  for (let x = 0; x < W; x++) {
    const span = columnFloorSpan(x, p, H);
    if (!span) continue;
    for (let s = 0; s <= span.steps; s++) {
      const u = span.u0 + span.du * s;
      const bucket = Math.round((u + 0.5) * lutLast);
      if (rowLut[bucket < 0 ? 0 : bucket > lutLast ? lutLast : bucket] === wantRow) {
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
  it("hides the far row in every column the tall near row reaches", () => {
    const grid = fakeGrid([0.05, 0.05, 0.05, 1]);
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

  // Every visible sample fills the wall down to the previous silhouette, so a column's painted
  // pixels are one unbroken run from the topmost sample to the floor's near edge -- including across
  // a capture gap, which is skipped rather than allowed to move the horizon. Anything that lets a
  // gap touch the horizon clips the following wall and tears a transparent stripe out of the middle
  // of the column.
  it("paints each column as one contiguous run", () => {
    const gapped = gapGrid();
    const scenes = [
      render(fakeGrid([0.2, 0.9, 0.3, 0.8, 0.1, 0.6]), { elevationDeg: 20 }),
      renderWith(gapped, gapRowLut(gapped), proj()),
    ];
    const holes = [];
    for (const [scene, out] of scenes.entries()) {
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
          if (out[y * W + x] === 0) holes.push({ scene, x, y });
        }
      }
    }
    expect(holes.slice(0, 5)).toEqual([]);
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
    const lutLast = rowLut.length - 1;
    const wrong = [];
    for (let x = 0; x < W; x++) {
      const span = columnFloorSpan(x, p, H);
      if (!span) continue;
      let minY = Infinity;
      for (let s = 0; s <= span.steps; s++) {
        const u = span.u0 + span.du * s;
        const v = span.v0 + span.dv * s;
        const bucket = Math.round((u + 0.5) * lutLast);
        const row = rowLut[bucket];
        if (row === NO_ROW) continue;
        const h =
          grid.heights[row * grid.pointCount + Math.round((v + 0.5) * (grid.pointCount - 1))];
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

  // The frequency index must be `(v + 0.5) * (pointCount - 1)`. With two points the boundary sits
  // exactly at v = 0, so scaling by `pointCount` instead moves it to v = -0.25 -- a quarter of the
  // floor -- and the top of the silhouette moves with it. The prediction comes from a brute-force
  // scan of the floor square through `projectPoint`'s own formula, not from the walk.
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
        const q = Math.round((v + 0.5) * (pointCount - 1));
        const y = projectPoint(u + 0.5, v + 0.5, grid.heights[q], p).y;
        if (y < predicted) predicted = y;
      }
    }
    expect(Math.abs(top - predicted)).toBeLessThanOrEqual(3);
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
