# Vectorscope hold slow mode — design

Date: 2026-07-10
Status: Implemented (revised during implementation — see "Slow-mode behavior")

> Revision note: the originally approved design was a display refresh throttle (200 ms cadence
> with a crossfade). User testing found the discrete refresh read as a frame-skipping jump
> rather than a smooth slowdown, so the shipped design is spectrum-style per-point EMA with a
> size renormalization step. The gesture, scope, and data-integrity sections are unchanged.

## Background

SpectrumPanel already has a hold gesture: pressing and holding the left mouse button on the
chart for 300 ms (without moving more than 4 px) activates a display-only smoothing mode that
makes the curve easier to read (`HOLD_DISPLAY_SMOOTHING_ALPHA` per-bin EMA in
`src/components/panels/SpectrumPanel.jsx`).

The user wants an equivalent hold gesture on the Vectorscope trace. The spectrum mechanism
cannot be copied blindly: spectrum bins have a stable physical meaning (bin `i` is always the
same frequency band), while vectorscope path points are raw sample pairs from a sliding
window — index `i` means a different instant on every frame. Naive per-point EMA therefore
contracts the figure toward its centroid (the EMA of index-shuffled targets converges to the
distribution mean; at `alpha = 0.06` the steady-state radius is ~18% of the true size).

The shipped design is per-point EMA **plus size renormalization**: blend every displayed point
6% toward the live target each frame, then rescale the blended cloud about the plot center so
its mean-square radius matches the (equally smoothed) live size. The result is a smoothly
morphing average stereo image at the correct scale. The displayed shape is not a true
instantaneous Lissajous trajectory — intentional: the hold mode exists to read the average
stereo image (width, bias, phase tendency), not transient trajectories.

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
HOLD_SLOW_SMOOTHING_ALPHA = 0.06
VS_TRACE_CENTER = 130
```

## Slow-mode behavior

While slow mode is active, every incoming frame is rendered (no throttle), but the displayed
values are low-passed:

- **Trace**: the live SVG path (`M x y L x y …`, 0..260 viewBox, center 130,130) is parsed
  into coordinates. Each displayed point moves `6%` (`HOLD_SLOW_SMOOTHING_ALPHA`) toward the
  incoming live point per frame — the same alpha as spectrum's `HOLD_DISPLAY_SMOOTHING_ALPHA`.
  Because per-point EMA of index-shuffled targets contracts the cloud toward its centroid, the
  blended figure is then rescaled about the plot center so its mean-square radius matches the
  live size (itself smoothed with the same alpha, so momentary silence does not collapse the
  figure instantly). If the point count changes between frames, the display snaps to the raw
  live path (same degradation strategy as spectrum's `bandsMatch`).
- **Correlation marker**: the correlation value is low-passed with the same alpha before
  feeding the existing live display smoothing (`LIVE_CORRELATION_DISPLAY_ALPHA`), so the marker
  slows down together with the trace.

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
- The smoothing state is a ref holding `{ points, correlation, meanSquareRadius }`, updated
  inside a `useMemo` keyed on the live path/correlation and the hold state (ref mutation in a
  memo is the established pattern in this component — see `liveCorrelationDisplayRef`).
  Releasing the hold clears the ref, so re-activation starts fresh from the then-current frame.
- Per-frame cost while held is bounded: the Rust ring caps the path at ~680 points
  (`VS_CAP = 4096`, decimation step 6), so parse + blend + rebuild is ~1400 numbers per frame,
  only in the held panel instance.
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
- While active, an incoming path blends 6% toward the live target per frame (deterministic
  coordinate assertions).
- Size renormalization: the same shape with shuffled point order keeps its size (a swapped-
  endpoints line stays at full width instead of contracting toward the center).
- A point-count change snaps to the raw live path.
- Correlation marker is low-passed with the same alpha.
- Pointer up restores live per-frame updates.
