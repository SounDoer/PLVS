# Preset Modified State by Snapshot Comparison

**Date:** 2026-10-27
**Status:** Approved

## Summary

The active Preset's modified state (`dirty`, shown as `*` after the Preset name) stops being a
persisted flag that each mutation path must remember to set. It becomes a value derived on every
relevant state change by comparing the current scene with the active Preset, projected through the
same rules `applySnapshot` uses to restore it. The decision is recorded in ADR 0040.

## Problem

`dirty` is set by `presetsStore.patch({ dirty: true })` from about twenty call sites and cleared
only by Apply, Save, Update, activation, deleting the active Preset, or a failed apply. Nothing ever
compares state, so:

- changing a value and changing it back leaves the Preset modified;
- any native `Moved`/`Resized` event marks it, even when the bounds end up identical;
- every new snapshot field needs its own hand-placed mark, and a missed one is silent.

Reproduced in the dev app on 2026-10-27, each from a freshly applied, clean Preset:

| Trigger                                                                   | Result                              |
| ------------------------------------------------------------------------- | ----------------------------------- |
| Minimise, then restore (bounds unchanged)                                 | dirty                               |
| Move the window 1 px and back (bounds unchanged)                          | dirty                               |
| Start capture on a 2-channel device with a Preset using Spectrum pair 5/6 | dirty; Spectrum rewritten to 1/2    |
| Switch to a 2-channel device while capturing, same Preset                 | dirty; Spectrum rewritten to 1/2    |
| Change the shared time axis window, then change it back                   | dirty after the first change, stays |
| Delete the active Loudness Profile (selection falls back to Off)          | dirty                               |
| Switch devices with no out-of-range channel selection; stop capture; idle | clean                               |

The first two are the "dirty from nowhere" cases users notice.

## Goals

- `dirty` is true exactly when applying the active Preset would change something.
- Returning to the Preset's values clears `dirty` without an explicit action.
- Adding a snapshot field requires updating one comparison, not finding every mutation path.
- Apply, then read: never dirty. Save or Update, then read: never dirty.

## Non-goals

- Fixing the channel clamp that rewrites a panel's stored selection when the device has fewer
  channels. It stays a separate defect; see "Channel clamp" below.
- Tolerances for split ratios, axis viewports or other floats dragged back to approximately the
  same place.
- Showing which fields differ. The comparison can report it later; this work only exposes a boolean.

## Design

### Derivation

```text
dirty = activePreset != null && presetDiverges(activePreset, currentScene)
```

`presetDiverges(preset, current)` is a pure function in `src/lib/presetDivergence.js`. `usePresets`
computes it in a `useMemo` over the workspace state, view settings, Dock state, the active Loudness
Profile id and the latest window bounds. The preset-side projection is memoised per active Preset
object, so a gesture only re-projects the current side.

The comparison is a structural deep equality with early exit, not `JSON.stringify`, so key order and
`undefined` members do not matter.

### What is compared: what apply restores

The projection mirrors `applySnapshot` field by field. A field apply does not restore must not be
compared, or the Preset reads modified right after Apply.

| Field                                                                                                       | Rule                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tree`, `panelsById`, `panelOrder`, `panelControlsById`, `pinnedPanelsById`, `axisViewports`                | Preset side through `presetWorkspaceView`; current side through the same normalizers. Both sides use today's normalizers, so a normalizer that gains a default key does not make every older Preset modified. |
| `focusView`, `panelPresentation`, `surfaceOpacity`, `glassEnabled`, `windowPinned`, `loudnessProfileActive` | Compared only when the Preset stores the field. Apply leaves an absent field alone, so an older Preset must not diverge on it.                                                                                |
| `panelPresentation.dock`                                                                                    | Ignored when the Preset's Dock is disabled: apply keeps the current Dock presentation.                                                                                                                        |
| Dock, Preset enabled                                                                                        | Compare `enabled`, `edge`, `monitor`, `reserveSpace`, `height` and the strip layout (`panelsById`, `panelOrder`, `panelSizesById`, `controlsByPanelId`).                                                      |
| Dock, Preset disabled                                                                                       | Compare only `enabled === false`. A Dock-disabled Preset deliberately does not restore the strip layout in its snapshot.                                                                                      |
| `windowBounds`                                                                                              | Compared exactly (physical pixels and `isMaximized`) only when the Preset stores bounds and its Dock is disabled.                                                                                             |
| `loudnessProfileActive`                                                                                     | Normalised on both sides: an id no longer in the library compares as Off, matching what apply leaves selected.                                                                                                |

### Window bounds source

`readWindowBounds()` is asynchronous and cannot feed a memo. Instead `usePresets` keeps the latest
bounds in state: read once on mount, then replaced from the payload of `window-bounds-changed`,
which Rust already emits with the persisted `WindowBounds` and which the frontend currently ignores.

Rust only persists, and therefore only emits, usable bounds: minimised windows (the Windows
`-32000` sentinel), undersized windows and the docked window are filtered, and a maximised window
keeps its last normal rectangle with `isMaximized: true`. A minimise/restore therefore ends on the
same bounds and compares clean, with no suppression window.

Decision: bounds take part in the comparison, exactly. A move that really changes the window is a
real divergence from a Preset that restores bounds.

### Channel clamp

When a device exposes fewer channels than a panel selects, `AnalysisSessionContext` rewrites the
panel's controls. After this change the Preset still reads modified in that case, because the live
selection (1/2) really differs from the stored one (5/6).

Decision: keep it modified. Comparing against a clamped copy of the Preset would hide the
divergence only until the wider device returns, when the panel would still be on 1/2 and the Preset
would turn modified anyway. The underlying defect is that the clamp is destructive; separating a
requested from an effective channel selection is follow-up work.

### What is removed

- `markPresetDirty` wrappers in `WorkspaceContext.jsx`, `useViewSettings.js`,
  `useWindowPinnedSetting.js`, `useDockLayout.js` and the five marks in `useDockMode.js`.
- The `presetDirty` option of `LoudnessProfileContext`'s `commit`.
- `markDirty`, `suppressPresetDivergence` and its 1.5 s window in `usePresets.js`, and the
  `dirty: false` members of the Apply, Save, Update, activate, delete and failed-apply writes.
- `dirty` from the presets domain. Existing stored values are ignored on read.

### Consumers

The `usePresets` API keeps its `dirty` member, now derived, so `App.jsx` (window title),
`PresetsPopover.jsx`, the Dock Preset row and `useTray.js` need no change. The Agent Control bridge
already receives that API object (`useAgentControlBridge.js`), so `appSnapshot.js`,
`handlers/preset.js` and `bridge/signatures.js` read the derived value too. Any path that reads
`presetsStore.read().dirty` directly must move to the API. In `presetLibrary.js` the delete plan's
`presets.dirty` effect disappears, since there is no stored flag to reset.

`dirty` stays in the Agent Control result shape and the revision signature, so CLI consumers see the
same field with corrected values. The synchronisation checklist in `docs/agent-control/README.md`
applies; generated files are regenerated, never hand-edited.

## Testing

Unit tests, `src/lib/presetDivergence.test.js`:

- each compared field diverges on its own;
- a value changed and changed back is clean;
- absent optional fields never diverge;
- Dock-disabled Preset: strip layout and `panelPresentation.dock` differences do not diverge;
- Dock-enabled Preset: window bounds differences do not diverge;
- a deleted Loudness Profile id equals Off;
- a Preset normalised with an older default set (missing control keys) equals the current scene.

Round-trip invariants, `usePresets` tests (jsdom):

- for every Preset fixture (legacy fields absent, Dock enabled, Dock disabled, with and without
  bounds): apply, then `dirty === false`;
- save, then `dirty === false`; update, then `dirty === false`.

Agent Control contract tests cover `dirty` in `preset list`, `inspect` and the revision signature,
including that reverting a change through the CLI clears it.

Performance: profile a continuous slider drag and a split resize with the webview CPU recipe before
and after. If the comparison shows up, defer it with `useDeferredValue` rather than reintroducing
marks.

Real-app verification: repeat the 2026-10-27 table above in the dev app. Expected afterwards:
minimise/restore and the 1 px round trip clean; time axis changed and back clean; channel clamp and
deleted active profile still modified.

## Documentation

- `docs/user/workspace.md`, Modules and presets: state that the modified mark appears when the
  current layout differs from the selected Preset and disappears when it matches again.
- `docs/user/cli.md`: the existing "mark the active Preset dirty" wording for read-only commands
  stays true; adjust if the contract tests change the phrasing.
- ADR 0040 records why the obvious flag was replaced.
