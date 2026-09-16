# Spectrogram 3D Waterfall View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3D hidden-line waterfall view mode to the existing Spectrogram panel, toggled per panel, sharing the 2D view's data, time window and scrub state.

**Architecture:** Two pure modules (projection math, grid sampling) under `src/math/`, one rendering hook under `src/hooks/` mirroring the existing `useSpectrogramCanvas`, and a view-mode branch in `SpectrogramPanel.jsx`. Rendering is Canvas 2D with painter's algorithm — oldest ridge first, each ridge filled opaque with the panel background so it occludes the ones behind. No WebGL, no Rust, no IPC changes.

**Tech Stack:** React 19, Canvas 2D, Vitest. Design spec: `docs/superpowers/specs/2026-07-28-spectrogram-3d-view-design.md`.

**Read the spec before starting.** This plan implements it; where they disagree, the spec wins and the plan should be corrected.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/math/spectrogram3dProjection.js` (create) | Orthographic axonometric projection, view-parameter clamping. No data access. |
| `src/math/spectrogram3dProjection.test.js` (create) | Tests for the above. |
| `src/math/spectrogram3dGrid.js` (create) | Downsample the slab view into a ridge grid. Knows the slab, not the canvas. |
| `src/math/spectrogram3dGrid.test.js` (create) | Tests for the above. |
| `src/hooks/useSpectrogram3dCanvas.js` (create) | rAF loop, canvas drawing. No test, matching `useSpectrogramCanvas.js`. |
| `src/components/panels/SpectrogramPanel.jsx` (modify) | View-mode branch, overlay suppression, rail rebinding. |
| `src/lib/panelControls.js` (modify) | Five new keys plus normalizers. |
| `src/components/PanelSettingsContent.jsx` (modify) | `3D View`, `Colorize`, `Height Gain`, `Reset View`. |
| `src/components/panels/chartHelp.js` (modify) | Help entries for 3D mode. |

The projection and grid modules are split because they have different dependencies: projection is pure trigonometry, grid needs the slab and timeline helpers. Keeping them apart means the projection tests need no fixtures at all.

---

### Task 1: Projection math

**Files:**
- Create: `src/math/spectrogram3dProjection.js`
- Test: `src/math/spectrogram3dProjection.test.js`

The projection is orthographic axonometric: rotate the floor plane by azimuth, foreshorten depth by `sin(elevation)`, scale height by `cos(elevation)`. Inputs are unit-cube coordinates — `tFrac` and `fFrac` in `[0,1]` across the visible window, `hNorm` in `[0,1]` across the dB range.

- [ ] **Step 1: Write the failing tests**

Create `src/math/spectrogram3dProjection.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  buildProjection,
  projectPoint,
  clampViewParams,
} from "./spectrogram3dProjection.js";

const VIEW = { width: 400, height: 300 };

describe("clampViewParams", () => {
  it("clamps elevation to a usable band", () => {
    expect(clampViewParams({ elevationDeg: 0 }).elevationDeg).toBe(5);
    expect(clampViewParams({ elevationDeg: 89 }).elevationDeg).toBe(70);
    expect(clampViewParams({ elevationDeg: 30 }).elevationDeg).toBe(30);
  });

  it("wraps azimuth instead of clamping it", () => {
    expect(clampViewParams({ azimuthDeg: 370 }).azimuthDeg).toBe(10);
    expect(clampViewParams({ azimuthDeg: -10 }).azimuthDeg).toBe(350);
    expect(clampViewParams({ azimuthDeg: 720 }).azimuthDeg).toBe(0);
  });

  it("clamps height gain and falls back on non-numbers", () => {
    expect(clampViewParams({ heightGain: 0.1 }).heightGain).toBe(0.3);
    expect(clampViewParams({ heightGain: 9 }).heightGain).toBe(3);
    expect(clampViewParams({ heightGain: Number.NaN }).heightGain).toBe(1);
  });
});

describe("projectPoint", () => {
  it("moves the time axis horizontally only at azimuth 0", () => {
    const proj = buildProjection({ azimuthDeg: 0, elevationDeg: 30, ...VIEW });
    const a = projectPoint(0, 0.5, 0, proj);
    const b = projectPoint(1, 0.5, 0, proj);
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(b.x).toBeGreaterThan(a.x);
  });

  it("keeps the height axis vertical at every azimuth", () => {
    for (const azimuthDeg of [0, 37, 90, 180, 271]) {
      const proj = buildProjection({ azimuthDeg, elevationDeg: 25, ...VIEW });
      const base = projectPoint(0.5, 0.5, 0, proj);
      const top = projectPoint(0.5, 0.5, 1, proj);
      expect(top.x).toBeCloseTo(base.x, 6);
      expect(top.y).toBeLessThan(base.y);
    }
  });

  // This is the invariant the shared Colorize gradient depends on: dB maps to vertical
  // displacement from the baseline by one scene-wide constant, with no depth foreshortening.
  it("applies one scene-wide height scale regardless of position", () => {
    const proj = buildProjection({ azimuthDeg: 40, elevationDeg: 25, ...VIEW });
    const near = projectPoint(0, 0, 0, proj).y - projectPoint(0, 0, 1, proj).y;
    const far = projectPoint(1, 1, 0, proj).y - projectPoint(1, 1, 1, proj).y;
    expect(far).toBeCloseTo(near, 6);
    expect(near).toBeCloseTo(proj.heightScale, 6);
  });

  // Every ridge baseline is parallel, which is what lets one shear flatten all of them.
  it("gives every ridge baseline the same slope", () => {
    const proj = buildProjection({ azimuthDeg: 40, elevationDeg: 25, ...VIEW });
    const slopeAt = (tFrac) => {
      const a = projectPoint(tFrac, 0, 0, proj);
      const b = projectPoint(tFrac, 1, 0, proj);
      return (b.y - a.y) / (b.x - a.x);
    };
    expect(slopeAt(0.9)).toBeCloseTo(slopeAt(0.1), 6);
    expect(proj.baselineSlope).toBeCloseTo(slopeAt(0.5), 6);
  });

  it("fits the whole unit cube inside the canvas", () => {
    const proj = buildProjection({ azimuthDeg: 33, elevationDeg: 40, ...VIEW });
    for (const t of [0, 1]) {
      for (const f of [0, 1]) {
        for (const h of [0, 1]) {
          const p = projectPoint(t, f, h, proj);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(VIEW.width);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(VIEW.height);
        }
      }
    }
  });

  it("draws oldest-first while time recedes from the viewer", () => {
    const away = buildProjection({ azimuthDeg: 200, elevationDeg: 25, ...VIEW });
    const toward = buildProjection({ azimuthDeg: 20, elevationDeg: 25, ...VIEW });
    expect(away.ridgeOrderAscending).not.toBe(toward.ridgeOrderAscending);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/math/spectrogram3dProjection.test.js`
Expected: FAIL — `Failed to resolve import "./spectrogram3dProjection.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/math/spectrogram3dProjection.js`:

```js
/**
 * Orthographic axonometric projection for the 3D spectrogram waterfall.
 *
 * Pure: no canvas, no React, no data access. Inputs are unit-cube coordinates — tFrac and fFrac
 * span the visible time window and frequency range, hNorm spans the dB range.
 *
 * Orthographic rather than perspective on purpose: perspective would compress the far end of the
 * time axis, and this view shares its time window with the 2D heatmap, so unequal time spacing
 * would misread. It also keeps dB -> screen height a single scene-wide linear map, which is what
 * lets the Colorize gradient be built once per repaint instead of once per ridge.
 */

const ELEVATION_MIN_DEG = 5;
const ELEVATION_MAX_DEG = 70;
const HEIGHT_GAIN_MIN = 0.3;
const HEIGHT_GAIN_MAX = 3;
const DEFAULT_HEIGHT_GAIN = 1;
const FIT_MARGIN = 0.92;

const DEG = Math.PI / 180;

function finiteOr(raw, fallback) {
  return Number.isFinite(raw) ? raw : fallback;
}

/**
 * Elevation is clamped at both ends: at 0 degrees the surface collapses to a line, and past about
 * 70 degrees it degenerates into a skewed top-down view that is strictly worse than the 2D mode.
 * Azimuth wraps rather than clamping, because spinning past 360 is a legitimate drag.
 */
export function clampViewParams({ azimuthDeg, elevationDeg, heightGain } = {}) {
  const rawAzimuth = finiteOr(azimuthDeg, 45);
  return {
    azimuthDeg: ((rawAzimuth % 360) + 360) % 360,
    elevationDeg: Math.min(
      ELEVATION_MAX_DEG,
      Math.max(ELEVATION_MIN_DEG, finiteOr(elevationDeg, 22))
    ),
    heightGain: Math.min(
      HEIGHT_GAIN_MAX,
      Math.max(HEIGHT_GAIN_MIN, finiteOr(heightGain, DEFAULT_HEIGHT_GAIN))
    ),
  };
}

/**
 * Precompute the projection for one repaint.
 *
 * Returns the six affine coefficients plus three derived values the renderer needs:
 * `heightScale` (dB -> vertical pixels), `baselineSlope` (the shear that flattens every ridge
 * baseline) and `ridgeOrderAscending` (painter's-algorithm draw order).
 */
export function buildProjection({ azimuthDeg, elevationDeg, width, height }) {
  const view = clampViewParams({ azimuthDeg, elevationDeg });
  const az = view.azimuthDeg * DEG;
  const el = view.elevationDeg * DEG;
  const cosAz = Math.cos(az);
  const sinAz = Math.sin(az);
  const depth = Math.sin(el);
  const rise = Math.cos(el);

  // Unit-space basis, centred on the floor so rotation happens about the middle of the scene.
  const tx = cosAz;
  const ty = sinAz * depth;
  const fx = -sinAz;
  const fy = cosAz * depth;
  const hy = -rise;

  // Fit: project all eight corners of the unit cube, then scale so the bounding box fills the
  // canvas. Doing this per repaint keeps the scene framed while the user rotates.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of [-0.5, 0.5]) {
    for (const f of [-0.5, 0.5]) {
      for (const h of [0, 1]) {
        const x = t * tx + f * fx;
        const y = t * ty + f * fy + h * hy;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min(width / spanX, height / spanY) * FIT_MARGIN;
  const originX = width / 2 - ((minX + maxX) / 2) * scale;
  const originY = height / 2 - ((minY + maxY) / 2) * scale;

  return {
    originX,
    originY,
    tx: tx * scale,
    ty: ty * scale,
    fx: fx * scale,
    fy: fy * scale,
    hy: hy * scale,
    heightScale: rise * scale,
    // Every baseline is parallel because the projection is affine, so one shear flattens them all.
    baselineSlope: (fy * scale) / (fx * scale),
    // Larger screen y is nearer the viewer. Draw the far end first so the newest frame, which is
    // what live monitoring watches, ends up unoccluded on top.
    ridgeOrderAscending: ty <= 0,
  };
}

export function projectPoint(tFrac, fFrac, hNorm, proj) {
  const t = tFrac - 0.5;
  const f = fFrac - 0.5;
  return {
    x: proj.originX + t * proj.tx + f * proj.fx,
    y: proj.originY + t * proj.ty + f * proj.fy + hNorm * proj.hy,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/math/spectrogram3dProjection.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dProjection.js src/math/spectrogram3dProjection.test.js
git commit -m "feat(spectrogram): add orthographic projection math for the 3D view"
```

---

### Task 2: Ridge grid sampling

**Files:**
- Create: `src/math/spectrogram3dGrid.js`
- Test: `src/math/spectrogram3dGrid.test.js`

Downsamples the slab into a fixed ridge count. This mirrors the long-zoom branch already in `src/hooks/useSpectrogramCanvas.js:51-63`, which resolves the newest active frame per screen column; here the column count is `ridgeCount` instead of canvas width.

The critical behaviour: **a real gap in time must stay empty.** The 2D path leaves gap columns unpainted; 3D must mark those ridges absent rather than stretching the previous frame across them.

- [ ] **Step 1: Write the failing tests**

Create `src/math/spectrogram3dGrid.test.js`:

```js
import { describe, expect, it } from "vitest";
import { sampleWaterfallGrid } from "./spectrogram3dGrid.js";
import { SPECTROGRAM_DB_MIN, SPECTROGRAM_DB_MAX } from "../config/scales.js";

const SAMPLE_MS = 40;

function viewOf(rows) {
  return {
    get length() {
      return rows.length;
    },
    version: 0,
    timestampAt: (i) => (i >= 0 && i < rows.length ? rows[i].timestampMs : NaN),
    rowAt: (i) => (i >= 0 && i < rows.length ? rows[i] : undefined),
  };
}

/** Frames at a fixed cadence, every band held at the same dB so assertions stay readable. */
function framesAt(timestamps, db) {
  return viewOf(
    timestamps.map((timestampMs) => ({
      timestampMs,
      bands: [{ fCenter: 100 }, { fCenter: 1000 }],
      dbList: [db, db],
    }))
  );
}

const Y_TO_BAND = Int16Array.from([0, 1]);

describe("sampleWaterfallGrid", () => {
  it("produces exactly ridgeCount ridges regardless of frame count", () => {
    const view = framesAt([0, 40, 80, 120, 160, 200], -20);
    const grid = sampleWaterfallGrid({
      view,
      startIdx: 0,
      endIdx: 5,
      oldestMs: 0,
      span: 240,
      sampleMs: SAMPLE_MS,
      ridgeCount: 4,
      yToBand: Y_TO_BAND,
    });
    expect(grid.present).toHaveLength(4);
    expect(grid.timestamps).toHaveLength(4);
    expect(grid.heights).toHaveLength(4 * 2);
    expect(grid.pointCount).toBe(2);
  });

  it("normalises dB to 0..1 across the spectrogram range", () => {
    const view = framesAt([0, 40], SPECTROGRAM_DB_MAX);
    const grid = sampleWaterfallGrid({
      view,
      startIdx: 0,
      endIdx: 1,
      oldestMs: 0,
      span: 80,
      sampleMs: SAMPLE_MS,
      ridgeCount: 2,
      yToBand: Y_TO_BAND,
    });
    expect(grid.heights[0]).toBeCloseTo(1, 6);

    const floor = framesAt([0, 40], SPECTROGRAM_DB_MIN - 50);
    const floorGrid = sampleWaterfallGrid({
      view: floor,
      startIdx: 0,
      endIdx: 1,
      oldestMs: 0,
      span: 80,
      sampleMs: SAMPLE_MS,
      ridgeCount: 2,
      yToBand: Y_TO_BAND,
    });
    expect(floorGrid.heights[0]).toBe(0);
  });

  // The 2D path leaves genuine timestamp gaps unpainted. 3D must not invent a surface across them.
  it("marks ridges inside a real timestamp gap as absent", () => {
    const view = framesAt([0, 40, 1000, 1040], -20);
    const grid = sampleWaterfallGrid({
      view,
      startIdx: 0,
      endIdx: 3,
      oldestMs: 0,
      span: 1080,
      sampleMs: SAMPLE_MS,
      ridgeCount: 12,
      yToBand: Y_TO_BAND,
    });
    expect(Array.from(grid.present)).toContain(0);
    expect(Array.from(grid.present)).toContain(1);
    // The gap sits in the middle of the window, so a mid ridge must be absent.
    expect(grid.present[6]).toBe(0);
  });

  it("marks every ridge present when frames are continuous", () => {
    const timestamps = [];
    for (let ts = 0; ts <= 400; ts += SAMPLE_MS) timestamps.push(ts);
    const view = framesAt(timestamps, -20);
    const grid = sampleWaterfallGrid({
      view,
      startIdx: 0,
      endIdx: timestamps.length - 1,
      oldestMs: 0,
      span: 400,
      sampleMs: SAMPLE_MS,
      ridgeCount: 8,
      yToBand: Y_TO_BAND,
    });
    expect(Array.from(grid.present).every((v) => v === 1)).toBe(true);
  });

  it("returns an empty grid when the window holds no frames", () => {
    const grid = sampleWaterfallGrid({
      view: viewOf([]),
      startIdx: 0,
      endIdx: -1,
      oldestMs: 0,
      span: 100,
      sampleMs: SAMPLE_MS,
      ridgeCount: 4,
      yToBand: Y_TO_BAND,
    });
    expect(Array.from(grid.present).every((v) => v === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/math/spectrogram3dGrid.test.js`
Expected: FAIL — `Failed to resolve import "./spectrogram3dGrid.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/math/spectrogram3dGrid.js`:

```js
import { SPECTROGRAM_DB_MIN, SPECTROGRAM_DB_MAX } from "../config/scales.js";
import { spectrogramFrameEndMs } from "./spectrogramTimeline.js";

/**
 * Downsample the spectrogram slab into a fixed-size ridge grid for the 3D waterfall.
 *
 * Same resolution strategy as the 2D long-zoom branch in useSpectrogramCanvas: for each output
 * slot, binary-search the newest frame whose own time span covers that slot. Frames outside any
 * span leave the ridge absent, so real capture gaps render as empty space exactly as they do in 2D
 * instead of being smeared across by the previous frame.
 */

const DB_RANGE = SPECTROGRAM_DB_MAX - SPECTROGRAM_DB_MIN;

/** First index whose timestamp is greater than target. View is ascending by timestamp. */
function upperBoundTimestamp(view, target, startIdx, endIdx) {
  let lo = startIdx;
  let hi = endIdx + 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (view.timestampAt(mid) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function sampleWaterfallGrid({
  view,
  startIdx,
  endIdx,
  oldestMs,
  span,
  sampleMs,
  ridgeCount,
  yToBand,
}) {
  const pointCount = yToBand.length;
  const heights = new Float32Array(ridgeCount * pointCount);
  const present = new Uint8Array(ridgeCount);
  const timestamps = new Float64Array(ridgeCount);

  if (!view || endIdx < startIdx || !(span > 0)) {
    return { heights, present, timestamps, ridgeCount, pointCount };
  }

  for (let r = 0; r < ridgeCount; r++) {
    const targetMs = oldestMs + ((r + 0.5) / ridgeCount) * span;
    const index = upperBoundTimestamp(view, targetMs, startIdx, endIdx) - 1;
    if (index < startIdx || index > endIdx) continue;

    const snap = view.rowAt(index);
    const dbList = snap?.dbList;
    if (!dbList || !Number.isFinite(snap.timestampMs)) continue;

    const frameEndMs = spectrogramFrameEndMs(view, index, sampleMs);
    if (!(targetMs >= snap.timestampMs && targetMs < frameEndMs)) continue;

    const base = r * pointCount;
    for (let p = 0; p < pointCount; p++) {
      const db = dbList[yToBand[p]];
      const norm = Number.isFinite(db) ? (db - SPECTROGRAM_DB_MIN) / DB_RANGE : 0;
      heights[base + p] = norm < 0 ? 0 : norm > 1 ? 1 : norm;
    }
    present[r] = 1;
    timestamps[r] = snap.timestampMs;
  }

  return { heights, present, timestamps, ridgeCount, pointCount };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/math/spectrogram3dGrid.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/math/spectrogram3dGrid.js src/math/spectrogram3dGrid.test.js
git commit -m "feat(spectrogram): add ridge grid sampling for the 3D view"
```

---

### Task 3: Rendering hook

**Files:**
- Create: `src/hooks/useSpectrogram3dCanvas.js`
- Modify: `src/components/panels/SpectrogramPanel.jsx`

No test file. `src/hooks/useSpectrogramCanvas.js` has none either — canvas drawing is not meaningfully testable under jsdom, which is why all the testable logic was pushed into Tasks 1 and 2. Verification here is visual.

> **Correction, found during execution:** the hook code below omits the repaint-skip guard, which
> the spec requires. Spectrum frames arrive at 25 Hz and the window advances at 10 Hz, so a live 3D
> view needs ~25 repaints/second; without the guard it redraws at display rate and does 2.4x the
> work, which would also make Task 4 measure the wrong thing. Mirror `useSpectrogramCanvas.js`'s
> `lastPaintRef` block, and include the 3D-only inputs — `azimuthDeg`, `elevationDeg`, `heightGain`,
> `colorize`, `selectionXFrac` — in the comparison, or rotation and height-gain drags produce no
> visible response. Read `length` and `version` from the resolved `frozenSnaps ?? snapRef.current`
> value, not from `snapRef.current` directly, or frozen-snapshot mode compares the wrong source.

This task wires the hook behind a **temporary module constant** so it can be seen before the settings UI exists. Task 5 replaces that constant with the real control.

Frequency sampling reuses `buildYToBand(bands, pointCount, minHz, maxHz)` unchanged — its second argument is just "how many sample points", so 2D and 3D cannot drift apart on frequency mapping.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useSpectrogram3dCanvas.js`:

```js
import { useEffect, useRef } from "react";
import { buildYToBand } from "../math/spectrogramMath.js";
import { inWindowRange } from "../math/spectrogramTimeline.js";
import { buildProjection, projectPoint, clampViewParams } from "../math/spectrogram3dProjection.js";
import { sampleWaterfallGrid } from "../math/spectrogram3dGrid.js";

// Cost tracks the product of these two, so they can be traded against each other while tuning:
// more ridges reads as denser time resolution, more points as finer spectral detail.
const RIDGE_TARGET_DIVISOR = 14;
const RIDGE_MIN = 24;
const RIDGE_MAX = 140;
const POINT_TARGET_DIVISOR = 6;
const POINT_MIN = 60;
const POINT_MAX = 320;
const GRADIENT_STOPS = 32;

function ridgeCountFor(widthPx) {
  return Math.round(Math.min(RIDGE_MAX, Math.max(RIDGE_MIN, widthPx / RIDGE_TARGET_DIVISOR)));
}

function pointCountFor(widthPx) {
  return Math.round(Math.min(POINT_MAX, Math.max(POINT_MIN, widthPx / POINT_TARGET_DIVISOR)));
}

function cssVar(el, name, fallback) {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/** Opaque fill colour is what performs the hidden-line removal, so it must not be transparent. */
function resolveSurface(canvas) {
  let node = canvas.parentElement;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !bg.startsWith("rgba(0, 0, 0, 0)")) return bg;
    node = node.parentElement;
  }
  return cssVar(canvas, "--background", "#000");
}

function buildColorGradient(ctx, colormapLut, heightPx) {
  const gradient = ctx.createLinearGradient(0, 0, 0, -heightPx);
  for (let s = 0; s <= GRADIENT_STOPS; s++) {
    const frac = s / GRADIENT_STOPS;
    const idx = Math.round(frac * 255) * 3;
    gradient.addColorStop(
      frac,
      `rgb(${colormapLut[idx]},${colormapLut[idx + 1]},${colormapLut[idx + 2]})`
    );
  }
  return gradient;
}

export function useSpectrogram3dCanvas({
  canvasRef,
  snapRef,
  oldestMs,
  newestMs,
  sampleMs,
  selectedOffset,
  selectionXFrac,
  frozenSnaps,
  colormapLut,
  minHz = 20,
  maxHz = 20000,
  azimuthDeg,
  elevationDeg,
  heightGain,
  colorize,
}) {
  const rafRef = useRef(null);
  const paramsRef = useRef({});
  const cacheRef = useRef({ pointCount: 0, minHz: 0, maxHz: 0, bands: null, yToBand: null });

  useEffect(() => {
    paramsRef.current = {
      oldestMs,
      newestMs,
      sampleMs,
      selectedOffset,
      selectionXFrac,
      frozenSnaps,
      colormapLut,
      minHz,
      maxHz,
      azimuthDeg,
      elevationDeg,
      heightGain,
      colorize,
    };
  }, [
    oldestMs,
    newestMs,
    sampleMs,
    selectedOffset,
    selectionXFrac,
    frozenSnaps,
    colormapLut,
    minHz,
    maxHz,
    azimuthDeg,
    elevationDeg,
    heightGain,
    colorize,
  ]);

  useEffect(() => {
    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      if (W === 0 || H === 0) return;

      const p = paramsRef.current;
      if (!p.colormapLut || p.colormapLut.length < 256 * 3) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const snaps = p.frozenSnaps ?? snapRef.current;
      const span =
        Number.isFinite(p.oldestMs) && Number.isFinite(p.newestMs) ? p.newestMs - p.oldestMs : 0;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const newest = snaps && snaps.length > 0 ? snaps.rowAt(snaps.length - 1) : null;
      const bands = newest?.bands;
      if (!bands || bands.length === 0 || span <= 0) return;

      const view = clampViewParams({
        azimuthDeg: p.azimuthDeg,
        elevationDeg: p.elevationDeg,
        heightGain: p.heightGain,
      });
      const proj = buildProjection({
        azimuthDeg: view.azimuthDeg,
        elevationDeg: view.elevationDeg,
        width: W,
        height: H,
      });

      const pointCount = pointCountFor(W);
      const cache = cacheRef.current;
      if (
        cache.pointCount !== pointCount ||
        cache.minHz !== p.minHz ||
        cache.maxHz !== p.maxHz ||
        cache.bands !== bands
      ) {
        cache.yToBand = buildYToBand(bands, pointCount, p.minHz, p.maxHz);
        cache.pointCount = pointCount;
        cache.minHz = p.minHz;
        cache.maxHz = p.maxHz;
        cache.bands = bands;
      }

      const { startIdx, endIdx } = inWindowRange(snaps, p.oldestMs, p.newestMs);
      if (endIdx < startIdx) return;

      const ridgeCount = ridgeCountFor(W);
      const grid = sampleWaterfallGrid({
        view: snaps,
        startIdx,
        endIdx,
        oldestMs: p.oldestMs,
        span,
        sampleMs: p.sampleMs,
        ridgeCount,
        yToBand: cache.yToBand,
      });

      const surface = resolveSurface(canvas);
      const ink = cssVar(canvas, "--muted-foreground", "#888");
      const selection = cssVar(canvas, "--ui-loudness-selection", ink);
      const heightPx = proj.heightScale * view.heightGain;

      // Colorize builds ONE gradient per repaint. It is expressed in a sheared space where every
      // ridge baseline is horizontal — the projection is affine, so all baselines share a slope and
      // a single shear flattens them together. Per ridge only a translate is then needed.
      // At azimuth 0 and 180 the frequency axis has no horizontal extent, so baselineSlope is
      // +/-Infinity. That is a legitimate degenerate view, not an error — but feeding it to
      // setTransform would corrupt the canvas matrix, so fall back to a monochrome stroke for
      // those angles rather than shearing by infinity.
      const canShear = Number.isFinite(proj.baselineSlope);
      let gradient = null;
      if (p.colorize && canShear) {
        ctx.setTransform(1, proj.baselineSlope, 0, 1, 0, 0);
        gradient = buildColorGradient(ctx, p.colormapLut, heightPx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // Scrub feedback: a vertical line through a 3D scene means nothing, so the selected ridge is
      // highlighted instead. selectionXFrac is the same 0..1 window fraction the 2D selection line
      // uses, so both modes mark the same moment.
      const selectedRidge =
        p.selectedOffset >= 0 && Number.isFinite(p.selectionXFrac)
          ? Math.min(ridgeCount - 1, Math.max(0, Math.round(p.selectionXFrac * (ridgeCount - 1))))
          : -1;

      ctx.lineJoin = "round";
      ctx.lineWidth = 1;

      // Painter's algorithm: far ridges first so nearer ones occlude them. Direction depends on
      // azimuth, which is why buildProjection reports it rather than assuming it.
      const first = proj.ridgeOrderAscending ? 0 : ridgeCount - 1;
      const step = proj.ridgeOrderAscending ? 1 : -1;
      for (let n = 0; n < ridgeCount; n++) {
        const r = first + n * step;
        if (!grid.present[r]) continue;
        const tFrac = (r + 0.5) / ridgeCount;
        const base = r * grid.pointCount;

        ctx.beginPath();
        for (let q = 0; q < grid.pointCount; q++) {
          const fFrac = q / (grid.pointCount - 1);
          const pt = projectPoint(tFrac, fFrac, grid.heights[base + q] * view.heightGain, proj);
          if (q === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        const endBase = projectPoint(tFrac, 1, 0, proj);
        const startBase = projectPoint(tFrac, 0, 0, proj);
        ctx.lineTo(endBase.x, endBase.y);
        ctx.lineTo(startBase.x, startBase.y);
        ctx.closePath();

        ctx.fillStyle = surface;
        ctx.fill();

        if (r === selectedRidge) {
          ctx.strokeStyle = selection;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.lineWidth = 1;
        } else if (gradient) {
          // Order matters and is easy to get wrong: the transform must be in effect WHEN the
          // gradient is used as strokeStyle and when stroke() runs, because gradient coordinates
          // resolve against the CTM at paint time. Setting strokeStyle inside save/restore and
          // stroking after the restore silently reverts it.
          ctx.save();
          ctx.transform(1, proj.baselineSlope, 0, 1, 0, 0);
          ctx.translate(0, startBase.y - proj.baselineSlope * startBase.x);
          ctx.strokeStyle = gradient;
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.strokeStyle = ink;
          ctx.stroke();
        }
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [canvasRef, snapRef]);
}
```

- [ ] **Step 2: Wire it behind a temporary constant**

In `src/components/panels/SpectrogramPanel.jsx`, add the import next to the existing `useSpectrogramCanvas` import:

```js
import { useSpectrogram3dCanvas } from "../../hooks/useSpectrogram3dCanvas";
```

Add below the `ACTIVE_PULSE_MS` constant near the top of the file:

```js
// TEMPORARY: flipped by hand to look at the 3D renderer before the settings control exists.
// Task 5 of the implementation plan replaces this with panelControls.spectrogram3d.
const FORCE_3D = false;
```

Then, immediately after the existing `useSpectrogramCanvas({ ... })` call, add:

```js
  useSpectrogram3dCanvas({
    canvasRef: FORCE_3D ? canvasRef : { current: null },
    snapRef,
    oldestMs,
    newestMs,
    sampleMs,
    selectedOffset,
    selectionXFrac: selLineX / 600,
    frozenSnaps: selectedOffset >= 0 ? spectrogramSnaps : null,
    colormapLut,
    minHz: normalizedPanelControls.spectrogramYMinFreq,
    maxHz: normalizedPanelControls.spectrogramYMaxFreq,
    azimuthDeg: 45,
    elevationDeg: 22,
    heightGain: 1,
    colorize: false,
  });
```

Passing `{ current: null }` when the flag is off makes the hook return early each frame without drawing, so the 2D path is untouched while the flag is false.

- [ ] **Step 3: Look at it**

Set `FORCE_3D = true`, then run:

```bash
npm run desktop
```

Start capture, play audio, open a Spectrogram panel. Expected: a solid ridged surface, oldest ridges at the back, newest unoccluded at the front. Real capture gaps appear as missing ridges.

If the surface looks inside-out or the ridges draw in the wrong order, check `proj.ridgeOrderAscending` before touching anything else.

Then set `colorize: true` in the hook call and look again. Expected: ridge lines run through the theme colormap by height. **This is the step most likely to misbehave** — the shear-plus-translate gradient relies on gradient coordinates resolving against the CTM at paint time, and it is worth confirming visually rather than assuming.

If the colours come out flat, uniform, or skewed relative to the ridge, the fallback is a **per-ridge gradient**: move `buildColorGradient` inside the ridge loop, build it from `startBase` to `startBase.y − heightPx`, and drop the shear entirely. That costs roughly 120 `createLinearGradient` plus 3800 `addColorStop` calls per repaint — still far cheaper than per-run strokes, and Task 4 will measure whether it matters. Record which variant you shipped.

- [ ] **Step 4: Set the flag back and run the suite**

Set `FORCE_3D = false`. Then:

```bash
npm test
```

Expected: PASS, same counts as the baseline (230 files, 2326 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSpectrogram3dCanvas.js src/components/panels/SpectrogramPanel.jsx
git commit -m "feat(spectrogram): add 3D waterfall renderer behind a temporary flag"
```

---

### Task 4: Performance gate

**Files:**
- Modify: `src/hooks/useSpectrogram3dCanvas.js` (temporary instrumentation, removed in this same task)

**This task produces no shippable code. It is a decision point.** The spec places it here deliberately: Tasks 1–3 have no callers yet and can be reworked cheaply, whereas Task 5 onward starts accumulating coupling.

Budgets from the spec's Performance Model: spectrum frames arrive at 25 Hz and the window advances at 10 Hz, so a live view repaints ~25 times per second, not 60.

- **Steady state: 40 ms per repaint**
- **While dragging or rotating: 16.7 ms per repaint**

Measure the repaint itself, **not** the observed frame rate. At 25 Hz data an idle 3D view is supposed to skip most display frames; a "25fps" reading is the design working, not a regression.

- [ ] **Step 1: Add temporary instrumentation**

In `src/hooks/useSpectrogram3dCanvas.js`, inside `draw()`, capture the start immediately after the `const ctx = canvas.getContext("2d");` guard:

```js
      const t0 = performance.now();
```

And at the very end of `draw()`, after the ridge loop closes:

```js
      // TEMPORARY: performance gate instrumentation, removed at the end of Task 4.
      const dt = performance.now() - t0;
      const stats = (window.__plvs3d ??= { n: 0, sum: 0, max: 0 });
      stats.n += 1;
      stats.sum += dt;
      stats.max = Math.max(stats.max, dt);
      if (stats.n >= 60) {
        // eslint-disable-next-line no-console
        console.log(`3D repaint mean ${(stats.sum / stats.n).toFixed(2)}ms max ${stats.max.toFixed(2)}ms`);
        stats.n = 0;
        stats.sum = 0;
        stats.max = 0;
      }
```

- [ ] **Step 2: Measure the worst case**

Set `FORCE_3D = true`, then:

```bash
npm run desktop
```

Then, in order:
1. Maximise the window and make the Spectrogram panel as large as it goes.
2. Drag the time axis rail to the longest available window.
3. Play dense material — full-band music, not a sine.
4. Read the console for 30 seconds while idle. **Record mean and max.**
5. Drag the chart left/right continuously for 10 seconds. **Record mean and max again.**

- [ ] **Step 3: Judge against the budgets**

- Idle mean under 40 ms **and** drag mean under 16.7 ms → pass, continue to Step 5.
- Otherwise → apply fallbacks in this order, re-measuring after each:
  1. Lower `RIDGE_MAX` and `POINT_MAX` in the hook. Cost tracks their product, so trade freely.
  2. If profiling shows fill dominating rather than path building, switch to **floating horizon** as described in the spec's Rendering section. Note this changes the look from solid to wireframe — it is a design change, so raise it rather than doing it silently.
  3. Accept a throttled repaint during rotation only.

**Not a fallback:** forcing `Colorize` off. The shared gradient makes it free; if turning it off appears to help, the gradient has been implemented wrong — the likely bug is building it per ridge instead of once per repaint.

**Not a fallback:** shortening the time window. That reverses a core design decision.

- [ ] **Step 4: Record the numbers in the spec**

Append the measured figures to the Performance Model section of
`docs/superpowers/specs/2026-07-28-spectrogram-3d-view-design.md`, under a new heading
`### Measured results (<date>)`, replacing estimates with facts. State the machine and whether
hardware acceleration was active.

- [ ] **Step 5: Remove the instrumentation**

Delete the `t0` line and the whole temporary block added in Step 1. Set `FORCE_3D = false`.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSpectrogram3dCanvas.js docs/superpowers/specs/2026-07-28-spectrogram-3d-view-design.md
git commit -m "perf(spectrogram): record 3D repaint measurements against the design budgets"
```

---

### Task 5: Panel integration

**Files:**
- Modify: `src/components/panels/SpectrogramPanel.jsx`

Replaces the temporary flag with a real prop, suppresses the 2D-only overlays, and rebinds the left rail. The panel controls key does not exist yet — Task 6 adds it — so this task reads it defensively through `normalizedPanelControls` and it simply stays `undefined` (falsy) until then. That keeps this task independently committable.

- [ ] **Step 1: Replace the temporary flag with the control**

Delete the `FORCE_3D` constant. Immediately after `normalizedPanelControls` is computed, add:

```js
  const is3d = normalizedPanelControls.spectrogram3d === true;
```

First add a stable dummy ref at module scope, next to the other constants:

```js
// Handed to whichever renderer is inactive. Must be a stable identity: both hooks depend on the
// canvas ref, so a fresh `{ current: null }` literal per render would tear down and restart their
// requestAnimationFrame loops on every panel render, which happens at spectrum-frame rate.
const NO_CANVAS = { current: null };
```

Change the two hook calls so exactly one of them owns the canvas:

```js
  useSpectrogramCanvas({
    canvasRef: is3d ? NO_CANVAS : canvasRef,
    // ...all existing arguments unchanged...
  });

  useSpectrogram3dCanvas({
    canvasRef: is3d ? canvasRef : NO_CANVAS,
    snapRef,
    oldestMs,
    newestMs,
    sampleMs,
    selectedOffset,
    selectionXFrac: selLineX / 600,
    frozenSnaps: selectedOffset >= 0 ? spectrogramSnaps : null,
    colormapLut,
    minHz: normalizedPanelControls.spectrogramYMinFreq,
    maxHz: normalizedPanelControls.spectrogramYMaxFreq,
    azimuthDeg: normalizedPanelControls.spectrogram3dAzimuthDeg,
    elevationDeg: normalizedPanelControls.spectrogram3dElevationDeg,
    heightGain: normalizedPanelControls.spectrogram3dHeightGain,
    colorize: normalizedPanelControls.spectrogram3dColorize,
  });
```

- [ ] **Step 2: Suppress the 2D-only overlays**

Hover produces a misleading readout under a 3D projection, so it is disabled rather than approximated. Guard the hover callback by returning `null` immediately when `is3d`:

```js
    (xFrac, yFrac) => {
      if (is3d) return null;
      if (!historyChartInteractive) return null;
```

Then gate the SVG overlay block. Change its condition from:

```js
              {(selectedOffset >= 0 && showSelLine) ||
              visibleFrequencyMarkers.length > 0 ||
              (dataBoundaryMarkers.length > 0 && boundarySpan > 0) ? (
```

to:

```js
              {!is3d &&
              ((selectedOffset >= 0 && showSelLine) ||
                visibleFrequencyMarkers.length > 0 ||
                (dataBoundaryMarkers.length > 0 && boundarySpan > 0)) ? (
```

`TimelineLatestEdgeHint` stays as-is — it is edge-anchored, not projection-dependent.

- [ ] **Step 3: Rebind the left rail to height gain**

In 3D the vertical screen direction is the dB axis, and it is the only axis that stays vertical under rotation — frequency and time swap visual direction as azimuth turns. So the vertical rail controls height gain there.

Add above the return, after `is3d`:

```js
  const onHeightGainDrag = useCallback(
    (deltaPx, axisPx) => {
      const next = normalizedPanelControls.spectrogram3dHeightGain * (1 - deltaPx / axisPx);
      onPanelControlsChange?.(
        normalizePanelControls({
          ...normalizedPanelControls,
          spectrogram3dHeightGain: next,
        })
      );
    },
    [normalizedPanelControls, onPanelControlsChange]
  );
```

Replace the Y-axis rail's spread props and tick contents so 3D uses the new binding and shows the axis name instead of frequency ticks:

```js
          <div
            ref={spectrogramYAxis.axisRef}
            {...(is3d ? {} : spectrogramYAxis.axisHandlers)}
            onPointerDown={
              is3d
                ? (e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    chartYDragRef.current = { startY: e.clientY, gainDrag: true };
                  }
                : undefined
            }
            onPointerMove={
              is3d
                ? (e) => {
                    const drag = chartYDragRef.current;
                    if (!drag?.gainDrag) return;
                    const axisPx = Math.max(1, e.currentTarget.getBoundingClientRect().height);
                    onHeightGainDrag(e.clientY - drag.startY, axisPx);
                    chartYDragRef.current = { startY: e.clientY, gainDrag: true };
                  }
                : undefined
            }
            onPointerUp={is3d ? () => (chartYDragRef.current = null) : undefined}
            style={{ cursor: is3d ? "ns-resize" : spectrogramYAxis.cursorStyle }}
            className={cn(
              W_SPECTRUM_Y_AXIS,
              "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
              (spectrogramYAxis.isActive || chartYAxisActive) && "text-foreground"
            )}
          >
            <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
              {is3d ? (
                <span className={axisLabelClass("y", "middle")} style={{ top: "50%" }}>
                  dB
                </span>
              ) : (
                spectrogramFreqTicks.map(({ v: hz, lb: label }, i) => {
                  /* ...existing tick mapping unchanged... */
                })
              )}
            </div>
          </div>
```

Keeping the rail in place rather than hiding it matters for two reasons: it stays an adjustment entry point, and the chart area does not reflow on every mode switch.

- [ ] **Step 4: Add right-drag rotation**

Add near the other refs:

```js
  const rotateDragRef = useRef(null);
```

Extend `onSpectrogramChartPointerDown` — right button starts a rotation instead of falling through to the timeline:

```js
      if (is3d && e.button === 2) {
        e.currentTarget.setPointerCapture(e.pointerId);
        rotateDragRef.current = {
          x: e.clientX,
          y: e.clientY,
          azimuthDeg: normalizedPanelControls.spectrogram3dAzimuthDeg,
          elevationDeg: normalizedPanelControls.spectrogram3dElevationDeg,
        };
        return;
      }
```

Extend `onSpectrogramChartPointerMove`, before the existing body:

```js
      const rotate = rotateDragRef.current;
      if (rotate) {
        onPanelControlsChange?.(
          normalizePanelControls({
            ...normalizedPanelControls,
            spectrogram3dAzimuthDeg: rotate.azimuthDeg + (e.clientX - rotate.x) * 0.4,
            spectrogram3dElevationDeg: rotate.elevationDeg - (e.clientY - rotate.y) * 0.3,
          })
        );
        return;
      }
```

And clear it in `onSpectrogramChartPointerUp`:

```js
      rotateDragRef.current = null;
```

The canvas already calls `preventDefault` on `onContextMenu`, so no menu appears.

- [ ] **Step 5: Run the suite**

```bash
npm test
```

Expected: PASS. `src/App.smoke.test.jsx` and `src/components/panels/*.test.jsx` render this panel, so a broken branch surfaces here.

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/SpectrogramPanel.jsx
git commit -m "feat(spectrogram): branch the panel between 2D and 3D view modes"
```

---

### Task 6: Panel controls and settings UI

**Files:**
- Modify: `src/lib/panelControls.js`
- Modify: `src/components/PanelSettingsContent.jsx`
- Modify: `src/components/panels/chartHelp.js`
- Test: `src/lib/panelControls.test.js`

`src/workspace/clampPanelControls.js` is **not** touched — it clamps channel selection only; numeric normalisation lives in `normalizePanelControls`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/panelControls.test.js`:

```js
describe("spectrogram 3D controls", () => {
  it("defaults to the 2D view with a monochrome mesh", () => {
    const c = normalizePanelControls({});
    expect(c.spectrogram3d).toBe(false);
    expect(c.spectrogram3dColorize).toBe(false);
    expect(c.spectrogram3dHeightGain).toBe(1);
    expect(c.spectrogram3dAzimuthDeg).toBe(45);
    expect(c.spectrogram3dElevationDeg).toBe(22);
  });

  it("clamps height gain and elevation, and wraps azimuth", () => {
    expect(normalizePanelControls({ spectrogram3dHeightGain: 99 }).spectrogram3dHeightGain).toBe(3);
    expect(normalizePanelControls({ spectrogram3dHeightGain: 0 }).spectrogram3dHeightGain).toBe(0.3);
    expect(normalizePanelControls({ spectrogram3dElevationDeg: 0 }).spectrogram3dElevationDeg).toBe(5);
    expect(normalizePanelControls({ spectrogram3dElevationDeg: 90 }).spectrogram3dElevationDeg).toBe(70);
    expect(normalizePanelControls({ spectrogram3dAzimuthDeg: 370 }).spectrogram3dAzimuthDeg).toBe(10);
  });

  it("rejects non-boolean toggles", () => {
    expect(normalizePanelControls({ spectrogram3d: "yes" }).spectrogram3d).toBe(false);
    expect(normalizePanelControls({ spectrogram3dColorize: 1 }).spectrogram3dColorize).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: FAIL — `expected undefined to be false`.

- [ ] **Step 3: Add the keys and normalizers**

In `src/lib/panelControls.js`, add to `DEFAULT_PANEL_CONTROLS` directly after `spectrogramYMaxFreq: 20000,`:

```js
  spectrogram3d: false,
  // Colorize defaults off for aesthetic reasons, not performance ones: the first impression of 3D
  // mode is the classic monochrome mesh. The shared gradient makes colorize effectively free, so
  // do not "optimise" this default on the assumption it was set for cost.
  spectrogram3dColorize: false,
  spectrogram3dHeightGain: 1,
  spectrogram3dAzimuthDeg: 45,
  spectrogram3dElevationDeg: 22,
```

Add the normalizers next to `normalizeSpectrumPeakLabels`:

```js
function normalizeSpectrogram3d(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.spectrogram3d;
}

function normalizeSpectrogram3dColorize(raw) {
  return typeof raw === "boolean" ? raw : DEFAULT_PANEL_CONTROLS.spectrogram3dColorize;
}

function normalizeSpectrogram3dHeightGain(raw) {
  return clampNumber(raw, 0.3, 3, DEFAULT_PANEL_CONTROLS.spectrogram3dHeightGain);
}

/** Azimuth wraps rather than clamping — spinning past 360 during a drag is legitimate. */
function normalizeSpectrogram3dAzimuthDeg(raw) {
  if (!isNumber(raw)) return DEFAULT_PANEL_CONTROLS.spectrogram3dAzimuthDeg;
  return ((raw % 360) + 360) % 360;
}

/**
 * Elevation is clamped at both ends: at 0 the surface collapses to a line, and past about 70 it
 * degenerates into a skewed top-down view that is strictly worse than the 2D mode.
 */
function normalizeSpectrogram3dElevationDeg(raw) {
  return clampNumber(raw, 5, 70, DEFAULT_PANEL_CONTROLS.spectrogram3dElevationDeg);
}
```

And in the object returned by `normalizePanelControls`, directly after `spectrogramYMaxFreq: spectrogramYRange.max,`:

```js
    spectrogram3d: normalizeSpectrogram3d(raw?.spectrogram3d),
    spectrogram3dColorize: normalizeSpectrogram3dColorize(raw?.spectrogram3dColorize),
    spectrogram3dHeightGain: normalizeSpectrogram3dHeightGain(raw?.spectrogram3dHeightGain),
    spectrogram3dAzimuthDeg: normalizeSpectrogram3dAzimuthDeg(raw?.spectrogram3dAzimuthDeg),
    spectrogram3dElevationDeg: normalizeSpectrogram3dElevationDeg(raw?.spectrogram3dElevationDeg),
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: PASS.

- [ ] **Step 5: Add the settings rows**

In `src/components/PanelSettingsContent.jsx`, inside the `showSpectrogramRange` block, add after the existing `Y Range` `SettingsRow`:

```jsx
            <SettingsRow
              label="3D View"
              tooltip="Draws the spectrogram as a waterfall surface. Presentation view: it shows how energy evolves, but has no hover readout — switch back to 2D to read values."
            >
              <SettingsSwitch
                aria-label="spectrogram 3d view"
                checked={normalizedPanelControls.spectrogram3d}
                onCheckedChange={(checked) => {
                  onPanelControlsChange?.(
                    normalizePanelControls({
                      ...normalizedPanelControls,
                      spectrogram3d: checked,
                    })
                  );
                }}
              />
            </SettingsRow>
            {normalizedPanelControls.spectrogram3d ? (
              <>
                <SettingsRow label="Colorize">
                  <SettingsSwitch
                    aria-label="spectrogram 3d colorize"
                    checked={normalizedPanelControls.spectrogram3dColorize}
                    onCheckedChange={(checked) => {
                      onPanelControlsChange?.(
                        normalizePanelControls({
                          ...normalizedPanelControls,
                          spectrogram3dColorize: checked,
                        })
                      );
                    }}
                  />
                </SettingsRow>
                <SettingsRow label="Height Gain">
                  <SettingsSlider
                    ariaLabel="spectrogram 3d height gain"
                    min={0.3}
                    max={3}
                    step={0.05}
                    value={normalizedPanelControls.spectrogram3dHeightGain}
                    formatValue={(value) => `${value.toFixed(2)}x`}
                    onCommit={(value) => {
                      onPanelControlsChange?.(
                        normalizePanelControls({
                          ...normalizedPanelControls,
                          spectrogram3dHeightGain: value,
                        })
                      );
                    }}
                  />
                </SettingsRow>
                <SettingsRow label="Reset View">
                  <SettingsSwitch
                    aria-label="spectrogram 3d reset view"
                    checked={false}
                    onCheckedChange={() => {
                      onPanelControlsChange?.(
                        normalizePanelControls({
                          ...normalizedPanelControls,
                          spectrogram3dAzimuthDeg: 45,
                          spectrogram3dElevationDeg: 22,
                        })
                      );
                    }}
                  />
                </SettingsRow>
              </>
            ) : null}
```

`Reset View` restores **azimuth and elevation only** — height gain, colorize, frequency range and time window are left alone, so recovering from a disorienting viewpoint does not undo unrelated tuning.

- [ ] **Step 6: Add the help entries**

In `src/components/panels/chartHelp.js`, append to the `SPECTROGRAM_HELP` array:

```js
  ["3D View", "Waterfall surface. Right-drag rotates; the left rail sets height gain."],
  ["3D readout", "No hover readout in 3D — switch to 2D to read exact values."],
```

Match the existing entry shape in that array; if entries there are objects rather than tuples, follow that shape instead.

- [ ] **Step 7: Run the suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js src/components/PanelSettingsContent.jsx src/components/panels/chartHelp.js
git commit -m "feat(spectrogram): add 3D view settings and persisted panel controls"
```

---

### Task 7: Floor grid and axis labels

**Files:**
- Modify: `src/hooks/useSpectrogram3dCanvas.js`

The floor and the slanted axis labels carry most of the perceived finish of this chart type. They also replace the tick values the rails no longer show.

**DPI trap:** `useCanvasSize` sets `canvas.width = clientWidth * devicePixelRatio`, so the canvas coordinate system is **device pixels**. The 2D path never noticed because it writes `ImageData` directly. Text must therefore be sized in device pixels or it renders tiny on hi-DPI displays.

- [ ] **Step 1: Add the floor and label drawing**

Add to `src/hooks/useSpectrogram3dCanvas.js`, above the hook:

```js
const FLOOR_DIVISIONS = 4;
const AXIS_FONT_CSS_PX = 10;

function drawFloor(ctx, proj, ink) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;

  const corner = (t, f) => projectPoint(t, f, 0, proj);
  ctx.beginPath();
  const c0 = corner(0, 0);
  ctx.moveTo(c0.x, c0.y);
  for (const [t, f] of [
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    const c = corner(t, f);
    ctx.lineTo(c.x, c.y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  for (let i = 1; i < FLOOR_DIVISIONS; i++) {
    const k = i / FLOOR_DIVISIONS;
    const a = corner(k, 0);
    const b = corner(k, 1);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    const c = corner(0, k);
    const d = corner(1, k);
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Axis names drawn along their own projected edge.
 *
 * Font size is multiplied by devicePixelRatio because the canvas works in device pixels. Note this
 * also makes labels follow the Windows Accessibility text-size factor, which devicePixelRatio
 * already includes inside the webview. That is correct behaviour, not a bug to "fix".
 */
function drawAxisLabels(ctx, proj, ink, dpr) {
  const edges = [
    { label: "Time", from: [0, 0], to: [1, 0] },
    { label: "Frequency", from: [1, 0], to: [1, 1] },
  ];
  ctx.save();
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.75;
  ctx.font = `${AXIS_FONT_CSS_PX * dpr}px var(--ui-font-mono, monospace)`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const edge of edges) {
    const a = projectPoint(edge.from[0], edge.from[1], 0, proj);
    const b = projectPoint(edge.to[0], edge.to[1], 0, proj);
    ctx.save();
    ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    ctx.fillText(edge.label, 0, 4 * dpr);
    ctx.restore();
  }
  ctx.restore();
}
```

- [ ] **Step 2: Call them**

In `draw()`, immediately after `const heightPx = ...` and before the gradient block:

```js
      const dpr = Math.max(1, W / Math.max(1, canvas.clientWidth));
      drawFloor(ctx, proj, ink);
      drawAxisLabels(ctx, proj, ink, dpr);
```

Deriving `dpr` from the canvas's own dimensions rather than reading `window.devicePixelRatio` keeps it correct if `useCanvasSize` ever caps the ratio.

- [ ] **Step 3: Look at it**

```bash
npm run desktop
```

Enable `3D View` in Panel Settings. Expected: a floor rhombus with grid lines behind the surface, `Time` and `Frequency` running along their own edges at a readable size.

- [ ] **Step 4: Run the suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSpectrogram3dCanvas.js
git commit -m "feat(spectrogram): add floor grid and slanted axis labels to the 3D view"
```

---

### Task 8: Acceptance and merge gate

**Files:** none modified unless a check fails.

- [ ] **Step 1: Walk the acceptance criteria**

```bash
npm run desktop
```

Confirm each, in order:

1. **2D unchanged.** With `3D View` off, hover readout, channel-marker lines, data-boundary dashes and the scrub selection line all behave as before.
2. **Scrub highlights a ridge.** Turn `3D View` on, drag back into history — the selected ridge is stroked in the selection colour.
3. **Mode switch preserves state.** Set a frequency range and a time window in 2D, switch to 3D and back — both survive.
4. **Preset round-trip.** Set a viewpoint, height gain and colorize, save a preset, change them, reload the preset — all three come back.
5. **Gaps stay empty.** Switch channel pair mid-capture to force a gap; the gap renders as missing ridges in 3D, matching the blank column in 2D.

- [ ] **Step 2: Run the merge gate**

```bash
npm run check
```

Expected: PASS. Baseline for comparison is 230 test files / 2326 tests and 386 Rust tests.

If a test under `scripts/` fails, do not "fix the test" — those read `src-tauri/tauri.conf.json` and the NSIS hooks, so a failure there means real config drift, and it reads like an unrelated frontend failure but is not one.

- [ ] **Step 3: Commit any fixes and report**

```bash
git add -A
git commit -m "chore(spectrogram): satisfy the merge gate for the 3D view"
```

Report the final `npm run check` output verbatim rather than summarising it.

---

## Notes for the implementer

- **`npm run soak:capture` is not needed.** It surfaces leaks and metric drift in the capture layer, and nothing in that layer changes here.
- **`smoke:capture` is unaffected** and still gates releases as usual.
- **Default viewpoint (45°/22°) and the elevation clamp (5°–70°) are unvalidated guesses.** They are constants, calibrated by looking at the thing during Task 3. If they look wrong, change them and say so — do not treat them as fixed.
- **If this worktree is fresh**, `npm install && npm run ffmpeg:fetch` must run before `npm run check`, or the Rust half fails with `could not compile serde_derive` — a misleading error whose real cause is the missing FFmpeg sidecar.
