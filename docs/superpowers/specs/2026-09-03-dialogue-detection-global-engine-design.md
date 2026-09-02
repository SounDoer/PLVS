# Dialogue Detection as a global setting

Date: 2026-09-03
Status: approved, not implemented

## Problem

The VAD engine is a Stats panel control (`dialogueVadEngine` in `src/lib/panelControls.js`), so it is
stored per panel, travels with presets, and can hold a different value in every Stats panel — while
the audio engine has exactly one detector. `deriveDialogueRuntime` resolves the conflict by scanning
`panelOrder` and returning the first Stats panel that shows a dialogue row; every other panel's
choice is silently discarded. The control is per-panel in the UI and global in effect.

A separate, pre-existing defect rides along: switching engines resets the dialogue accumulator
(`src-tauri/src/dsp/loudness.rs:736`) while `integrated` keeps accumulating from the original start.
Dialogue Offset then subtracts two different time windows and still renders a number.

## Decisions

**The engine becomes a global setting.** It moves out of panel controls into `settingsStore`, and is
surfaced once in the system settings panel.

**Enablement stays implicit.** Showing any of the four dialogue rows in a Stats panel is still what
turns the detector on. This was reconsidered and deliberately kept: making enablement explicit
breaks the "visible = running" invariant and creates two new states — a detector burning CPU with
nothing displaying it, and dialogue rows reading `--` forever with no explanation.

**No Off option.** With enablement implicit, an Off entry in the engine picker would be a second
switch that contradicts the first, reintroducing the permanently-blank rows.

**Multiple engines running concurrently is out of scope.** The dialogue metrics are single-valued
end to end (`LoudnessBlock`, the frame payload, and the four columns in
`src/lib/AudioSnapHistorySlab.js`); running N engines means keying all of that per engine. There is
no use case for it beyond comparing engines side by side, which a global setting plus a re-run
serves adequately.

**Changing the engine triggers one Clear.** `clear_peak_and_history` is the existing "restart the
measurement" path, it already has a button, a shortcut and a tray entry, and reusing it keeps the
rule explicable: changing the detector restarts the measurement. Resetting only the loudness
accumulators would leave Integrated at zero while M Max still carried the old peak — more precise
and harder to explain. No confirmation dialog.

## Design

### The setting

`dialogueVadEngine` joins `src/settings/defaults.js` alongside `historyRetentionSec`, with
`DEFAULT_DIALOGUE_VAD_ENGINE` (`"firered"`) as the default and `normalizeDialogueVadEngine` as its
repair rule — both already exist in `src/lib/dialogueVadEngines.js` and move unchanged. It is read
and written through `settingsStore`, following the shape of `useHistoryRetentionSetting`.

Consequence to accept: the engine no longer travels with presets or the workspace. It is a
machine-level preference, not part of a layout, and `exportAll` / `resetAll` treat it as such.

### The UI row

A `Dialogue Detection` row in the settings panel, placed in the History Length section
(`src/components/SettingsPanel.jsx:433`) — that section is measurement behaviour, not appearance or
window management. Options are the three engines from `DIALOGUE_VAD_ENGINE_OPTIONS`; the label drops
the "VAD" jargon, and the tooltip says the detector feeds the Stats dialogue metrics and that those
metrics are what switch it on.

The engine picker leaves the Stats tab of `PanelSettingsContent` entirely, along with `vadOpen` and
the `SettingsVadSelect` usage there. To offset the discoverability loss, the four dialogue entries in
the Stats metrics list carry a tooltip pointing at the global setting.

### Runtime derivation

`deriveDialogueRuntime` loses its engine half and returns only `dialogueGating` — whether any Stats
panel shows a dialogue row. `App.jsx` pairs it with the engine read from settings before handing
both to `useRuntimeBackendSync`, whose two refs and two IPC effects stay as they are. The file
analysis settings (`currentFileAnalysisSettings`, `src/App.jsx:788`) keep reading the same two
values and need no change.

### Clear on engine change

The settings row's `onChange` writes the new engine and, **only when `dialogueGating` is currently
true**, invokes the existing `clearAll`. Changing the detector while no dialogue row is visible
changes nothing observable, so it must not destroy a running measurement. `clearAll` is already
threaded to the header and the tray from `App.jsx:1372`; the settings overlay receives it the same
way, through `AppSettingsOverlays`.

The engine set and the clear are two separate IPC calls. Their order does not matter: both end in a
reset dialogue accumulator, and `LoudnessMeter` re-creates the detector on the next block when
`ctx.dialogue_vad_engine` differs from `self.speech_kind`.

### Migration

The stored value must be salvaged before the key disappears. `normalizePanelControls` rebuilds its
output from the `CONTROLS` table, so deleting the row drops the key from workspace state and from
every preset automatically on the next normalize — including the copies already in `presetsStore`.

A one-shot `migrateDialogueVadEngineToSettings()` in `src/persistence/` runs in `main.jsx` before
`createRoot`, on the main surface only (the dock surfaces are separate webviews over the same
storage and have no Stats panels). It is a no-op when `settingsStore` already holds
`dialogueVadEngine`. Otherwise it reads the raw `workspaceStore` value, walks `panelOrder` for the
first `stats` panel carrying a `dialogueVadEngine`, and writes that value into settings —
deliberately the same "first Stats panel wins" rule `deriveDialogueRuntime` uses today, so nobody's
effective engine changes across the upgrade. Panels beyond the first are discarded, as they already
were in effect.

Presets are not migrated. A preset's copy of the key is dropped, and applying an old preset no
longer changes the engine — which is the intended new behaviour.

## Testing

- `src/lib/panelControls.test.js` — the key is gone from `DEFAULT_PANEL_CONTROLS` and from
  `normalizePanelControls` output, including when present in the raw input.
- New test beside the migration module — first-Stats-panel selection, multiple panels with differing
  values, no Stats panel at all, an existing settings value left untouched, and a second run being a
  no-op.
- `src/runtime/appRuntimeDerivations.test.js` — `deriveDialogueRuntime` returns gating only, still
  true for any dialogue row in any Stats panel.
- `src/components/SettingsPanel.test.jsx` — the row renders the three engines, writes the setting,
  calls `clearAll` when gating is on, and does not call it when gating is off.
- `src/components/PanelSettingsContent.test.jsx` — the Stats tab no longer renders the picker.

Rust is untouched, so the capture layer needs no smoke or soak run for this change.

## Risks

- **Dropping the key is irreversible for presets.** Once a preset is normalized without it, the old
  value is gone. Acceptable: the migration has already lifted the effective one into settings.
- **The Clear is destructive and unconfirmed.** A dropdown that wipes a long measurement is a sharp
  edge; it is gated on gating being active, which removes the case where it buys nothing. Revisit if
  it bites in practice.
- **Discoverability.** The control is now two surfaces away from the metrics it governs. The
  tooltips are the mitigation; a stronger link can wait for evidence that it is needed.
