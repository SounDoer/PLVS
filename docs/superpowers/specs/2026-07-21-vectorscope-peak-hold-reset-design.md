# Vectorscope Peak Hold Reset — Design

**Date:** 2026-07-21
**Status:** Approved

## Summary

Let the user reset a Polar Level **Peak hold** during live capture without clearing the source or
history. Today Peak hold only resets through the global Clear action (the shared reset epoch), by
toggling Peak hold off/on, or by changing pair/mode. This adds a direct, in-context reset: clicking
the plot resets that instance's Peak hold, mirroring the existing "click to reset TP Max" affordance
on the Level meter.

The reset is frontend-only. Peak hold is a per-instance runtime accumulator (`peakHoldRef` in
`VectorscopePolarPlot`); resetting it does not touch the Rust engine, unlike `resetTruePeakMax`.

## Product Decisions

- The reset is **per instance**: it clears only the clicked panel's (or Dock module's) Peak hold.
  Other Vectorscope instances are untouched, matching Peak hold's per-instance semantics.
- The trigger is a **click on the plot area** (the square plot region, not the correlation rail).
- The click-to-reset affordance is active only when all of these hold:
  - mode is `polarLevel`;
  - Peak hold is enabled for that instance;
  - the view is **live**, not a snapshot.

  It is intentionally **not** gated on whether a held value has accumulated yet: that state lives
  inside `VectorscopePolarPlot` (`peakHoldRef`) and lifting it up to the panel/Dock only to hide a
  cursor for the fraction of a second before the hold seeds is not worth the coupling. Clicking
  before anything has accumulated resets null→null — a harmless no-op.
- Reset clears only the Peak hold accumulation. The live level fan (envelope) keeps running
  uninterrupted; Peak hold restarts from the current envelope, identical to toggling it off then on.
- Discoverability matches the Level meter's TP Max reset: `cursor-pointer` plus a hover tip reading
  **"Click to reset Peak hold"**, both supplied by the existing `useHoverTip` hook.
- Both the full-panel Vectorscope and the Dock Vectorscope support the gesture, each resetting its
  own Peak hold.
- The global Clear action still resets Peak hold everywhere, as before. This feature is additive.

## Affordance

Reuse the pattern from `AxisValueMarker` (Level meter TP Max):

- When the affordance is active, the plot wrapper gets `pointer-events`/`cursor-pointer`, an
  `onClick` that fires the reset, and `useHoverTip({ tip: "Click to reset Peak hold" })` for the
  anchor ref plus `showTip`/`hideTip`/`tipNode`.
- When inactive, the wrapper carries no reset handler or tip and behaves exactly as today.
- The click must not interfere with the Lissajous hold-to-slow pointer gesture. That gesture is
  Lissajous-only; the reset is Polar Level-only, so they never coexist. The reset uses `onClick`
  (a completed down+up), distinct from the hold-to-slow `pointerdown` timer.

## Mechanism and Data Flow

- Each instance owns a runtime **reset nonce** — a `useState` counter in `VectorscopePanel` and in
  `DockVectorscope`. The click handler increments it. It is runtime-only and never persisted.
- The nonce is passed to `VectorscopePolarPlot` as a new `peakHoldResetKey` prop.
- `VectorscopePolarPlot` tracks the last-seen key in a ref. When it changes, it clears
  `peakHoldRef` (sets it to null). On the next draw the live path's
  `updatePolarPeakHold(null, envelope, { enabled })` reseeds the hold from the current envelope —
  the existing "fresh hold from current" behaviour. `envelopeRef` and `lastTimestampRef` are left
  untouched, so the fan does not jump.
- `peakHoldResetKey` joins the plot's redraw-guard signature so the reset triggers a redraw.
- This is separate from the `stateIdentity` reset (mode / identityKey / resetEpoch), which resets
  the envelope as well. Peak hold reset must not disturb the envelope.

## Scope and Edge Cases

- **Live only.** In snapshot the outline is reconstructed read-only history
  (`buildPolarLevelPeakHoldTable`); resetting it is meaningless, so the affordance is absent in
  snapshot and clicks do nothing.
- **Nothing to reset.** With Peak hold on but no accumulation yet, the affordance is still shown
  (it becomes meaningful within a frame or two); clicking resets null→null, a harmless no-op.
- **Wrong mode.** Lissajous and Polar Sample have no Peak hold; the affordance is absent.
- **Dock.** The Dock plot is small but supports the same click-to-reset on its plot area, resetting
  the Dock module's own Peak hold. Endpoint labels and layout are unchanged.

## Testing

- `VectorscopePolarPlot`: changing `peakHoldResetKey` clears the held outline while the live fan
  (envelope fill) is unchanged; a stable key does not reset; snapshot ignores the key.
- `VectorscopePanel` / `DockVectorscope`: clicking the plot fires the reset only when the affordance
  is active (Polar Level + Peak hold on + live); the hover tip text and cursor state appear only
  then; other modes/snapshot expose no reset handler.
- `useHoverTip` is existing and not re-tested here.

## Out of Scope

- Resetting Peak hold across all instances at once (global "reset all").
- A settings-menu reset button or a keyboard shortcut (click-on-plot is the only trigger this
  slice).
- Any Rust/IPC change; Peak hold is a frontend accumulator.
- Changing how the global Clear action resets Peak hold.
- Persisting or restoring Peak hold values (they remain runtime-only).
