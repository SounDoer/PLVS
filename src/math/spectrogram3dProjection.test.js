import { describe, expect, it } from "vitest";
import { buildProjection, projectPoint, clampViewParams } from "./spectrogram3dProjection.js";

const VIEW = { width: 400, height: 300 };

describe("clampViewParams", () => {
  it("clamps elevation to a usable band", () => {
    expect(clampViewParams({ elevationDeg: 0 }).elevationDeg).toBe(5);
    expect(clampViewParams({ elevationDeg: 89 }).elevationDeg).toBe(70);
    expect(clampViewParams({ elevationDeg: 30 }).elevationDeg).toBe(30);
  });

  it("wraps azimuth instead of clamping it", () => {
    expect(clampViewParams({ azimuthDeg: 370 }).azimuthDeg).toBe(10);
    expect(clampViewParams({ azimuthDeg: -10 }).azimuthDeg).toBe(350);
    expect(clampViewParams({ azimuthDeg: 720 }).azimuthDeg).toBe(0);
  });

  it("clamps height gain and falls back on non-numbers", () => {
    expect(clampViewParams({ heightGain: 0.1 }).heightGain).toBe(0.3);
    expect(clampViewParams({ heightGain: 9 }).heightGain).toBe(3);
    expect(clampViewParams({ heightGain: Number.NaN }).heightGain).toBe(1);
  });
});

describe("projectPoint", () => {
  it("moves the time axis horizontally only at azimuth 0", () => {
    const proj = buildProjection({ azimuthDeg: 0, elevationDeg: 30, ...VIEW });
    const a = projectPoint(0, 0.5, 0, proj);
    const b = projectPoint(1, 0.5, 0, proj);
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(b.x).toBeGreaterThan(a.x);
  });

  it("keeps the height axis vertical at every azimuth", () => {
    for (const azimuthDeg of [0, 37, 90, 180, 271]) {
      const proj = buildProjection({ azimuthDeg, elevationDeg: 25, ...VIEW });
      const base = projectPoint(0.5, 0.5, 0, proj);
      const top = projectPoint(0.5, 0.5, 1, proj);
      expect(top.x).toBeCloseTo(base.x, 6);
      expect(top.y).toBeLessThan(base.y);
    }
  });

  // This is the invariant the shared Colorize gradient depends on: dB maps to vertical
  // displacement from the baseline by one scene-wide constant, with no depth foreshortening.
  it("applies one scene-wide height scale regardless of position", () => {
    const proj = buildProjection({ azimuthDeg: 40, elevationDeg: 25, ...VIEW });
    const near = projectPoint(0, 0, 0, proj).y - projectPoint(0, 0, 1, proj).y;
    const far = projectPoint(1, 1, 0, proj).y - projectPoint(1, 1, 1, proj).y;
    expect(far).toBeCloseTo(near, 6);
    expect(near).toBeCloseTo(proj.heightScale, 6);
  });

  // Every ridge baseline is parallel because the projection is affine. The Colorize ramp relies on
  // this: its axis is the baseline's perpendicular, derived once from (fx, fy) and reused for every
  // ridge, which is only valid while all baselines share a direction.
  it("gives every ridge baseline the same slope", () => {
    const proj = buildProjection({ azimuthDeg: 40, elevationDeg: 25, ...VIEW });
    const slopeAt = (tFrac) => {
      const a = projectPoint(tFrac, 0, 0, proj);
      const b = projectPoint(tFrac, 1, 0, proj);
      return (b.y - a.y) / (b.x - a.x);
    };
    expect(slopeAt(0.9)).toBeCloseTo(slopeAt(0.1), 6);
    expect(slopeAt(0.5)).toBeCloseTo(proj.fy / proj.fx, 6);
  });

  it("fits the whole unit cube inside the canvas", () => {
    const proj = buildProjection({ azimuthDeg: 33, elevationDeg: 40, ...VIEW });
    for (const t of [0, 1]) {
      for (const f of [0, 1]) {
        for (const h of [0, 1]) {
          const p = projectPoint(t, f, h, proj);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(VIEW.width);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(VIEW.height);
        }
      }
    }
  });

  it("draws oldest-first while time recedes from the viewer", () => {
    const away = buildProjection({ azimuthDeg: 200, elevationDeg: 25, ...VIEW });
    const toward = buildProjection({ azimuthDeg: 20, elevationDeg: 25, ...VIEW });
    expect(away.ridgeOrderAscending).not.toBe(toward.ridgeOrderAscending);
  });
});
