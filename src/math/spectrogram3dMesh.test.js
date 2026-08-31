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

describe("buildSurfaceMesh triangles", () => {
  it("joins each pair of neighbouring rows with two triangles per cell", () => {
    const mesh = buildSurfaceMesh(grid(), { rowGapTFrac: 2 });
    // One row pair, two cells across the frequency axis, two triangles each.
    expect(mesh.indices.length).toBe(2 * 2 * 3);
    expect(Array.from(mesh.indices.subarray(0, 6))).toEqual([0, 1, 3, 1, 4, 3]);
  });

  it("leaves a hole where two rows are further apart than the stride", () => {
    const gapped = {
      heights: Float32Array.from([0.25, 0.5, 0.75, 0.5, 0.25, 0.875, 0.5, 0.5, 0.5]),
      tFracs: Float64Array.from([0, 0.1, 0.9]),
      count: 3,
      bucketCount: 3,
      pointCount: 3,
    };
    // Rows 0-1 are one stride apart and join; rows 1-2 are eight strides apart and must not.
    const mesh = buildSurfaceMesh(gapped, { rowGapTFrac: 0.2 });
    expect(mesh.indices.length).toBe(2 * 2 * 3);
  });
});

describe("buildSurfaceMesh skirt", () => {
  it("closes the solid with a skirt down to the floor along every boundary", () => {
    const mesh = buildSurfaceMesh(grid(), { rowGapTFrac: 2, skirt: true });
    // Six terrain vertices, plus one floor vertex under each of them on the boundary. With two rows
    // of three points every sample is on the boundary.
    expect(mesh.vertexCount).toBe(12);
    const skirtStart = 6 * 3;
    // A skirt vertex sits under its terrain vertex, at height zero.
    expect(Array.from(mesh.positions.subarray(skirtStart, skirtStart + 3))).toEqual([0, 0, 0]);
    // Two triangles per boundary edge, on top of the four terrain triangles.
    expect(mesh.triangleCount).toBeGreaterThan(4);
  });
});
