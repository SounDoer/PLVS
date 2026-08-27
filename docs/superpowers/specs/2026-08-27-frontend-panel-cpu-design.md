# Frontend Panel CPU Design

**Status:** Approved for implementation on `main` (2026-08-27).

## Context

After the packed-history and bounded Snapshot-entry work, a long-running four-hour session no
longer needs multi-gigabyte unpacked visual history or a full-history copy when Snapshot opens.
The remaining reported symptoms are steady WebView CPU usage, visibly uneven panel updates, and a
small pause around Snapshot interaction.

The frontend currently receives meter display updates at frame cadence while visual-analysis rows
advance at their own cadence. Some panels already compare an explicit history `version` before an
expensive redraw. The 2D and 3D Spectrogram renderers still run permanent
`requestAnimationFrame` loops: they wake at display refresh rate, inspect the same version and
layout, and usually return without painting. This polling continues in a static Snapshot and in a
normal workspace panel covered by the fullscreen overlay.

There are also important existing optimizations that must not be mistaken for missing work:

- only the active tab in each workspace leaf is mounted;
- live React display publication stops while Snapshot is selected, while history ingestion
  continues;
- Vectorscope Polar already has a complete redraw signature and skips identical frame-cadence
  renders; and
- long-window Spectrogram raster work is already bounded by canvas width.

The CPU work therefore starts with measured panel-local rendering, not changes to capture,
analysis cadence, history retention, or history precision.

## Goals

1. Eliminate continuous frontend work when a panel's pixels cannot change.
2. Coalesce multiple invalidations before the next browser paint into one draw.
3. Preserve the effective update cadence and appearance of every visible Live panel.
4. Make static Snapshot panels and fullscreen-covered workspace panels settle to zero recurring
   panel-owned animation work.
5. Add opt-in measurements that identify render, scheduling, skip, and paint cost by panel family
   without adding production allocations on every frame.

## Non-goals

- Reducing the four-hour history duration.
- Reducing any history sampling cadence or panel-specific history length.
- Reducing stored history precision.
- Throttling visible Live rendering below the cadence of the data that drives it.
- Changing Rust DSP, capture, analysis requests, or IPC payload cadence.
- Replacing Canvas/SVG technology or redesigning a panel.
- Moving rendering to a Worker or `OffscreenCanvas` in this phase.
- Treating aggregate Task Manager CPU as a deterministic automated-test threshold.

## Fixed product decisions

1. **History ingestion is independent from visibility.** A hidden or static panel may stop deriving
   and drawing, but `FrameIntake` continues to retain every configured history row.
2. **Live fidelity is fixed.** Every new source version visible to a Live panel remains eligible for
   the next browser paint; there is no timer-based frame dropping.
3. **Snapshot is static by default.** After its selected source, viewport, theme, controls, and size
   settle, a Snapshot panel schedules no recurring work.
4. **Covered panels are inactive.** When the fullscreen overlay sets `panelVisible: false`, the
   normal workspace instance does not draw. The fullscreen instance remains active.
5. **Optimize only proven work.** Existing guards remain unless measurements show that the guarded
   computation itself is material.

## Rendering model

Each canvas renderer follows an invalidation-driven model:

```text
history version / selection / controls / theme / size / visibility
                              |
                              v
                    coalesced one-shot rAF
                              |
                              v
                 compare complete paint signature
                       |                 |
                    unchanged          dirty
                       |                 |
                     stop             paint once
```

The renderer does not schedule its successor. React data publication, a ResizeObserver callback,
or a control/theme/selection change schedules the next one-shot frame. If several inputs change
before that frame, cleanup cancels the obsolete callback and only the newest parameters paint.

Canvas backing-store size is part of invalidation. `useCanvasSize` remains responsible for sizing
the canvas, and the panel increments a small size revision through its existing callback so the
renderer cannot miss a ResizeObserver-only change.

## Phase 1: Spectrogram

Both `useSpectrogramCanvas` and `useSpectrogram3dCanvas` will:

- accept the current history source version explicitly;
- accept canvas size revision and panel visibility;
- schedule one rAF from input invalidation rather than maintaining a permanent loop;
- keep the existing complete paint-signature check as a correctness backstop;
- cancel an outstanding callback on a newer invalidation or unmount; and
- force the next visible render after a hidden interval to evaluate the current source.

The source version is necessary because live history views mutate in place. Depending on the view
object identity would freeze the display. The revision is a scalar read from the same history view
that the draw later consumes; it does not copy or decode history.

Expected steady-state behavior:

- visible Live: at most one scheduled canvas draw per new visual source version or other visual
  invalidation;
- static Snapshot: zero callbacks after the final paint;
- inactive 2D/3D renderer: zero callbacks;
- fullscreen-covered workspace instance: zero callbacks; and
- history ingestion: unchanged.

## Phase 2 candidates, gated by measurements

### Vectorscope

Vectorscope Polar already skips identical paints, but its parent still selects recent windows and
the Lissajous persistence canvas redraws on every parent commit while active. Instrumentation will
separate window-selection time from canvas time. If material, selection will be keyed by slab
version and the canvas will use the same visibility-aware one-shot invalidation model. Polar Max
Hold accumulation semantics must remain unchanged.

### Spectrum

The live analysis result already supplies paths, but the panel constructs display snapshots,
max-hold arrays, paths, peak candidates, and labels. Measurements will determine whether stable
subresults should be cached by analysis-result identity and viewport. No spectrum result will be
quantized or sampled less often as part of CPU work.

### Stereo Map

Live rows are converted from packed mode data into display arrays during render, and hold data is
resolved from the history slab. If this is material, derive results will be cached by live-row
identity, mode, and range. This is a compute cache only; stored mode history remains unchanged.

### Waveform

Waveform already gates work with `panelVisible` and schedules its canvas paint through a one-shot
rAF. Measurements may still show avoidable envelope selection or SVG construction, but it is not a
first-pass scheduling target.

## Diagnostics

Add a development-only panel CPU collector with an explicit enable switch. It records aggregate
counters and elapsed time, not per-frame objects:

- invalidations;
- scheduled and cancelled callbacks;
- paint attempts;
- signature skips;
- completed paints; and
- total/max paint duration.

The collector exposes a resettable snapshot on `window` only in development and only when enabled.
Normal production builds take one predictable disabled branch and create no samples. Automated
tests assert counter semantics and scheduling bounds; elapsed milliseconds remain report-only.

## Correctness and lifecycle

- A renderer mounted before the first history row paints when the first source version arrives.
- Switching between 2D and 3D paints the newly active renderer and leaves the inactive hook idle.
- Resizing with unchanged data repaints at the new backing-store dimensions.
- Theme, frequency range, dB floor, 3D view, colorization, floor, selection, and time-window changes
  each invalidate the relevant renderer.
- Hiding cancels outstanding work; revealing evaluates the latest source and paints once.
- Snapshot entry/exit does not restart a self-perpetuating loop.
- React Strict Mode setup/cleanup may schedule and cancel callbacks but cannot leave duplicate
  loops because no callback schedules another callback.

## Testing

### Scheduler behavior

- One invalidation schedules one rAF and the callback does not schedule a successor.
- A newer invalidation before paint cancels the obsolete callback and paints the latest parameters.
- Identical rerenders do not schedule another callback.
- Hidden and inactive renderers schedule nothing.
- Revealing, resizing, and source-version changes each schedule exactly one draw.

### Rendering behavior

- Existing 2D pixel placement and gap behavior remains unchanged.
- Existing 3D mode, projection, selection, view, and theme tests remain unchanged.
- Live in-place history mutation with a new version repaints.
- Static Snapshot settles after its first paint.

### Integration and manual validation

- Verify 2D Heatmap, 3D Lines, and 3D Surface in Live and Snapshot.
- Verify fullscreen entry/exit and tab switching.
- Verify resize, DPI, theme, controls, scrub, Clear, and source restart.
- Compare developer counters over one minute: callback count should track source invalidations, not
  monitor refresh; static Snapshot callback count must stop.
- Run a real four-hour soak and compare WebView CPU and interaction smoothness to the prior run.

## Acceptance criteria

- Spectrogram canvas hooks contain no self-rescheduling rAF loop.
- A static visible Snapshot performs no recurring Spectrogram callback after settling.
- A fullscreen-covered normal Spectrogram performs no canvas work.
- Visible Live paints on every new visual-history version eligible for the next browser frame.
- Resize and every existing visual control still repaint correctly.
- History length, history cadence, stored values, analysis request cadence, and IPC are unchanged.
- Focused tests, `git diff --check`, and `npm run check` pass.
- Phase 2 changes land only with before/after diagnostic evidence for that panel family.

## Implementation boundaries

- Keep Phase 1 in JavaScript/React.
- Do not touch `src-tauri/src/audio`, `dsp`, or `engine`.
- Land on `main` as approved by the user.
- Keep documentation, diagnostics, renderer scheduling, and later panel-specific caches in separate
  commits where practical.
