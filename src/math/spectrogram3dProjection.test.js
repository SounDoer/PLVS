import { describe, expect, it } from "vitest";
import {
  buildProjection,
  projectPoint,
  clampViewParams,
  labelEdges,
  unprojectFloor,
} from "./spectrogram3dProjection.js";

const VIEW = { width: 400, height: 300 };

describe("clampViewParams", () => {
  it("clamps elevation to a usable band", () => {
    expect(clampViewParams({ elevationDeg: 0 }).elevationDeg).toBe(5);
    expect(clampViewParams({ elevationDeg: 89 }).elevationDeg).toBe(85);
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

  // The default viewpoint puts frequency up the front-left floor edge, time up the front-right one,
  // and the newest frame at the near corner. Pin the whole arrangement rather than the angle, so a
  // future tweak is free to change the number as long as the layout survives.
  it("defaults to frequency front-left, time front-right, newest nearest", () => {
    const proj = buildProjection({ elevationDeg: 22, ...VIEW });
    const at = (t, f) => projectPoint(t, f, 0, proj);

    // Larger screen y is nearer, so the near corner is where both axes contribute their maximum.
    const nearT = proj.ty > 0 ? 1 : 0;
    const nearF = proj.fy > 0 ? 1 : 0;
    const near = at(nearT, nearF);

    // Walking away from the near corner along frequency goes left; along time, right.
    expect(at(nearT, 1 - nearF).x).toBeLessThan(near.x);
    expect(at(1 - nearT, nearF).x).toBeGreaterThan(near.x);

    // The newest frame is the one at the near corner, so it also paints last and lands on top.
    expect(nearT).toBe(1);
    expect(at(1, nearF).y).toBeGreaterThan(at(0, nearF).y);
    expect(proj.ridgeOrderAscending).toBe(true);
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

  // Asserting only that two azimuths disagree would pass with the comparison inverted, which is
  // exactly the bug this replaces. Check the order actually starts at the far end, everywhere.
  it("reports a draw order that starts from the far end at every azimuth", () => {
    for (let azimuthDeg = 5; azimuthDeg < 360; azimuthDeg += 5) {
      const proj = buildProjection({ azimuthDeg, elevationDeg: 25, ...VIEW });
      const oldest = projectPoint(0, 0.5, 0, proj);
      const newest = projectPoint(1, 0.5, 0, proj);
      // Larger screen y is nearer, so whichever end is drawn first must be the higher one.
      const firstDrawn = proj.ridgeOrderAscending ? oldest : newest;
      const lastDrawn = proj.ridgeOrderAscending ? newest : oldest;
      expect({ azimuthDeg, ok: firstDrawn.y <= lastDrawn.y }).toEqual({ azimuthDeg, ok: true });
    }
  });

  // Pointer handling depends on this being exact: a cursor is turned into a (time, frequency)
  // position by inverting the floor map, so any error lands straight in scrub and zoom.
  it("round-trips floor coordinates through projection and back at every azimuth", () => {
    for (let azimuthDeg = 5; azimuthDeg < 360; azimuthDeg += 15) {
      for (const elevationDeg of [5, 22, 70, 85]) {
        const proj = buildProjection({ azimuthDeg, elevationDeg, ...VIEW });
        for (const [t, f] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
          [0.3, 0.8],
        ]) {
          const p = projectPoint(t, f, 0, proj);
          const back = unprojectFloor(p.x, p.y, proj);
          expect(back.tFrac).toBeCloseTo(t, 9);
          expect(back.fFrac).toBeCloseTo(f, 9);
        }
      }
    }
  });

  it("clamps an unprojected cursor to the floor rather than extrapolating", () => {
    const proj = buildProjection({ elevationDeg: 70, ...VIEW });
    const far = unprojectFloor(-10000, -10000, proj);
    expect(far.tFrac).toBeGreaterThanOrEqual(0);
    expect(far.tFrac).toBeLessThanOrEqual(1);
    expect(far.fFrac).toBeGreaterThanOrEqual(0);
    expect(far.fFrac).toBeLessThanOrEqual(1);
  });

  // The user is free to rotate to any orientation, including the mirror of the default where time
  // and frequency swap sides. Labels must stay legible there too, so the chosen edge has to be the
  // nearer one at every angle -- not just at the handful we happened to look at.
  it("puts both axis labels on a front edge at every azimuth", () => {
    for (let azimuthDeg = 5; azimuthDeg < 360; azimuthDeg += 5) {
      const proj = buildProjection({ azimuthDeg, elevationDeg: 25, ...VIEW });
      const { timeAtF, freqAtT } = labelEdges(proj);

      // Compare each labelled edge against the opposite one; nearer means larger screen y.
      const timeEdgeY = projectPoint(0.5, timeAtF, 0, proj).y;
      const timeAwayY = projectPoint(0.5, 1 - timeAtF, 0, proj).y;
      const freqEdgeY = projectPoint(freqAtT, 0.5, 0, proj).y;
      const freqAwayY = projectPoint(1 - freqAtT, 0.5, 0, proj).y;

      expect({ azimuthDeg, time: timeEdgeY >= timeAwayY, freq: freqEdgeY >= freqAwayY }).toEqual({
        azimuthDeg,
        time: true,
        freq: true,
      });
    }
  });
});
