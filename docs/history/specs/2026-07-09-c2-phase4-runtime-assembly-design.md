# C2 Phase 4 — Runtime Assembly and App Slimming

**Status:** proposed after code audit · **Date:** 2026-07-09 · **Scope:** frontend architecture

## Non-negotiable outcomes

1. User-visible behavior and UI remain unchanged.
2. Every move must deepen a module: a smaller interface hides more lifecycle behavior and improves
   locality. Moving the same wide interface into a Provider does not count.
3. Every commit is independently testable and revertible. `npm run check` is the final gate.

## Audit findings

### The real owner is the source runtime, not the live engine alone

`useAudioEngine` and `useFileAnalysisEngine` share `audioRef` and `defaultSampleRateRef`. Live and
File are mutually exclusive source modes, and both write the same display owner. Making only the
live engine own `running` would leave the source-switch lifecycle split across modules.

The deep module is therefore a **meter runtime** that composes:

- `useMeterDisplay`
- source mode
- `useCaptureTransport`
- `useFileSessionLedger`
- `useIntakeRouting`
- the shared engine refs
- `useAudioEngine`
- `useFileAnalysisEngine`
- live/file start, stop, switch, clear, select, and reanalyze orchestration

The engine hooks remain internal implementations. The runtime interface exposes user-domain verbs
and state; it does not expose `setRunning`.

### `AudioDataContext` is a mixed interface

Its value currently contains more than 60 frame values, derived labels, workspace panel controls,
history interactions, shell preferences, and callbacks. `SplitLayout` and `LeafView` read the whole
value, spread it into a new object, add panel-instance fields, and provide it again.

Splitting Contexts above this path without changing the workspace adaptation would merely recombine
the interfaces. Panel-instance data must stay at one workspace seam; frame/runtime/history data must
pass through without object spreading.

### The grep test contains several different test classes

`App.toolbar.test.js` has 34 source-reading tests:

- IPC seam contracts that belong beside `src/ipc/`
- visual copy and ordering that belong in rendered `AppHeader` tests
- runtime behavior invariants that belong at owner-hook/runtime interfaces
- assembly checks that belong in the App smoke test
- negative implementation checks that can be deleted after their replacement module makes the old
  implementation impossible

The file may be deleted only after every test is classified and either migrated or intentionally
retired.

### C2 alone cannot honestly make App approximately 100 lines

`useSettings`, configuration import/export/reset, theme editing, presets, focus-view shell behavior,
and update UI remain substantial. C3 owns the `useSettings` split. C2 Phase 4 should remove runtime
ownership from App; final shell-only sizing follows after C3. Line count is an observation, not an
exit criterion.

## Target topology

```text
WorkspaceProvider
└─ App assembly
   ├─ settings/presets/shell owners                 (unchanged in C2; C3 later)
   └─ MeterRuntimeProvider(runtimeConfig)
      ├─ display owner
      ├─ source mode + shared engine resources
      ├─ live transport + live engine
      ├─ file ledger + file engine
      ├─ intake routing
      └─ PanelDataProvider
         ├─ frame/display interface
         ├─ history interaction interface
         └─ workspace panel-instance interface
            └─ AppShell
```

The runtime is one Provider because live and file are two adapters for one active-source lifecycle.
Separate read contexts may be used inside it when update frequency differs, but they do not create
separate ownership.

## Interface rules

### Meter runtime

Expose domain state and verbs such as:

- active source and lifecycle phase
- active/analyzing file session selectors
- `startLive`, `stopLive`, `switchSource`
- `beginFileAnalysis`, `stopFileAnalysis`, `selectFile`, `reanalyzeFile`
- `clearActiveSource`

Do not expose raw state setters, engine refs, run-id counters, or IPC-shaped commands.

The existing `running` boolean remains behavior-compatible during the move. A richer
`idle | starting | running | error` phase is a later behavior change and is not part of this
refactor.

### Panel data

Keep these concerns distinct:

- high-frequency frame/display reads
- history navigation and snapshot interaction
- panel-instance controls and visibility
- low-frequency appearance values

`SplitLayout` and `LeafView` may adapt panel id to panel-instance state, but must not spread and
re-provide unrelated runtime data.

## Safe implementation sequence

### Phase 4a — Test migration ledger

Create a checked migration table for all 34 `App.toolbar.test.js` tests. Add missing rendered
behavior tests before moving implementation. No production behavior changes.

Exit:

- every old assertion has a destination or an explicit deletion reason
- App smoke covers shell mount, START, source switching, and Clear-preserves-capture
- IPC contracts live beside IPC modules

### Phase 4b — Meter runtime skeleton

Introduce `MeterRuntimeProvider` and its consumer hook. Initially compose the existing owner hooks
and both engines without changing their implementations. Move the shared engine refs and source
mode into the runtime.

The first commit must not split `AudioDataContext` and must preserve the current rendered tree.

Exit:

- App no longer calls either engine hook
- App no longer owns `audioRef`, `defaultSampleRateRef`, live intake, file ledger, or `running`
- runtime interface tests cover live start/stop, file start/stop, and source mutual exclusion

### Phase 4c — Runtime orchestration

Move source-switch, clear, file selection, drop, reanalysis, and stop orchestration behind runtime
verbs. Keep UI copy byte-for-byte unchanged.

Exit:

- App contains no raw runtime setter or engine cleanup sequence
- runtime behavior tests assert the previously scattered invariants
- `useAudioEngine` and `useFileAnalysisEngine` are internal implementations

### Phase 4d — Panel data seam

Replace the spread/re-provide path in `SplitLayout` and `LeafView` with a panel-instance adapter.
Separate high-frequency frame data from history interactions and low-frequency panel/shell data.

Exit:

- no `{ ...audioData, ... }` recreation in workspace layout modules
- each panel reads only the interfaces it needs
- existing panel tests remain behavior-equivalent
- add a render-count regression test only if it is deterministic; performance is not claimed
  without evidence

### Phase 4e — Retire the grep test and slim App

Delete migrated assertions from `App.toolbar.test.js` incrementally. Delete the file only when its
migration ledger is empty. Extract the rendered shell after runtime ownership has moved, so the
shell interface is naturally small.

Exit:

- no production behavior is protected only by source-string matching
- App is assembly plus the C3-owned settings/presets work that legitimately remains
- `npm run check` passes

## Verification

For every production commit:

1. Run the directly affected Vitest files.
2. Run `npm test`.
3. Run `npm run check` before commit.

Manual desktop sanity at the end:

- START/STOP and device switch
- Clear while live capture continues
- live/file source switching
- file drop/open, progress, stop, reanalyze, selection, removal, export
- history scrub and snapshot display
- Focus View, presets, settings, and panel layout remain visually unchanged

## Explicit non-goals

- No UI or copy changes.
- No new runtime lifecycle states.
- No C3 `useSettings` redesign inside the meter runtime.
- No Provider-per-hook rule.
- No line-count target.
