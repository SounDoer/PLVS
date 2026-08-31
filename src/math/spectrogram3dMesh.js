/**
 * Turns a waterfall grid into the buffers WebGL draws.
 *
 * Pure, and deliberately so: this is the half of the old per-pixel rasteriser that is worth
 * asserting, and keeping it out of the shaders is what lets CI keep seeing it. The shader gets
 * geometry and uniforms; every decision about WHICH geometry exists is made here.
 *
 * A vertex is `(tFrac, fFrac, height)` on the unit square. The projection is a uniform, so the same
 * buffer survives a rotation without being rebuilt.
 */
export function buildSurfaceMesh(grid) {
  const { heights, tFracs, count, pointCount } = grid;
  const positions = new Float32Array(count * pointCount * 3);
  for (let r = 0; r < count; r += 1) {
    const t = tFracs[r];
    for (let q = 0; q < pointCount; q += 1) {
      const at = (r * pointCount + q) * 3;
      positions[at] = t;
      positions[at + 1] = pointCount > 1 ? q / (pointCount - 1) : 0;
      positions[at + 2] = heights[r * pointCount + q];
    }
  }
  return { positions, vertexCount: count * pointCount };
}
