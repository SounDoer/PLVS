# Axis Zoom & Pan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add zoom, pan, and reset gestures to panel axes (Spectrum X+Y, Spectrogram Y, Loudness Y, LevelMeter Y) with adaptive tick density.

**Architecture:** A shared `useAxisInteraction` hook encapsulates all gesture logic (Ctrl+wheel zoom, drag pan, double-click reset). Pure math functions in `axisInteractionMath.js` handle range computation for both linear and log scales. Each panel wires the hook to its axis label container and stores zoom state in `panelControls` (workspace-persisted). A new `buildAdaptiveTicks` family of functions replaces fixed tick arrays with density-aware generation.

**Tech Stack:** React 19 hooks, Vitest, existing panelControls/scales infrastructure.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/math/axisInteractionMath.js` | Create | Pure math: zoom (linear+log, mouse-anchored), pan, clamp |
| `src/math/axisInteractionMath.test.js` | Create | Tests for all math functions |
| `src/hooks/useAxisInteraction.js` | Create | Hook: gesture event handlers, refs, cursor style |
| `src/hooks/useAxisInteraction.test.js` | Create | Hook behavior tests (render-hook) |
| `src/config/scales.js` | Modify | Add adaptive tick builders, parameterized fromTopFrac functions |
| `src/config/scales.test.js` | Modify | Tests for new tick builders |
| `src/lib/panelControls.js` | Modify | New zoom fields, migration from yRangeDb, wider normalizer bounds |
| `src/lib/panelControls.test.js` | Modify | Tests for new fields and migration |
| `src/components/panels/SpectrumPanel.jsx` | Modify | Wire useAxisInteraction to Y-axis and X-axis containers |
| `src/components/panels/SpectrogramPanel.jsx` | Modify | Wire useAxisInteraction to Y-axis (frequency) container |
| `src/components/panels/LoudnessHistoryChart.jsx` | Modify | Wire useAxisInteraction to Y-axis container |
| `src/components/panels/LevelMeterPanel.jsx` | Modify | Wire useAxisInteraction to Y-axis container |
| `src/components/PanelSettingsContent.jsx` | Modify | Change spectrum Y sliders to min/max with 1dB step |

---

### Task 1: Axis Interaction Math — Linear Zoom

**Files:**
- Create: `src/math/axisInteractionMath.js`
- Create: `src/math/axisInteractionMath.test.js`

- [ ] **Step 1: Write failing tests for `computeLinearZoom`**

```js
// src/math/axisInteractionMath.test.js
import { describe, it, expect } from "vitest";
import { computeLinearZoom } from "./axisInteractionMath";

describe("computeLinearZoom", () => {
  const base = { min: -96, max: -12, absMin: -120, absMax: 6, minSpan: 12 };

  it("zooms in around anchor, preserving anchor position", () => {
    // anchor at -54 (midpoint), zoom in (factor < 1)
    const result = computeLinearZoom({ ...base, anchor: -54, factor: 0.5 });
    expect(result.max - result.min).toBeCloseTo(42); // 84 * 0.5
    expect(result.min).toBeLessThan(-54);
    expect(result.max).toBeGreaterThan(-54);
  });

  it("zooms out around anchor", () => {
    const result = computeLinearZoom({ ...base, anchor: -54, factor: 1.5 });
    expect(result.max - result.min).toBeCloseTo(126); // 84 * 1.5, capped at absMax-absMin
  });

  it("clamps to absolute bounds", () => {
    const result = computeLinearZoom({ ...base, anchor: -54, factor: 3 });
    expect(result.min).toBeGreaterThanOrEqual(-120);
    expect(result.max).toBeLessThanOrEqual(6);
  });

  it("enforces minimum span", () => {
    const narrow = { ...base, min: -20, max: -14 }; // span=6, already below minSpan after zoom in
    const result = computeLinearZoom({ ...narrow, anchor: -17, factor: 0.5 });
    expect(result.max - result.min).toBeGreaterThanOrEqual(12);
  });

  it("keeps anchor within resulting range", () => {
    const result = computeLinearZoom({ ...base, anchor: -12, factor: 0.5 });
    expect(result.min).toBeLessThanOrEqual(-12);
    expect(result.max).toBeGreaterThanOrEqual(-12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/axisInteractionMath.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `computeLinearZoom`**

```js
// src/math/axisInteractionMath.js

/**
 * Compute new min/max after a zoom gesture on a linear axis.
 * Anchor stays at the same relative position within the range.
 */
export function computeLinearZoom({ min, max, absMin, absMax, minSpan, anchor, factor }) {
  const span = max - min;
  const anchorFrac = (anchor - min) / span;
  let nextSpan = Math.max(minSpan, Math.min(absMax - absMin, span * factor));
  let nextMin = anchor - anchorFrac * nextSpan;
  let nextMax = nextMin + nextSpan;
  // Clamp to absolute bounds, preserving span
  if (nextMin < absMin) {
    nextMin = absMin;
    nextMax = nextMin + nextSpan;
  }
  if (nextMax > absMax) {
    nextMax = absMax;
    nextMin = nextMax - nextSpan;
  }
  return { min: nextMin, max: nextMax };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/axisInteractionMath.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add src/math/axisInteractionMath.js src/math/axisInteractionMath.test.js
git commit -m "feat(axis): add computeLinearZoom math" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Axis Interaction Math — Log Zoom

**Files:**
- Modify: `src/math/axisInteractionMath.js`
- Modify: `src/math/axisInteractionMath.test.js`

- [ ] **Step 1: Write failing tests for `computeLogZoom`**

```js
// append to src/math/axisInteractionMath.test.js
import { computeLogZoom } from "./axisInteractionMath";

describe("computeLogZoom", () => {
  const base = { min: 20, max: 20000, absMin: 20, absMax: 20000, minOctaves: 1 };

  it("zooms in around anchor in log space", () => {
    const result = computeLogZoom({ ...base, anchor: 1000, factor: 0.5 });
    const octaves = Math.log2(result.max / result.min);
    expect(octaves).toBeCloseTo(Math.log2(20000 / 20) * 0.5, 1);
    expect(result.min).toBeLessThan(1000);
    expect(result.max).toBeGreaterThan(1000);
  });

  it("clamps to absolute bounds", () => {
    const result = computeLogZoom({ ...base, anchor: 1000, factor: 3 });
    expect(result.min).toBeGreaterThanOrEqual(20);
    expect(result.max).toBeLessThanOrEqual(20000);
  });

  it("enforces minimum octave span", () => {
    const narrow = { ...base, min: 900, max: 1100 };
    const result = computeLogZoom({ ...narrow, anchor: 1000, factor: 0.1 });
    const octaves = Math.log2(result.max / result.min);
    expect(octaves).toBeGreaterThanOrEqual(1);
  });

  it("keeps anchor within resulting range", () => {
    const result = computeLogZoom({ ...base, anchor: 20000, factor: 0.5 });
    expect(result.min).toBeLessThanOrEqual(20000);
    expect(result.max).toBeGreaterThanOrEqual(20000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/axisInteractionMath.test.js`
Expected: FAIL — `computeLogZoom` not exported

- [ ] **Step 3: Implement `computeLogZoom`**

```js
// add to src/math/axisInteractionMath.js

/**
 * Compute new min/max after a zoom gesture on a logarithmic axis.
 * Operates in log2 space so equal scroll increments feel like equal octave steps.
 */
export function computeLogZoom({ min, max, absMin, absMax, minOctaves, anchor, factor }) {
  const logMin = Math.log2(min);
  const logMax = Math.log2(max);
  const logSpan = logMax - logMin;
  const logAnchor = Math.log2(anchor);
  const anchorFrac = (logAnchor - logMin) / logSpan;
  const logAbsMin = Math.log2(absMin);
  const logAbsMax = Math.log2(absMax);
  let nextLogSpan = Math.max(minOctaves, Math.min(logAbsMax - logAbsMin, logSpan * factor));
  let nextLogMin = logAnchor - anchorFrac * nextLogSpan;
  let nextLogMax = nextLogMin + nextLogSpan;
  if (nextLogMin < logAbsMin) {
    nextLogMin = logAbsMin;
    nextLogMax = nextLogMin + nextLogSpan;
  }
  if (nextLogMax > logAbsMax) {
    nextLogMax = logAbsMax;
    nextLogMin = nextLogMax - nextLogSpan;
  }
  return { min: Math.pow(2, nextLogMin), max: Math.pow(2, nextLogMax) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/axisInteractionMath.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add src/math/axisInteractionMath.js src/math/axisInteractionMath.test.js
git commit -m "feat(axis): add computeLogZoom math" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Axis Interaction Math — Pan

**Files:**
- Modify: `src/math/axisInteractionMath.js`
- Modify: `src/math/axisInteractionMath.test.js`

- [ ] **Step 1: Write failing tests for `computeLinearPan` and `computeLogPan`**

```js
// append to src/math/axisInteractionMath.test.js
import { computeLinearPan, computeLogPan } from "./axisInteractionMath";

describe("computeLinearPan", () => {
  it("shifts range by deltaPx proportional to visible span", () => {
    // 84 dB visible over 400px → 0.21 dB/px; drag 100px → shift 21 dB
    const result = computeLinearPan({
      min: -96, max: -12, absMin: -120, absMax: 6, deltaPx: 100, axisPx: 400,
    });
    expect(result.min).toBeCloseTo(-96 + 21);
    expect(result.max).toBeCloseTo(-12 + 21);
  });

  it("clamps at absolute upper bound", () => {
    const result = computeLinearPan({
      min: -96, max: -12, absMin: -120, absMax: 6, deltaPx: 1000, axisPx: 400,
    });
    expect(result.max).toBe(6);
    expect(result.max - result.min).toBeCloseTo(84);
  });

  it("clamps at absolute lower bound", () => {
    const result = computeLinearPan({
      min: -96, max: -12, absMin: -120, absMax: 6, deltaPx: -1000, axisPx: 400,
    });
    expect(result.min).toBe(-120);
  });
});

describe("computeLogPan", () => {
  it("shifts range in log space", () => {
    const result = computeLogPan({
      min: 100, max: 10000, absMin: 20, absMax: 20000, deltaPx: 50, axisPx: 400,
    });
    expect(result.min).toBeGreaterThan(100);
    expect(result.max).toBeGreaterThan(10000);
    // Span in octaves should be preserved
    const origOctaves = Math.log2(10000 / 100);
    const newOctaves = Math.log2(result.max / result.min);
    expect(newOctaves).toBeCloseTo(origOctaves, 5);
  });

  it("clamps at absolute bounds", () => {
    const result = computeLogPan({
      min: 100, max: 10000, absMin: 20, absMax: 20000, deltaPx: 5000, axisPx: 400,
    });
    expect(result.max).toBeLessThanOrEqual(20000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/axisInteractionMath.test.js`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement pan functions**

```js
// add to src/math/axisInteractionMath.js

/**
 * Pan a linear axis by a pixel drag delta.
 * Positive deltaPx means dragging "up" (increasing values for Y) or "right" (increasing for X).
 * The caller maps the drag direction to the sign convention for its axis orientation.
 */
export function computeLinearPan({ min, max, absMin, absMax, deltaPx, axisPx }) {
  const span = max - min;
  const delta = (deltaPx / Math.max(1, axisPx)) * span;
  let nextMin = min + delta;
  let nextMax = max + delta;
  if (nextMin < absMin) {
    nextMin = absMin;
    nextMax = absMin + span;
  }
  if (nextMax > absMax) {
    nextMax = absMax;
    nextMin = absMax - span;
  }
  return { min: nextMin, max: nextMax };
}

/**
 * Pan a logarithmic axis by a pixel drag delta.
 * Operates in log2 space so equal pixel drags shift by equal octaves.
 */
export function computeLogPan({ min, max, absMin, absMax, deltaPx, axisPx }) {
  const logMin = Math.log2(min);
  const logMax = Math.log2(max);
  const logSpan = logMax - logMin;
  const logAbsMin = Math.log2(absMin);
  const logAbsMax = Math.log2(absMax);
  const delta = (deltaPx / Math.max(1, axisPx)) * logSpan;
  let nextLogMin = logMin + delta;
  let nextLogMax = logMax + delta;
  if (nextLogMin < logAbsMin) {
    nextLogMin = logAbsMin;
    nextLogMax = logAbsMin + logSpan;
  }
  if (nextLogMax > logAbsMax) {
    nextLogMax = logAbsMax;
    nextLogMin = logAbsMax - logSpan;
  }
  return { min: Math.pow(2, nextLogMin), max: Math.pow(2, nextLogMax) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/axisInteractionMath.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add src/math/axisInteractionMath.js src/math/axisInteractionMath.test.js
git commit -m "feat(axis): add linear and log pan math" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Axis Interaction Math — Pixel-to-Value Mapping

**Files:**
- Modify: `src/math/axisInteractionMath.js`
- Modify: `src/math/axisInteractionMath.test.js`

- [ ] **Step 1: Write failing tests for `pixelToLinearValue` and `pixelToLogValue`**

These convert a mouse position (pixel offset within axis element) to the axis value at that position. Needed for zoom anchoring.

```js
// append to src/math/axisInteractionMath.test.js
import { pixelToLinearValue, pixelToLogValue } from "./axisInteractionMath";

describe("pixelToLinearValue", () => {
  it("maps top pixel (0) to max for a Y axis (inverted)", () => {
    expect(pixelToLinearValue(0, 400, -96, -12)).toBeCloseTo(-12);
  });

  it("maps bottom pixel (400) to min for a Y axis", () => {
    expect(pixelToLinearValue(400, 400, -96, -12)).toBeCloseTo(-96);
  });

  it("maps midpoint correctly", () => {
    expect(pixelToLinearValue(200, 400, -96, -12)).toBeCloseTo(-54);
  });
});

describe("pixelToLogValue", () => {
  it("maps top pixel (0) to max for a Y axis (inverted)", () => {
    expect(pixelToLogValue(0, 400, 20, 20000)).toBeCloseTo(20000);
  });

  it("maps bottom pixel (400) to min for a Y axis", () => {
    expect(pixelToLogValue(400, 400, 20, 20000)).toBeCloseTo(20, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/axisInteractionMath.test.js`
Expected: FAIL

- [ ] **Step 3: Implement pixel-to-value functions**

```js
// add to src/math/axisInteractionMath.js

/**
 * Convert a pixel offset within an axis element to a linear axis value.
 * Pixel 0 = max (top of Y axis), pixel axisPx = min (bottom of Y axis).
 * For X axes the caller should pass (axisPx - offset) as the pixel value.
 */
export function pixelToLinearValue(px, axisPx, min, max) {
  const frac = 1 - px / Math.max(1, axisPx);
  return min + frac * (max - min);
}

/**
 * Convert a pixel offset within an axis element to a log axis value.
 * Same orientation as pixelToLinearValue.
 */
export function pixelToLogValue(px, axisPx, min, max) {
  const frac = 1 - px / Math.max(1, axisPx);
  const logMin = Math.log2(min);
  const logMax = Math.log2(max);
  return Math.pow(2, logMin + frac * (logMax - logMin));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/axisInteractionMath.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add src/math/axisInteractionMath.js src/math/axisInteractionMath.test.js
git commit -m "feat(axis): add pixel-to-value mapping functions" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Adaptive Tick Builders

**Files:**
- Modify: `src/config/scales.js`
- Modify: `src/config/scales.test.js`

- [ ] **Step 1: Write failing tests for `buildAdaptiveDbTicks` and `buildAdaptiveFreqTicks`**

```js
// append to src/config/scales.test.js
import { buildAdaptiveDbTicks, buildAdaptiveFreqTicks } from "./scales";

describe("buildAdaptiveDbTicks", () => {
  it("returns ticks within the given range", () => {
    const ticks = buildAdaptiveDbTicks(-96, -12, 300);
    for (const t of ticks) {
      expect(t.v).toBeGreaterThanOrEqual(-96);
      expect(t.v).toBeLessThanOrEqual(-12);
    }
  });

  it("reduces tick count when axis is short", () => {
    const wide = buildAdaptiveDbTicks(-96, -12, 400);
    const narrow = buildAdaptiveDbTicks(-96, -12, 80);
    expect(narrow.length).toBeLessThan(wide.length);
  });

  it("always includes endpoints", () => {
    const ticks = buildAdaptiveDbTicks(-96, -12, 300);
    const values = ticks.map((t) => t.v);
    expect(values[0]).toBe(-12);
    expect(values[values.length - 1]).toBe(-96);
  });

  it("handles very small axis (< 2 label slots)", () => {
    const ticks = buildAdaptiveDbTicks(-96, -12, 20);
    expect(ticks.length).toBe(2); // only endpoints
  });

  it("adapts to zoomed-in range", () => {
    const ticks = buildAdaptiveDbTicks(-50, -30, 300);
    // With 20 dB range and 300px, should use 3dB steps → many ticks
    expect(ticks.length).toBeGreaterThan(4);
  });
});

describe("buildAdaptiveFreqTicks", () => {
  it("returns ticks within the given Hz range", () => {
    const ticks = buildAdaptiveFreqTicks(20, 20000, 500);
    for (const t of ticks) {
      expect(t.v).toBeGreaterThanOrEqual(20);
      expect(t.v).toBeLessThanOrEqual(20000);
    }
  });

  it("reduces tick count when axis is short", () => {
    const wide = buildAdaptiveFreqTicks(20, 20000, 500);
    const narrow = buildAdaptiveFreqTicks(20, 20000, 100);
    expect(narrow.length).toBeLessThanOrEqual(wide.length);
  });

  it("shows finer ticks when zoomed in", () => {
    const ticks = buildAdaptiveFreqTicks(1000, 4000, 500);
    // Zoomed to 1k-4k, should show intermediate labels like 1.5k, 2k, 3k
    expect(ticks.length).toBeGreaterThan(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/scales.test.js`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement adaptive tick builders**

```js
// add to src/config/scales.js

const DB_TICK_STEPS = [3, 6, 12, 24];
const MIN_Y_SPACING = 32;
const MIN_X_SPACING = 48;

/**
 * Build adaptive dB tick array for a given visible range and axis pixel length.
 * Always includes the endpoints (min and max).
 */
export function buildAdaptiveDbTicks(minDb, maxDb, axisPx) {
  const range = maxDb - minDb;
  if (range <= 0) return [{ v: maxDb, lb: `${maxDb}` }];
  const maxTicks = Math.max(2, Math.floor(axisPx / MIN_Y_SPACING));
  if (maxTicks <= 2) {
    return [
      { v: maxDb, lb: `${Math.round(maxDb)}` },
      { v: minDb, lb: `${Math.round(minDb)}` },
    ];
  }
  // Find the finest step that fits
  let step = DB_TICK_STEPS[DB_TICK_STEPS.length - 1];
  for (const candidate of DB_TICK_STEPS) {
    if (Math.floor(range / candidate) + 1 <= maxTicks) {
      step = candidate;
      break;
    }
  }
  const ticks = [{ v: maxDb, lb: `${Math.round(maxDb)}` }];
  // Start from the nearest step-aligned value below maxDb
  const firstTick = Math.ceil(minDb / step) * step;
  for (let v = Math.floor(maxDb / step) * step; v > minDb; v -= step) {
    if (v < maxDb) {
      ticks.push({ v, lb: `${v}` });
    }
  }
  ticks.push({ v: minDb, lb: `${Math.round(minDb)}` });
  return ticks;
}

const FREQ_TICK_CANDIDATES = [
  10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100,
  125, 150, 200, 250, 300, 400, 500, 600, 700, 800, 1000,
  1250, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 10000,
  12500, 15000, 20000,
];

function formatFreq(hz) {
  if (hz >= 1000) {
    const k = hz / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k}k`;
  }
  return `${hz}`;
}

/**
 * Build adaptive frequency tick array for a given visible Hz range and axis pixel length.
 * Ticks are chosen from standard frequency points within the visible range.
 */
export function buildAdaptiveFreqTicks(minHz, maxHz, axisPx) {
  const logMin = Math.log10(Math.max(1, minHz));
  const logMax = Math.log10(Math.max(1, maxHz));
  const logRange = logMax - logMin;
  if (logRange <= 0) return [{ v: minHz, lb: formatFreq(minHz) }];
  const maxTicks = Math.max(2, Math.floor(axisPx / MIN_X_SPACING));
  // Filter candidates within range
  const inRange = FREQ_TICK_CANDIDATES.filter((f) => f >= minHz && f <= maxHz);
  if (inRange.length <= maxTicks) {
    return inRange.map((f) => ({ v: f, lb: formatFreq(f) }));
  }
  // Downsample: pick evenly spaced subset in log space
  const result = [];
  const step = (inRange.length - 1) / (maxTicks - 1);
  for (let i = 0; i < maxTicks; i++) {
    const idx = Math.round(i * step);
    const f = inRange[idx];
    if (!result.length || result[result.length - 1].v !== f) {
      result.push({ v: f, lb: formatFreq(f) });
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/scales.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add src/config/scales.js src/config/scales.test.js
git commit -m "feat(axis): add adaptive tick builders for dB and frequency" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Parameterized Scale Functions

**Files:**
- Modify: `src/config/scales.js`
- Modify: `src/config/scales.test.js`

The existing `loudnessFromTopFrac` and `peakFromTopFrac` use hardcoded range constants. We need parameterized versions that accept a custom min/max for zoomed views.

- [ ] **Step 1: Write failing tests for parameterized functions**

```js
// append to src/config/scales.test.js
import { rangedFromTopFrac, rangedFreqToYFrac } from "./scales";

describe("rangedFromTopFrac", () => {
  it("maps max to 0 (top)", () => {
    expect(rangedFromTopFrac(0, -64, 0)).toBe(0);
  });

  it("maps min to 1 (bottom)", () => {
    expect(rangedFromTopFrac(-64, -64, 0)).toBe(1);
  });

  it("works with custom range", () => {
    expect(rangedFromTopFrac(-20, -40, -10)).toBeCloseTo(2 / 3);
  });

  it("clamps values outside range", () => {
    expect(rangedFromTopFrac(10, -64, 0)).toBe(0);
    expect(rangedFromTopFrac(-100, -64, 0)).toBe(1);
  });
});

describe("rangedFreqToYFrac", () => {
  it("maps maxHz to 0 (top)", () => {
    expect(rangedFreqToYFrac(20000, 20, 20000)).toBeCloseTo(0);
  });

  it("maps minHz to 1 (bottom)", () => {
    expect(rangedFreqToYFrac(20, 20, 20000)).toBeCloseTo(1);
  });

  it("uses log scale", () => {
    // Geometric midpoint of 20..20000 is ~632 Hz, should map to 0.5
    const mid = Math.sqrt(20 * 20000);
    expect(rangedFreqToYFrac(mid, 20, 20000)).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/scales.test.js`
Expected: FAIL

- [ ] **Step 3: Implement parameterized scale functions**

```js
// add to src/config/scales.js

/**
 * Generalized from-top fraction for any linear dB range.
 * Returns 0 at max, 1 at min (like loudnessFromTopFrac but configurable).
 */
export function rangedFromTopFrac(v, min, max) {
  const c = Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
  return 1 - (c - min) / (max - min);
}

/**
 * Frequency to Y fraction for a configurable log-scale frequency range.
 * Returns 0 at maxHz (top), 1 at minHz (bottom).
 */
export function rangedFreqToYFrac(hz, minHz, maxHz) {
  const f = Math.max(minHz, Math.min(maxHz, hz));
  const logMin = Math.log10(minHz);
  const logMax = Math.log10(maxHz);
  return 1 - (Math.log10(f) - logMin) / (logMax - logMin);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/scales.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add src/config/scales.js src/config/scales.test.js
git commit -m "feat(axis): add parameterized scale functions for zoom ranges" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Panel Controls — New Zoom Fields and Migration

**Files:**
- Modify: `src/lib/panelControls.js`
- Modify: `src/lib/panelControls.test.js`

- [ ] **Step 1: Write failing tests**

```js
// append to src/lib/panelControls.test.js

describe("zoom fields", () => {
  it("has zoom defaults for all panels", () => {
    const d = DEFAULT_PANEL_CONTROLS;
    expect(d.spectrumXMinFreq).toBe(20);
    expect(d.spectrumXMaxFreq).toBe(20000);
    expect(d.spectrumYMinDb).toBe(-96);
    expect(d.spectrumYMaxDb).toBe(-12);
    expect(d.spectrogramYMinFreq).toBe(20);
    expect(d.spectrogramYMaxFreq).toBe(20000);
    expect(d.loudnessYMinDb).toBe(-64);
    expect(d.loudnessYMaxDb).toBe(0);
    expect(d.levelMeterYMinDb).toBe(-60);
    expect(d.levelMeterYMaxDb).toBe(3);
  });

  it("normalizes new zoom fields", () => {
    const result = normalizePanelControls({ spectrumXMinFreq: 50, spectrumXMaxFreq: 10000 });
    expect(result.spectrumXMinFreq).toBe(50);
    expect(result.spectrumXMaxFreq).toBe(10000);
  });

  it("clamps zoom fields to absolute bounds", () => {
    const result = normalizePanelControls({ spectrumYMinDb: -200, spectrumYMaxDb: 100 });
    expect(result.spectrumYMinDb).toBe(-120);
    expect(result.spectrumYMaxDb).toBe(6);
  });

  it("migrates spectrumYRangeDb to spectrumYMinDb", () => {
    const result = normalizePanelControls({ spectrumYMaxDb: -12, spectrumYRangeDb: 84 });
    expect(result.spectrumYMinDb).toBe(-96);
    expect(result.spectrumYRangeDb).toBeUndefined();
  });

  it("prefers spectrumYMinDb over spectrumYRangeDb when both present", () => {
    const result = normalizePanelControls({
      spectrumYMaxDb: -12, spectrumYMinDb: -80, spectrumYRangeDb: 84,
    });
    expect(result.spectrumYMinDb).toBe(-80);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: FAIL

- [ ] **Step 3: Update panelControls.js**

Add new defaults to `DEFAULT_PANEL_CONTROLS`:

```js
// In DEFAULT_PANEL_CONTROLS, add:
spectrumXMinFreq: 20,
spectrumXMaxFreq: 20000,
spectrumYMinDb: -96,
// spectrumYMaxDb: -12 already exists
// Remove spectrumYRangeDb: 84
spectrogramYMinFreq: 20,
spectrogramYMaxFreq: 20000,
loudnessYMinDb: -64,
loudnessYMaxDb: 0,
levelMeterYMinDb: -60,
levelMeterYMaxDb: 3,
```

Update `normalizeSpectrumYMaxDb` bounds from `(-48, 0)` to `(-120, 6)`.

Remove `normalizeSpectrumYRangeDb`. Add new normalizer functions:

```js
function normalizeSpectrumYMinDb(raw, yMaxDb, legacyYRangeDb) {
  if (isNumber(raw)) return clampNumber(raw, -120, yMaxDb, DEFAULT_PANEL_CONTROLS.spectrumYMinDb);
  // Migration: derive from legacy yRangeDb
  if (isNumber(legacyYRangeDb)) return clampNumber(yMaxDb - legacyYRangeDb, -120, yMaxDb, DEFAULT_PANEL_CONTROLS.spectrumYMinDb);
  return DEFAULT_PANEL_CONTROLS.spectrumYMinDb;
}
```

Add similar normalizers for each new field (simple clampNumber calls). Update `normalizePanelControls()` to include all new fields, drop `spectrumYRangeDb`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: PASS

- [ ] **Step 5: Fix any downstream references to `spectrumYRangeDb`**

Search for all remaining references to `spectrumYRangeDb` in `src/` and update them to use `spectrumYMinDb`. Key files:
- `src/config/scales.js`: update `normalizeSpectrumRange` to accept `{ yMaxDb, yMinDb }` instead of `{ yMaxDb, yRangeDb }`, compute yRangeDb internally.
- `src/components/panels/SpectrumPanel.jsx`: change `spectrumRange` construction.
- `src/components/PanelSettingsContent.jsx`: update slider bindings.

Run: `npx vitest run` (full test suite)
Expected: PASS

- [ ] **Step 6: Commit**

```
git add src/lib/panelControls.js src/lib/panelControls.test.js src/config/scales.js src/components/panels/SpectrumPanel.jsx src/components/PanelSettingsContent.jsx
git commit -m "feat(axis): add zoom state fields to panelControls, migrate spectrumYRangeDb" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: useAxisInteraction Hook

**Files:**
- Create: `src/hooks/useAxisInteraction.js`
- Create: `src/hooks/useAxisInteraction.test.js`

- [ ] **Step 1: Write failing tests for the hook**

```js
// src/hooks/useAxisInteraction.test.js
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAxisInteraction } from "./useAxisInteraction";

function fireWheel(el, { deltaY, clientY = 100, ctrlKey = true }) {
  const event = new WheelEvent("wheel", { deltaY, clientY, ctrlKey, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
}

describe("useAxisInteraction", () => {
  it("returns axisRef, axisHandlers, and cursorStyle", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useAxisInteraction({
        axis: "y",
        min: -96, max: -12,
        absMin: -120, absMax: 6,
        defaultMin: -96, defaultMax: -12,
        minSpan: 12,
        scale: "linear",
        onRangeChange: onChange,
      })
    );
    expect(result.current.axisRef).toBeDefined();
    expect(result.current.axisHandlers).toBeDefined();
    expect(result.current.axisHandlers.onWheel).toBeTypeOf("function");
    expect(result.current.axisHandlers.onMouseDown).toBeTypeOf("function");
    expect(result.current.axisHandlers.onDoubleClick).toBeTypeOf("function");
    expect(result.current.cursorStyle).toBe("ns-resize");
  });

  it("returns ew-resize for x axis", () => {
    const { result } = renderHook(() =>
      useAxisInteraction({
        axis: "x", min: 20, max: 20000,
        absMin: 20, absMax: 20000,
        defaultMin: 20, defaultMax: 20000,
        minSpan: 1, scale: "log",
        onRangeChange: vi.fn(),
      })
    );
    expect(result.current.cursorStyle).toBe("ew-resize");
  });

  it("calls onRangeChange on double-click with defaults", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useAxisInteraction({
        axis: "y", min: -50, max: -10,
        absMin: -120, absMax: 6,
        defaultMin: -96, defaultMax: -12,
        minSpan: 12, scale: "linear",
        onRangeChange: onChange,
      })
    );
    act(() => {
      result.current.axisHandlers.onDoubleClick();
    });
    expect(onChange).toHaveBeenCalledWith(-96, -12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useAxisInteraction.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the hook**

```js
// src/hooks/useAxisInteraction.js
import { useCallback, useRef } from "react";
import {
  computeLinearZoom,
  computeLogZoom,
  computeLinearPan,
  computeLogPan,
  pixelToLinearValue,
  pixelToLogValue,
} from "../math/axisInteractionMath";

const ZOOM_IN_FACTOR = 0.85;
const ZOOM_OUT_FACTOR = 1.18;

export function useAxisInteraction({
  axis,
  min,
  max,
  absMin,
  absMax,
  defaultMin,
  defaultMax,
  minSpan,
  scale,
  onRangeChange,
}) {
  const axisRef = useRef(null);
  const dragRef = useRef(null);
  const cursorStyle = axis === "y" ? "ns-resize" : "ew-resize";

  const onWheel = useCallback(
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const el = axisRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const isY = axis === "y";
      const px = isY ? e.clientY - rect.top : e.clientX - rect.left;
      const axisPx = isY ? rect.height : rect.width;
      const factor = e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR;

      if (scale === "log") {
        const anchor = pixelToLogValue(isY ? px : axisPx - px, axisPx, min, max);
        const next = computeLogZoom({ min, max, absMin, absMax, minOctaves: minSpan, anchor, factor });
        onRangeChange(next.min, next.max);
      } else {
        const anchor = pixelToLinearValue(isY ? px : axisPx - px, axisPx, min, max);
        const next = computeLinearZoom({ min, max, absMin, absMax, minSpan, anchor, factor });
        onRangeChange(next.min, next.max);
      }
    },
    [axis, min, max, absMin, absMax, minSpan, scale, onRangeChange]
  );

  const onMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const isY = axis === "y";
      dragRef.current = {
        startPx: isY ? e.clientY : e.clientX,
        startMin: min,
        startMax: max,
      };

      const onMouseMove = (moveEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const el = axisRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const axisPx = isY ? rect.height : rect.width;
        const currentPx = isY ? moveEvent.clientY : moveEvent.clientX;
        // For Y axis: dragging down (positive delta) should decrease values (pan down)
        // For X axis: dragging right (positive delta) should increase values (pan right)
        const rawDelta = currentPx - drag.startPx;
        const deltaPx = isY ? rawDelta : -rawDelta;

        if (scale === "log") {
          const next = computeLogPan({
            min: drag.startMin, max: drag.startMax,
            absMin, absMax, deltaPx, axisPx,
          });
          onRangeChange(next.min, next.max);
        } else {
          const next = computeLinearPan({
            min: drag.startMin, max: drag.startMax,
            absMin, absMax, deltaPx, axisPx,
          });
          onRangeChange(next.min, next.max);
        }
      };

      const onMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [axis, min, max, absMin, absMax, scale, onRangeChange]
  );

  const onDoubleClick = useCallback(() => {
    onRangeChange(defaultMin, defaultMax);
  }, [defaultMin, defaultMax, onRangeChange]);

  const axisHandlers = { onWheel, onMouseDown, onDoubleClick };
  const isDragging = false; // simplified; can be upgraded with state if visual feedback needed

  return { axisRef, axisHandlers, cursorStyle, isDragging };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useAxisInteraction.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add src/hooks/useAxisInteraction.js src/hooks/useAxisInteraction.test.js
git commit -m "feat(axis): add useAxisInteraction hook" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Wire Spectrum Panel — Y Axis

**Files:**
- Modify: `src/components/panels/SpectrumPanel.jsx`

- [ ] **Step 1: Add useAxisInteraction for Y axis**

In `SpectrumPanel`, import and wire the hook:

```jsx
import { useAxisInteraction } from "../../hooks/useAxisInteraction";

// Inside SpectrumPanel component, after normalizedPanelControls:
const { setPanelControls } = useAudioData(); // or however panelControls are updated

const spectrumYAxis = useAxisInteraction({
  axis: "y",
  min: normalizedPanelControls.spectrumYMinDb,
  max: normalizedPanelControls.spectrumYMaxDb,
  absMin: -120,
  absMax: 6,
  defaultMin: -96,
  defaultMax: -12,
  minSpan: 12,
  scale: "linear",
  onRangeChange: useCallback((newMin, newMax) => {
    onPanelControlsChange?.(normalizePanelControls({
      ...panelControls,
      spectrumYMinDb: newMin,
      spectrumYMaxDb: newMax,
    }));
  }, [panelControls, onPanelControlsChange]),
});
```

- [ ] **Step 2: Bind to Y axis label container**

Find the Y-axis `<div>` (the one containing `spectrumYTicks.map(...)`) and add the hook's ref and handlers:

```jsx
<div
  ref={spectrumYAxis.axisRef}
  {...spectrumYAxis.axisHandlers}
  style={{ cursor: spectrumYAxis.cursorStyle }}
  className={cn(
    W_SPECTRUM_Y_AXIS,
    "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground"
  )}
>
```

- [ ] **Step 3: Replace fixed ticks with adaptive ticks**

Replace `buildSpectrumYTicks(spectrumRange)` with `buildAdaptiveDbTicks(...)`. This requires knowing the axis pixel height. Use a ref + ResizeObserver or a state variable for axisPx. If the panel already has a ResizeObserver, reuse it; otherwise add a simple one:

```jsx
const [yAxisPx, setYAxisPx] = useState(300);
// In the Y-axis div, use a ResizeObserver callback (or a useLayoutEffect) to set yAxisPx

const spectrumYTicks = buildAdaptiveDbTicks(
  normalizedPanelControls.spectrumYMinDb,
  normalizedPanelControls.spectrumYMaxDb,
  yAxisPx
);
```

- [ ] **Step 4: Verify Spectrum Y axis zoom works**

Run: `npm run dev`
Open the app. Hover over the Spectrum Y-axis labels area. Verify:
1. Cursor changes to `ns-resize`
2. Ctrl+scroll zooms the Y axis (anchored at mouse position)
3. Drag pans the Y axis
4. Double-click resets to -96..-12 dB
5. Tick labels adapt to zoom level

- [ ] **Step 5: Commit**

```
git add src/components/panels/SpectrumPanel.jsx
git commit -m "feat(spectrum): wire Y axis zoom/pan/reset" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Wire Spectrum Panel — X Axis

**Files:**
- Modify: `src/components/panels/SpectrumPanel.jsx`

- [ ] **Step 1: Add useAxisInteraction for X axis**

```jsx
const spectrumXAxis = useAxisInteraction({
  axis: "x",
  min: normalizedPanelControls.spectrumXMinFreq,
  max: normalizedPanelControls.spectrumXMaxFreq,
  absMin: 20,
  absMax: 20000,
  defaultMin: 20,
  defaultMax: 20000,
  minSpan: 1, // 1 octave
  scale: "log",
  onRangeChange: useCallback((newMin, newMax) => {
    onPanelControlsChange?.(normalizePanelControls({
      ...panelControls,
      spectrumXMinFreq: newMin,
      spectrumXMaxFreq: newMax,
    }));
  }, [panelControls, onPanelControlsChange]),
});
```

- [ ] **Step 2: Bind to X axis label container**

Find the X-axis `<div>` (the one containing `FREQ_LABELS.map(...)`) and add:

```jsx
<div
  ref={spectrumXAxis.axisRef}
  {...spectrumXAxis.axisHandlers}
  style={{ cursor: spectrumXAxis.cursorStyle }}
  className={cn(CAPTION_TEXT, "relative h-[var(--ui-chart-x-axis-row-h)] w-full")}
>
```

- [ ] **Step 3: Replace FREQ_LABELS with adaptive freq ticks**

```jsx
const [xAxisPx, setXAxisPx] = useState(500);
// Measure via ResizeObserver on the X-axis container

const spectrumFreqTicks = buildAdaptiveFreqTicks(
  normalizedPanelControls.spectrumXMinFreq,
  normalizedPanelControls.spectrumXMaxFreq,
  xAxisPx
);
```

Update the label rendering loop to use `spectrumFreqTicks` instead of `FREQ_LABELS`. Update `freqToXFrac` calls to use the parameterized range (not hardcoded 20-20k).

- [ ] **Step 4: Update SVG viewBox and data mapping for X-axis zoom**

The spectrum SVG currently maps frequencies to `0..1000` using `freqToXFrac(f)` which assumes 20-20kHz. When zoomed, only the visible frequency range should fill the SVG width. Update the spectrum path building and grid lines to use the zoomed frequency range.

This requires updating `spectrumSvgFromBandsAndDb` or the `freqToXFrac` calls to use a parameterized range: `rangedFreqToXFrac(f, minHz, maxHz)`.

Add to `scales.js`:

```js
export function rangedFreqToXFrac(f, minHz, maxHz) {
  const ff = Math.max(minHz, Math.min(maxHz, f));
  const logMin = Math.log10(minHz);
  const logMax = Math.log10(maxHz);
  return (Math.log10(ff) - logMin) / (logMax - logMin);
}
```

Update SpectrumPanel grid lines and hover math to use `rangedFreqToXFrac`.

- [ ] **Step 5: Verify Spectrum X axis zoom works**

Run: `npm run dev`
Verify:
1. Ctrl+scroll on X axis labels zooms frequency range
2. Drag pans frequency range
3. Double-click resets to 20-20kHz
4. Spectrum curve, grid lines, hover crosshair all respect the zoomed range
5. Ticks adapt to zoom level

- [ ] **Step 6: Commit**

```
git add src/components/panels/SpectrumPanel.jsx src/config/scales.js src/config/scales.test.js
git commit -m "feat(spectrum): wire X axis (frequency) zoom/pan/reset" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Wire Spectrogram Panel — Y Axis (Frequency)

**Files:**
- Modify: `src/components/panels/SpectrogramPanel.jsx`

- [ ] **Step 1: Add useAxisInteraction for Y axis**

```jsx
import { useAxisInteraction } from "../../hooks/useAxisInteraction";

const spectrogramYAxis = useAxisInteraction({
  axis: "y",
  min: normalizedPanelControls.spectrogramYMinFreq,
  max: normalizedPanelControls.spectrogramYMaxFreq,
  absMin: 20,
  absMax: 20000,
  defaultMin: 20,
  defaultMax: 20000,
  minSpan: 1,
  scale: "log",
  onRangeChange: useCallback((newMin, newMax) => {
    onPanelControlsChange?.(normalizePanelControls({
      ...panelControls,
      spectrogramYMinFreq: newMin,
      spectrogramYMaxFreq: newMax,
    }));
  }, [panelControls, onPanelControlsChange]),
});
```

- [ ] **Step 2: Bind to Y axis label container**

Replace the Y-axis `<div>` that currently renders `FREQ_LABELS`:

```jsx
<div
  ref={spectrogramYAxis.axisRef}
  {...spectrogramYAxis.axisHandlers}
  style={{ cursor: spectrogramYAxis.cursorStyle }}
  className={cn(
    W_SPECTRUM_Y_AXIS,
    "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground"
  )}
>
```

- [ ] **Step 3: Replace static FREQ_LABELS with adaptive ticks for Y axis**

The spectrogram Y axis is frequency (vertical, log). Replace the hardcoded `FREQ_LABELS.map(...)` with `buildAdaptiveFreqTicks(minFreq, maxFreq, yAxisPx)` and position them using `rangedFreqToYFrac`.

- [ ] **Step 4: Update canvas rendering for zoomed frequency range**

The spectrogram canvas (`useSpectrogramCanvas`) needs to know the visible frequency range to render only that slice. Pass `spectrogramYMinFreq`/`spectrogramYMaxFreq` through to the canvas hook so it maps FFT bins to the visible range.

- [ ] **Step 5: Verify Spectrogram Y axis zoom works**

Run: `npm run dev`
Verify:
1. Ctrl+scroll on Y axis labels zooms frequency range
2. Drag pans frequency range
3. Double-click resets to 20-20kHz
4. Canvas heatmap correctly shows only the zoomed frequency range
5. Hover tooltip reports correct frequencies

- [ ] **Step 6: Commit**

```
git add src/components/panels/SpectrogramPanel.jsx
git commit -m "feat(spectrogram): wire Y axis (frequency) zoom/pan/reset" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 12: Wire Loudness Panel — Y Axis

**Files:**
- Modify: `src/components/panels/LoudnessHistoryChart.jsx`
- Modify: `src/components/panels/LoudnessPanel.jsx`

- [ ] **Step 1: Add useAxisInteraction for Y axis in LoudnessHistoryChart**

```jsx
import { useAxisInteraction } from "../../hooks/useAxisInteraction";

// Accept new props: loudnessYMinDb, loudnessYMaxDb, onLoudnessYRangeChange
const loudnessYAxis = useAxisInteraction({
  axis: "y",
  min: loudnessYMinDb,
  max: loudnessYMaxDb,
  absMin: -64,
  absMax: 0,
  defaultMin: -64,
  defaultMax: 0,
  minSpan: 12,
  scale: "linear",
  onRangeChange: onLoudnessYRangeChange,
});
```

- [ ] **Step 2: Bind to Y axis label container**

```jsx
<div
  ref={loudnessYAxis.axisRef}
  {...loudnessYAxis.axisHandlers}
  style={{ cursor: loudnessYAxis.cursorStyle }}
  className={cn(
    W_LOUDNESS_Y_AXIS,
    "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground"
  )}
>
```

- [ ] **Step 3: Replace LOUDNESS_TICKS with adaptive ticks**

Replace the fixed `historyYAxisTicksLabeled` with `buildAdaptiveDbTicks(loudnessYMinDb, loudnessYMaxDb, yAxisPx)`.

Update the `loudnessFromTopFrac` calls in the chart to use `rangedFromTopFrac(v, loudnessYMinDb, loudnessYMaxDb)`.

- [ ] **Step 4: Update LoudnessPanel to pass zoom state from panelControls**

Thread `loudnessYMinDb`/`loudnessYMaxDb` and the `onRangeChange` callback through from LoudnessPanel to LoudnessHistoryChart.

- [ ] **Step 5: Update SVG path mapping for zoomed Y range**

The loudness SVG uses `loudnessHistY(v, 220)` for path Y coordinates. This needs to respect the zoom range. Update the path builder (or the coordinate conversion) to use the ranged min/max instead of hardcoded -64..0.

- [ ] **Step 6: Verify**

Run: `npm run dev`
Verify zoom/pan/reset on Loudness Y axis works. Grid lines, curve, and hover crosshair should all respect the zoomed range.

- [ ] **Step 7: Commit**

```
git add src/components/panels/LoudnessHistoryChart.jsx src/components/panels/LoudnessPanel.jsx
git commit -m "feat(loudness): wire Y axis zoom/pan/reset" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 13: Wire LevelMeter Panel — Y Axis

**Files:**
- Modify: `src/components/panels/LevelMeterPanel.jsx`

- [ ] **Step 1: Add useAxisInteraction for Y axis**

LevelMeter has two modes with different scales. Determine defaults based on `levelMeterMode`:

```jsx
import { useAxisInteraction } from "../../hooks/useAxisInteraction";

const isPeak = levelMeterMode === "peak";
const yDefaults = isPeak
  ? { min: -60, max: 3, absMin: -60, absMax: 3 }
  : { min: -64, max: 0, absMin: -64, absMax: 0 };

const levelMeterYAxis = useAxisInteraction({
  axis: "y",
  min: normalizedPanelControls.levelMeterYMinDb,
  max: normalizedPanelControls.levelMeterYMaxDb,
  absMin: yDefaults.absMin,
  absMax: yDefaults.absMax,
  defaultMin: yDefaults.min,
  defaultMax: yDefaults.max,
  minSpan: 12,
  scale: "linear",
  onRangeChange: useCallback((newMin, newMax) => {
    onPanelControlsChange?.(normalizePanelControls({
      ...panelControls,
      levelMeterYMinDb: newMin,
      levelMeterYMaxDb: newMax,
    }));
  }, [panelControls, onPanelControlsChange]),
});
```

- [ ] **Step 2: Bind to Y axis label container**

Both the peak and loudness rendering paths have a `data-level-meter-y-axis` div. Bind ref and handlers to both:

```jsx
<div
  data-level-meter-y-axis
  ref={levelMeterYAxis.axisRef}
  {...levelMeterYAxis.axisHandlers}
  style={{ cursor: levelMeterYAxis.cursorStyle }}
  className={cn(/* existing classes */)}
>
```

- [ ] **Step 3: Replace static ticks with adaptive ticks**

Replace `PEAK_TICKS` / `LOUDNESS_TICKS` with:
```jsx
const levelMeterTicks = buildAdaptiveDbTicks(
  normalizedPanelControls.levelMeterYMinDb,
  normalizedPanelControls.levelMeterYMaxDb,
  yAxisPx
);
```

Update `peakFromTopFrac` / `loudnessFromTopFrac` calls to `rangedFromTopFrac`.

- [ ] **Step 4: Handle mode switch defaults**

When `levelMeterMode` changes, reset zoom to the new mode's defaults if the user hasn't manually zoomed. Track this with a simple flag or by comparing against defaults.

- [ ] **Step 5: Verify**

Run: `npm run dev`
Verify zoom/pan/reset on LevelMeter Y axis works in both peak and momentary/ST modes.

- [ ] **Step 6: Commit**

```
git add src/components/panels/LevelMeterPanel.jsx
git commit -m "feat(level-meter): wire Y axis zoom/pan/reset" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 14: Update Spectrum Panel Settings Sliders

**Files:**
- Modify: `src/components/PanelSettingsContent.jsx`

- [ ] **Step 1: Update Y Max slider**

Change the existing Y Max slider from step=6, range=(-48,0) to step=1, range=(-120,6):

```jsx
<SettingsSlider
  ariaLabel="spectrum y max"
  min={-120}
  max={6}
  step={1}
  value={normalizedPanelControls.spectrumYMaxDb}
  formatValue={(value) => `${value.toFixed(0)} dB`}
  onCommit={(value) => {
    onPanelControlsChange?.(normalizePanelControls({
      ...normalizedPanelControls,
      spectrumYMaxDb: value,
    }));
  }}
/>
```

- [ ] **Step 2: Replace Y Range slider with Y Min slider**

Replace the `spectrumYRangeDb` slider with a `spectrumYMinDb` slider:

```jsx
<SettingsRow label="Y Min">
  <SettingsSlider
    ariaLabel="spectrum y min"
    min={-120}
    max={6}
    step={1}
    value={normalizedPanelControls.spectrumYMinDb}
    formatValue={(value) => `${value.toFixed(0)} dB`}
    onCommit={(value) => {
      onPanelControlsChange?.(normalizePanelControls({
        ...normalizedPanelControls,
        spectrumYMinDb: value,
      }));
    }}
  />
</SettingsRow>
```

- [ ] **Step 3: Verify bidirectional sync**

Run: `npm run dev`
1. Zoom Y axis via gesture → open panel settings → sliders reflect zoomed values
2. Change slider → chart updates immediately
3. Double-click to reset → sliders return to defaults

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: PASS — all existing PanelSettingsContent tests updated for new field names.

- [ ] **Step 5: Commit**

```
git add src/components/PanelSettingsContent.jsx
git commit -m "feat(settings): update spectrum Y sliders to continuous min/max" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 15: Final Integration Test and Cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 2: Run full check**

Run: `npm run check`
Expected: PASS (format + lint + test + build + version + Rust checks)

- [ ] **Step 3: Manual smoke test all panels**

Run: `npm run dev`
Test each panel:
1. **Spectrum**: Ctrl+scroll on Y labels (dB zoom), Ctrl+scroll on X labels (freq zoom), drag to pan, double-click to reset. Verify grid lines, curves, hover, and snapshots all respect zoomed ranges.
2. **Spectrogram**: Ctrl+scroll on Y labels (freq zoom), drag to pan, double-click to reset. Canvas heatmap maps correctly.
3. **Loudness**: Ctrl+scroll on Y labels (LUFS zoom), drag to pan, double-click to reset. Curves and grid lines correct.
4. **LevelMeter**: Ctrl+scroll on Y labels (dB zoom), drag to pan, double-click to reset. Test peak, M, and ST modes.
5. **Small panel sizes**: Shrink panels to verify tick density adapts gracefully.
6. **Persistence**: Zoom, close app, reopen — zoom state preserved.

- [ ] **Step 4: Commit any fixes**

```
git add -A
git commit -m "fix: integration fixes for axis zoom/pan" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
