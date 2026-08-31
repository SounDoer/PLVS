import { describe, expect, it } from "vitest";

import { buildSurfaceMesh } from "./spectrogram3dMesh.js";

/** Two rows of three points, heights chosen so Float32 holds them exactly. */
function grid() {
  return {
    heights: Float32Array.from([0.25, 0.5, 0.75, 0.5, 0.25, 0.875]),
    tFracs: Float64Array.from([0, 1]),
    count: 2,
    bucketCount: 2,
    pointCount: 3,
  };
}

describe("buildSurfaceMesh", () => {
  it("emits one vertex per grid sample, carrying its own place on the unit square", () => {
    const mesh = buildSurfaceMesh(grid(), { rowGapTFrac: 2 });
    expect(mesh.vertexCount).toBe(6);
    // (tFrac, fFrac, height) per vertex, in row-major order.
    expect(Array.from(mesh.positions.subarray(0, 9))).toEqual([
      0, 0, 0.25, 0, 0.5, 0.5, 0, 1, 0.75,
    ]);
    expect(Array.from(mesh.positions.subarray(9, 18))).toEqual([
      1, 0, 0.5, 1, 0.5, 0.25, 1, 1, 0.875,
    ]);
  });
});
