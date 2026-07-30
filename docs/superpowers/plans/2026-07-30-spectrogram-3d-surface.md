# Spectrogram 3D Surface Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third Spectrogram view mode — a shaded solid surface rendered per pixel with exact hidden-surface removal — and replace the boolean 3D toggle with a three-way Mode dropdown.

**Architecture:** A new pure module `src/math/spectrogram3dSurface.js` rasterises the existing waterfall grid column by column using a front-to-back floating-horizon walk, writing ARGB words into a caller-supplied `Uint32Array`. `useSpectrogram3dCanvas.js` gains a mode branch that runs that rasteriser into a reused offscreen canvas and composites it with `drawImage`. The projection and grid modules are not modified.

**Tech Stack:** React 19, Canvas 2D, `ImageData` + `Uint32Array` views, Vitest, Node ESM benchmark script.

**Read first:** `docs/superpowers/specs/2026-07-30-spectrogram-3d-surface-design.md` and the design it builds on, `docs/superpowers/specs/2026-07-28-spectrogram-3d-view-design.md`.

---

## Orientation for someone new to this code

Five facts that will otherwise cost you a debugging session each:

1. **The canvas coordinate system is device pixels, not CSS pixels.** `useCanvasSize` sizes it that way. Anything measured in CSS pixels (`ctx.font`, `ctx.lineWidth`, pointer event coordinates) must be converted. The ratio is derived from the canvas's own dimensions (`W / canvas.clientWidth`), never from `window.devicePixelRatio` — see the note in `AGENTS.md`.
2. **`putImageData` overwrites, including alpha. `drawImage` blends.** This is why the surface goes through an offscreen canvas.
3. **`sampleWaterfallGrid` returns rows at irregular `tFracs`.** Each row is a real captured frame at its own timestamp. There is no fixed row spacing, and this is deliberate — read the header comment in `src/math/spectrogram3dGrid.js` before assuming otherwise.
4. **`heights` in that grid are floor-relative** (0 at `dbFloor`, 1 at `SPECTROGRAM_DB_MAX`), while **colour must be absolute**. The conversion — recover the dB a height fraction represents, then run it through `spectrogramColorFrac` — belongs in the colour LUT, exactly as `buildStopColors` already does it for the Lines renderer.
5. **Vitest collects every `*.test.js` in the repo, including `scripts/`.** A failing test in `scripts/` is usually a Tauri-config or installer problem, not a frontend one. You will not touch those here, but do not be confused if one shows up.

## File structure

| File | Responsibility |
|---|---|
| `src/math/spectrogram3dSurface.js` | **Create.** Pure. Column/floor-line clipping, the row lookup table, the colour LUT, and the floating-horizon rasteriser. All of the testable logic. |
| `src/math/spectrogram3dSurface.test.js` | **Create.** Tests for the above. |
| `scripts/spectrogram-surface-benchmark.mjs` | **Create.** Node benchmark of the rasteriser at real panel sizes. Decides the default column stride. |
| `src/hooks/useSpectrogram3dCanvas.js` | **Modify.** Mode branch; offscreen canvas lifecycle; compositing. |
| `src/lib/panelControls.js` | **Modify.** `SPECTROGRAM_MODE_OPTIONS`, `spectrogramMode` + normalizer; delete `spectrogram3d`. |
| `src/lib/panelControls.test.js` | **Modify.** Normalizer coverage. |
| `src/components/panels/chartHelp.js` | **Modify.** Three-way predicate. |
| `src/components/panels/chartHelp.test.js` | **Modify.** Coverage for all three modes. |
| `src/components/panels/SpectrogramPanel.jsx` | **Modify.** Derive `is3d` from the mode; pass the mode to the renderer. |
| `src/components/panels/SpectrogramPanel.test.jsx` | **Modify.** Replace `spectrogram3d: true` with `spectrogramMode: "lines"`. |
| `src/components/PanelSettingsContent.jsx` | **Modify.** Mode dropdown; Line Alpha / Line Width shown only for Lines. |
| `src/components/PanelSettingsContent.test.jsx` | **Modify.** Dropdown and conditional-control coverage. |

The rasteriser is a single module because its four exports share one coordinate convention and one set of typed-array layouts; splitting them would mean re-stating that convention in two places. It stays pure so that the untestable part (canvas calls) remains as thin as possible, which is the same split the Lines renderer already uses.

## Coordinate conventions used throughout

Learn these before Task 1; every later task depends on them.

- `proj` is the object returned by `buildProjection` in `src/math/spectrogram3dProjection.js`. Read that file.
- **Centred unit coordinates** `(u, v)`, both in `[-0.5, 0.5]`: `u` is time, `v` is frequency. `projectPoint(tFrac, fFrac, h, proj)` takes fractions in `[0, 1]` and subtracts 0.5 internally, so `u = tFrac - 0.5`.
- Screen position: `x = originX + u·tx + v·fx`, `y = originY + u·ty + v·fy + h·hy`. `hy` is negative, so larger `h` means smaller `y` (up).
- `det = tx·fy − ty·fx = depth · scaleX · scaleY`, **strictly positive** for every elevation `clampViewParams` allows.
- Along the direction `(du, dv) ∝ (−fx, tx)` the screen `y` increases by `det` per unit — so that direction points **toward the viewer**. The walk runs the other way: start at the near end, step toward the far end.

---

### Task 1: `columnFloorSpan` — clip a screen column's floor line

For a fixed screen column `x`, the set of floor points projecting into it is a straight line, because the projection is affine and `x` does not depend on `h`. This function clips that line to the floor square and returns the near endpoint plus a constant step toward the far end.

**Files:**
- Create: `src/math/spectrogram3dSurface.js`
- Create: `src/math/spectrogram3dSurface.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/math/spectrogram3dSurface.test.js`:

```js
import { describe, expect, it } from "vitest";
import { buildProjection, projectPoint } from "./spectrogram3dProjection.js";
import { columnFloorSpan } from "./spectrogram3dSurface.js";

const W = 920;
const H = 300;

function proj(azimuthDeg = 135, elevationDeg = 60) {
  return buildProjection({ azimuthDeg, elevationDeg, width: W, height: H });
}

describe("columnFloorSpan", () => {
  it("returns endpoints that project back to the requested column", () => {
    const p = proj();
    const span = columnFloorSpan(W / 2, p, H);
    expect(span).not.toBeNull();

    const near = projectPoint(span.u0 + 0.5, span.v0 + 0.5, 0, p);
    const farU = span.u0 + span.du * span.steps;
    const farV = span.v0 + span.dv * span.steps;
    const far = projectPoint(farU + 0.5, farV + 0.5, 0, p);

    expect(near.x).toBeCloseTo(W / 2, 6);
    expect(far.x).toBeCloseTo(W / 2, 6);
  });

  it("starts at the near end, so screen y decreases along the walk", () => {
    const p = proj();
    const span = columnFloorSpan(W / 2, p, H);
    const near = projectPoint(span.u0 + 0.5, span.v0 + 0.5, 0, p);
    const far = projectPoint(
      span.u0 + span.du * span.steps + 0.5,
      span.v0 + span.dv * span.steps + 0.5,
      0,
      p
    );
    // Larger screen y is nearer the viewer.
    expect(near.y).toBeGreaterThan(far.y);
  });

  it("keeps both endpoints inside the floor square at every view", () => {
    for (let az = 0; az < 360; az += 10) {
      for (const el of [5, 20, 45, 60, 85]) {
        const p = proj(az, el);
        for (const x of [W * 0.2, W * 0.35, W * 0.5, W * 0.65, W * 0.8]) {
          const span = columnFloorSpan(x, p, H);
          if (!span) continue;
          const us = [span.u0, span.u0 + span.du * span.steps];
          const vs = [span.v0, span.v0 + span.dv * span.steps];
          for (const u of us) expect(Math.abs(u)).toBeLessThanOrEqual(0.5 + 1e-9);
          for (const v of vs) expect(Math.abs(v)).toBeLessThanOrEqual(0.5 + 1e-9);
          expect(span.steps).toBeGreaterThan(0);
        }
      }
    }
  });

  it("returns null for a column outside the floor silhouette", () => {
    const p = proj();
    // buildProjection fits with FIT_MARGIN 0.92, so the outermost columns are empty margin.
    expect(columnFloorSpan(0, p, H)).toBeNull();
    expect(columnFloorSpan(W - 1, p, H)).toBeNull();
  });

  it("caps the step count at maxSteps", () => {
    const p = proj();
    const span = columnFloorSpan(W / 2, p, 4);
    expect(span.steps).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/math/spectrogram3dSurface.test.js
```

Expected: FAIL — `Failed to resolve import "./spectrogram3dSurface.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/math/spectrogram3dSurface.js`:

```js
/**
 * Per-pixel renderer for the 3D spectrogram Surface mode.
 *
 * Pure: no canvas, no React, no data access. Writes ARGB words into buffers the caller supplies.
 *
 * The whole module rests on one property of the orthographic projection: for a fixed screen column
 * the set of floor points landing in it is a straight line, so a column can be walked with constant
 * additions and given exact hidden-surface removal by a single running minimum. That is cheaper and
 * more robust than filling geometry, which is what the Lines mode's abandoned hidden-line attempt
 * tried -- see the Reversed section of the 2026-07-28 design.
 */

const EPS = 1e-9;

/**
 * Where screen column `x` enters and leaves the floor square, in centred unit coordinates.
 *
 * Returns the NEAR endpoint plus a constant per-step delta pointing at the far end, because the
 * rasteriser walks front to back. `(-fx, tx)` is the direction of increasing screen y, i.e. toward
 * the viewer, so the near end is the one at the larger line parameter.
 *
 * @param {number} x screen column, device pixels
 * @param {object} proj from `buildProjection`
 * @param {number} maxSteps upper bound on samples for this column
 * @returns {{ u0: number, v0: number, du: number, dv: number, steps: number } | null}
 *          null when the column misses the floor entirely
 */
export function columnFloorSpan(x, proj, maxSteps) {
  const offset = x - proj.originX;
  const denom = proj.tx * proj.tx + proj.fx * proj.fx;
  if (!(denom > 0)) return null;

  // Any point on the line `u*tx + v*fx = offset`; the one closest to the centre is convenient.
  const baseU = (offset * proj.tx) / denom;
  const baseV = (offset * proj.fx) / denom;
  const dirU = -proj.fx;
  const dirV = proj.tx;

  // Slab-clip the line parameter against both axes of the square.
  let sMin = -Infinity;
  let sMax = Infinity;
  for (const [base, dir] of [
    [baseU, dirU],
    [baseV, dirV],
  ]) {
    if (Math.abs(dir) < EPS) {
      // The line is constant along this axis: either wholly inside the slab or wholly outside.
      if (base < -0.5 - EPS || base > 0.5 + EPS) return null;
      continue;
    }
    const a = (-0.5 - base) / dir;
    const b = (0.5 - base) / dir;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    if (lo > sMin) sMin = lo;
    if (hi < sMax) sMax = hi;
  }
  if (!(sMax > sMin)) return null;

  // Screen-y extent of the clipped segment. One sample per screen pixel row is as fine as the
  // output can show, and it self-limits: a compressed low-elevation view needs fewer samples.
  const det = proj.tx * proj.fy - proj.ty * proj.fx;
  const yExtent = Math.abs(det) * (sMax - sMin);
  const cap = Math.max(1, Math.floor(maxSteps));
  const steps = Math.max(1, Math.min(cap, Math.ceil(yExtent)));

  // Start at sMax -- the near end -- and step back toward sMin.
  const travel = sMin - sMax;
  return {
    u0: baseU + sMax * dirU,
    v0: baseV + sMax * dirV,
    du: (travel * dirU) / steps,
    dv: (travel * dirV) / steps,
    steps,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/math/spectrogram3dSurface.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dSurface.js src/math/spectrogram3dSurface.test.js
git commit -m "feat(spectrogram): clip a screen column against the 3D floor plane"
```

---

### Task 2: `buildRowLut` — constant-time nearest-row lookup, with gap detection

Grid rows sit at irregular `tFracs`. The rasteriser needs `row(tFrac)` per sample, so a binary search per sample would dominate the inner loop. A quantised lookup table gives it in one array read, and the same table is where capture gaps become holes: a bucket with no row within `maxDistTFrac` gets the `NO_ROW` sentinel, and the rasteriser skips those samples without advancing the horizon.

**Files:**
- Modify: `src/math/spectrogram3dSurface.js`
- Modify: `src/math/spectrogram3dSurface.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/math/spectrogram3dSurface.test.js` (and add `buildRowLut, NO_ROW` to the existing import from `./spectrogram3dSurface.js`):

```js
describe("buildRowLut", () => {
  it("maps each bucket to the nearest row", () => {
    const tFracs = new Float64Array([0, 0.5, 1]);
    const lut = buildRowLut(tFracs, 3, 101, 0.4);
    expect(lut[0]).toBe(0);
    expect(lut[50]).toBe(1);
    expect(lut[100]).toBe(2);
    expect(lut[10]).toBe(0);
    expect(lut[40]).toBe(1);
  });

  it("marks buckets with no row within maxDistTFrac as NO_ROW", () => {
    // Rows clustered at both ends: the middle is a capture gap.
    const tFracs = new Float64Array([0, 0.05, 0.95, 1]);
    const lut = buildRowLut(tFracs, 4, 101, 0.1);
    expect(lut[0]).toBe(0);
    expect(lut[100]).toBe(3);
    expect(lut[50]).toBe(NO_ROW);
  });

  it("fills entirely with NO_ROW when there are no rows", () => {
    const lut = buildRowLut(new Float64Array(0), 0, 8, 0.1);
    expect([...lut]).toEqual(new Array(8).fill(NO_ROW));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/math/spectrogram3dSurface.test.js
```

Expected: FAIL — `buildRowLut is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/math/spectrogram3dSurface.js`:

```js
/** Sentinel for "no grid row covers this time". Uint16Array-safe. */
export const NO_ROW = 0xffff;

/**
 * Quantised nearest-row lookup over tFrac, so the inner loop costs one array read instead of a
 * binary search. Rows sit at irregular timestamps, which is why a divide cannot replace this.
 *
 * Buckets with no row within `maxDistTFrac` get NO_ROW. That is how a real capture gap becomes a
 * hole in the surface: the rasteriser skips those samples and leaves the horizon where it was, so
 * the terrain behind the gap stays visible through it. Substituting the dB floor instead would draw
 * a gap as a flat plain, which is data that does not exist.
 *
 * @param {Float64Array} tFracs row positions in 0..1, ascending
 * @param {number} count how many entries of `tFracs` are valid
 * @param {number} size table resolution
 * @param {number} maxDistTFrac beyond this distance a bucket counts as uncovered
 * @returns {Uint16Array}
 */
export function buildRowLut(tFracs, count, size, maxDistTFrac) {
  const lut = new Uint16Array(size);
  if (count <= 0) {
    lut.fill(NO_ROW);
    return lut;
  }
  let row = 0;
  for (let i = 0; i < size; i++) {
    const t = size > 1 ? i / (size - 1) : 0;
    // tFracs ascends, so the nearest row only ever moves forward as i advances.
    while (row + 1 < count && Math.abs(tFracs[row + 1] - t) <= Math.abs(tFracs[row] - t)) {
      row += 1;
    }
    lut[i] = Math.abs(tFracs[row] - t) > maxDistTFrac ? NO_ROW : row;
  }
  return lut;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/math/spectrogram3dSurface.test.js
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dSurface.js src/math/spectrogram3dSurface.test.js
git commit -m "feat(spectrogram): add a nearest-row lookup with gap detection for the 3D surface"
```

---

### Task 3: `buildSurfaceLut` — the (level × shade) colour table

The rasteriser must not do colour maths per sample. It computes two small integers — a level index from the sample's height and a shade index from slope and depth — and reads one ARGB word. One table serves both Colorize states; only how it is filled differs, so the rasteriser never learns which is active.

Monochrome ramps between the colormap's two ends, per Decision #7 of the design. That is why no theme colour string has to be parsed here: those ends are already numeric RGB.

**Files:**
- Modify: `src/math/spectrogram3dSurface.js`
- Modify: `src/math/spectrogram3dSurface.test.js`

- [ ] **Step 1: Write the failing test**

Add `SHADE_LEVELS, buildSurfaceLut, packArgb` to the existing import, and this new import line **at the top of the file with the others** — the rest of the block appends to the end:

```js
import { SPECTROGRAM_DB_MAX, SPECTROGRAM_DB_MIN } from "../config/scales.js";

// A LUT whose low end is pure red and whose high end is pure blue, so the two are distinguishable.
function testColormapLut() {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    lut[i * 3] = 255 - i;
    lut[i * 3 + 1] = 0;
    lut[i * 3 + 2] = i;
  }
  return lut;
}

describe("buildSurfaceLut", () => {
  it("ramps monochrome by shade alone, ignoring level", () => {
    const lut = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: false,
    });
    const darkest = lut[0 * SHADE_LEVELS + 0];
    const brightest = lut[0 * SHADE_LEVELS + (SHADE_LEVELS - 1)];
    // Low end of the colormap is red, high end is blue.
    expect(darkest).toBe(packArgb(255, 0, 0, 255));
    expect(brightest).toBe(packArgb(0, 0, 255, 255));
    // Level does not move the colour.
    expect(lut[255 * SHADE_LEVELS + 0]).toBe(darkest);
    expect(lut[128 * SHADE_LEVELS + (SHADE_LEVELS - 1)]).toBe(brightest);
  });

  it("ramps colorize by level, with shade only changing luminance", () => {
    const lut = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: true,
    });
    const litLow = lut[0 * SHADE_LEVELS + (SHADE_LEVELS - 1)];
    const litHigh = lut[255 * SHADE_LEVELS + (SHADE_LEVELS - 1)];
    expect(litLow).not.toBe(litHigh);

    // At full shade, the top of the ramp is the colormap's high end untouched.
    expect(litHigh).toBe(packArgb(0, 0, 255, 255));

    // Shading darkens without changing which channel dominates.
    const dimHigh = lut[255 * SHADE_LEVELS + 0];
    expect(dimHigh).not.toBe(litHigh);
    const blueOf = (argb) => (argb >>> 16) & 0xff;
    expect(blueOf(dimHigh)).toBeLessThan(blueOf(litHigh));
    expect(blueOf(dimHigh)).toBeGreaterThan(0);
  });

  it("is fully opaque everywhere", () => {
    const lut = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: true,
    });
    for (let i = 0; i < lut.length; i++) {
      expect(lut[i] >>> 24).toBe(255);
    }
  });

  it("keeps colour absolute when the dB floor is raised", () => {
    const low = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: true,
    });
    const high = buildSurfaceLut({
      colormapLut: testColormapLut(),
      dbFloor: -40,
      colorize: true,
    });
    // The top of the height ramp is SPECTROGRAM_DB_MAX in both cases, so its colour is unchanged.
    const top = 255 * SHADE_LEVELS + (SHADE_LEVELS - 1);
    expect(low[top]).toBe(high[top]);
    expect(SPECTROGRAM_DB_MAX).toBeGreaterThan(-40);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/math/spectrogram3dSurface.test.js
```

Expected: FAIL — `buildSurfaceLut is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/math/spectrogram3dSurface.js`, and add this import at the top of the file:

```js
import { SPECTROGRAM_DB_MAX } from "../config/scales.js";
import { spectrogramColorFrac } from "../theme/spectrogramColormap.js";
```

Then:

```js
/** Shade quantisation. 16 keeps the LUT at 4096 words -- cheap to rebuild, fine enough to read. */
export const SHADE_LEVELS = 16;

/** How far Colorize lets shading move luminance. Small on purpose: colour must stay readable. */
const COLORIZE_SHADE_FLOOR = 0.75;

/**
 * Pack one ARGB word for a Uint32Array view over ImageData.
 *
 * The byte order assumes a little-endian host, which every platform PLVS targets is. On a
 * big-endian host the channels would come out reversed.
 */
export function packArgb(r, g, b, a) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * The (level x shade) colour table the rasteriser indexes with `level * SHADE_LEVELS + shade`.
 *
 * `level` is the sample's FLOOR-RELATIVE height fraction, quantised to 0..255 -- the same quantity
 * `sampleWaterfallGrid` stores. Colour, however, must be ABSOLUTE against the fixed dB range, so
 * that raising the dB Floor never recolours a peak (Decision #8 of the 2026-07-28 design). The
 * conversion happens here, once per repaint, exactly as `buildStopColors` does it for Lines:
 * recover the dB that a height fraction represents, then run that dB through spectrogramColorFrac.
 *
 * Monochrome ignores `level` entirely and ramps on `shade`, between the colormap's two ends. The
 * relief IS the information in that state; height carries level, and colour carries shape.
 *
 * @param {object} args
 * @param {Uint8Array|number[]} args.colormapLut 256 RGB triplets
 * @param {number} args.dbFloor current dB floor
 * @param {boolean} args.colorize
 * @returns {Uint32Array} length 256 * SHADE_LEVELS
 */
export function buildSurfaceLut({ colormapLut, dbFloor, colorize }) {
  const lut = new Uint32Array(256 * SHADE_LEVELS);
  const lowR = colormapLut[0];
  const lowG = colormapLut[1];
  const lowB = colormapLut[2];
  const highR = colormapLut[255 * 3];
  const highG = colormapLut[255 * 3 + 1];
  const highB = colormapLut[255 * 3 + 2];

  for (let level = 0; level < 256; level++) {
    let r = 0;
    let g = 0;
    let b = 0;
    if (colorize) {
      const db = dbFloor + (level / 255) * (SPECTROGRAM_DB_MAX - dbFloor);
      const idx = Math.round(spectrogramColorFrac(db, dbFloor) * 255) * 3;
      r = colormapLut[idx];
      g = colormapLut[idx + 1];
      b = colormapLut[idx + 2];
    }
    for (let shade = 0; shade < SHADE_LEVELS; shade++) {
      const s = SHADE_LEVELS > 1 ? shade / (SHADE_LEVELS - 1) : 1;
      let outR;
      let outG;
      let outB;
      if (colorize) {
        const mul = COLORIZE_SHADE_FLOOR + (1 - COLORIZE_SHADE_FLOOR) * s;
        outR = Math.round(r * mul);
        outG = Math.round(g * mul);
        outB = Math.round(b * mul);
      } else {
        outR = Math.round(lowR + (highR - lowR) * s);
        outG = Math.round(lowG + (highG - lowG) * s);
        outB = Math.round(lowB + (highB - lowB) * s);
      }
      lut[level * SHADE_LEVELS + shade] = packArgb(outR, outG, outB, 255);
    }
  }
  return lut;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/math/spectrogram3dSurface.test.js
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dSurface.js src/math/spectrogram3dSurface.test.js
git commit -m "feat(spectrogram): build the level-by-shade colour table for the 3D surface"
```

---

### Task 4: `rasterizeSurface` — the floating-horizon walk

The core. Front to back per column, one running minimum for exact occlusion.

**The walk direction is the one thing to get right.** Nearer terrain projects lower on screen (larger `y`) and must occlude what is behind it, so the silhouette built front to back rises monotonically — which is the `y < horizon` test. Marching back to front makes the farthest sample fill the whole lower column, after which every nearer sample fails that same test and nothing else is ever drawn. `columnFloorSpan` already returns the near end first; do not reverse it.

**Files:**
- Modify: `src/math/spectrogram3dSurface.js`
- Modify: `src/math/spectrogram3dSurface.test.js`

- [ ] **Step 1: Write the failing test**

Append to the test file (add `rasterizeSurface` to the import):

```js
const HIGHLIGHT = packArgb(0, 255, 0, 255);

/**
 * A grid of `count` rows x `pointCount` points, each row at a uniform tFrac, with per-row heights
 * given by `rowHeights`. Mirrors the shape `sampleWaterfallGrid` returns.
 */
function fakeGrid(rowHeights, pointCount = 8) {
  const count = rowHeights.length;
  const heights = new Float32Array(count * pointCount);
  const tFracs = new Float64Array(count);
  for (let r = 0; r < count; r++) {
    tFracs[r] = count > 1 ? r / (count - 1) : 0;
    for (let q = 0; q < pointCount; q++) heights[r * pointCount + q] = rowHeights[r];
  }
  return { heights, tFracs, count, pointCount };
}

function render(
  grid,
  { highlightRow = -1, columnStride = 1, heightGain = 1, elevationDeg = 60, azimuthDeg = 135 } = {}
) {
  const p = proj(azimuthDeg, elevationDeg);
  const out = new Uint32Array(W * H);
  const lut = buildSurfaceLut({
    colormapLut: testColormapLut(),
    dbFloor: SPECTROGRAM_DB_MIN,
    colorize: true,
  });
  const rowLut = buildRowLut(grid.tFracs, grid.count, 1024, 1.5 / Math.max(1, grid.count - 1));
  rasterizeSurface({
    out,
    width: W,
    height: H,
    proj: p,
    grid,
    rowLut,
    lut,
    heightGain,
    highlightArgb: HIGHLIGHT,
    highlightRow,
    columnStride,
    maxSteps: H,
  });
  return out;
}

function countPixels(out, argb) {
  let n = 0;
  for (let i = 0; i < out.length; i++) if (out[i] === argb) n += 1;
  return n;
}

function countOpaque(out) {
  let n = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== 0) n += 1;
  return n;
}

describe("rasterizeSurface", () => {
  it("draws a flat field as an unbroken silhouette", () => {
    const out = render(fakeGrid([0.5, 0.5, 0.5, 0.5, 0.5]));
    expect(countOpaque(out)).toBeGreaterThan(0);
    // Every column that the floor covers gets at least one pixel.
    const p = proj();
    let covered = 0;
    let painted = 0;
    for (let x = 0; x < W; x++) {
      if (!columnFloorSpan(x, p, H)) continue;
      covered += 1;
      for (let y = 0; y < H; y++) {
        if (out[y * W + x] !== 0) {
          painted += 1;
          break;
        }
      }
    }
    expect(covered).toBeGreaterThan(0);
    expect(painted).toBe(covered);
  });

  // Occlusion is a function of elevation, not just of height, and the arithmetic is worth knowing
  // before reading these two. A near sample hides a far one when
  //
  //     Δh · (rise · scaleY)  >  Δt · ty        i.e.  Δh > Δt · tan(elevation) · sin(azimuth)
  //
  // At elevation 60 and Δt = 1 that needs Δh > 1.2, which heights in 0..1 cannot reach — so a
  // low-elevation view is where a solid surface genuinely occludes its own interior. That is the
  // whole reason Lines is kept as a separate mode; see Decision #1 of the design. Elevation 20 puts
  // the threshold at Δh > 0.26, which is reachable.
  //
  // These two also render at azimuth 90 rather than the default 135, and that is load-bearing. A
  // screen column is the floor line `u·tx + v·fx = const`. At azimuth 135, `tx` and `fx` are equal,
  // so the line is `u + v = k` and reaches at most `u = k + 0.5` — meaning a column with low `k`
  // contains no sample from the newest row's time slab at all, and the far row is legitimately
  // unoccluded there. A global "zero highlight pixels" assertion is therefore unsatisfiable by ANY
  // implementation at azimuth 135. At azimuth 90 `tx` is zero, every column spans the whole time
  // axis, and the assertion means what it says. Do not "simplify" these back to the default view.
  it("hides a low far row behind a tall near row", () => {
    // Row 0 is oldest, row N-1 newest. `proj.ty > 0` at both 90 and 135, so the newest row is
    // nearest: make the NEAREST row tall and tag the FARTHEST one. None of it should survive.
    const grid = fakeGrid([0.05, 0.05, 0.05, 1]);
    const out = render(grid, { highlightRow: 0, elevationDeg: 20, azimuthDeg: 90 });
    expect(countPixels(out, HIGHLIGHT)).toBe(0);
  });

  it("lets a tall far row show above a low near row", () => {
    const grid = fakeGrid([1, 0.05, 0.05, 0.05]);
    const out = render(grid, { highlightRow: 0, elevationDeg: 20, azimuthDeg: 90 });
    expect(countPixels(out, HIGHLIGHT)).toBeGreaterThan(0);
  });

  // Occlusion at the DEFAULT viewpoint, which is what ships. Scoped to the columns whose floor line
  // actually reaches the tall row's time slab, for the reason given above.
  it("hides the far row in every column the tall near row reaches", () => {
    // Assert zero highlight pixels within those columns only. Derive the column set from
    // `columnFloorSpan`, not from a hard-coded range.
  });

  it("leaves a gap transparent instead of filling it", () => {
    const grid = fakeGrid([0.5, 0.5, 0.5, 0.5, 0.5]);
    // Rows clustered at the ends: nothing covers the middle of the window.
    grid.tFracs.set([0, 0.02, 0.04, 0.96, 1]);
    const rowLut = buildRowLut(grid.tFracs, grid.count, 1024, 0.05);
    const p = proj();
    const out = new Uint32Array(W * H);
    rasterizeSurface({
      out,
      width: W,
      height: H,
      proj: p,
      grid,
      rowLut,
      lut: buildSurfaceLut({
        colormapLut: testColormapLut(),
        dbFloor: SPECTROGRAM_DB_MIN,
        colorize: true,
      }),
      heightGain: 1,
      highlightArgb: HIGHLIGHT,
      highlightRow: -1,
      columnStride: 1,
      maxSteps: H,
    });
    const solid = render(grid);
    expect(countOpaque(out)).toBeLessThan(countOpaque(solid));
    expect(countOpaque(out)).toBeGreaterThan(0);
  });

  it("writes nothing outside the floor silhouette", () => {
    const out = render(fakeGrid([0.5, 0.5, 0.5]));
    const p = proj();
    for (let x = 0; x < W; x++) {
      if (columnFloorSpan(x, p, H)) continue;
      for (let y = 0; y < H; y++) expect(out[y * W + x]).toBe(0);
    }
  });

  it("replicates columns when a stride is used", () => {
    const grid = fakeGrid([0.4, 0.5, 0.6]);
    const single = render(grid);
    const strided = render(grid, { columnStride: 2 });
    expect(countOpaque(strided)).toBeGreaterThan(0);
    // Same overall coverage: every skipped column is filled from its left neighbour.
    expect(Math.abs(countOpaque(strided) - countOpaque(single)) / countOpaque(single)).toBeLessThan(
      0.1
    );
  });

  it("draws nothing when the grid is empty", () => {
    const out = render(fakeGrid([]));
    expect(countOpaque(out)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/math/spectrogram3dSurface.test.js
```

Expected: FAIL — `rasterizeSurface is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/math/spectrogram3dSurface.js`:

```js
/** Slope-to-shade sensitivity, and the mid-grey a flat sample sits at. Tuned by eye. */
const SHADE_MID = 0.5;
const SHADE_SLOPE_GAIN = 6;
/** How far the far end is darkened. Mild: it carries recession, it should not hide data. */
const DEPTH_FADE_FLOOR = 0.65;

/**
 * Rasterise the whole surface into `out`, one screen column at a time.
 *
 * Each column is walked FRONT TO BACK with a running minimum (`horizon`) of the topmost pixel
 * already written. A sample is visible only where it rises above that, and the span between the two
 * is the vertical wall that makes the result read as solid rather than as a stack of contours.
 * Occluded pixels are never written, so there is no overdraw at all.
 *
 * Walking back to front instead would let the farthest sample fill the entire lower column, after
 * which every nearer sample fails the same `y < horizon` test and nothing else is ever drawn.
 *
 * `out` must be zero-filled by the caller. Pixels this leaves at 0 are transparent, which is what
 * lets the panel background and the floor grid show through.
 *
 * @param {object} args
 * @param {Uint32Array} args.out ARGB words, `width * height`, zero-filled
 * @param {number} args.width
 * @param {number} args.height
 * @param {object} args.proj from `buildProjection`
 * @param {{ heights: Float32Array, tFracs: Float64Array, count: number, pointCount: number }} args.grid
 * @param {Uint16Array} args.rowLut from `buildRowLut`
 * @param {Uint32Array} args.lut from `buildSurfaceLut`
 * @param {number} args.heightGain the Height Scale multiplier
 * @param {number} args.highlightArgb colour for the scrubbed row
 * @param {number} args.highlightRow grid row to highlight, or -1
 * @param {number} args.columnStride rasterise every Nth column and replicate
 * @param {number} args.maxSteps per-column sample cap
 */
export function rasterizeSurface({
  out,
  width,
  height,
  proj,
  grid,
  rowLut,
  lut,
  heightGain,
  highlightArgb,
  highlightRow = -1,
  columnStride = 1,
  maxSteps,
}) {
  const { heights, count, pointCount } = grid;
  if (count <= 0 || pointCount <= 0) return;

  const lastPoint = pointCount - 1;
  const lutLast = rowLut.length - 1;
  const stride = Math.max(1, Math.floor(columnStride));
  const stepCap = Math.max(1, Math.floor(maxSteps ?? height));

  for (let x = 0; x < width; x += stride) {
    const span = columnFloorSpan(x, proj, stepCap);
    if (!span) continue;

    // Seed the horizon at the floor's NEAR edge for this column, not at the canvas bottom. With
    // `height` the nearest sample's wall would extend past the front edge of the floor and paint
    // the empty area below the scene.
    const nearFloorY = proj.originY + span.u0 * proj.ty + span.v0 * proj.fy;
    let horizon = Math.min(height, Math.round(nearFloorY) + 1);
    if (horizon <= 0) continue;

    let u = span.u0;
    let v = span.v0;
    let prevH = NaN;

    for (let s = 0; s <= span.steps; s++, u += span.du, v += span.dv) {
      const bucket = Math.round((u + 0.5) * lutLast);
      const row = rowLut[bucket < 0 ? 0 : bucket > lutLast ? lutLast : bucket];
      if (row === NO_ROW) {
        // A capture gap: contribute nothing and leave the horizon alone, so what is behind the gap
        // stays visible through it.
        prevH = NaN;
        continue;
      }

      const q = Math.round((v + 0.5) * lastPoint);
      const h = heights[row * pointCount + (q < 0 ? 0 : q > lastPoint ? lastPoint : q)];

      // Slope along the view ray, measured before the visibility test: an occluded stretch still
      // shapes the terrain, so skipping it here would corrupt the shading of whatever follows.
      const slope = Number.isFinite(prevH) ? h - prevH : 0;
      prevH = h;

      const y = Math.round(proj.originY + u * proj.ty + v * proj.fy + h * heightGain * proj.hy);
      if (y >= horizon) continue;
      const top = y < 0 ? 0 : y;
      if (top >= horizon) continue;

      let argb;
      if (row === highlightRow) {
        argb = highlightArgb;
      } else {
        // Headlight shading: the ray always lies along the view direction, so this stays stable
        // while the user rotates, where a world-fixed light would darken whole faces.
        let shade = SHADE_MID + slope * SHADE_SLOPE_GAIN;
        shade = shade < 0 ? 0 : shade > 1 ? 1 : shade;
        // Depth attenuation. s runs 0 at the near end to steps at the far end.
        const near = span.steps > 0 ? 1 - s / span.steps : 1;
        shade *= DEPTH_FADE_FLOOR + (1 - DEPTH_FADE_FLOOR) * near;
        const shadeIdx = Math.min(SHADE_LEVELS - 1, (shade * (SHADE_LEVELS - 1) + 0.5) | 0);
        const level = Math.min(255, (h * 255 + 0.5) | 0);
        argb = lut[level * SHADE_LEVELS + shadeIdx];
      }

      const kEnd = Math.min(stride, width - x);
      for (let yy = top; yy < horizon; yy++) {
        const base = yy * width + x;
        for (let k = 0; k < kEnd; k++) out[base + k] = argb;
      }
      horizon = top;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/math/spectrogram3dSurface.test.js
```

Expected: PASS, 19 tests.

If the two occlusion tests disagree with each other, check the walk direction first: at azimuth 135 `proj.ty > 0`, so the newest row (highest index) is nearest. Print `proj.ty` before assuming the test is wrong.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dSurface.js src/math/spectrogram3dSurface.test.js
git commit -m "feat(spectrogram): rasterise the 3D surface with a floating horizon"
```

---

### Task 5: Benchmark the rasteriser and choose the column stride

The design requires this before the renderer is wired up, because whether a stride is needed changes what the hook passes. The rasteriser is pure JS over typed arrays, so Node measures it directly — no browser and no canvas needed, which makes this a better measurement than the browser harness the Lines mode used.

**Files:**
- Create: `scripts/spectrogram-surface-benchmark.mjs`

- [ ] **Step 1: Write the benchmark**

Create `scripts/spectrogram-surface-benchmark.mjs`:

```js
import { performance } from "node:perf_hooks";

import { SPECTROGRAM_DB_MIN } from "../src/config/scales.js";
import { buildProjection } from "../src/math/spectrogram3dProjection.js";
import {
  buildRowLut,
  buildSurfaceLut,
  packArgb,
  rasterizeSurface,
} from "../src/math/spectrogram3dSurface.js";

// The two real panel sizes the Lines mode was measured at, in device pixels.
const CANVASES = [
  { width: 922, height: 110, rows: 66, points: 154 },
  { width: 2560, height: 900, rows: 300, points: 320 },
  { width: 3840, height: 1200, rows: 300, points: 320 },
];
const STRIDES = [1, 2, 3];
const ITERATIONS = 60;
const BUDGET_MS = 16.7;

function syntheticGrid(rows, points) {
  const heights = new Float32Array(rows * points);
  const tFracs = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    tFracs[r] = rows > 1 ? r / (rows - 1) : 0;
    for (let q = 0; q < points; q++) {
      // Something with real spectral shape: a decaying tilt plus a couple of resonances.
      const f = q / Math.max(1, points - 1);
      const tilt = 1 - f * 0.8;
      const res = 0.25 * Math.exp(-(((f - 0.2) / 0.03) ** 2)) + 0.2 * Math.exp(-(((f - 0.55) / 0.05) ** 2));
      const env = 0.6 + 0.4 * Math.sin((r / rows) * Math.PI * 6);
      heights[r * points + q] = Math.min(1, Math.max(0, (tilt * 0.6 + res) * env));
    }
  }
  return { heights, tFracs, count: rows, pointCount: points };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure({ width, height, rows, points }, columnStride) {
  const proj = buildProjection({ azimuthDeg: 135, elevationDeg: 60, width, height });
  const grid = syntheticGrid(rows, points);
  const rowLut = buildRowLut(grid.tFracs, grid.count, 1024, 1.5 / Math.max(1, grid.count - 1));
  const out = new Uint32Array(width * height);
  const samples = [];

  for (let i = 0; i < ITERATIONS; i++) {
    // The colour LUT is rebuilt per repaint in the renderer, so it belongs inside the timing.
    const started = performance.now();
    const lut = buildSurfaceLut({
      colormapLut: new Uint8Array(256 * 3).fill(128),
      dbFloor: SPECTROGRAM_DB_MIN,
      colorize: true,
    });
    out.fill(0);
    rasterizeSurface({
      out,
      width,
      height,
      proj,
      grid,
      rowLut,
      lut,
      heightGain: 1,
      highlightArgb: packArgb(0, 255, 0, 255),
      highlightRow: -1,
      columnStride,
      maxSteps: height,
    });
    samples.push(performance.now() - started);
  }
  return median(samples);
}

console.log(`iterations per cell: ${ITERATIONS}, budget: ${BUDGET_MS} ms\n`);
for (const canvas of CANVASES) {
  const label = `${canvas.width}x${canvas.height} (${canvas.rows} rows x ${canvas.points} pts)`;
  const parts = STRIDES.map((stride) => {
    const ms = measure(canvas, stride);
    const flag = ms > BUDGET_MS ? "  OVER" : "";
    return `stride ${stride}: ${ms.toFixed(2)} ms${flag}`;
  });
  console.log(`${label}\n  ${parts.join("\n  ")}\n`);
}
```

- [ ] **Step 2: Run it**

```bash
node scripts/spectrogram-surface-benchmark.mjs
```

Expected: a table of medians. Node's JIT is not WebView2 and there is no competing load from capture or DSP, so treat the numbers as a lower bound.

- [ ] **Step 3: Choose the default stride and record the measurement**

Add to `src/math/spectrogram3dSurface.js`, filling in the numbers you actually measured:

```js
/**
 * Default column stride: rasterise every Nth column and replicate.
 *
 * Measured with scripts/spectrogram-surface-benchmark.mjs on <date>, medians of 60 repaints:
 *
 *   922x110    stride 1: <x> ms   stride 2: <x> ms
 *   2560x900   stride 1: <x> ms   stride 2: <x> ms
 *   3840x1200  stride 1: <x> ms   stride 2: <x> ms
 *
 * Node is not WebView2 and nothing else is competing for the main thread there, so these are a
 * lower bound. <One sentence saying which stride you chose and why.>
 */
export const DEFAULT_COLUMN_STRIDE = 1;
```

Set the value to `1` if every canvas came in comfortably under 16.7 ms, otherwise to the smallest stride that does. Do not add a user-facing control for it — the design rules that out explicitly.

- [ ] **Step 4: Verify nothing else broke**

```bash
npx vitest run src/math/spectrogram3dSurface.test.js
```

Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/spectrogram-surface-benchmark.mjs src/math/spectrogram3dSurface.js
git commit -m "test(perf): benchmark the 3D surface rasteriser and pin the column stride"
```

---

### Task 6: Replace the `spectrogram3d` boolean with a `spectrogramMode` enum

`spectrogram3d` has never shipped — the entire 3D feature is unmerged — so it is deleted outright rather than migrated. `cleanupLegacyKeys.js` is not touched.

**Files:**
- Modify: `src/lib/panelControls.js`
- Modify: `src/lib/panelControls.test.js`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/panelControls.test.js` (match the surrounding import and describe style):

```js
describe("spectrogramMode", () => {
  it("defaults to the 2D heatmap", () => {
    expect(normalizePanelControls({}).spectrogramMode).toBe("heatmap");
  });

  it("accepts every option id", () => {
    for (const option of SPECTROGRAM_MODE_OPTIONS) {
      expect(normalizePanelControls({ spectrogramMode: option.id }).spectrogramMode).toBe(option.id);
    }
  });

  it("falls back to the default for unknown or malformed values", () => {
    for (const raw of ["waterfall", "", null, undefined, 3, true, {}]) {
      expect(normalizePanelControls({ spectrogramMode: raw }).spectrogramMode).toBe("heatmap");
    }
  });

  it("no longer carries the retired spectrogram3d boolean", () => {
    expect(normalizePanelControls({ spectrogram3d: true }).spectrogram3d).toBeUndefined();
  });

  it("offers exactly the three documented modes, in order", () => {
    expect(SPECTROGRAM_MODE_OPTIONS.map((option) => option.id)).toEqual([
      "heatmap",
      "lines",
      "surface",
    ]);
    expect(SPECTROGRAM_MODE_OPTIONS.map((option) => option.label)).toEqual([
      "2D Heatmap",
      "3D Lines",
      "3D Surface",
    ]);
  });
});
```

Add `SPECTROGRAM_MODE_OPTIONS` to the file's existing import from `./panelControls.js`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/panelControls.test.js
```

Expected: FAIL — `SPECTROGRAM_MODE_OPTIONS is not defined`.

- [ ] **Step 3: Write the implementation**

In `src/lib/panelControls.js`:

Add after `VECTORSCOPE_MODE_OPTIONS` (around line 23):

```js
/// Spectrogram view modes. The 2D/3D prefix is carried in the label because that is the
/// distinction users are choosing between; the ids stay short because they are persisted.
export const SPECTROGRAM_MODE_OPTIONS = [
  { id: "heatmap", label: "2D Heatmap" },
  { id: "lines", label: "3D Lines" },
  { id: "surface", label: "3D Surface" },
];
```

Add next to the other id sets (around line 102):

```js
const SPECTROGRAM_MODE_IDS = new Set(SPECTROGRAM_MODE_OPTIONS.map((option) => option.id));
```

In `DEFAULT_PANEL_CONTROLS`, replace `spectrogram3d: false,` (line 56) with:

```js
  spectrogramMode: "heatmap",
```

Replace the `normalizeSpectrogram3d` function (around line 151-153) with:

```js
function normalizeSpectrogramMode(raw) {
  return SPECTROGRAM_MODE_IDS.has(raw) ? raw : DEFAULT_PANEL_CONTROLS.spectrogramMode;
}
```

In the returned object of `normalizePanelControls`, replace the `spectrogram3d:` line (around line 453) with:

```js
    spectrogramMode: normalizeSpectrogramMode(raw?.spectrogramMode),
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/panelControls.test.js
```

Expected: PASS. Other suites will now fail — Tasks 7 and 8 fix them.

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "feat(spectrogram): replace the 3D boolean with a three-way view mode"
```

---

### Task 7: Point the help text at the new mode

Lines and Surface share every gesture, so there are still only two help sets. Only the predicate changes.

**Files:**
- Modify: `src/components/panels/chartHelp.js:153`
- Modify: `src/components/panels/chartHelp.test.js:16-18`

- [ ] **Step 1: Write the failing test**

Replace the two existing spectrogram assertions in `src/components/panels/chartHelp.test.js` (lines 16-18) with:

```js
    expect(resolvePanelHelpItems("spectrogram", { spectrogramMode: "lines" })).toBe(
      SPECTROGRAM_3D_HELP
    );
    expect(resolvePanelHelpItems("spectrogram", { spectrogramMode: "surface" })).toBe(
      SPECTROGRAM_3D_HELP
    );
    expect(resolvePanelHelpItems("spectrogram", { spectrogramMode: "heatmap" })).toBe(
      SPECTROGRAM_2D_HELP
    );
    expect(resolvePanelHelpItems("spectrogram", {})).toBe(SPECTROGRAM_2D_HELP);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/components/panels/chartHelp.test.js
```

Expected: FAIL — the `"lines"` and `"surface"` cases return `SPECTROGRAM_2D_HELP`.

- [ ] **Step 3: Write the implementation**

In `src/components/panels/chartHelp.js`, replace line 153:

```js
  const mode = controls?.spectrogramMode;
  return mode === "lines" || mode === "surface" ? SPECTROGRAM_3D_HELP : SPECTROGRAM_2D_HELP;
```

Enumerating the 3D modes rather than testing `!== "heatmap"` keeps an absent or malformed `controls` on the 2D help, which is what a panel with no controls yet should get.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/components/panels/chartHelp.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/chartHelp.js src/components/panels/chartHelp.test.js
git commit -m "fix(spectrogram): resolve panel help from the view mode"
```

---

### Task 8: The Mode dropdown, and Lines-only controls

**Files:**
- Modify: `src/components/PanelSettingsContent.jsx:1319-1500`
- Modify: `src/components/PanelSettingsContent.test.jsx`
- Modify: `src/components/panels/SpectrogramPanel.jsx:86`
- Modify: `src/components/panels/SpectrogramPanel.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `src/components/PanelSettingsContent.test.jsx`. This file has no per-tab render helper — every test renders `<PanelSettingsContent activeTab="..." />` inline with the local `render` from line 49 — so these follow the vectorscope-mode test at line 425 exactly, including `fireEvent` rather than `userEvent` and `getByRole("button", ...)` to open a `SettingsSelect`.

```js
  it("selects the spectrogram view mode and scopes the line controls to Lines", () => {
    const onPanelControlsChange = vi.fn();
    const props = {
      activeTab: "spectrogram",
      channelCount: 2,
      spectrumOptions: [{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }],
      spectrumValueKey: "p-0-1",
      panelControls: DEFAULT_PANEL_CONTROLS,
      onPanelControlsChange,
    };
    const { rerender } = render(<PanelSettingsContent {...props} />);

    // Heatmap is the default: no 3D control is present at all.
    expect(screen.queryByLabelText("spectrogram 3d elevation")).toBeNull();
    expect(screen.queryByLabelText("spectrogram 3d line alpha")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "spectrogram mode" }));
    fireEvent.click(screen.getByRole("option", { name: "3D Surface" }));
    expect(onPanelControlsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ spectrogramMode: "surface" })
    );

    rerender(
      <PanelSettingsContent
        {...props}
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, spectrogramMode: "surface" }}
      />
    );
    // Shared view controls appear; the line-only ones do not.
    expect(screen.getByLabelText("spectrogram 3d elevation")).toBeTruthy();
    expect(screen.getByLabelText("spectrogram 3d height scale")).toBeTruthy();
    expect(screen.queryByLabelText("spectrogram 3d line alpha")).toBeNull();
    expect(screen.queryByLabelText("spectrogram 3d line width")).toBeNull();

    rerender(
      <PanelSettingsContent
        {...props}
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, spectrogramMode: "lines" }}
      />
    );
    expect(screen.getByLabelText("spectrogram 3d elevation")).toBeTruthy();
    expect(screen.getByLabelText("spectrogram 3d line alpha")).toBeTruthy();
    expect(screen.getByLabelText("spectrogram 3d line width")).toBeTruthy();
  });
```

The `aria-label` strings above are the ones already on those controls (`PanelSettingsContent.jsx:1360`, `:1415`, `:1463`, `:1481`) — do not invent new ones.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/components/PanelSettingsContent.test.jsx
```

Expected: FAIL — no element labelled `spectrogram mode`.

- [ ] **Step 3: Write the implementation**

In `src/components/PanelSettingsContent.jsx`:

Add `SPECTROGRAM_MODE_OPTIONS` to the existing import from `../lib/panelControls.js`.

Add near the other dropdown open-state hooks (around line 876):

```js
  const [spectrogramModeOpen, setSpectrogramModeOpen] = useState(false);
```

Replace the `3D View` `SettingsRow` (lines 1319-1335) with:

```js
            <SettingsRow
              label="Mode"
              tooltip="3D is a presentation view of the waterfall surface. There is no hover readout in 3D — switch back to 2D Heatmap to read exact values."
            >
              <SettingsSelect
                label={
                  (
                    SPECTROGRAM_MODE_OPTIONS.find(
                      (option) => option.id === normalizedPanelControls.spectrogramMode
                    ) ?? SPECTROGRAM_MODE_OPTIONS[0]
                  ).label
                }
                ariaLabel="spectrogram mode"
                options={SPECTROGRAM_MODE_OPTIONS}
                value={normalizedPanelControls.spectrogramMode}
                open={spectrogramModeOpen}
                onOpenChange={setSpectrogramModeOpen}
                onChange={(spectrogramMode) => {
                  onPanelControlsChange?.(
                    normalizePanelControls({
                      ...normalizedPanelControls,
                      spectrogramMode,
                    })
                  );
                }}
              />
            </SettingsRow>
```

Change the guard on line 1336 from `normalizedPanelControls.spectrogram3d ?` to:

```js
            {normalizedPanelControls.spectrogramMode !== "heatmap" ? (
```

Wrap **only** the Line Alpha and Line Width rows (the two blocks around lines 1460-1500) in a Lines-only guard, leaving Elevation, Azimuth, Height Scale, Colorize and Grid inside the shared 3D block:

```js
                {normalizedPanelControls.spectrogramMode === "lines" ? (
                  <>
                    {/* the existing Line Alpha SettingsRow */}
                    {/* the existing Line Width SettingsRow */}
                  </>
                ) : null}
```

In `src/components/panels/SpectrogramPanel.jsx`, replace line 86:

```js
  const spectrogramMode = normalizedPanelControls.spectrogramMode;
  const is3d = spectrogramMode !== "heatmap";
```

- [ ] **Step 4: Update the existing suites and run them**

Two suites set the retired key — `SpectrogramPanel.test.jsx` in 16 places and `PanelSettingsContent.test.jsx` in 4. Replace every occurrence of `spectrogram3d: true` with `spectrogramMode: "lines"` in both:

```bash
node -e "const fs=require('fs');for(const p of ['src/components/panels/SpectrogramPanel.test.jsx','src/components/PanelSettingsContent.test.jsx'])fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('spectrogram3d: true','spectrogramMode: \"lines\"'))"
```

One of those four in `PanelSettingsContent.test.jsx` is the reset-one-angle-at-a-time test at line 1300, which spreads `customControls` into an exact `toHaveBeenCalledWith`. It keeps passing after the rename because the whole object is spread, but read it once to confirm rather than assuming.

Then:

```bash
npx vitest run src/components/PanelSettingsContent.test.jsx src/components/panels/SpectrogramPanel.test.jsx
```

Expected: PASS. If any test still references `spectrogram3d`, grep for it and convert it — the key no longer exists:

```bash
git grep -n "spectrogram3d[^A-Za-z]" -- src
```

That should return nothing (`spectrogram3dColorize` and friends still exist and must survive).

- [ ] **Step 5: Commit**

```bash
git add src/components/PanelSettingsContent.jsx src/components/PanelSettingsContent.test.jsx src/components/panels/SpectrogramPanel.jsx src/components/panels/SpectrogramPanel.test.jsx
git commit -m "feat(spectrogram): select the view mode from a dropdown"
```

---

### Task 9: Wire the surface renderer into the canvas hook

No unit test: canvas work is not meaningfully testable under jsdom, which is why every testable piece was pushed into `spectrogram3dSurface.js`. This follows `useSpectrogramCanvas.js` and the Lines path, both of which are also untested.

**Files:**
- Modify: `src/hooks/useSpectrogram3dCanvas.js`
- Modify: `src/components/panels/SpectrogramPanel.jsx:350-361`

- [ ] **Step 1: Pass the mode into the hook**

In `src/components/panels/SpectrogramPanel.jsx`, add to the `useSpectrogram3dCanvas({ ... })` call (near line 354, alongside `azimuthDeg`):

```js
    mode: spectrogramMode,
```

- [ ] **Step 2: Thread the mode through the hook's params and repaint guard**

In `src/hooks/useSpectrogram3dCanvas.js`:

Add `mode,` to the destructured parameters of `useSpectrogram3dCanvas` (next to `floor,`).

Add `mode: undefined,` to the `lastPaintRef` initial object.

Add `mode,` to the object assigned to `paramsRef.current` **and** to that effect's dependency array.

Add to the repaint-skip comparison, alongside `last.floor === p.floor`:

```js
        last.mode === p.mode &&
```

and to the `lastPaintRef.current = { ... }` assignment:

```js
        mode: p.mode,
```

Missing any one of these produces a mode switch that silently does nothing, which looks exactly like a frozen render.

- [ ] **Step 3: Add the offscreen canvas and the ARGB colour helper**

Add these imports at the top of `src/hooks/useSpectrogram3dCanvas.js`:

```js
import {
  DEFAULT_COLUMN_STRIDE,
  buildRowLut,
  buildSurfaceLut,
  packArgb,
  rasterizeSurface,
} from "../math/spectrogram3dSurface.js";
```

Add these module-level helpers next to `cssVar`:

```js
/** Rows within this multiple of the mean row spacing count as covering a sample; see buildRowLut. */
const ROW_LUT_SIZE = 1024;
const ROW_GAP_TOLERANCE = 1.5;

/**
 * Resolve a CSS colour string to a packed ARGB word.
 *
 * The per-pixel renderer cannot ask the canvas to parse a colour per sample, and the theme's values
 * may be `oklch()`, which no amount of string handling will convert. So the canvas parses it once:
 * fill a single pixel and read it back. Cached on the string, because the only thing that changes it
 * is a theme switch.
 */
function makeArgbResolver() {
  let lastCss = null;
  let lastArgb = packArgb(255, 255, 255, 255);
  return (ctx, css) => {
    if (css === lastCss) return lastArgb;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    ctx.restore();
    lastCss = css;
    lastArgb = packArgb(r, g, b, a);
    return lastArgb;
  };
}
```

Inside the hook body, next to the other refs:

```js
  const offscreenRef = useRef(null);
  const surfaceLutRef = useRef({ key: null, lut: null });
  const resolveArgbRef = useRef(makeArgbResolver());
```

And a module-level helper for the offscreen surface:

```js
/**
 * A reused offscreen canvas plus a Uint32 view over its ImageData.
 *
 * The surface is composited with `drawImage` rather than `putImageData` because putImageData
 * OVERWRITES, alpha included -- writing the surface straight to the main canvas would erase the
 * floor grid drawn beneath it. Rebuilt only on resize.
 */
function ensureOffscreen(ref, width, height) {
  const current = ref.current;
  if (current && current.canvas.width === width && current.canvas.height === height) return current;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  const next = { canvas, ctx, image, pixels: new Uint32Array(image.data.buffer) };
  ref.current = next;
  return next;
}
```

- [ ] **Step 4: Branch the draw loop**

In the draw function, the scrub search currently sits inside the Lines path (lines 432-446) and both modes need it. Move the `let selectedRidge = -1; ...` block so it runs before the branch — it depends only on `grid` and `p`, so it can move as-is.

Then, immediately after that block, insert the surface branch and leave the whole existing Lines body in the `else`:

```js
      if (p.mode === "surface") {
        const off = ensureOffscreen(offscreenRef, W, H);
        const lutKey = `${p.colorize}|${p.dbFloor}|${p.colormapLut}`;
        if (surfaceLutRef.current.key !== lutKey) {
          surfaceLutRef.current = {
            key: lutKey,
            lut: buildSurfaceLut({
              colormapLut: p.colormapLut,
              dbFloor: p.dbFloor,
              colorize: p.colorize,
            }),
          };
        }
        const rowLut = buildRowLut(
          grid.tFracs,
          grid.count,
          ROW_LUT_SIZE,
          ROW_GAP_TOLERANCE / Math.max(1, grid.count - 1)
        );
        off.pixels.fill(0);
        rasterizeSurface({
          out: off.pixels,
          width: W,
          height: H,
          proj,
          grid,
          rowLut,
          lut: surfaceLutRef.current.lut,
          heightGain: view.heightGain,
          highlightArgb: resolveArgbRef.current(off.ctx, selection),
          highlightRow: selectedRidge,
          columnStride: DEFAULT_COLUMN_STRIDE,
          maxSteps: H,
        });
        off.ctx.putImageData(off.image, 0, 0);
        ctx.drawImage(off.canvas, 0, 0);
        return;
      }
```

Note the ordering this relies on: `drawFloor` / `drawAxisLabels` already ran above (lines 416-419), so the grid is underneath the composite. Do not move the surface branch above them.

`resolveArgbRef` writes a pixel into the offscreen canvas, so it must be called **before** `off.pixels.fill(0)`. Hoist it into a local above the `fill` if you prefer that to relying on argument evaluation order — the version above evaluates it after the fill, which would leave one stray pixel, so change it to:

```js
        const highlightArgb = resolveArgbRef.current(off.ctx, selection);
        off.pixels.fill(0);
```

and pass `highlightArgb` in the call.

- [ ] **Step 5: Verify in the real app**

```bash
npm run desktop
```

Walk the acceptance list from the spec: switch through all three modes; confirm Surface renders as a solid shaded relief with peaks occluding what is behind them; toggle Colorize and confirm it reads as one continuous palette; confirm the floor grid stays visible around the silhouette and the panel background shows through; rotate with right-drag and confirm shading stays stable; scrub and confirm the highlight appears where the moment is visible; switch Lines ↔ Surface and confirm viewpoint, height scale, time window and frequency range all survive.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSpectrogram3dCanvas.js src/components/panels/SpectrogramPanel.jsx
git commit -m "feat(spectrogram): render the 3D surface mode"
```

---

### Task 10: Close out

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-spectrogram-3d-surface-design.md`

- [ ] **Step 1: Run the merge gate**

```bash
npm run check
```

Expected: all green. If the Rust half fails with `could not compile serde_derive`, the worktree is missing the FFmpeg sidecars — run `npm run ffmpeg:fetch` and retry. Do not go debugging the dependency tree; see the pitfall in `AGENTS.md`.

- [ ] **Step 2: Record what actually shipped**

Set the spec's **Status** to `Implemented`. If anything was reversed while building — as four things were on the Lines mode — add a **Reversed during implementation** section saying what was decided, what happened, and why, in that shape. Do not quietly delete the original decision.

Fill in the measured stride numbers in the spec's Performance section from Task 5.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-30-spectrogram-3d-surface-design.md
git commit -m "docs: record the shipped Spectrogram 3D Surface implementation"
```

- [ ] **Step 4: Report, do not merge**

Per `AGENTS.md`, moving work on or off `main` is the user's call. Report that the branch is ready and let them decide. The capture layer was not touched, so no `smoke:capture` or `soak:capture` run is required by this change.
