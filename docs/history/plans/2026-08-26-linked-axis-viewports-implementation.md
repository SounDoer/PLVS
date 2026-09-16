# Linked Axis Viewports Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Panels showing the same quantity on an axis share one persisted viewport by default, with a per-panel opt-out, for frequency and for time.

**Architecture:** Workspace state owns one `axisViewports` entry per axis kind and each eligible panel owns a membership flag plus its dormant local value. Semantic reducer actions perform join, leave and shared-range updates atomically. Panels consume one effective-viewport adapter. Dock is screened out.

**Tech Stack:** React 19, Workspace reducer/context, existing persistence and preset hooks, Vitest/Testing Library, `useAxisInteraction` / `AxisRail` / `axisInteractionMath`.

**Design:** `docs/superpowers/specs/2026-08-26-linked-axis-viewports-design.md`

**Supersedes:** `docs/superpowers/plans/2026-07-25-linked-frequency-viewport-implementation.md`

## Preconditions and invariants

- Linking is Workspace-only and defaults **on** for new and existing panels.
- Do not add viewport state to session runtime, backend requests, history keys, snapshot selection, or Dock state.
- Do not persist a separate global enabled flag; derive participation from eligible panel instances.
- While linked, preserve dormant local values unchanged.
- Join, leave and preset apply must be atomic reducer operations.
- Render-time clamping must never mutate a persisted value.
- `selectedOffset` stays global. Never split it per panel.
- Each task defines a focused commit checkpoint. Run its commit step only when the user has explicitly authorized commits; otherwise leave the verified changes uncommitted.

## Phase map

| Phase | Tasks | Ships on its own |
| --- | --- | --- |
| 1 — Time Range row | 1–3 | Yes: numeric entry for a window that is gesture-only today |
| 2 — Linking, frequency first | 4–9 | Yes: the feature, for frequency |
| 3 — Time localization + linking | 10–13 | Yes: completes the feature |

Phase 1 deliberately leaves the time value shared. Localization belongs with the toggle that needs it (see the design's Phasing section), so it lands in Phase 3.

---

## Phase 1 — Time Range in panel settings

### Task 1: Time viewport edge mapping

**Files:**

- Create: `src/math/timeViewportEdges.js`
- Create: `src/math/timeViewportEdges.test.js`

**Step 1: Write failing pure-function tests**

The settings row shows the value at the left end of the rail and the value at the right end, matching whichever labels the current source mode renders. Cover both directions and the round trip:

- live (`buildHistoryTimeAxisLabels`, counts down left to right): `{ windowSec: 30, offsetSec: 0 }` reads as `{ left: 30, right: 0 }`; `{ windowSec: 20, offsetSec: 10 }` reads as `{ left: 30, right: 10 }`.
- file (`buildMediaTimeAxisLabels`, counts up): the same window reads as `{ left: startSec, right: endSec }` from the visible media range.
- editing either end produces a `{ windowSec, offsetSec }` pair, never a negative window;
- the round trip `edgesFromViewport(viewportFromEdges(e))` is the identity on valid input.

**Step 2: Verify RED**

```powershell
npm test -- src/math/timeViewportEdges.test.js
```

Expected: module missing.

**Step 3: Implement**

Export `edgesFromViewport({ windowSec, offsetSec, mode, mediaRange })` and `viewportFromEdges({ left, right, mode, mediaRange })`. Reuse the existing media-range helper in `historyMath.js` rather than recomputing sample arithmetic.

**Step 4: Verify**

```powershell
npm test -- src/math/timeViewportEdges.test.js
```

**Step 5: Commit**

```powershell
git add src/math/timeViewportEdges.js src/math/timeViewportEdges.test.js
git commit -m "feat: map the time viewport to its rail's two edges"
```

---

### Task 2: Clamp time edges against the current source

**Files:**

- Modify: `src/math/timeViewportEdges.js`
- Modify: `src/math/timeViewportEdges.test.js`

**Step 1: Write failing tests**

The window's maximum is dynamic and already exists: `fileMaxWindowSec` for files, `historyMaxWindowSec` for live. A committed edit clamps against it without reporting an error, and clamping is a display-time operation that never rewrites a stored value:

- a window longer than the source is clamped to the source;
- an offset that would scroll past the oldest sample is clamped;
- a right edge earlier than the left edge swaps rather than producing a negative window;
- clamping a viewport twice is idempotent.

**Step 2: Verify RED, Step 3: Implement, Step 4: Verify**

Same commands as Task 1.

**Step 5: Commit**

```powershell
git add src/math/timeViewportEdges.js src/math/timeViewportEdges.test.js
git commit -m "feat: clamp time viewport edits against the current source"
```

---

### Task 3: Render the Time Range row

**Files:**

- Modify: `src/components/PanelSettingsContent.jsx`
- Modify: `src/components/PanelSettingsContent.test.jsx`
- Modify: `src/App.jsx`

**Step 1: Write failing component tests**

- Loudness, Spectrogram and Waveform settings each show a `Time Range` row with two inputs; no other panel does.
- In live mode the row reads `[30] – [0]`; in file mode the same window reads `[0] – [30]`.
- Committing a value calls the setters for the shared window and offset.
- Values carry no unit suffix, matching `Frequency Range`.
- Dock Editor does not show the row.

**Step 2: Verify RED**

```powershell
npm test -- src/components/PanelSettingsContent.test.jsx
```

**Step 3: Implement**

Add the row using the existing `SettingsRow` + `SettingsRangeInput` pair. Thread `clampedWindowSec`, `effectiveOffsetSec`, the source mode, the media range and the two setters from `App.jsx` — they are already in the `historyData` context, so prefer reading them there over adding props.

The value is still shared in this phase. Editing it from one panel moves all timeline panels, which is exactly what the axis gestures already do, so no ownership caveat is needed in the UI.

**Step 4: Verify**

```powershell
npm run check
```

**Step 5: Commit**

```powershell
git add src/components/PanelSettingsContent.jsx src/components/PanelSettingsContent.test.jsx src/App.jsx
git commit -m "feat: set the time range from panel settings"
```

---

## Phase 2 — The linking mechanism, frequency first

Task detail is deliberately thin here: Phase 1 will teach us how much of the time cluster can be read from context, which changes the shape of the adapter in Task 6. Expand these before starting.

### Task 4: Axis-kind descriptors and normalization

Create `src/workspace/axisViewports.js`: one descriptor per kind (id, member module ids, scale, bounds, min span), and `normalizeAxisViewport(kind, raw)`. Reuse `FREQUENCY_VIEWPORT` from `axisInteractionMath.js` as the frequency descriptor's source of truth rather than restating its numbers.

### Task 5: Persisted Workspace state and migration

Add `axisViewports` to Workspace state and `linkFrequencyViewport: true` to eligible panel controls. Old payloads normalize to the defaults **with membership on**. Confirm the right persistence domain first — `src/persistence/index.js` splits by domain and guessing wrong makes a reset take the wrong data with it.

### Task 6: Atomic reducer actions and the effective-viewport adapter

`setSharedAxisViewport`, `joinAxisViewport`, `leaveAxisViewport`. One adapter gives a panel its effective value, its linked flag and an update callback already aimed at local or shared state.

### Task 7: Wire the three frequency panels

Spectrum X, Spectrogram frequency Y, Stereo Map X. All three already consume their range through `useAxisInteraction` + `AxisRail` with a shared `FREQUENCY_VIEWPORT`, so this is the same edit three times: swap the local range source for the adapter.

### Task 8: The link toggle in the range row's action slot

A shared control used by every axis kind. It must hold its width in both states — `SettingsRow`'s label column is `max-content`, and `SettingsResetButton`'s comment records what happens when a control there unmounts.

### Task 9: Presets, and the DSP/history/snapshot and Dock boundaries

Capture and restore shared viewport, membership and dormant local values, applied atomically. Add the guard tests that keep viewports out of request keys, history keys and snapshot selection, and out of Dock entirely.

---

## Phase 3 — Time localization and linking

### Task 10: Localize the time viewport cluster

Move `clampedWindowSec`, `effectiveOffsetSec`, `effectiveOffsetSamples`, `visibleSamples`, `historyTimeTicks`, `historyTimeAxisHandlers`, `historyTimeAxisActive`, the four `onHistory*` handlers and the HUD trio from a single computation in `App.jsx` into per-instance state for each timeline panel. This is the bulk of the phase; expand it into sub-tasks before starting.

#### Task 10a: Separate global history inputs from panel-local viewport output

- Keep the raw shared `historyWindowSec` / `historyOffsetSec` pair temporarily in
  `useLoudnessHistory`; Task 11 replaces its storage through the axis adapter.
- Extract the render-time clamp, selection-line placement and time-tick construction into a
  panel-instance hook fed by global history inputs plus an effective viewport.
- Cover live/file clamping and selection placement with hook tests before moving callers.

#### Task 10b: Give each timeline mount its own interaction and HUD lifecycle

- Move `useHistoryInteraction` and the HUD hold/timer state into the panel-instance hook.
- Build the hook in both normal leaves and the fullscreen overlay, and expose its result through
  the existing panel instance boundary so panel bodies and their Settings menu read the same data.
- Keep non-timeline panels and Dock on the global history data path.

#### Task 10c: Remove the App-owned derived cluster

- Migrate Loudness, Spectrogram, Waveform and their Time Range rows to the localized value without
  changing their public `useHistoryData()` consumption seam.
- Remove the derived viewport, interaction handlers and HUD fields from `App.jsx`; retain only raw
  history/source inputs and globally meaningful selection/snapshot data.
- Run focused panel/settings tests, then the complete frontend test suite before starting Task 11.

### Task 11: Add time as the second axis kind

Descriptor, membership flag, and the same adapter. If Phase 2's mechanism was built correctly this is mostly configuration.

### Task 12: The off-window selection indicator

With unlinked windows a selection can fall outside a panel's view. Show an edge indicator pointing toward it. `TimelineLatestEdgeHint` is the precedent to follow.

### Task 13: Final verification

`npm run check`, then a manual pass: link and unlink each axis in each panel, confirm presets round-trip, confirm Dock is untouched, and confirm the time row reads correctly in both source modes.

---

## Out of scope, tracked separately

**Source-aware frequency clamping.** The frequency axes always draw 20 Hz–20 kHz regardless of the source's sample rate, so a low-rate source leaves the upper part of every frequency panel permanently empty. `supportedMax`, `nyquist` and `sampleRate` appear nowhere in the three frequency panels today. The 2026-07-25 draft folded this into linking; it is an independent display defect and belongs in its own change. Its shape mirrors time's existing clamp — a persisted value plus a render-time clamp against the current source — so it is cheaper after Phase 1 than before.
