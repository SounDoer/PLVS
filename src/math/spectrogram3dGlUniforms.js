/**
 * The uniform set the surface's vertex shader needs, plus a JS twin of the shader's arithmetic.
 *
 * The twin exists to be tested: a shader cannot be asserted in CI, so the arithmetic it performs is
 * written once here, pinned against `projectPoint`, and transcribed into GLSL in the renderer. If
 * the two ever disagree, the terrain slides off the floor grid, which is drawn from `proj` itself.
 */
export function buildGlUniforms({ proj, width, height, heightGain }) {
  // Floor corners, height excluded: the depth range is exactly what the floor spans on screen.
  let minFloorY = Infinity;
  let maxFloorY = -Infinity;
  for (const t of [0, 1]) {
    for (const f of [0, 1]) {
      const y = proj.originY + (t - 0.5) * proj.ty + (f - 0.5) * proj.fy;
      if (y < minFloorY) minFloorY = y;
      if (y > maxFloorY) maxFloorY = y;
    }
  }
  // Screen pixels per unit of floor distance along the view ray -- the column the old rasteriser
  // walked. It stepped one pixel row at a time and divided the height delta by the floor distance
  // that step covered, so shading described the terrain rather than the panel's resolution; the
  // shader measures the same delta per pixel with `dFdy`, so it needs the same conversion. The
  // determinant is the screen-y rate per unit of the column's line parameter and `(-fx, tx)` is the
  // column's direction in floor units, which is exactly `columnFloorSpan`'s arithmetic.
  const det = proj.tx * proj.fy - proj.ty * proj.fx;
  const columnFloorLen = Math.hypot(proj.tx, proj.fx);

  return {
    origin: [proj.originX, proj.originY],
    tAxis: [proj.tx, proj.ty],
    fAxis: [proj.fx, proj.fy],
    hy: proj.hy * heightGain,
    viewport: [width, height],
    depthRange: [minFloorY, Math.max(maxFloorY, minFloorY + 1e-6)],
    slopeGain: columnFloorLen > 0 ? det / columnFloorLen : 0,
  };
}

/** What the vertex shader computes. Kept in JS so the test above can hold it to `projectPoint`. */
export function projectWithUniforms(tFrac, fFrac, height, u) {
  const t = tFrac - 0.5;
  const f = fFrac - 0.5;
  const px = u.origin[0] + t * u.tAxis[0] + f * u.fAxis[0];
  const floorY = u.origin[1] + t * u.tAxis[1] + f * u.fAxis[1];
  const py = floorY + height * u.hy;
  const [minY, maxY] = u.depthRange;
  return {
    x: (px / u.viewport[0]) * 2 - 1,
    y: 1 - (py / u.viewport[1]) * 2,
    // Nearer floor points sit lower on screen, so a larger floorY must come out in front.
    z: 1 - 2 * ((floorY - minY) / (maxY - minY)),
  };
}
