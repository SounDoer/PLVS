# Vectorscope hold slow mode — design

Date: 2026-07-10
Status: Approved, ready for implementation

## Background

SpectrumPanel already has a hold gesture: pressing and holding the left mouse button on the
chart for 300 ms (without moving more than 4 px) activates a display-only smoothing mode that
makes the curve easier to read (`HOLD_DISPLAY_SMOOTHING_ALPHA` per-bin EMA in
`src/components/panels/SpectrumPanel.jsx`).

The user wants an equivalent hold gesture on the Vectorscope trace. The spectrum mechanism
cannot be reused directly: spectrum bins have a stable physical meaning (bin `i` is always the
same frequency band), so per-bin EMA produces a meaningful "slowed" curve. Vectorscope path
points are raw sample pairs from a sliding window — index `i` means a different instant on every
frame — so per-point interpolation would draw distorted ghost shapes, not a slower trace.

Instead, the Vectorscope slow mode is a **display refresh throttle**: while held, the trace
updates at a fixed slow cadence with a crossfade between shapes.

## Scope

Frontend-only change in `src/components/panels/VectorscopePanel.jsx`. No Rust, IPC, analysis
request key, or persistence changes. The data pipeline (frame intake, history slab writes,
snapshot resolution) is untouched; only which frames the panel chooses to *draw* changes.

Out of scope:

- Phosphor persistence / afterglow rendering.
- True slow-motion playback (engine-side sample consumption pacing).
- Any panel setting or persisted control for this behavior.
- Spectrogram/Waveform hold gestures.

## Gesture

Matches the spectrum hold gesture semantics:

- Trigger: left button (`button === 0`) pointer down on the vectorscope plot area (the square
  trace container, grid + trace), held for `300 ms` without moving more than `4 px`
  (`Math.hypot` from the pointer-down position).
- Guards: no trigger when `selectedOffset >= 0` (snapshot mode) or when
  `historyChartInteractive` is false. `ctrlKey` down at pointer down does not trigger
  (consistent with spectrum, which reserves ctrl-drag for panning).
- Cancel: pointer moves beyond `4 px` before the 300 ms timer fires.
- Exit: pointer up, pointer cancel, or pointer leave immediately deactivates slow mode and
  restores per-frame live updates. No exit delay.
- Timer and refs are cleaned up on unmount.

Constants (component-local, mirroring spectrum's naming):

```text
HOLD_SLOW_DELAY_MS = 300
HOLD_SLOW_CANCEL_PX = 4
HOLD_SLOW_REFRESH_MS = 200
HOLD_SLOW_CROSSFADE_MS = 140
```

## Slow-mode behavior

While slow mode is active:

- **Trace**: the displayed SVG path is frozen; a new live path is accepted only every
  `200 ms`. Frames arriving between refresh ticks are ignored for display (the underlying data
  flow is unaffected). At each refresh tick the new path replaces the old one with a
  `~140 ms` opacity crossfade using `framer-motion` `AnimatePresence` (same pattern as the
  spectrum live/snap palette transition), keyed per refresh tick. `useReducedMotion` disables
  the crossfade (instant swap), matching spectrum's reduced-motion handling.
- **Correlation marker**: the correlation value driving the marker and its color updates on the
  same 200 ms cadence as the trace, so the whole panel reads as one paused-cadence view. The
  existing live smoothing (`LIVE_CORRELATION_DISPLAY_ALPHA`) applies to the values that are
  accepted; the marker's existing CSS left/color transition provides the visual easing between
  ticks.

On exit, the panel immediately resumes normal per-frame updates for both trace and correlation.

## Data integrity

The history path is unaffected by design: vectorscope history pairs are written by the frame
intake layer (`src/lib/FrameIntake.js` → `VectorscopeHistorySlab`) at the App level, independent
of panel rendering. Slow mode only skips display updates inside `VectorscopePanel`; every frame
still reaches the history slab, and snapshots taken over a hold period contain full-rate data.

## Implementation notes

- The hold state machine (pointer-down timer, move-cancel, release cleanup) mirrors
  `scheduleHoldSmoothing` / `clearPendingHoldSmoothing` / `releaseHoldSmoothing` in
  `SpectrumPanel.jsx`. During implementation planning, evaluate extracting a shared
  `useHoldGesture` hook versus keeping a local copy; default to a local copy unless the
  extraction is clean (two call sites, identical semantics) — no speculative generalization.
- The throttle can be a ref holding `{ lastAcceptTs, heldPath, heldCorrelation }`: when slow
  mode is active and `now - lastAcceptTs < 200 ms`, render the held values; otherwise accept
  the current live values and update the ref. A re-render tick is not required beyond what
  incoming frames already cause, since frames arrive far more often than 200 ms.
- Snapshot mode short-circuits all of this: existing snapshot rendering is unchanged.
- The plot container currently has no pointer handlers; adding them must keep the two SVGs'
  `pointer-events` behavior intact (grid SVG is `pointer-events-none`; handlers go on the
  wrapping container).

## Tests

Vitest, colocated in `src/components/panels/VectorscopePanel.test.jsx`:

- Holding pointer down for ≥ 300 ms (fake timers) activates slow mode; moving > 4 px before the
  timer fires cancels it.
- No activation in snapshot mode (`selectedOffset >= 0`) or when `historyChartInteractive` is
  false.
- While active, a new live path arriving within 200 ms of the last accepted one does not change
  the rendered path; after 200 ms the new path is rendered.
- Correlation marker value follows the same throttle.
- Pointer up restores live per-frame updates.
