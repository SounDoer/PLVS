# App Assembly Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue slimming `src/App.jsx` by moving remaining coordination concerns to focused
owners without changing user-visible behavior.

**Architecture:** Keep `App.jsx` as the assembly root while extracting one concern at a time:
Views chrome behavior, preset/window coordination, backend sync, source transport actions, and
finally prop assembly. Each slice introduces or deepens a module with a smaller caller interface.

**Tech Stack:** React 19 hooks, Vitest, Tauri 2 IPC wrappers in `src/ipc/`, existing workspace and
runtime contexts.

---

## Task 1: Extract Views Shell Chrome Reveal

**Files:**

- Create: `src/hooks/useViewsChromeReveal.js`
- Modify: `src/App.jsx`
- Test: `src/App.smoke.test.jsx`
- Test: `src/hooks/useAppKeyboardShortcuts.test.jsx`
- Test: `src/components/AppHeader.test.jsx`

- [ ] **Step 1: Move reveal state and timers into a hook**

Create `useViewsChromeReveal({ autoHideControls, frameless })` with the same behavior currently in
`App.jsx`:

- `focusControlsVisible`
- `showFocusControls`
- `hideFocusControlsLater`
- `hideFocusControlsNow`
- `holdFocusControls`
- `releaseFocusControlsHold`
- `handleWindowDrag`

The hook should keep `getCurrentWindow().startDragging()` guarded behind `isTauri()` and clean up
both timers on unmount.

- [ ] **Step 2: Replace App-local chrome state with the hook**

In `src/App.jsx`, remove the local `useState` and `useRef` declarations for focus controls and drag
timers. Keep the existing prop names passed to `AppShell` and `AppHeader` so this first slice does
not ripple through shell components.

- [ ] **Step 3: Verify shell behavior tests**

Run:

```bash
npm test -- src/App.smoke.test.jsx src/hooks/useAppKeyboardShortcuts.test.jsx src/components/AppHeader.test.jsx
```

Expected: all tests pass without assertion changes except import/mocking adjustments required by
the new hook file.

## Task 2: Move Preset Window Bounds Coordination

**Files:**

- Modify: `src/hooks/usePresets.js`
- Modify: `src/App.jsx`
- Test: `src/hooks/usePresets.test.jsx`
- Test: `src/App.smoke.test.jsx`

- [ ] **Step 1: Move suppression ref into the preset owner**

Move the current `suppressPresetDivergenceUntilRef` and `suppressPresetDivergence()` behavior from
`App.jsx` into `usePresets`. Applying a preset with stored `windowBounds` should still suppress the
next bounds-change dirty mark.

- [ ] **Step 2: Move `onWindowBoundsChanged` subscription into the preset owner**

Subscribe to `onWindowBoundsChanged` inside `usePresets`, guarded by `isTauri()`. On bounds changes,
call `markDirty()` unless the suppression window is active.

- [ ] **Step 3: Remove preset/window glue from App**

Delete the App-local effect and no longer pass `suppressPresetDivergence` into `usePresets`.

- [ ] **Step 4: Verify preset behavior**

Run:

```bash
npm test -- src/hooks/usePresets.test.jsx src/App.smoke.test.jsx
```

Expected: preset dirty behavior remains unchanged, including the existing window-bounds dirty smoke
coverage.

## Task 3: Extract Runtime Backend Sync

**Files:**

- Create: `src/runtime/useRuntimeBackendSync.js`
- Modify: `src/App.jsx`
- Test: `src/runtime/appRuntimeDerivations.test.js`
- Test: `src/ipc/commands.test.js`
- Test: `src/App.smoke.test.jsx`

- [ ] **Step 1: Create `useRuntimeBackendSync`**

The hook should accept:

- `analysisRequests`
- `loudnessWeights`
- `running`
- `dialogueGating`
- `dialogueVadEngine`

It owns the refs and effects currently used to call:

- `setAnalysisRequests`
- `setLoudnessWeights`
- `setDialogueGating`
- `setDialogueVadEngine`

Preserve the existing `isTauri()` guards, empty catch handlers, and `lastSentAnalysisRequestsKey`
retry reset behavior.

- [ ] **Step 2: Replace App-local backend sync effects**

Remove the App-local refs/effects for backend sync and call the new hook after the derived runtime
values are available.

- [ ] **Step 3: Verify derivation and smoke coverage**

Run:

```bash
npm test -- src/runtime/appRuntimeDerivations.test.js src/ipc/commands.test.js src/App.smoke.test.jsx
```

Expected: derived request shapes and IPC command contracts remain unchanged.

## Task 4: Extract Source Transport Actions

**Files:**

- Create: `src/hooks/useSourceTransportActions.js`
- Modify: `src/App.jsx`
- Test: `src/lib/sourceTransportState.test.js`
- Test: `src/runtime/MeterRuntimeContext.test.jsx`
- Test: `src/App.smoke.test.jsx`
- Test: `src/components/AppHeader.test.jsx`

- [ ] **Step 1: Move history viewport reset into a local helper**

Inside the new hook, define a helper that resets history offset and window to
`UI_PREFERENCES.modules.loudness.history.defaultWindowSec`.

- [ ] **Step 2: Move source transport action mapping**

Move the existing `runLiveStartAction`, `onSourceTransportAction`, and `onSourceModeChange` logic
into the hook. Dependencies should be explicit: runtime verbs, source state, selected offset,
status setter, file picker, analysis settings provider, and history setters.

- [ ] **Step 3: Move file list action wrappers**

Move `onSelectFile`, `onStopFile`, `onReanalyzeFile`, `onRemoveFile`, and `onClearAllFiles` into
the same hook if doing so keeps the interface smaller. If the hook interface becomes wider than the
implementation it replaces, split file list actions into a second hook.

- [ ] **Step 4: Replace App handlers with returned actions**

`App.jsx` should receive a small action object and pass its handlers to `AppHeader`,
`FileAnalysisSummary`, `FileDropOverlay`, and tray/keyboard wiring as before.

- [ ] **Step 5: Verify runtime and shell behavior**

Run:

```bash
npm test -- src/lib/sourceTransportState.test.js src/runtime/MeterRuntimeContext.test.jsx src/App.smoke.test.jsx src/components/AppHeader.test.jsx
```

Expected: live/file mode switching, file analysis actions, and header transport rendering remain
unchanged.

## Task 5: Decide and Plan Prop Assembly Cleanup

**Files:**

- Inspect: `src/App.jsx`
- Inspect: `src/workspace/AudioDataContext.jsx`
- Inspect: `src/workspace/SplitLayout.jsx`
- Inspect: `src/workspace/LeafView.jsx`
- Inspect: `src/components/SettingsPanel.jsx`
- Inspect: `src/components/AppHeader.jsx`

- [ ] **Step 1: Re-audit App after Tasks 1-4**

Measure the remaining responsibilities in `App.jsx`. Do not start broad prop-bag moves until the
smaller owner moves are merged or at least locally green.

- [ ] **Step 2: Choose the next smallest prop assembly owner**

Pick one of:

- panel data/provider seam
- header prop assembly
- file summary prop assembly
- settings overlays

Prefer the smallest owner that removes real knowledge from `App.jsx` without introducing a
pass-through component.

- [ ] **Step 3: Write a follow-up mini-plan if panel data is selected**

If selecting panel data/provider cleanup, write a separate plan before implementation because it
touches context shape and workspace render paths.

**Decision after Tasks 1-4:** defer the panel data/provider seam to a separate mini-plan. It remains
the largest architectural payoff, but it touches `AudioDataContext`, `SplitLayout`, `LeafView`, and
panel render paths. The next smallest prop-assembly owner is settings overlays: move
`SettingsPanel`, `ThemeEditor`, feedback dialog state, update actions, configuration actions, and
CLI path settings behind a focused shell/settings overlay module so `App.jsx` no longer assembles
that large prop list directly.

## Final Verification

- [ ] Run focused tests for every completed slice.
- [ ] Run:

```bash
npm test
```

- [ ] Run:

```bash
npm run check
```

- [ ] Manual desktop sanity:

- `Views` auto-hide reveal, hover zones, `Escape`, popover hold, and frameless dragging.
- Preset save/apply/update with pinned, Views options, opacity, glass, and window bounds.
- START/STOP, Clear, live/file source switch, file open/drop/reanalyze/remove/clear/export.
- Panel data still updates for Spectrum, Vectorscope, Spectrogram, Loudness History, and dialogue
  stats.
