import { describe, expect, it } from "vitest";
import { SPECTROGRAM_DB_MAX, SPECTROGRAM_DB_MIN } from "../config/scales.js";
import { spectrogramColorFrac } from "../theme/spectrogramColormap.js";
import { buildProjection, projectPoint } from "./spectrogram3dProjection.js";
import {
  buildRowLut,
  buildSurfaceLut,
  columnFloorSpan,
  NO_ROW,
  packArgb,
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
  });

  // A mid-height level, away from both ends of the ramp, where a raised dbFloor sends the recovered
  // dB through spectrogramColorFrac to a colormap index that is NOT the same as the level itself.
  // The "keeps colour absolute" test above cannot catch a mutant that indexes the colormap by level
  // directly, skipping the dB round-trip: at dbFloor = SPECTROGRAM_DB_MIN the two happen to agree,
  // and the "raised floor" case only checks the top of the ramp, where they also agree (level 255
  // always maps to dB SPECTROGRAM_DB_MAX regardless of floor). This test picks a floor and a level
  // where they diverge, and pins the result to the same conversion buildStopColors uses, so the
  // production code and the assertion cannot silently drift together.
  it("converts level to dB before indexing the colormap, not level directly", () => {
    const dbFloor = -40;
    const colormapLut = testColormapLut();
    const lut = buildSurfaceLut({ colormapLut, dbFloor, colorize: true });
    const level = 128;

    const db = dbFloor + (level / 255) * (SPECTROGRAM_DB_MAX - dbFloor);
    const frac = spectrogramColorFrac(db, dbFloor);
    const idx = Math.round(frac * 255) * 3;
    // Sanity check that this level/floor pair actually exercises the divergence the test relies on.
    expect(idx).not.toBe(level * 3);

    const expected = packArgb(colormapLut[idx], colormapLut[idx + 1], colormapLut[idx + 2], 255);
    expect(lut[level * SHADE_LEVELS + (SHADE_LEVELS - 1)]).toBe(expected);
  });
});
