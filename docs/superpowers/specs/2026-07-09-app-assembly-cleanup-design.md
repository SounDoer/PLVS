# App Assembly Cleanup Design

**Status:** proposed · **Date:** 2026-07-09 · **Scope:** frontend architecture

## Goal

Continue the post-C2 cleanup by turning `src/App.jsx` from an application coordinator into a
thin assembly entry. The work is behavior-preserving: no UI copy changes, no feature changes, no
global `focusView` rename, and no runtime lifecycle redesign.

## Current Shape

The previous C2 work moved the shared display/runtime ownership into `src/runtime/` and extracted
several shell helpers:

- `MeterRuntimeProvider` owns live/file source state, file sessions, and runtime verbs.
- `AppShell` owns the rendered shell structure.
- `useAppGlobalEffects`, `useAppKeyboardShortcuts`, `useFileAnalysisReportExport`,
  `useConfigurationProfileActions`, and settings sub-hooks removed several older App duties.

`App.jsx` still assembles too many independent concerns:

- Views shell chrome reveal state, hover timers, `Escape` reveal, and frameless window dragging.
- Preset dirty suppression and window-bounds change handling.
- React-to-Rust backend synchronization effects for analysis requests, loudness weights, and
  dialogue settings.
- File/live source transport button orchestration around runtime verbs and history viewport resets.
- Large prop bags for panel data, header, file summary, footer, settings overlays, and shell handlers.

## Target Ownership

This cleanup deepens existing modules instead of adding pass-through wrappers.

| Concern | Current owner | Target owner |
| --- | --- | --- |
| Views chrome reveal and drag handling | `App.jsx` | `useViewsChromeReveal` hook |
| Preset/window-bounds dirty coordination | `App.jsx` + `usePresets` | `usePresets` or a preset-local helper |
| Backend synchronization effects | `App.jsx` | `useRuntimeBackendSync` under `src/runtime/` |
| File/live source action orchestration | `App.jsx` | `useSourceTransportActions` hook |
| Panel/header/settings prop assembly | `App.jsx` | later focused providers or overlay components |

## Interface Rules

- Hooks should expose domain-shaped values and handlers, not raw implementation refs unless the
  caller already owns those refs.
- Do not move a wide prop bag into a new hook unchanged. A move counts only if the caller needs to
  know less.
- Keep the public `focusView` data shape while this cleanup lands. Renaming it across the app is a
  separate migration.
- IPC for the audio engine remains under `src/ipc/`; this work only moves call sites into runtime
  or hook owners.
- Each slice must be independently revertible and must not require later slices to pass tests.

## Slices

### Slice 1 — Views Shell Chrome

Extract the shell chrome reveal state machine from `App.jsx`:

- controls visible/held state
- hide/reveal timers
- `showFocusControls`, `hideFocusControlsLater`, `hideFocusControlsNow`
- popover hold/release handlers
- frameless window drag handler
- cleanup for timers

The hook may keep the existing `focusView` terminology internally where it touches current state,
but new user-facing names should use "Views" or "chrome".

### Slice 2 — Preset Window Bounds Coordination

Move preset dirty suppression and `onWindowBoundsChanged` subscription out of App. Applying a
preset with stored window bounds should still avoid marking the preset dirty during the restore
window.

### Slice 3 — Runtime Backend Sync

Move backend sync effects into a runtime-local hook:

- `setAnalysisRequests(analysisRequests)`
- `setLoudnessWeights(loudnessWeights)`
- `setDialogueGating(dialogueGating)`
- `setDialogueVadEngine(dialogueVadEngine)`

The hook should preserve existing Tauri guards, error swallowing, and request-key retry behavior.

### Slice 4 — Source Transport Actions

Move UI action orchestration that sits above `MeterRuntimeProvider` into a hook:

- live start/stop/return-to-live behavior
- file choose/analyze/reanalyze/stop behavior
- source-mode switching
- history viewport reset when the active source changes
- file removal/clear-all viewport reset behavior

The runtime still owns source state and lifecycle verbs; this hook owns UI button intent mapping.

### Slice 5 — Prop Assembly Cleanup

After the first four slices are stable, reduce the remaining prop assembly:

- panel data and panel chrome composition
- header props
- file summary props
- settings and overlay props

This slice may need a separate design before implementation because it touches more render paths.

## Non-Goals

- No UI rename from `Views` back to `Focus View`, or global source rename from `focusView` to a new
  persisted key.
- No persistence shape migration.
- No change to window geometry storage semantics.
- No new runtime lifecycle states.
- No test deletion unless behavior is already covered elsewhere.
- No line-count target. Smaller `App.jsx` is an outcome, not the success criterion.

## Verification

Every production slice should run directly affected Vitest files first, then the broader suite if
the slice changes shared behavior. `npm run check` remains the final merge gate.

Manual desktop sanity at the end:

- `Views` auto-hide reveal, hover zones, `Escape`, popover hold, and frameless dragging.
- Preset apply/save/update with pinned, Views options, opacity, glass, and window bounds.
- START/STOP, Clear, live/file switching, file open/drop/reanalyze/remove/clear/export.
- Spectrum, Vectorscope, Spectrogram, Loudness History, and dialogue stats still receive data.
