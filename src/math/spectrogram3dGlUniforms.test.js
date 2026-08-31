import { describe, expect, it } from "vitest";

import { buildProjection, projectPoint } from "./spectrogram3dProjection.js";
import { buildGlUniforms, projectWithUniforms } from "./spectrogram3dGlUniforms.js";

describe("buildGlUniforms", () => {
  it("places a vertex where projectPoint does, in clip space", () => {
    const width = 800;
    const height = 400;
    const proj = buildProjection({ azimuthDeg: 135, elevationDeg: 40, width, height });
    const uniforms = buildGlUniforms({ proj, width, height, heightGain: 1 });
    for (const [t, f, h] of [
      [0, 0, 0],
      [1, 0, 0.5],
      [0.5, 1, 0.875],
    ]) {
      const expected = projectPoint(t, f, h, proj);
      const clip = projectWithUniforms(t, f, h, uniforms);
      expect(((clip.x + 1) / 2) * width).toBeCloseTo(expected.x, 4);
      expect(((1 - clip.y) / 2) * height).toBeCloseTo(expected.y, 4);
    }
  });

  it("scales slope by the floor distance one screen pixel covers", () => {
    const proj = buildProjection({ azimuthDeg: 135, elevationDeg: 40, width: 800, height: 400 });
    const { slopeGain } = buildGlUniforms({ proj, width: 800, height: 400, heightGain: 1 });
    // Same quantity `columnFloorSpan` derives: screen-y per unit of the column's parameter, over
    // the column direction's length in floor units.
    const det = proj.tx * proj.fy - proj.ty * proj.fx;
    expect(slopeGain).toBeCloseTo(det / Math.hypot(proj.tx, proj.fx), 9);
    // The column runs DOWN the screen, so only the vertical fit moves this: a taller panel puts
    // more pixels across the same floor, one pixel then covers less of it, and the gain rises to
    // keep the same terrain shading the same. A wider panel leaves it alone.
    const tall = buildProjection({ azimuthDeg: 135, elevationDeg: 40, width: 800, height: 800 });
    expect(
      buildGlUniforms({ proj: tall, width: 800, height: 800, heightGain: 1 }).slopeGain
    ).toBeGreaterThan(slopeGain);
    const wide = buildProjection({ azimuthDeg: 135, elevationDeg: 40, width: 1600, height: 400 });
    expect(
      buildGlUniforms({ proj: wide, width: 1600, height: 400, heightGain: 1 }).slopeGain
    ).toBeCloseTo(slopeGain, 9);
  });

  it("puts nearer floor points in front", () => {
    const proj = buildProjection({ azimuthDeg: 135, elevationDeg: 40, width: 800, height: 400 });
    const uniforms = buildGlUniforms({ proj, width: 800, height: 400, heightGain: 1 });
    // Which corner is nearest follows the azimuth: at 135 degrees `ty > 0` and `fy < 0`, so the
    // near corner is (t = 1, f = 0). The other diagonal, (1, 1) and (0, 0), are the two SIDE
    // corners and sit at exactly the same depth -- `ty + fy` is zero at this azimuth.
    const near = projectWithUniforms(1, 0, 0, uniforms);
    const far = projectWithUniforms(0, 1, 0, uniforms);
    expect(near.z).toBeLessThan(far.z);
    // Height must not tilt depth: a peak belongs at its own row's distance, which is what replaces
    // the old horizon walk.
    expect(projectWithUniforms(1, 0, 0.875, uniforms).z).toBe(near.z);
  });
});
