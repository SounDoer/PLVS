import { describe, expect, it } from "vitest";
import { buildProjection, projectPoint } from "./spectrogram3dProjection.js";
import { buildRowLut, columnFloorSpan, NO_ROW } from "./spectrogram3dSurface.js";

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
