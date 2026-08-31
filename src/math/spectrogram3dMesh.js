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
export function buildSurfaceMesh(grid, { rowGapTFrac, skirt = false }) {
  const { heights, tFracs, count, pointCount } = grid;
  const boundary = skirt ? boundaryCycle(count, pointCount) : null;
  const terrainCount = count * pointCount;
  const skirtCount = boundary ? boundary.length : 0;
  const positions = new Float32Array((terrainCount + skirtCount) * 3);
  for (let r = 0; r < count; r += 1) {
    const t = tFracs[r];
    for (let q = 0; q < pointCount; q += 1) {
      const at = (r * pointCount + q) * 3;
      positions[at] = t;
      positions[at + 1] = pointCount > 1 ? q / (pointCount - 1) : 0;
      positions[at + 2] = heights[r * pointCount + q];
    }
  }
  // One floor copy per boundary sample, directly under it. Height zero puts it on the floor plane,
  // which is where the old rasteriser's extrusion ended too.
  for (let i = 0; i < skirtCount; i += 1) {
    const from = boundary[i] * 3;
    const at = (terrainCount + i) * 3;
    positions[at] = positions[from];
    positions[at + 1] = positions[from + 1];
    positions[at + 2] = 0;
  }

  // Worst case: every row pair joins. Trimmed with subarray so a gap does not leave stale indices
  // behind for the draw call to read.
  const indices = new Uint32Array(
    Math.max(0, count - 1) * Math.max(0, pointCount - 1) * 6 + skirtCount * 6
  );
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

  // The skirt walks the boundary as one closed cycle, so consecutive entries are always an edge of
  // the terrain and every quad joins that edge to its floor copy. A cycle edge that spans a capture
  // gap is dropped for the same reason the terrain quad above it is: there is no terrain there to
  // close, and the wall would stand across the silence.
  for (let i = 0; i < skirtCount; i += 1) {
    const a = boundary[i];
    const b = boundary[(i + 1) % skirtCount];
    if (
      Math.abs(tFracs[Math.floor(b / pointCount)] - tFracs[Math.floor(a / pointCount)]) >
      rowGapTFrac
    ) {
      continue;
    }
    const aFloor = terrainCount + i;
    const bFloor = terrainCount + ((i + 1) % skirtCount);
    indices[at++] = a;
    indices[at++] = b;
    indices[at++] = aFloor;
    indices[at++] = b;
    indices[at++] = bFloor;
    indices[at++] = aFloor;
  }

  return {
    positions,
    vertexCount: terrainCount + skirtCount,
    indices: indices.subarray(0, at),
    triangleCount: at / 3,
  };
}

/**
 * The boundary of the grid as one closed cycle of vertex indices, each sample visited once.
 *
 * One cycle rather than four independent edges: the skirt's quads are then just consecutive pairs,
 * corners included, with nothing to special-case at the turns. A grid thinner than a cell in either
 * direction has no interior and no boundary worth walling, so it gets no skirt.
 */
function boundaryCycle(count, pointCount) {
  if (count < 2 || pointCount < 2) return null;
  const cycle = [];
  for (let r = 0; r < count; r += 1) cycle.push(r * pointCount);
  for (let q = 1; q < pointCount; q += 1) cycle.push((count - 1) * pointCount + q);
  for (let r = count - 2; r >= 0; r -= 1) cycle.push(r * pointCount + pointCount - 1);
  for (let q = pointCount - 2; q >= 1; q -= 1) cycle.push(q);
  return cycle;
}
