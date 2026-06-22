# Spectrogram Timestamp-Positioned Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented — all tasks complete and `npm run check` green; only Task 5 Step 3 (on-device visual verification) remains, to be done by the owner on the desktop build.

**Goal:** Render the Spectrogram by real timestamp instead of frame-packed index, so per-key history gaps (no-backfill) become real blank space, the heatmap aligns with the time axis / selection line / frequency markers, and data-availability boundary marker lines can be drawn where a view's data appears or disappears.

**Architecture:** A new pure module `src/math/spectrogramTimeline.js` owns the timeline math: `spectrogramTimeWindow(history, offset, visible)` → `{ oldestMs, newestMs }` and `spectrogramDataBoundaries(frames, oldestMs, newestMs, sampleMs)` → boundary timestamps. `useSpectrogramCanvas` paints each in-window frame at `x(ts) = (ts - oldestMs) / (newestMs - oldestMs) * W` (one sample wide; gaps unpainted), selecting the in-window frame range by binary search. `SpectrogramPanel` computes the time window once, passes it to the canvas + hover, and renders the boundary markers (memoized) reusing the frequency-marker SVG. `computeSpectrogramHoverPoint` maps `xFrac → ts → nearest in-window frame`. `mapHistoryViewportToVisual` / `spectrogramVisibleRange` lose their caller and are removed if unused.

**Tech Stack:** React 19, Canvas 2D, Vitest + Testing Library, Vite, JS (JSDoc types).

**Spec:** `docs/superpowers/specs/2026-06-22-spectrogram-timestamp-positioned-rendering-design.md`

---

## File Structure

- **Create** `src/math/spectrogramTimeline.js` — `spectrogramTimeWindow`, `spectrogramDataBoundaries` (+ a binary-search helper for the in-window range, exported for the canvas).
- **Create** `src/math/spectrogramTimeline.test.js` — unit tests for both pure functions + the range helper.
- **Modify** `src/hooks/useSpectrogramCanvas.js` — paint by timestamp window instead of `spectrogramVisibleRange`; cache key includes `oldestMs/newestMs`.
- **Modify** `src/math/hoverMath.js` — rewrite `computeSpectrogramHoverPoint` to map via the time window.
- **Modify** `src/math/hoverMath.test.js` — update spectrogram hover cases to the time-window contract.
- **Modify** `src/components/panels/SpectrogramPanel.jsx` — compute the time window, drop `mapHistoryViewportToVisual`/`visualViewport`, pass window to canvas + hover, render memoized boundary markers.
- **Modify** `src/components/panels/SpectrogramPanel.test.jsx` — add a boundary-marker render assertion (if feasible) / adjust existing.
- **Modify** `src/math/spectrogramViewportMath.js` + `src/math/spectrogramViewportMath.test.js` — remove `mapHistoryViewportToVisual` if no remaining caller; otherwise leave.
- **Modify** `src/config/scales.js` + `src/config/scales.test.js` — remove `spectrogramVisibleRange` if no remaining caller; otherwise leave.

---

## Task 1: Timeline pure functions

**Files:**
- Create: `src/math/spectrogramTimeline.js`
- Create: `src/math/spectrogramTimeline.test.js`

- [x] **Step 1: Write failing tests**

Cover, per the spec §Testing Notes:
- `spectrogramTimeWindow`: offset/visible → `{oldestMs, newestMs}`; clamps at array ends; returns `null` when history has no `timestampMs`.
- `inWindowRange(frames, oldestMs, newestMs)` (binary-search helper): correct `[startIdx, endIdx]`; empty when no frame in range.
- `spectrogramDataBoundaries`: single continuous segment → `[]`; leading gap → start marker; trailing gap → end marker (`ts + sampleMs`); interior gap (switch back-and-forth) → two markers; segment edges touching the window bound are clipped (not marked); empty input → `[]`.

- [x] **Step 2: Implement** `spectrogramTimeline.js` to pass. Keep all three functions pure (no React, no canvas). `gapFactor = 1.8`.

- [x] **Step 3:** `npx vitest run src/math/spectrogramTimeline.test.js` green.

## Task 2: Timestamp-positioned canvas paint

**Files:**
- Modify: `src/hooks/useSpectrogramCanvas.js`

- [x] **Step 1:** Replace the `spectrogramVisibleRange` call + index-based `paintImageData` with: take `{ oldestMs, newestMs, sampleMs }` from params; `inWindowRange` to get the frame slice; for each frame paint `xStart=round(x(ts))`, `xEnd=round(x(ts+sampleMs))`, skip if `colW<=0`; leave gaps unpainted (`data.fill(0)` stays).
- [x] **Step 2:** Update `lastPaintRef` cache key to `{ oldestMs, newestMs, len, sel, W, H, colormapLut }`. Keep the rAF loop + `ImageData` reuse.
- [x] **Step 3:** `npm run build` (canvas has no unit test; rely on Task 1 + build + on-device check).

## Task 3: Hover mapping

**Files:**
- Modify: `src/math/hoverMath.js`, `src/math/hoverMath.test.js`

- [x] **Step 1:** Update tests: `xFrac` inside a segment → nearest frame readout; `xFrac` in a gap → `null`.
- [x] **Step 2:** Rewrite `computeSpectrogramHoverPoint` to accept the time window, compute `ts = oldestMs + xFrac*(newestMs-oldestMs)`, pick nearest in-window frame within `sampleMs` tolerance, else `null`.
- [x] **Step 3:** `npx vitest run src/math/hoverMath.test.js` green.

## Task 4: Panel wiring + boundary markers

**Files:**
- Modify: `src/components/panels/SpectrogramPanel.jsx`, `src/components/panels/SpectrogramPanel.test.jsx`

- [x] **Step 1:** Compute `timeWindow = spectrogramTimeWindow(histSourceList, effectiveOffsetSamples, visibleSamples)`; drop `mapHistoryViewportToVisual`/`visualViewport`. Pass `oldestMs/newestMs/sampleMs` to `useSpectrogramCanvas` and the hover callback.
- [x] **Step 2:** `const boundaries = useMemo(() => spectrogramDataBoundaries(spectrogramSnaps, oldestMs, newestMs, sampleMs), [spectrogramSnaps, oldestMs, newestMs])`. Render each as a dashed vertical line at `x = (ts-oldestMs)/(newestMs-oldestMs)*1000` inside the existing overlay SVG (reuse the frequency-marker style + a `<title>`). Live + snapshot.
- [x] **Step 3:** Add/adjust a panel test asserting a boundary line renders when the visible frames have a leading gap (and none when continuous), if testable; otherwise lean on Task 1 coverage.

## Task 5: Cleanup + gate

**Files:**
- Modify: `src/math/spectrogramViewportMath.js` (+ test), `src/config/scales.js` (+ test) — remove now-unused exports if no other caller; else leave.

- [x] **Step 1:** `grep` for `mapHistoryViewportToVisual` and `spectrogramVisibleRange`; remove each + its tests only if the Spectrogram was the sole caller.
- [x] **Step 2:** `npm run check` green (format + lint + test + build + Rust unaffected).
- [ ] **Step 3:** On-device visual verification (desktop `npm run tauri dev`): gaps render blank, heatmap aligns with time ticks, markers land at segment edges, scrubbing across a gap behaves, hover in a gap shows no readout. _(pending — owner to verify)_

---

## Notes

- No backend/Rust changes — purely frontend rendering.
- Frequency-change markers stay index-positioned for now (history is ~evenly spaced, so they still align); converting them to timestamp x is an optional follow-up.
- Marker end-edge position decision (last frame `ts` vs `ts + sampleMs`): default to `ts + sampleMs` (visual end of data).
