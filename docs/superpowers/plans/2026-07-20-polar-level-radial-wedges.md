# Polar Level Radial Wedges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the connected, filled Polar Level envelope with separated radial wedges while retaining the open left-to-right Peak hold polyline and fixed `-48...0 dBFS` scale.

**Architecture:** Keep projection, bin aggregation, attack/release, Peak hold accumulation, and the shared Full Panel/Dock adapter unchanged. Change only the Canvas drawing layer in `VectorscopePolarPlot.jsx`: current values render as independent triangular wedges from the bottom-center origin, while held values form an open polyline connecting bin maxima from left to right.

**Tech Stack:** React 19, Canvas 2D, Vitest, Testing Library

---

## File Structure

- Modify `src/components/panels/VectorscopePolarPlot.jsx`: draw separated current-level wedges and retain the open left-to-right Peak hold path.
- Modify `src/components/panels/VectorscopePolarPlot.test.jsx`: lock down wedge separation, current-outline removal, open Peak hold polyline, fixed dB sizing, and snapshot behavior.
- Modify `docs/superpowers/specs/2026-07-20-vectorscope-display-modes-design.md`: record the approved PAZ-style rendering semantics.

### Task 1: Lock Down the Radial-Wedge Rendering Contract

**Files:**
- Modify: `src/components/panels/VectorscopePolarPlot.test.jsx:68-170`

- [ ] **Step 1: Replace the filled-envelope assertion with a failing separated-wedge test**

Use a row that activates multiple angular bins and assert that Canvas receives multiple fills from the shared origin but only the grid stroke:

```jsx
it("draws Polar Level as separated radial wedges without a current outline", () => {
  const ctx = contextStub();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  render(
    <VectorscopePolarPlot
      mode="polarLevel"
      rows={[{ pairs: new Float32Array([1, 1, 0, 1]), ageMs: 0, timestampMs: 100 }]}
      hasSignal
      firstLabel="L"
      secondLabel="R"
    />
  );

  const originMoves = ctx.moveTo.mock.calls.filter(([x, y]) => x === 100 && y === 150);
  expect(ctx.fill.mock.calls.length).toBeGreaterThan(1);
  expect(originMoves.length).toBeGreaterThan(1);
  expect(ctx.stroke).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- src/components/panels/VectorscopePolarPlot.test.jsx
```

Expected: FAIL because the current renderer performs one connected fill and adds a current-level outline stroke.

- [ ] **Step 3: Add a Peak hold layer assertion**

Add a live Peak hold test that verifies current wedges still fill independently while the grid and open held polyline produce exactly two strokes:

```jsx
it("connects only the Polar Level Peak hold values", () => {
  const ctx = contextStub();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  render(
    <VectorscopePolarPlot
      mode="polarLevel"
      rows={[{ pairs: new Float32Array([1, 1, 0, 1]), ageMs: 0, timestampMs: 100 }]}
      hasSignal
      firstLabel="L"
      secondLabel="R"
      peakHoldEnabled
    />
  );

  expect(ctx.fill.mock.calls.length).toBeGreaterThan(1);
  expect(ctx.stroke).toHaveBeenCalledTimes(2);
});
```

Update the existing snapshot assertion from two strokes to one: snapshot mode draws the grid and current wedges but no current outline and no runtime Peak hold outline.

- [ ] **Step 4: Run the focused test and confirm both new expectations fail for the intended reasons**

Run:

```powershell
npm test -- src/components/panels/VectorscopePolarPlot.test.jsx
```

Expected: FAIL on the single current fill/current outline behavior, not on Canvas setup or unrelated labels.

### Task 2: Render Independent Current-Level Wedges

**Files:**
- Modify: `src/components/panels/VectorscopePolarPlot.jsx:13-112`
- Test: `src/components/panels/VectorscopePolarPlot.test.jsx`

- [ ] **Step 1: Add the fixed wedge-width ratio**

Define one rendering constant beside the existing alpha constants:

```js
const POLAR_LEVEL_WEDGE_WIDTH_RATIO = 0.5;
```

This leaves half of each angular bin empty so neighboring directions remain visually separate at both full-panel and Dock sizes.

- [ ] **Step 2: Extract the existing fixed-dB conversion into a normalized-radius helper**

Keep the approved scale and clamp behavior:

```js
function polarLevelRadius(value, extent, geometry) {
  const levelDb =
    value > 0 ? 20 * Math.log10(value / Math.max(extent, 1e-9)) : POLAR_LEVEL_FLOOR_DB;
  const normalized = Math.max(
    0,
    Math.min(1, (levelDb - POLAR_LEVEL_FLOOR_DB) / -POLAR_LEVEL_FLOOR_DB)
  );
  return normalized * geometry.radius;
}
```

Update `envelopePoint` to call this helper so Peak hold continues using exactly the same dB coordinate system.

- [ ] **Step 3: Add a triangular wedge tracer**

For each non-zero displayed bin, calculate a center angle and two edge angles occupying half a bin. Draw a triangle from the bottom-center origin to both outer edge points:

```js
function traceLevelWedge(ctx, index, value, count, extent, geometry) {
  const binAngle = Math.PI / Math.max(1, count - 1);
  const centerAngle = -Math.PI / 2 + index * binAngle;
  const halfWidth = (binAngle * POLAR_LEVEL_WEDGE_WIDTH_RATIO) / 2;
  const startAngle = Math.max(-Math.PI / 2, centerAngle - halfWidth);
  const endAngle = Math.min(Math.PI / 2, centerAngle + halfWidth);
  const radius = polarLevelRadius(value, extent, geometry);
  if (radius <= 0) return false;

  ctx.beginPath();
  ctx.moveTo(geometry.centerX, geometry.baselineY);
  ctx.lineTo(
    geometry.centerX + Math.sin(startAngle) * radius,
    geometry.baselineY - Math.cos(startAngle) * radius
  );
  ctx.lineTo(
    geometry.centerX + Math.sin(endAngle) * radius,
    geometry.baselineY - Math.cos(endAngle) * radius
  );
  ctx.closePath();
  return true;
}
```

- [ ] **Step 4: Replace the connected current-level fill and outline**

Change `drawPolarLevel` so it fills each traced wedge independently at full opacity with `--ui-vectorscope-trace`. Remove the current-level call to `traceEnvelope`, `fill`, and `stroke`. Keep `traceEnvelope` only for `held`, using the same trace color at `PEAK_ALPHA = 0.35`. Draw the Polar grid with `--ui-vectorscope-grid-stroke` at full opacity:

```js
function drawPolarLevel(ctx, envelope, held, extent, geometry, wedgeColor, lineWidth) {
  ctx.fillStyle = wedgeColor;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = 1;
  for (let index = 0; index < envelope.length; index += 1) {
    if (traceLevelWedge(ctx, index, envelope[index], envelope.length, extent, geometry)) {
      ctx.fill();
    }
  }
  if (held) {
    traceEnvelope(ctx, held, extent, geometry);
    ctx.strokeStyle = wedgeColor;
    ctx.globalAlpha = PEAK_ALPHA;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
```

Delete `OUTLINE_ALPHA` after its only use disappears.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- src/components/panels/VectorscopePolarPlot.test.jsx
```

Expected: all tests pass, including fixed dB sizing and Peak hold containment.

### Task 3: Verify Shared Consumers and Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-20-vectorscope-display-modes-design.md`
- Test: `src/math/vectorscopePolarMath.test.js`
- Test: `src/components/panels/VectorscopePolarPlot.test.jsx`
- Test: `src/components/panels/VectorscopePanel.test.jsx`
- Test: `src/dock/modules/DockVectorscope.test.jsx`

- [ ] **Step 1: Confirm the design spec contains no obsolete connected-fill or Polar Level auto-scale statements**

Run:

```powershell
rg -n "filled stereo|filled envelope|shared automatic|All modes use|repeatedly updated filled" docs/superpowers/specs/2026-07-20-vectorscope-display-modes-design.md
```

Expected: no matches.

- [ ] **Step 2: Run all Polar renderer consumers**

Run:

```powershell
npm test -- src/math/vectorscopePolarMath.test.js src/components/panels/VectorscopePolarPlot.test.jsx src/components/panels/VectorscopePanel.test.jsx src/dock/modules/DockVectorscope.test.jsx
```

Expected: all test files pass. Existing jsdom `HTMLCanvasElement.prototype.getContext` warnings from tests that do not install a Canvas stub may still be printed.

- [ ] **Step 3: Run lint and diff validation**

Run:

```powershell
npm run lint
git diff --check
```

Expected: both commands exit with code 0.

- [ ] **Step 4: Perform real-app visual verification**

Run:

```powershell
npm run desktop
```

Verify:

- Full Panel and Dock show separated translucent wedges from the bottom-center origin.
- Current values have no connected outline or filled petal.
- Enabling Peak hold adds one connected outer contour.
- Wedges remain stable under steady input because the fixed dB scale is unchanged.
- Peak hold stays inside the outer arc after signal level falls.

- [ ] **Step 5: Commit only after explicit user approval**

Stage the renderer, tests, and updated spec. Use the repository's `fix(vectorscope): ...` message style and do not commit until the user explicitly requests it.
