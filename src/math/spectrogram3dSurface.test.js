import { describe, expect, it } from "vitest";
import { buildProjection, projectPoint } from "./spectrogram3dProjection.js";
import { columnFloorSpan } from "./spectrogram3dSurface.js";

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
