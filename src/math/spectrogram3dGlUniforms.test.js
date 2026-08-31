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
