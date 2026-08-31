# Spectrogram 3D Surface on WebGL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the Spectrogram's 3D Surface mode as a WebGL2 triangle mesh so the terrain stops
boiling as the window advances, without moving any testable logic out of JavaScript.

**Architecture:** The grid, both smoothers, the projection and the colour table stay where they are.
Two new pure modules turn a grid into vertex/index buffers and into a uniform set; a renderer module
owns the GL context; the panel gains a second canvas. `rasterizeSurface` and its walk are deleted at
the end, once the replacement is proven.

**Tech stack:** WebGL2 (ANGLE/D3D11 under WebView2), Vitest, React 19.

**Spec:** [2026-08-31-spectrogram-3d-webgl-design.md](../specs/2026-08-31-spectrogram-3d-webgl-design.md).
Read its Non-Goals before deviating. Acceptance is a revert criterion, not a tuning target.

---

## Conventions used by every task

- Run one test file with `npx vitest run <path>`; run everything with `npm test`.
- `npm run check` before every commit that touches `src/`.
- Comments and commit messages in English (`AGENTS.md`).
- Fixtures use values Float32 holds exactly (0.25, 0.5, 0.875) or `Math.fround` — see the Known
  pitfalls section of `AGENTS.md`.

Shared vocabulary, matching the existing code:

- `grid` is `{ heights: Float32Array, tFracs: Float64Array, count, bucketCount, pointCount }` from
  `sampleWaterfallGrid`. `heights[r * pointCount + q]` is row `r`, frequency point `q`, in 0..1.
- `proj` is from `buildProjection`. A point is placed by
  `x = originX + (t - 0.5) * tx + (f - 0.5) * fx` and
  `y = originY + (t - 0.5) * ty + (f - 0.5) * fy + h * hy`.

---

### Task 1: Mesh vertices

**Files:**

- Create: `src/math/spectrogram3dMesh.js`
- Test: `src/math/spectrogram3dMesh.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/math/spectrogram3dMesh.test.js`
Expected: FAIL, `Failed to resolve import "./spectrogram3dMesh.js"`.

- [ ] **Step 3: Write the minimal implementation**

```js
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
  return { positions, vertexCount: count * pointCount };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/math/spectrogram3dMesh.test.js`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dMesh.js src/math/spectrogram3dMesh.test.js
git commit -m "feat(spectrogram): build surface mesh vertices from a waterfall grid"
```

---

### Task 2: Triangles, and the holes a capture gap leaves

**Files:**

- Modify: `src/math/spectrogram3dMesh.js`
- Test: `src/math/spectrogram3dMesh.test.js`

The old rasteriser left a gap unpainted by leaving the horizon alone across it (`NO_ROW`). The mesh
equivalent is to not emit the quad: two rows further apart in time than the decimation stride are not
neighbours, and joining them would stretch one frame's spectrum across a silence.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/math/spectrogram3dMesh.test.js`
Expected: FAIL, `Cannot read properties of undefined (reading 'length')` — there are no indices yet.

- [ ] **Step 3: Implement**

Add to `buildSurfaceMesh`, before the `return`:

```js
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
```

and return `indices: indices.subarray(0, at), triangleCount: at / 3` alongside the existing fields.

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/math/spectrogram3dMesh.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dMesh.js src/math/spectrogram3dMesh.test.js
git commit -m "feat(spectrogram): triangulate the surface mesh, leaving capture gaps open"
```

---

### Task 3: The skirt that makes it a solid

**Files:**

- Modify: `src/math/spectrogram3dMesh.js`
- Test: `src/math/spectrogram3dMesh.test.js`

Without it the terrain is a sheet: at a low elevation you see under its edges, and the depth buffer
happily shows the floor grid through the front face. The old rasteriser got this by extruding each
sample down to the floor.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/math/spectrogram3dMesh.test.js`
Expected: FAIL, `expected 6 to be 12`.

- [ ] **Step 3: Implement**

In `buildSurfaceMesh`, take `skirt = false` in the options, and when it is set: after the terrain
vertices, append one vertex per boundary sample with the same `(tFrac, fFrac)` and height `0`, then
emit two triangles per boundary edge joining the terrain edge to its floor copy. Walk the boundary
in one order (`f = 0` row, last `t` row, `f = last` row reversed, first `t` row reversed) so the
skirt's winding matches the terrain's.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/math/spectrogram3dMesh.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dMesh.js src/math/spectrogram3dMesh.test.js
git commit -m "feat(spectrogram): close the surface mesh with a floor skirt"
```

---

### Task 4: Uniforms, and the projection they have to agree with

**Files:**

- Create: `src/math/spectrogram3dGlUniforms.js`
- Test: `src/math/spectrogram3dGlUniforms.test.js`

The shader must land a vertex exactly where `projectPoint` would, or the terrain will not sit on the
floor grid. That correspondence is the assertion.

Depth: this projection is axonometric, so a floor point's screen `y` is monotone in distance from the
viewer — nearer is lower on screen. Depth therefore comes from the floor `y` of the vertex (its
height excluded), normalised over the floor's own span. No camera matrix is needed.

- [ ] **Step 1: Write the failing test**

```js
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
    const near = projectWithUniforms(1, 1, 0, uniforms);
    const far = projectWithUniforms(0, 0, 0, uniforms);
    expect(near.z).toBeLessThan(far.z);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/math/spectrogram3dGlUniforms.test.js`
Expected: FAIL, `Failed to resolve import "./spectrogram3dGlUniforms.js"`.

- [ ] **Step 3: Implement**

```js
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
  return {
    origin: [proj.originX, proj.originY],
    tAxis: [proj.tx, proj.ty],
    fAxis: [proj.fx, proj.fy],
    hy: proj.hy * heightGain,
    viewport: [width, height],
    depthRange: [minFloorY, Math.max(maxFloorY, minFloorY + 1e-6)],
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
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/math/spectrogram3dGlUniforms.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dGlUniforms.js src/math/spectrogram3dGlUniforms.test.js
git commit -m "feat(spectrogram): pin the surface shader's arithmetic to projectPoint"
```

---

### Task 5: The renderer

**Files:**

- Create: `src/hooks/spectrogram3dGlRenderer.js`

No CI test: this needs a GL context, which jsdom does not have. Everything it consumes is asserted
in Tasks 1–4; keep this file to context handling, buffer upload and draw calls, and put nothing in it
that could have been a pure function.

- [ ] **Step 1: Write the renderer**

Exports `createSurfaceRenderer(canvas)` returning `{ draw, resize, dispose, state }` where `state` is
`"ok" | "lost" | "dead"`. The vertex shader transcribes `projectWithUniforms` exactly:

```glsl
#version 300 es
in vec3 vertex;            // tFrac, fFrac, height
uniform vec2 origin;
uniform vec2 tAxis;
uniform vec2 fAxis;
uniform float hy;
uniform vec2 viewport;
uniform vec2 depthRange;
out float height;
void main() {
  float t = vertex.x - 0.5;
  float f = vertex.y - 0.5;
  height = vertex.z;
  float px = origin.x + t * tAxis.x + f * fAxis.x;
  float floorY = origin.y + t * tAxis.y + f * fAxis.y;
  float py = floorY + vertex.z * hy;
  float z = 1.0 - 2.0 * ((floorY - depthRange.x) / (depthRange.y - depthRange.x));
  gl_Position = vec4((px / viewport.x) * 2.0 - 1.0, 1.0 - (py / viewport.y) * 2.0, z, 1.0);
}
```

The fragment shader shades from the screen-space gradient of the interpolated height — the same
headlight model as `slopeShade`, measured on the surface rather than on point samples, which is the
change that is supposed to stop the boiling:

```glsl
#version 300 es
precision highp float;
in float height;
uniform sampler2D lut;     // 256 x 64, level on x, shade on y
uniform float slopeGain;
out vec4 colour;
void main() {
  float slope = length(vec2(dFdx(height), dFdy(height))) * sign(dFdy(height)) * slopeGain;
  float shade = 0.5 + 0.5 * (slope / (1.0 + abs(slope)));
  colour = texture(lut, vec2(height, shade));
}
```

Context loss is handled here and nowhere else: `webglcontextlost` calls `preventDefault()` and sets
`state = "lost"`; `webglcontextrestored` rebuilds and sets `"ok"`; a second failed restore sets
`"dead"` permanently. Per the spec, `"dead"` does not change the panel's mode.

- [ ] **Step 2: Verify by hand in the real window**

```
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run desktop
```

Expected: Surface mode draws terrain over the floor grid, shaded, at every azimuth.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/spectrogram3dGlRenderer.js
git commit -m "feat(spectrogram): render the 3D surface with WebGL2"
```

---

### Task 6: Wire the panel

**Files:**

- Modify: `src/components/panels/SpectrogramPanel.jsx`
- Modify: `src/hooks/useSpectrogram3dCanvas.js`
- Test: `src/components/panels/SpectrogramPanel.test.jsx`

- [ ] **Step 1: Write the failing test**

```js
it("gives Surface mode its own GL canvas and keeps the 2D one for the other modes", () => {
  const { container, rerender } = render(<SpectrogramPanel {...props} spectrogramMode="lines" />);
  expect(container.querySelector("[data-spectrogram-gl]")).toBeNull();
  rerender(<SpectrogramPanel {...props} spectrogramMode="surface" />);
  expect(container.querySelector("[data-spectrogram-gl]")).not.toBeNull();
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx`
Expected: FAIL, `expected null not to be null`.

- [ ] **Step 3: Implement**

Add the GL canvas and the transparent label overlay described in the spec's Compositing section, both
`pointer-events: none`, both sized by the existing `useCanvasSize` measurement. In
`useSpectrogram3dCanvas`, the `surface` branch stops calling `rasterizeSurface` and instead builds the
mesh (Task 1–3) and the uniforms (Task 4) and hands them to the renderer (Task 5). The `lines` branch
is untouched. Axis labels and the floor grid move to their new homes: labels to the overlay canvas,
floor grid into the GL draw.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/SpectrogramPanel.jsx src/hooks/useSpectrogram3dCanvas.js src/components/panels/SpectrogramPanel.test.jsx
git commit -m "feat(spectrogram): draw Surface mode through the GL renderer"
```

---

### Task 7: Measure against the acceptance table before deleting anything

**Files:** none — this is the gate.

- [ ] **Step 1: Fill the window with real audio**

Start capture on VB-Cable with a player running, Spectrogram fullscreen, Surface mode, and wait for
the terrain coverage to reach ~37%, the figure every earlier reading was taken at.

- [ ] **Step 2: Measure**

Run the per-update shimmer probe and the panel CPU counter, then
`node scripts/webview-gpu-usage.mjs --seconds 10 --label "surface gl"`, and repeat the CPU reading
under `--disable-gpu`.

- [ ] **Step 3: Compare, and decide**

|                                    | Before |   Target |
| ---------------------------------- | -----: | -------: |
| Silhouette columns popping >= 1 px | 47–48% |    < 15% |
| Main thread per repaint            | 7.5 ms |  <= 4 ms |
| Same, `--disable-gpu`              | 7.3 ms | <= 20 ms |

**If the popping target is missed, stop and revert the branch.** The cost was never the problem; a
GL renderer that boils has bought nothing and costs a second rendering stack forever.

- [ ] **Step 4: Record the numbers**

Append the readings to `docs/working/perf/spectrogram.md` §1, in the same table shape as the earlier
entries, and commit.

---

### Task 8: Delete the CPU rasteriser

Only after Task 7 passes.

**Files:**

- Modify: `src/math/spectrogram3dSurface.js`
- Modify: `src/math/spectrogram3dSurface.test.js`
- Modify: `scripts/spectrogram-surface-benchmark.mjs`

- [ ] **Step 1: Move the invariants worth keeping**

`rasterizeSurface`'s tests go with it, but three of its assertions are about the terrain rather than
about pixels and belong on the mesh: a capture gap contributes no geometry, the pinned live row is
present, and the edge fades sink the terrain at the window edges. Rewrite those three against
`buildSurfaceMesh` in `src/math/spectrogram3dMesh.test.js` first, and watch them pass.

- [ ] **Step 2: Delete**

Remove `rasterizeSurface`, `columnFloorSpan`, `buildRowLut`, `slopeShade`, `edgeFade`,
`SHADE_LEVELS`'s rasteriser-side use, and every test that covers only them. Keep `buildSurfaceLut`
(it builds the LUT texture now) and both smoothers. Delete
`scripts/spectrogram-surface-benchmark.mjs`, which benchmarks a walk that no longer exists.

- [ ] **Step 3: Run everything**

Run: `npm run check`
Expected: PASS, with a smaller test count.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(spectrogram): delete the CPU surface rasteriser"
```

---

### Task 9: The visual checklist

**Files:** none — this is the merge gate the spec promised, and it needs a human.

- [ ] Rotate through azimuth 0 / 90 / 135 / 270 at elevation 5 / 30 / 60.
- [ ] A capture gap mid-window leaves a hole, not a smear.
- [ ] The scrub marker reads at the same weight as in Lines.
- [ ] Colorize on and off.
- [ ] A theme switch while running rebuilds the LUT texture.
- [ ] A window resize while running.
- [ ] `--disable-gpu`: it still draws, slower.
- [ ] Kill the GPU process (Task Manager) with the panel open: the panel goes dark with an error and
      the Mode control stays on Surface.
