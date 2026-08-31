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
export function buildSurfaceMesh(grid, { rowGapTFrac }) {
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
  // Worst case: every row pair joins. Trimmed with subarray so a gap does not leave stale indices
  // behind for the draw call to read.
  const indices = new Uint32Array(Math.max(0, count - 1) * Math.max(0, pointCount - 1) * 6);
  let at = 0;
  for (let r = 0; r + 1 < count; r += 1) {
    // A gap is a stretch of time holding no frames. Joining across it would smear one frame's
    // spectrum over the silence, which is what the old walk avoided by holding its horizon.
    if (tFracs[r + 1] - tFracs[r] > rowGapTFrac) continue;
    const base = r * pointCount;
    const next = base + pointCount;
    for (let q = 0; q + 1 < pointCount; q += 1) {
      indices[at++] = base + q;
      indices[at++] = base + q + 1;
      indices[at++] = next + q;
      indices[at++] = base + q + 1;
      indices[at++] = next + q + 1;
      indices[at++] = next + q;
    }
  }

  return {
    positions,
    vertexCount: count * pointCount,
    indices: indices.subarray(0, at),
    triangleCount: at / 3,
  };
}
