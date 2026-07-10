# Vectorscope Persistence Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Rev 2 EMA hold-smoothing with phosphor-persistence rendering: while held, a canvas layer draws the real samples from the last 1.5 s of the panel's history slab with age-based fading.

**Architecture:** Pure window/extent/alpha/draw math in a new `src/math/vectorscopePersistence.js` (canvas calls go through an injected ctx, so everything is unit-testable with a stub). `App.jsx` exposes the existing `FrameIntake.getVisualVectorscopeHistByKey` accessor on the history context. `VectorscopePanel` keeps the hold gesture and the correlation low-pass, drops the EMA trace machinery, and mounts/draws the canvas while held.

**Tech Stack:** React 19, 2D canvas, Vitest (jsdom; `canvas.getContext` returns null in jsdom so the draw effect guards on it — presence is asserted in panel tests, drawing is asserted via stub-ctx unit tests).

**Spec:** `docs/superpowers/specs/2026-07-10-vectorscope-hold-slow-mode-design.md` (Rev 3)

---

## File Structure

- Modify: `src/math/vectorscopeMath.js` — export the shared plot constants (currently module-private).
- Create: `src/math/vectorscopePersistence.js` — window selection, shared extent, alpha mapping, ctx drawing.
- Create: `src/math/vectorscopePersistence.test.js`
- Modify: `src/App.jsx:727` — add `getVectorscopeHistoryForKey` to `historyData`.
- Modify: `src/components/panels/VectorscopePanel.jsx` — remove EMA trace machinery, add persistence layer.
- Modify: `src/components/panels/VectorscopePanel.test.jsx` — rework hold-mode tests.

---

### Task 1: Pure persistence math

**Files:**
- Modify: `src/math/vectorscopeMath.js:1-5`
- Create: `src/math/vectorscopePersistence.js`
- Test: `src/math/vectorscopePersistence.test.js`

- [ ] **Step 1: Export the plot constants from vectorscopeMath**

In `src/math/vectorscopeMath.js`, change the five top-of-file `const` declarations to `export const` (same names, same values): `INV_SQRT2`, `VS_HALF`, `VS_SAFE_INSET`, `VS_EXTENT_FLOOR`, `BASE_PLOT_RADIUS`.

- [ ] **Step 2: Write the failing tests**

Create `src/math/vectorscopePersistence.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  PERSISTENCE_WINDOW_MS,
  PERSISTENCE_ALPHA_MAX,
  PERSISTENCE_ALPHA_MIN,
  selectPersistenceWindow,
  computeWindowEffRadius,
  persistenceAlpha,
  drawPersistenceWindow,
} from "./vectorscopePersistence.js";

function fakeSlab(rows) {
  return {
    length: rows.length,
    timestampAt: (i) => rows[i]?.timestampMs ?? NaN,
    rowAt: (i) => rows[i],
  };
}

describe("selectPersistenceWindow", () => {
  it("returns rows within the window, oldest first, aged against the newest row", () => {
    const slab = fakeSlab([
      { pairs: [0.1, 0.1], timestampMs: 1000 },
      { pairs: [0.2, 0.2], timestampMs: 2600 },
      { pairs: [0.3, 0.3], timestampMs: 3000 },
      { pairs: [0.4, 0.4], timestampMs: 4000 },
    ]);
    const rows = selectPersistenceWindow(slab, 1500);
    expect(rows.map((r) => r.ageMs)).toEqual([1400, 1000, 0]);
    expect(rows.map((r) => r.pairs[0])).toEqual([0.2, 0.3, 0.4]);
  });

  it("returns an empty list for missing, empty, or single-row slabs", () => {
    expect(selectPersistenceWindow(null, 1500)).toEqual([]);
    expect(selectPersistenceWindow(fakeSlab([]), 1500)).toEqual([]);
    expect(selectPersistenceWindow(fakeSlab([{ pairs: [0, 0], timestampMs: 1 }]), 1500)).toEqual(
      []
    );
  });

  it("returns an empty list when only one row falls inside the window", () => {
    const slab = fakeSlab([
      { pairs: [0.1, 0.1], timestampMs: 0 },
      { pairs: [0.2, 0.2], timestampMs: 10000 },
    ]);
    expect(selectPersistenceWindow(slab, 1500)).toEqual([]);
  });
});

describe("computeWindowEffRadius", () => {
  it("applies the extent floor for silent windows", () => {
    // All-zero pairs: extent floors at 0.02, radius caps at the base plot radius (122).
    expect(computeWindowEffRadius([{ pairs: [0, 0, 0, 0], ageMs: 0 }])).toBe(122);
  });

  it("computes one shared radius across all rows", () => {
    // l = r = 1 -> mid = sqrt(2) -> extent sqrt(2) -> radius 122 / sqrt(2).
    const rows = [
      { pairs: [0, 0], ageMs: 100 },
      { pairs: [1, 1], ageMs: 0 },
    ];
    expect(computeWindowEffRadius(rows)).toBeCloseTo(122 / Math.SQRT2, 6);
  });
});

describe("persistenceAlpha", () => {
  it("maps age 0 to the max alpha and window edge to the min alpha", () => {
    expect(persistenceAlpha(0, 1500)).toBe(PERSISTENCE_ALPHA_MAX);
    expect(persistenceAlpha(1500, 1500)).toBe(PERSISTENCE_ALPHA_MIN);
    expect(persistenceAlpha(3000, 1500)).toBe(PERSISTENCE_ALPHA_MIN);
    expect(persistenceAlpha(750, 1500)).toBeCloseTo(
      (PERSISTENCE_ALPHA_MAX + PERSISTENCE_ALPHA_MIN) / 2,
      6
    );
  });
});

describe("drawPersistenceWindow", () => {
  function stubCtx() {
    const calls = [];
    return {
      calls,
      set globalAlpha(v) {
        calls.push(["globalAlpha", v]);
      },
      beginPath: () => calls.push(["beginPath"]),
      moveTo: (x, y) => calls.push(["moveTo", x, y]),
      lineTo: (x, y) => calls.push(["lineTo", x, y]),
      stroke: () => calls.push(["stroke"]),
      clearRect: (...a) => calls.push(["clearRect", ...a]),
    };
  }

  it("draws one faded polyline per row scaled to the canvas size", () => {
    const ctx = stubCtx();
    // Center pair (0,0) projects to plot center 130,130 in the 260 coordinate space;
    // canvas 520x520 doubles it.
    drawPersistenceWindow(
      ctx,
      [
        { pairs: [0, 0, 0, 0], ageMs: 1500 },
        { pairs: [0, 0], ageMs: 0 },
      ],
      { width: 520, height: 520, windowMs: 1500 }
    );
    expect(ctx.calls).toEqual([
      ["clearRect", 0, 0, 520, 520],
      ["globalAlpha", PERSISTENCE_ALPHA_MIN],
      ["beginPath"],
      ["moveTo", 260, 260],
      ["lineTo", 260, 260],
      ["stroke"],
      ["globalAlpha", PERSISTENCE_ALPHA_MAX],
      ["beginPath"],
      ["moveTo", 260, 260],
      ["stroke"],
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/math/vectorscopePersistence.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the module**

Create `src/math/vectorscopePersistence.js`:

```js
import {
  INV_SQRT2,
  VS_HALF,
  VS_SAFE_INSET,
  VS_EXTENT_FLOOR,
  BASE_PLOT_RADIUS,
} from "./vectorscopeMath.js";

export const PERSISTENCE_WINDOW_MS = 1500;
export const PERSISTENCE_ALPHA_MAX = 0.9;
export const PERSISTENCE_ALPHA_MIN = 0.05;

const VS_VIEWBOX = VS_HALF * 2;

/**
 * Rows from the slab whose age (relative to the newest row's timestamp) is within the
 * window. Oldest first. Empty unless at least 2 rows qualify — a single frame is just the
 * live trace and the caller should fall back to it.
 */
export function selectPersistenceWindow(slab, windowMs = PERSISTENCE_WINDOW_MS) {
  const length = slab?.length ?? 0;
  if (length < 2) return [];
  const newestTs = slab.timestampAt(length - 1);
  if (!Number.isFinite(newestTs)) return [];
  const rows = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    const ts = slab.timestampAt(i);
    if (!Number.isFinite(ts)) break;
    const ageMs = newestTs - ts;
    if (ageMs > windowMs) break;
    const row = slab.rowAt(i);
    if (!row?.pairs?.length) break;
    rows.push({ pairs: row.pairs, ageMs });
  }
  if (rows.length < 2) return [];
  rows.reverse();
  return rows;
}

/** One shared effective plot radius over all pairs in the window (same auto-zoom as
 * buildVectorscopeSvgFromPairs, but window-wide so the display does not pump per frame). */
export function computeWindowEffRadius(rows) {
  let maxCheb = 0;
  for (const { pairs } of rows) {
    const n = Math.floor(pairs.length / 2);
    for (let i = 0; i < n; i += 1) {
      const l = Math.max(-1, Math.min(1, pairs[i * 2]));
      const r = Math.max(-1, Math.min(1, pairs[i * 2 + 1]));
      const side = (r - l) * INV_SQRT2;
      const mid = (l + r) * INV_SQRT2;
      const e = Math.max(Math.abs(side), Math.abs(mid));
      if (e > maxCheb) maxCheb = e;
    }
  }
  const extent = Math.max(VS_EXTENT_FLOOR, maxCheb);
  return Math.min(BASE_PLOT_RADIUS, (VS_HALF - VS_SAFE_INSET) / extent);
}

export function persistenceAlpha(ageMs, windowMs = PERSISTENCE_WINDOW_MS) {
  const t = Math.max(0, Math.min(1, ageMs / windowMs));
  return PERSISTENCE_ALPHA_MAX - (PERSISTENCE_ALPHA_MAX - PERSISTENCE_ALPHA_MIN) * t;
}

/**
 * Redraw the whole window onto a 2D context. The caller owns canvas sizing, strokeStyle,
 * and lineWidth; coordinates are projected from the 260x260 plot space to width/height.
 */
export function drawPersistenceWindow(ctx, rows, { width, height, windowMs }) {
  ctx.clearRect(0, 0, width, height);
  const effRadius = computeWindowEffRadius(rows);
  const sx = width / VS_VIEWBOX;
  const sy = height / VS_VIEWBOX;
  for (const { pairs, ageMs } of rows) {
    ctx.globalAlpha = persistenceAlpha(ageMs, windowMs);
    ctx.beginPath();
    const n = Math.floor(pairs.length / 2);
    for (let i = 0; i < n; i += 1) {
      const l = Math.max(-1, Math.min(1, pairs[i * 2]));
      const r = Math.max(-1, Math.min(1, pairs[i * 2 + 1]));
      const side = (r - l) * INV_SQRT2;
      const mid = (l + r) * INV_SQRT2;
      const x = (VS_HALF + side * effRadius) * sx;
      const y = (VS_HALF - mid * effRadius) * sy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/math/vectorscopePersistence.test.js src/math/vectorscopeMath.test.js`
Expected: all PASS (including the pre-existing vectorscopeMath tests after the export change).

---

### Task 2: Expose the history accessor to panels

**Files:**
- Modify: `src/App.jsx:727` (the `historyData` object literal)

- [ ] **Step 1: Add the accessor**

In `src/App.jsx`, add one entry to the `historyData` object (after `resolveVectorscopeSnapshotForKey`):

```js
    resolveVectorscopeSnapshotForKey,
    getVectorscopeHistoryForKey: (key) => intakeRef.current.getVisualVectorscopeHistByKey(key),
```

No dedicated test: the accessor is a one-line delegation to an already-tested FrameIntake
method; panel tests inject their own accessor via the provider.

- [ ] **Step 2: Verify no regression**

Run: `npx vitest run src/App.test.jsx` (if present; otherwise skip — Task 4 runs the full suite).

---

### Task 3: Panel rework — persistence layer replaces EMA smoothing

**Files:**
- Modify: `src/components/panels/VectorscopePanel.jsx`
- Test: `src/components/panels/VectorscopePanel.test.jsx`

- [ ] **Step 1: Rework the hold-mode tests**

In `VectorscopePanel.test.jsx`:

1a. Add a fake-slab helper next to `holdAudioData`:

```js
function fakeVectorscopeSlab(rows) {
  return {
    length: rows.length,
    timestampAt: (i) => rows[i]?.timestampMs ?? NaN,
    rowAt: (i) => rows[i],
  };
}

function persistenceAccessor() {
  return fakeVectorscopeSlab([
    { pairs: [0.1, 0.1], timestampMs: 1000 },
    { pairs: [0.2, 0.2], timestampMs: 1040 },
  ]);
}
```

1b. **Delete** these Rev 2 tests: "smooths the live trace toward incoming frames while held",
"preserves the trace size when point order shuffles between frames while held", "snaps to the
live trace when the point count changes while held".

1c. **Keep unchanged**: "cancels hold activation when the pointer moves beyond the threshold",
"does not activate when history is not interactive", "does not activate in snapshot mode",
"restores per-frame updates on pointer up", "smooths the correlation marker while held".

1d. **Add** persistence-layer tests:

```js
it("shows the persistence layer and hides the live path while held", () => {
  vi.useFakeTimers();
  const { container } = renderPanel(
    holdAudioData("M 0 0 L 10 10", 0.5, {
      getVectorscopeHistoryForKey: persistenceAccessor,
    })
  );
  expect(container.querySelector("[data-vectorscope-persistence]")).toBeNull();

  activateHold(container);
  expect(container.querySelector("[data-vectorscope-persistence]")).toBeTruthy();
  expect(lastLiveTrace(container)).toBeNull();
});

it("removes the persistence layer and restores the live path on release", () => {
  vi.useFakeTimers();
  const { container } = renderPanel(
    holdAudioData("M 0 0 L 10 10", 0.5, {
      getVectorscopeHistoryForKey: persistenceAccessor,
    })
  );
  const plot = activateHold(container);

  fireEvent(plot, new MouseEvent("pointerup", { bubbles: true }));
  expect(container.querySelector("[data-vectorscope-persistence]")).toBeNull();
  expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 0 0 L 10 10");
});

it("falls back to the live trace while held when history is unavailable", () => {
  vi.useFakeTimers();
  const { container, rerender } = renderPanel(holdAudioData("M 0 0 L 10 10"));
  activateHold(container);

  expect(container.querySelector("[data-vectorscope-persistence]")).toBeNull();
  rerender(vectorscopePanelTree(holdAudioData("M 1 1 L 11 11")));
  expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 1 1 L 11 11");
});
```

Note: "restores per-frame updates on pointer up" (kept from 1c) covers the no-accessor case;
the new release test covers the accessor case.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: the three new tests FAIL (no `[data-vectorscope-persistence]`); deleted tests gone;
kept tests PASS.

- [ ] **Step 3: Implement the panel changes**

In `VectorscopePanel.jsx`:

3a. Imports: add

```js
import {
  PERSISTENCE_WINDOW_MS,
  selectPersistenceWindow,
  drawPersistenceWindow,
} from "../../math/vectorscopePersistence.js";
```

3b. Remove the Rev 2 helpers and constants: `parseTracePathPoints`,
`buildTracePathFromPoints`, `traceMeanSquareRadius`, `VS_TRACE_CENTER`,
`VS_TRACE_MIN_MEAN_SQUARE_RADIUS`. Keep `HOLD_SLOW_DELAY_MS`, `HOLD_SLOW_CANCEL_PX`,
`HOLD_SLOW_SMOOTHING_ALPHA`.

3c. Pull the accessor from history data:

```js
const {
  selectedOffset,
  resolveVectorscopeSnapshotForKey,
  historyChartInteractive,
  getVectorscopeHistoryForKey,
} = useHistoryData();
```

3d. Replace the Rev 2 `holdSmoothingRef` + `{ gatedVectorPath, gatedCorrelation }` memo with a
correlation-only low-pass plus the window selection (placed where the old memo was, after the
`panelVectorPath` if/else chain):

```js
// Hold slow mode: correlation low-pass (display-only).
const holdCorrelationRef = useRef(null);
const gatedCorrelation = useMemo(() => {
  if (isSnapshot || !holdSlowActive) {
    holdCorrelationRef.current = null;
    return panelCorrelation;
  }
  const previous = holdCorrelationRef.current;
  let correlation = panelCorrelation;
  if (Number.isFinite(previous) && Number.isFinite(panelCorrelation)) {
    correlation = previous + (panelCorrelation - previous) * HOLD_SLOW_SMOOTHING_ALPHA;
  }
  holdCorrelationRef.current = correlation;
  return correlation;
}, [holdSlowActive, isSnapshot, panelCorrelation]);
// Hold slow mode: phosphor persistence window — real samples from the recent history slab,
// drawn with age-based fading. Falls back to the live path when history is unavailable.
const persistenceSlab =
  !isSnapshot && holdSlowActive ? (getVectorscopeHistoryForKey?.(vectorscopeKey) ?? null) : null;
const persistenceRows = persistenceSlab
  ? selectPersistenceWindow(persistenceSlab, PERSISTENCE_WINDOW_MS)
  : [];
const persistenceActive = persistenceRows.length > 0;
```

References to `gatedVectorPath` in the render go back to `panelVectorPath` (the trace path is
no longer transformed).

3e. Add the draw effect (next to the existing stroke-width layout effect):

```js
const persistenceCanvasRef = useRef(null);
useLayoutEffect(() => {
  if (!persistenceActive) return;
  const canvas = persistenceCanvasRef.current;
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const stroke = getComputedStyle(canvas).getPropertyValue("--ui-vectorscope-trace").trim();
  if (stroke) ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(dpr * 0.5, traceStrokeWidth * (width / 260));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  drawPersistenceWindow(ctx, persistenceRows, {
    width,
    height,
    windowMs: PERSISTENCE_WINDOW_MS,
  });
});
```

Intentionally no dependency array: it must redraw on every render while active (a new history
row arrives with each frame render), and it is a no-op when inactive.

3f. Render: inside the inset container (sibling of the two SVGs), and gate the live path:

```jsx
{persistenceActive && (
  <canvas
    ref={persistenceCanvasRef}
    data-vectorscope-persistence
    className="pointer-events-none absolute inset-0 z-[1] block h-full w-full"
    aria-hidden
  />
)}
```

and in the trace SVG change the path condition to:

```jsx
{!persistenceActive && panelVectorPath && (
  <path
    d={panelVectorPath}
    ...unchanged attributes...
  />
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: all PASS.

---

### Task 4: Full check and commit

- [ ] **Step 1: Format, then run the full project check**

Run: `npx prettier --write src/math/vectorscopePersistence.js src/math/vectorscopePersistence.test.js src/math/vectorscopeMath.js src/components/panels/VectorscopePanel.jsx src/components/panels/VectorscopePanel.test.jsx src/App.jsx`
Then: `npm run check`
Expected: all PASS.

- [ ] **Step 2: Commit**

```powershell
git add src/math/vectorscopeMath.js src/math/vectorscopePersistence.js src/math/vectorscopePersistence.test.js src/App.jsx src/components/panels/VectorscopePanel.jsx src/components/panels/VectorscopePanel.test.jsx docs/superpowers/specs/2026-07-10-vectorscope-hold-slow-mode-design.md docs/superpowers/plans/2026-07-10-vectorscope-persistence-window.md
git commit -m "feat(vectorscope): hold shows phosphor persistence window" -m "Replace the hold EMA trace smoothing with persistence rendering: while held, a canvas layer draws the real samples from the last 1.5s of the panel's history slab as connected polylines with age-based fading (newest 0.9 -> oldest 0.05) and one window-wide extent. Correlation low-pass and the hold gesture are unchanged. Falls back to the live trace when history is unavailable. Display-only; frame intake and history writes untouched." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Do **not** launch a preview; report done + test results and let the user test manually.
