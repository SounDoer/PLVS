# Panel Settings Control Table — Implementation Plan

**Goal:** The main window and the Dock editor render their settings rows from the one control
table in `src/lib/panelControls.js`, and `PanelSettingsControls.jsx` is gone.

**Architecture:** The table gains a face per tab for every row a widget kind covers. One renderer
draws a list of rows and reports a patch; each surface merges and repairs the patch with its own
rule. The Dock passes the table's rows filtered to its key list, merged with its own three rows.
Rows the table cannot know are slots.

**Tech stack:** React 19, JavaScript with JSDoc types checked by `tsc`, Vitest + jsdom, Tauri 2,
Agent Control CLI for verification.

**Spec:** `docs/history/specs/2026-10-07-panel-settings-content-split-design.md`

---

## Delivery rules

Every task is one commit on `main`. Before each commit:

```bash
npm run check
```

```bash
bash artifacts/app-state/ps-walk.sh <label> ref1
```

The second command cold-starts the dev app on an isolated profile and compares 37 screenshots with
the reference captured on `463b9463`. The gate is zero changed pixels. A run whose only differences
are the 1724-pixel highlight on another panel's header settings icon is repeated (see the spec,
Verification); any difference inside a settings surface fails.

Move convention for Stage 1: function bodies move verbatim, checked with
`git diff --color-moved=dimmed-zebra`.

Coverage rule for Stages 3 and 4: a test is deleted only when the prop or code path it covers is
deleted in the same commit, and the commit message names both. A test whose subject still exists is
rewritten to reach it through the new path, with its assertion unchanged.

Nothing is pushed without asking. Another session commits to `main`; rebase and rerun
`npm run check` before a push.

## Stage 1 — groundwork, moves only

- [ ] **1.1** Extract `panel-settings/SettingsWidgets.jsx`: the class constants, `SettingsGroup`,
      `SettingsRow`, `SettingsResetButton`, `SettingsSwitch`, `SettingsSlider`,
      `SettingsRangeInput`, `SettingsNumberInput`, `SettingsThresholdInputs`, the disclosure
      trigger, the option row, `SettingsSelect`, `SettingsChoiceSelect`, the multi-select list.
      Update `rawButtonContract.test.js`. Move `settingsInputInteraction.test.jsx` next to it.
- [ ] **1.2** Extract `panel-settings/AxisRangeRows.jsx`, `panel-settings/PanelControlRows.jsx` and
      `panel-settings/selectionKeys.js`. `PanelSettingsMenu.jsx` imports its two helpers from
      `selectionKeys.js` instead of keeping copies.
- [ ] **1.3** Narrow the import surface: module files, the Dock and the tests import from the
      owning files; `PanelSettingsContent.jsx` exports only `PanelSettingsContent`. What remains in
      `PanelSettingsControls.jsx` is the module rows, which Stage 3 replaces.

## Stage 2 — the renderer and the table

- [ ] **2.1** `ui` may be a list of faces. `panelControlUiRows(tab)` returns each matching row with
      `ui` resolved to that tab's face. Tests in `lib/panelControls.test.js`.
- [ ] **2.2** The renderer reports a patch (`onChange(changes)`) and has a lower-level form that
      takes rows. The three table-driven tabs merge and normalize in their module files. Their
      existing tests and screenshots are the regression check.

## Stage 3 — one module per commit, both surfaces

Each task adds the module's faces to the table, renders the main-window tab and the Dock module
from them, deletes the hand-written rows it replaces, and moves Dock test lookups to the
main window's `aria-label`s.

- [ ] **3.1** Vectorscope (Dock: `correlation`).
- [ ] **3.2** Waveform.
- [ ] **3.3** Loudness, including the Dock-only Readouts row.
- [ ] **3.4** Stats.
- [ ] **3.5** Spectrum.
- [ ] **3.6** Dock side of Level Meter (Dock-only Readout and Labels rows, mode resets readout),
      Stereo Map and Spectrogram (Dock tooltip override for dB Floor).
- [ ] **3.7** A test that renders every Dock module and asserts the rows it shows, so a key in
      `DOCK_MODULE_CONTROL_KEYS` without a face fails.

## Stage 4 — what is left over

- [ ] **4.1** Slim `PanelSettingsProps` to the nine fields the spec lists; `LeafView.jsx` and
      `SplitLayout.jsx` stop passing the rest; `hasPanelSettings` reduces to "controls and a way to
      change them". Tests for the removed props are deleted here, each named in the commit message.
- [ ] **4.2** Delete `PanelSettingsControls.jsx` if anything is left of it. Update
      `docs/architecture.md` where it describes the control table.

## Stage 5 — the fullscreen Channel Pair fix

- [ ] **5.1** `SplitLayout.jsx` passes the Stereo Map pair options that `LeafView.jsx` passes. A
      test that the fullscreen menu offers the Channel Pair row. Before/after screenshots of the
      fullscreen Stereo Map settings for review. This is the only commit with a visible change.
