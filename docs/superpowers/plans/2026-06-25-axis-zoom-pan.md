# Axis And Chart Viewport Interaction Plan

**Date:** 2026-06-26
**Spec:** `docs/superpowers/specs/2026-06-25-axis-zoom-pan-design.md`
**Status:** In progress

## Goal

Extend the already-landed axis zoom/pan foundation so axis rails, time axes, and chart areas share
one coherent viewport interaction model:

- Axis rails support wheel zoom, drag pan, double-click reset, and hover/active
  affordance.
- Time axes become direct interaction surfaces instead of passive labels.
- History/timeline chart areas keep snapshot gestures by default, with Ctrl gestures reserved for
  viewport editing.
- Spectrum chart area adds X zoom, Y zoom, trackpad X pan, and Ctrl-drag viewport pan.
- HelpPopover documents the complete current and new gesture set using the existing custom gesture
  icon language.

## Current Baseline

Already implemented:

- `src/math/axisInteractionMath.js` has linear/log zoom, pan, and pixel mapping helpers.
- `src/hooks/useAxisInteraction.js` wires wheel zoom, drag pan, double-click reset, axis
  measurement, and cursor style.
- Spectrum, Spectrogram, Loudness, and LevelMeter already use `useAxisInteraction` for existing
  editable axes.
- Timeline panels already use `useHistoryInteraction` for snapshot select/scrub, wheel time zoom,
  right-drag time pan, and right-double-click reset.
- HelpPopover exists with a lucide `CircleHelp` trigger and custom inline SVG mouse gesture icons.

## File Map

| File                                             | Action           | Responsibility                                                                           |
| ------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------- |
| `src/hooks/useAxisInteraction.js`                | Modify           | Add plain wheel pan, hover/active state, class helpers, pointer-event cleanup            |
| `src/hooks/useAxisInteraction.test.js`           | Modify           | Cover plain wheel pan, Ctrl zoom, drag, active state basics                              |
| `src/hooks/useHistoryInteraction.js`             | Modify           | Add optional Ctrl + wheel Y zoom callback and Ctrl-drag viewport pan callbacks           |
| `src/math/historyInteractionMath.js`             | Modify if needed | Reuse or expose time pan/zoom helpers for time-axis rails                                |
| `src/components/panels/LoudnessHistoryChart.jsx` | Modify           | Wire time-axis rail, Ctrl chart gestures, axis highlight feedback                        |
| `src/components/panels/LoudnessPanel.jsx`        | Modify           | Pass Y-range viewport callbacks and expanded help content                                |
| `src/components/panels/SpectrogramPanel.jsx`     | Modify           | Wire time-axis rail, Ctrl chart gestures, axis highlight feedback, expanded help content |
| `src/components/panels/WaveformPanel.jsx`        | Modify           | Wire time-axis rail, Ctrl time pan, expanded help content                                |
| `src/components/panels/SpectrumPanel.jsx`        | Modify           | Add chart X/Y wheel zoom, trackpad X pan, Ctrl-drag X/Y pan, axis highlights             |
| `src/components/HelpPopover.jsx`                 | Modify           | Support grouped help items, Ctrl keycaps, axis chips, custom gesture icons               |
| Panel tests                                      | Modify/add       | Assert help content, handler routing, and no layout row regressions                      |

## Task 1: Refresh Shared Axis Rail Behavior

- [ ] Extend `useAxisInteraction` so plain wheel zooms the axis around the cursor.
- [ ] Keep drag direction aligned with the spec:
  - X axis: drag right pans earlier/lower, drag left pans later/higher.
  - Y axis: drag up pans lower, drag down pans higher.
- [ ] Add hover and non-lingering active state to the hook return value.
- [ ] Keep existing `cursorStyle` behavior.
- [ ] Update `useAxisInteraction.test.js` for plain wheel pan and existing Ctrl zoom behavior.

## Task 2: Add Axis Rail Affordance Styling

- [ ] Create a small shared axis rail class/helper if it reduces duplicated class strings.
- [ ] Add subtle hover and active rail backgrounds to Spectrum, Spectrogram, Loudness, and
      LevelMeter axis rails.
- [ ] Ensure the dedicated axis layout rows/columns remain unchanged.
- [ ] Add or adjust tests that source-assert axis row placement.

## Task 3: Make Time Axes Interactive

- [ ] Add a reusable time-axis rail interaction path for history-window pan/zoom/reset.
- [ ] Wire Loudness time axis:
  - wheel zooms time
  - drag pans time
  - double-click resets time window/offset
- [ ] Wire Spectrogram time axis with the same behavior.
- [ ] Wire Waveform time axis with the same behavior.
- [ ] Reuse existing history math and state setters where possible.

## Task 4: Add Timeline Chart Ctrl Viewport Gestures

- [ ] Extend `useHistoryInteraction` or compose a wrapper so timeline chart areas support:
  - existing plain left click/drag snapshot behavior
  - existing right-drag time pan
  - existing plain wheel time zoom
  - Ctrl + wheel Y zoom when the panel has a Y axis
  - Ctrl + drag viewport pan
- [ ] Ensure Ctrl + drag does not move snapshot selection lines.
- [ ] Hide or soften hover popovers while Ctrl viewport drag is active.
- [ ] Add focused tests around event routing where practical.

## Task 5: Add Spectrum Chart Viewport Gestures

- [ ] Add plain wheel X zoom anchored at cursor.
- [ ] Add Ctrl + wheel Y zoom anchored at cursor.
- [ ] Add trackpad horizontal scroll X pan.
- [ ] Add Ctrl + left-drag X/Y viewport pan.
- [ ] Preserve click-to-capture snapshot and double-click-return-to-live.
- [ ] Show active X/Y axis rail feedback during chart viewport operations.
- [ ] Add focused tests for handler routing and range updates.

## Task 6: Upgrade HelpPopover

- [ ] Let `HelpPopover` accept the existing flat string list and a grouped structure.
- [ ] Keep lucide `CircleHelp` for the trigger.
- [ ] Keep custom gesture icons inside the popover; add Ctrl keycap and X/Y/time axis chips.
- [ ] Update Loudness, Spectrogram, Waveform, and Spectrum help content to list both existing and
      new gestures.
- [ ] Update `HelpPopover.test.jsx` for grouped rendering and backward compatibility.

## Task 7: Verification

- [ ] Run focused tests:
  - `npm test -- src/hooks/useAxisInteraction.test.js`
  - `npm test -- src/components/HelpPopover.test.jsx`
  - panel tests touched by the implementation
- [ ] Run broader gates when code stabilizes:
  - `npm test`
  - `npm run build`
  - `git diff --check`
- [ ] Manual smoke in the desktop/web app:
  - Spectrum chart and axes
  - Loudness chart, time axis, and Y axis
  - Spectrogram chart, time axis, and Y axis
  - Waveform chart and time axis

## Non-Goals

- Do not add chart HUD text for Ctrl-hover `Pan viewport`.
- Do not add chart HUD text for wheel `Zoom X` / `Zoom Y`.
- Do not replace custom gesture icons with generic lucide action icons.
- Do not redesign the panel layout or move axis labels out of their existing rows/columns.
