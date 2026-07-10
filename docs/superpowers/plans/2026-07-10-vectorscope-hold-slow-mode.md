# Vectorscope Hold Slow Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Holding the left mouse button on the Vectorscope trace for 300 ms throttles the displayed trace and correlation marker to a 200 ms refresh cadence with a 140 ms crossfade, without touching the data pipeline.

**Architecture:** Frontend-only change inside `VectorscopePanel.jsx`. A hold-gesture state machine (copied from SpectrumPanel's pattern, kept local per the spec) sets `holdSlowActive`; a render-time gate ref holds the last accepted `{ path, correlation, tick }` and refuses new live values until 200 ms have passed; the trace `<path>` is wrapped in `AnimatePresence`/`motion.g` keyed by the accepted tick so each refresh crossfades. History writes happen in `FrameIntake.js` at the App level and are untouched.

**Tech Stack:** React 19, framer-motion (already a dependency, same pattern as SpectrumPanel), Vitest + @testing-library/react (jsdom, fake timers).

**Spec:** `docs/superpowers/specs/2026-07-10-vectorscope-hold-slow-mode-design.md`

---

## File Structure

- Modify: `src/components/panels/VectorscopePanel.jsx` — all behavior lives here (constants, gesture state machine, throttle gate, crossfade wrapper, pointer handlers on the plot container).
- Modify: `src/components/panels/VectorscopePanel.test.jsx` — new test block for the hold slow mode.

No new files. No Rust/IPC/persistence changes.

---

### Task 1: Hold gesture + trace throttle

**Files:**
- Modify: `src/components/panels/VectorscopePanel.jsx`
- Test: `src/components/panels/VectorscopePanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `VectorscopePanel.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
```

(The file currently imports `describe, expect, it` from vitest and `render, screen` from testing-library — extend both lines.)

Add this describe block at the end of the file (inside nothing — sibling of the existing `describe`):

```jsx
function holdAudioData(path, correlation = 0.5, overrides = {}) {
  return {
    selectedOffset: -1,
    historyChartInteractive: true,
    panelControls: { vectorscopePair: { x: 0, y: 1 } },
    displayAudio: {
      peakDb: [-12, -18],
      vectorscopeResultsByKey: {
        "vectorscope:pair:0:1": { path, correlation, pairX: 0, pairY: 1 },
      },
    },
    ...overrides,
  };
}

function lastLiveTrace(container) {
  const traces = container.querySelectorAll('path[stroke="var(--ui-vectorscope-trace)"]');
  return traces[traces.length - 1] ?? null;
}

describe("VectorscopePanel hold slow mode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function activateHold(container) {
    const plot = container.querySelector("[data-vectorscope-plot]");
    fireEvent.pointerDown(plot, { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    return plot;
  }

  it("throttles the live trace to the slow cadence while held", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderPanel(holdAudioData("M 0 0 L 10 10"));
    activateHold(container);

    rerender(vectorscopePanelTree(holdAudioData("M 1 1 L 11 11")));
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 0 0 L 10 10");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender(vectorscopePanelTree(holdAudioData("M 2 2 L 12 12")));
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 2 2 L 12 12");
  });

  it("cancels hold activation when the pointer moves beyond the threshold", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderPanel(holdAudioData("M 0 0 L 10 10"));
    const plot = container.querySelector("[data-vectorscope-plot]");
    fireEvent.pointerDown(plot, { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(plot, { clientX: 60, clientY: 50, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    rerender(vectorscopePanelTree(holdAudioData("M 1 1 L 11 11")));
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 1 1 L 11 11");
  });

  it("does not activate when history is not interactive", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderPanel(
      holdAudioData("M 0 0 L 10 10", 0.5, { historyChartInteractive: false })
    );
    activateHold(container);

    rerender(
      vectorscopePanelTree(
        holdAudioData("M 1 1 L 11 11", 0.5, { historyChartInteractive: false })
      )
    );
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 1 1 L 11 11");
  });

  it("does not activate in snapshot mode", () => {
    vi.useFakeTimers();
    const snapshotData = {
      selectedOffset: 2,
      historyChartInteractive: true,
      resolveVectorscopeSnapshotForKey: () => ({
        missing: false,
        path: "M 5 5 L 15 15",
        correlation: 0.5,
        hasSignal: true,
      }),
    };
    const { container } = renderPanel(snapshotData);
    activateHold(container);

    const snapTrace = container.querySelector('path[stroke="var(--ui-vectorscope-trace-snap)"]');
    expect(snapTrace?.getAttribute("d")).toBe("M 5 5 L 15 15");
  });

  it("restores per-frame updates on pointer up", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderPanel(holdAudioData("M 0 0 L 10 10"));
    const plot = activateHold(container);

    fireEvent.pointerUp(plot, { pointerId: 1 });
    rerender(vectorscopePanelTree(holdAudioData("M 1 1 L 11 11")));
    expect(lastLiveTrace(container)?.getAttribute("d")).toBe("M 1 1 L 11 11");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: the new `hold slow mode` tests FAIL (no `[data-vectorscope-plot]` element yet → `fireEvent` target null / throttle assertions fail). The pre-existing tests still PASS.

- [ ] **Step 3: Implement gesture + throttle**

In `src/components/panels/VectorscopePanel.jsx`:

3a. Extend the react import (line 1):

```jsx
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
```

3b. Add constants after the existing `VECTOR_TRACE_STROKE_*` constants (after line 24):

```jsx
const HOLD_SLOW_DELAY_MS = 300;
const HOLD_SLOW_CANCEL_PX = 4;
const HOLD_SLOW_REFRESH_MS = 200;
const HOLD_SLOW_CROSSFADE_MS = 140;
```

(`HOLD_SLOW_CROSSFADE_MS` is used in Task 3; adding it now keeps the constants together.)

3c. Pull `historyChartInteractive` from history data (line 80):

```jsx
const { selectedOffset, resolveVectorscopeSnapshotForKey, historyChartInteractive } =
  useHistoryData();
```

3d. Add the gesture state machine inside the component, after the `isSnapshot` derivation (after line 84, before the `snapResolved` line is fine — it only needs `isSnapshot` and `historyChartInteractive`):

```jsx
const [holdSlowActive, setHoldSlowActive] = useState(false);
const holdSlowTimerRef = useRef(null);
const holdSlowPointerRef = useRef(null);
const holdSlowActiveRef = useRef(false);
const clearPendingHoldSlow = useCallback(() => {
  if (holdSlowTimerRef.current != null) {
    window.clearTimeout(holdSlowTimerRef.current);
    holdSlowTimerRef.current = null;
  }
  holdSlowPointerRef.current = null;
}, []);
const releaseHoldSlow = useCallback(() => {
  clearPendingHoldSlow();
  if (holdSlowActiveRef.current) {
    holdSlowActiveRef.current = false;
    setHoldSlowActive(false);
  }
}, [clearPendingHoldSlow]);
useEffect(() => releaseHoldSlow, [releaseHoldSlow]);
const onTracePointerDown = useCallback(
  (e) => {
    if (isSnapshot || !historyChartInteractive || (e.button != null && e.button !== 0) || e.ctrlKey) {
      return;
    }
    clearPendingHoldSlow();
    holdSlowPointerRef.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY };
    holdSlowTimerRef.current = window.setTimeout(() => {
      holdSlowTimerRef.current = null;
      if (!holdSlowPointerRef.current) return;
      holdSlowActiveRef.current = true;
      setHoldSlowActive(true);
    }, HOLD_SLOW_DELAY_MS);
  },
  [clearPendingHoldSlow, historyChartInteractive, isSnapshot]
);
const onTracePointerMove = useCallback(
  (e) => {
    const pointer = holdSlowPointerRef.current;
    if (
      pointer &&
      !holdSlowActiveRef.current &&
      Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > HOLD_SLOW_CANCEL_PX
    ) {
      clearPendingHoldSlow();
    }
  },
  [clearPendingHoldSlow]
);
const onTracePointerUp = useCallback(() => {
  releaseHoldSlow();
}, [releaseHoldSlow]);
```

3e. Add the throttle gate. Place it after the `panelVectorPath` / `panelCorrelation` if/else chain resolves (after the `else` block ending around line 117), before `labelChannelCount`:

```jsx
// Hold slow mode: while active, refuse new live display values until the refresh window
// elapses. Display-only — frame intake and history writes are unaffected.
const holdSlowGateRef = useRef(null);
let gatedVectorPath = panelVectorPath;
let gatedCorrelation = panelCorrelation;
let traceCrossfadeKey = "live";
if (!isSnapshot && holdSlowActive) {
  const now = Date.now();
  const gate = holdSlowGateRef.current;
  if (gate && now - gate.acceptedTs < HOLD_SLOW_REFRESH_MS) {
    gatedVectorPath = gate.path;
    gatedCorrelation = gate.correlation;
    traceCrossfadeKey = `hold-${gate.tick}`;
  } else {
    const tick = (gate?.tick ?? 0) + 1;
    holdSlowGateRef.current = {
      acceptedTs: now,
      path: panelVectorPath,
      correlation: panelCorrelation,
      tick,
    };
    traceCrossfadeKey = `hold-${tick}`;
  }
} else {
  holdSlowGateRef.current = null;
}
```

3f. Route the gated values into the trace rendering. In the trace SVG (around line 229), replace `panelVectorPath` with `gatedVectorPath`:

```jsx
{gatedVectorPath && (
  <>
    <path
      d={gatedVectorPath}
      fill="none"
      stroke={
        selectedOffset >= 0
          ? "var(--ui-vectorscope-trace-snap)"
          : "var(--ui-vectorscope-trace)"
      }
      strokeWidth={traceStrokeWidth}
      opacity="var(--ui-vectorscope-axis-opacity)"
      strokeLinecap="round"
    />
  </>
)}
```

(`traceCrossfadeKey` becomes meaningful in Task 3; it is intentionally unused for rendering in this task — if lint flags it, prefix nothing, it is read in Task 3 within the same PR.)

3g. Attach the pointer handlers and test hook to the square plot container (the `relative w-full` div with `aspectRatio: "1/1"`, around line 191):

```jsx
<div
  data-vectorscope-plot
  className="relative w-full"
  style={{ aspectRatio: "1/1", maxHeight: "100%", maxWidth: "100%" }}
  onPointerDown={onTracePointerDown}
  onPointerMove={onTracePointerMove}
  onPointerUp={onTracePointerUp}
  onPointerCancel={onTracePointerUp}
  onPointerLeave={onTracePointerUp}
>
```

The grid SVG inside stays `pointer-events-none`; handlers on the container work regardless.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: all tests PASS, including the five new hold-slow-mode tests and all pre-existing ones.

---

### Task 2: Correlation marker follows the throttle

**Files:**
- Modify: `src/components/panels/VectorscopePanel.jsx`
- Test: `src/components/panels/VectorscopePanel.test.jsx`

- [ ] **Step 1: Write the failing test**

Add inside the `VectorscopePanel hold slow mode` describe block:

```jsx
it("throttles the correlation marker on the same cadence", () => {
  vi.useFakeTimers();
  const { container, rerender } = renderPanel(holdAudioData("M 0 0 L 10 10", -1));
  activateHold(container);

  rerender(vectorscopePanelTree(holdAudioData("M 1 1 L 11 11", 1)));
  const marker = () => container.querySelector("[data-vectorscope-correlation-marker]");
  // Held value is still -1 -> marker pinned at the left edge.
  expect(marker()?.getAttribute("style")).toContain("left: 0%");

  act(() => {
    vi.advanceTimersByTime(200);
  });
  rerender(vectorscopePanelTree(holdAudioData("M 2 2 L 12 12", 1)));
  // Accepted +1 smoothed from -1 with alpha 0.25 -> -0.5 -> left 25%.
  expect(marker()?.getAttribute("style")).toContain("left: 25%");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: the new test FAILS — the marker currently reads the un-gated `panelCorrelation`, so it moves immediately (second assertion sees a value that already left 0%, or the first assertion fails).

- [ ] **Step 3: Route gated correlation into the marker path**

In `VectorscopePanel.jsx`, two substitutions:

3a. `canPlaceCorrelationMarker` (currently around line 128) uses the gated value:

```jsx
const canPlaceCorrelationMarker =
  hasCorrelationSignal && clampCorrelation(gatedCorrelation) !== null;
```

3b. The `displayCorrelation` memo (currently around line 155) reads `gatedCorrelation` instead of `panelCorrelation`:

```jsx
const displayCorrelation = useMemo(() => {
  const rawCorrelation = canPlaceCorrelationMarker ? clampCorrelation(gatedCorrelation) : null;
  if (isSnapshot || rawCorrelation === null) {
    liveCorrelationDisplayRef.current = rawCorrelation;
    return rawCorrelation;
  }
  const smoothedCorrelation = smoothCorrelation(
    liveCorrelationDisplayRef.current,
    rawCorrelation
  );
  liveCorrelationDisplayRef.current = smoothedCorrelation;
  return smoothedCorrelation;
}, [canPlaceCorrelationMarker, isSnapshot, gatedCorrelation]);
```

Note: the gate must therefore be computed **before** this memo in the component body — the Task 1 placement (before `labelChannelCount`) already satisfies this.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: all PASS.

---

### Task 3: Crossfade between accepted trace refreshes

**Files:**
- Modify: `src/components/panels/VectorscopePanel.jsx`
- Test: `src/components/panels/VectorscopePanel.test.jsx`

- [ ] **Step 1: Write the failing test**

Add inside the `VectorscopePanel hold slow mode` describe block. framer-motion animations don't complete under jsdom fake timers, so assert structure only: the live trace path is wrapped in a `<g>` (motion group) and the throttle behavior is unchanged.

```jsx
it("wraps the live trace in a crossfade group", () => {
  const { container } = renderPanel(holdAudioData("M 0 0 L 10 10"));
  const trace = lastLiveTrace(container);
  expect(trace?.closest("g")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: FAIL — the trace `<path>` currently has no `<g>` ancestor inside the trace SVG.

- [ ] **Step 3: Implement the crossfade**

3a. Add the framer-motion import after the react import in `VectorscopePanel.jsx`:

```jsx
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
```

3b. Read reduced-motion preference inside the component (next to the other hooks, e.g. after the `traceStrokeWidth` state):

```jsx
const reduceMotion = useReducedMotion();
```

3c. Replace the trace path block from Task 1 step 3f with:

```jsx
{gatedVectorPath && (
  <AnimatePresence mode="sync">
    <motion.g
      key={traceCrossfadeKey}
      initial={
        reduceMotion || traceCrossfadeKey === "live" ? false : { opacity: 0 }
      }
      animate={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
      transition={{
        duration: reduceMotion ? 0 : HOLD_SLOW_CROSSFADE_MS / 1000,
        ease: "easeOut",
      }}
    >
      <path
        d={gatedVectorPath}
        fill="none"
        stroke={
          selectedOffset >= 0
            ? "var(--ui-vectorscope-trace-snap)"
            : "var(--ui-vectorscope-trace)"
        }
        strokeWidth={traceStrokeWidth}
        opacity="var(--ui-vectorscope-axis-opacity)"
        strokeLinecap="round"
      />
    </motion.g>
  </AnimatePresence>
)}
```

Notes:
- The fade animates `motion.g`'s style opacity, which composes with (rather than overwrites) the `<path>`'s `opacity` presentation attribute — the trace's themed base opacity is preserved. This mirrors SpectrumPanel's `motion.g` palette transition.
- In live (non-hold) mode the key is the constant `"live"`, so the group never remounts and per-frame updates render exactly as before, with `initial={false}`.
- `useReducedMotion` gives an instant swap for reduced-motion users, matching the spec.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: all PASS — including the pre-existing trace tests (`lastLiveTrace` and the snapshot-trace queries still resolve inside the new `<g>`; the existing tests use `container.querySelector('path[...]')` which is ancestor-agnostic).

---

### Task 4: Full check and commit

**Files:** none new.

- [ ] **Step 1: Run the full project check**

Run: `npm run check`
Expected: format + lint + test + build + version check + Rust fmt/clippy/test all PASS. (Project rule: full `npm run check` must pass before any commit.)

If lint flags anything in the new code (e.g. unused variable ordering), fix it and re-run.

- [ ] **Step 2: Commit**

```powershell
git add src/components/panels/VectorscopePanel.jsx src/components/panels/VectorscopePanel.test.jsx
git commit -m "feat(vectorscope): hold-to-slow trace refresh with crossfade" -m "Holding the left button on the vectorscope plot for 300ms throttles the displayed trace and correlation marker to a 200ms cadence with a 140ms crossfade. Display-only: frame intake and history writes are unaffected. Mirrors the spectrum hold gesture (300ms delay, 4px cancel), gated off in snapshot mode and when history is not interactive." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Single commit for the whole feature: the project rule requires a full `npm run check` before any commit, so intermediate per-task commits would each cost a full Rust build — one verified commit is the pragmatic shape here.)

- [ ] **Step 3: Report**

Report done + test results. Do **not** launch a preview; the user tests manually.
