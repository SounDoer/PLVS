# Panel settings: one control table for the main window and the Dock — design

Date: 2026-10-07
Status: proposed, awaiting approval

## Where this starts

`src/components/PanelSettingsContent.jsx` was a 1941-line file with 18 exports. Commit `0824905f`
(`refactor(ui): split panel settings by module`) took a first step: the file is now a 45-line
dispatcher, and each module has a file under `src/components/panel-settings/`. That commit had no
spec and no recorded visual check; the check was run retroactively and it passes (see
Verification).

What it left is `panel-settings/PanelSettingsControls.jsx`, 1349 lines and 24 exports, in which
five kinds of code with different dependencies still share a file:

| Kind              | What is in it                                                                                            | Depends on                            |
| ----------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Settings widgets  | group, row, reset button, switch, slider, range / number / threshold inputs, selects, option rows        | `components/ui/` primitives only      |
| Axis-aware rows   | `AxisLinkToggle`, `RangeRowLinkToggle`, `AxisViewportRangeInput`, `TimeRangeRow`                         | workspace contexts                    |
| Table renderer    | `PanelControlRows`, `renderPanelControlWidget`                                                           | the control table, plus the two above |
| Module rows       | `WaveformSettingsRows`, `LoudnessSettingsRows`, `SpectrumDisplaySettingsRows`, `StatsMetricsSettingsRow` | one module each; shared with the Dock |
| Selection helpers | `getSelectedOption`, `spectrumKeyFromSelection`, and three more                                          | nothing                               |

The first design for this work proposed splitting that file along those lines and stopping. The
decision since is to go further, because the file layout is the smaller problem.

## The larger problem: three ways to describe one row

`lib/panelControls.js` holds the control table: one row per persisted control, with its default and
repair rule. A row may also carry a `ui` block (tab, label, widget, order, visibility rule), and
`PanelControlRows` draws a settings tab straight from those blocks. The table's own comment states
the intent: adding a control to the table is what puts it on screen.

That is true for three of eight tabs. Today a settings row is described in one of three places:

1. **The control table** — Level Meter, Spectrogram, Stereo Map in the main window.
2. **Hand-written main-window components** — Waveform, Stats, Loudness, Spectrum, Vectorscope.
   Labels, `aria-label`s, tooltips, slider bounds and visibility rules are JSX literals.
3. **`dock/editors/DockModuleSettings.jsx`** (605 lines) — every Dock module, including the three
   that are table-driven in the main window. It restates labels, tooltips, slider bounds, steps and
   formats, and keeps its own copy of the Stereo Map mode list.

The Dock already stores its controls under the panel's own keys and repairs them with the table's
rows (`DOCK_MODULE_CONTROL_KEYS` in `dock/dockModuleControls.js`); only the rendering was left
behind. Concretely, the Stereo Map's Speed slider is declared with its bounds, step, format and
commit-on-release flag once in the table and again in the Dock, and nothing ties the two together.
Commit-on-release in particular is a correctness rule (`docs/pitfalls.md`, "Analysis history"), not
a presentation detail.

Agent Control is unaffected by any of this. Its schema and read/patch mapping work from the
normalized control record, not from the settings UI, and no control key changes here.

## Approaches

### A. Split the file and stop

Cut `PanelSettingsControls.jsx` along the table above. Moves only.

- For: lowest risk; a zero-pixel gate is trivially meaningful.
- Against: leaves all three descriptions of a row in place. The Dock keeps restating the table.

### B. One table, one renderer, two surfaces (chosen)

Every settings row that the table can express is declared there once. The main window and the Dock
both render from it. The Dock differs by declaring which controls it carries (it already does) and
which extra rows only it has.

- For: a control's label, bounds, step, format, tooltip and commit rule exist once. A new control
  reaches both surfaces by being added to the table and, for the Dock, to its key list. About 900
  lines of row declarations go away across the module files and `DockModuleSettings.jsx`.
- Against: this changes which code draws most rows, so correctness rests on tests and screenshots
  rather than on "the code did not change". A substantial part of two test files is rewritten.

### C. Separate tables for the main window and the Dock

Give the Dock its own table instead of sharing one.

- For: each surface is free to diverge.
- Against: it formalises the duplication instead of removing it. The Dock has no row today that
  needs different bounds or a different widget from the main window's; the differences are a
  subset, three extra rows and two tooltips.

**Decision: B**, built in stages so each stage has its own gate.

## Design

### The table

A control can appear on more than one tab with a different label, order or `aria-label` on each —
Tilt on Spectrum and Spectrogram, the Time Range row on three tabs, the loudness range on Loudness
and Level Meter. A row's `ui` therefore becomes either one face or a list of faces, each naming its
tab. `panelControlUiRows(tab)` keeps its signature and returns each matching row with `ui` resolved
to that tab's face, so the renderer does not learn about the change.

The five hand-written tabs gain faces for every row a widget kind already covers:

| Tab         | Rows that become table-driven                                                | Rows that stay as slots                                     |
| ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Vectorscope | Mode, Persistence, Max Hold                                                  | Channel Pair (options come from the device)                 |
| Waveform    | Frequency Color, Centroid                                                    | the two split inputs (each bounds the other), Time Range    |
| Loudness    | Grid, Loudness Range                                                         | Layers (depends on the active Loudness Profile), Time Range |
| Stats       | —                                                                            | Metrics (the sortable list)                                 |
| Spectrum    | Max, Peak Labels, Speed, Tilt, Smoothing, Grid, Frequency Range, Level Range | Channel, View (options and the legend come from the device) |
| Spectrogram | (already table-driven)                                                       | Channel joins the existing slots                            |

A slot is the mechanism the table already has (`widget: "custom"` and `"customRow"`): the table
owns the row's position and label, and the surface supplies the control. Slots are not a gap to be
closed later. They mark the rows whose content the table cannot know.

### The renderer

`PanelControlRows` is generalised in two ways and otherwise keeps its widget switch as it is:

- **It reports a patch.** Today it calls `onChange(normalizePanelControls({...controls, ...changes}))`.
  That is right for a panel and wrong for the Dock, whose record also holds keys the table does not
  know (`readout`, `showLabels`, `showReadouts`) and which a full normalize would drop. The renderer
  will call `onChange(changes)`; each surface merges and repairs with its own rule, which both
  already have (`normalizePanelControls` and `normalizeDockModuleControls`).
- **It takes rows.** A lower-level component takes the list of rows to draw. The main window's
  `PanelControlRows` passes `panelControlUiRows(tab)`. The Dock passes that list filtered to its key
  list and merged, by `order`, with its own extra rows.

### The Dock

`DockModuleSettings.jsx` shrinks to what is specific to the Dock:

- the three Dock-only rows (Level Meter Readout and Labels, Loudness Readouts), declared in the
  same row shape next to `DOCK_ONLY_DEFAULTS`;
- its slots: channel selects built from the Dock's own option sources, the Metrics list without a
  reset action, the Layers list;
- one rule that is behaviour, not presentation: changing the Level Meter mode also sets Readout back
  to Live;
- two tooltip overrides (below).

What the Dock shows is still decided by `DOCK_MODULE_CONTROL_KEYS`. This design does not add
controls to the Dock: Grid, Peak Labels, Playback Max and the rest stay main-window only, because
that is a product decision about what the strip has room for, not a rendering inconsistency.

What "unified" changes on the Dock, measured against the current code:

| Difference today                                                                            | After                                                                                                    | Visible? |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| `aria-label`s are capitalised (`Vectorscope mode`); the main window's are lowercase         | The main window's, which is also the repository convention                                               | No       |
| Labels, bounds, steps, formats restated                                                     | Read from the table                                                                                      | No       |
| Own copy of the Stereo Map mode list                                                        | The table's list (same four entries, same labels)                                                        | No       |
| Reset buttons and axis-link toggles absent                                                  | Still absent: no control the Dock carries is resettable, and link toggles render only inside a workspace | No       |
| Spectrogram "dB Floor" tooltip omits "Applies in both 2D and 3D."                           | Kept as a Dock override; the Dock has no 3D mode, so the sentence would be wrong there                   | No       |
| Spectrum "Smoothing", Vectorscope "Persistence" and similar tooltips restated word for word | Read from the table                                                                                      | No       |

The expected result is a Dock editor that looks the same and is declared once. If a screenshot
shows otherwise, that is a finding to look at, not a tolerance to widen.

### File layout

All under `src/components/panel-settings/`.

| File                                     | Owns                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| `SettingsWidgets.jsx` (new)              | The widget library. Depends on `components/ui/` only |
| `AxisRangeRows.jsx` (new)                | The four axis-aware pieces                           |
| `PanelControlRows.jsx` (new)             | The renderer                                         |
| `selectionKeys.js` (new)                 | The selection helpers. Logic only                    |
| `<Module>Settings.jsx` (seven, existing) | That module's slots and its main-window composition  |
| `PanelSettingsControls.jsx`              | Deleted                                              |

`PanelSettingsContent.jsx` exports `PanelSettingsContent` and nothing else. The Dock imports the
renderer, the widgets and the slot components from the files that own them. No barrel file.

### The props interface

`PanelSettingsProps` has 22 fields. Once the rows are table-driven, most of them have no reader:

- Five callbacks (`onVectorscopeChange`, `onSpectrumChange`, `onSpectrumViewChange`,
  `onSpectrumMaxModeChange`, `onStereoMapPairChange`) receive a no-op from both product call sites
  and serve only as switches that turn rows on. Removed.
- `spectrumView`, `spectrumMaxMode`, `spectrumValueKey`, `vectorscopeValueKey`,
  `stereoMapPairValueKey`, `spectrumDisplayLabel`, `vectorscopeDisplayLabel` are fallbacks for a
  render without `panelControls`, or for a stored selection that normalizing can no longer leave
  empty. Removed.
- `stereoMapPairDisplayLabel` is reachable: it labels a stored pair that is not among the offered
  options. Kept.

That leaves `activeTab`, `channelCount`, the three option lists, `spectrumViewLegend`,
`stereoMapPairDisplayLabel`, `panelControls` and `onPanelControlsChange` — nine. `LeafView.jsx`
and `SplitLayout.jsx` stop passing the rest. `hasPanelSettings` in `PanelSettingsMenu.jsx`, which
restates each module's "do I render anything" rule and tests a prop no caller passes, reduces to
"there are controls and a way to change them".

### Tests

- `PanelSettingsContent.test.jsx` (3028 lines, 96 tests): tests that drive a row through
  `onPanelControlsChange` keep their assertions. Tests that exist for the removed fallback props
  (42 references to the five callbacks) are deleted with the props, each deletion listed in the
  plan against the prop it covered.
- `DockModuleSettings.test.jsx` (462 lines, 54 lookups by label): lookups move to the lowercase
  `aria-label`s. Assertions about what is committed keep their values.
- `settingsInputInteraction.test.jsx` moves next to the widgets it covers.
- `lib/panelControls.test.js` gains coverage for multi-face rows.
- New: one test that renders every Dock module from the table and asserts the set of rows it shows,
  so a control added to the Dock's key list without a face fails loudly instead of rendering
  nothing.
- `rawButtonContract.test.js`: the path of the one hand-written button changes; the count stays 1.

## Stages

Each stage ends with `npm run check` green and a screenshot run with zero changed pixels, and each
stops for review before the next begins.

**Stage 1 — groundwork, moves only.** Extract `SettingsWidgets.jsx`, `AxisRangeRows.jsx`,
`PanelControlRows.jsx`, `selectionKeys.js`. Narrow the import surface. No function body changes.

**Stage 2 — the renderer and the table learn what Stage 3 needs.** Patch-reporting `onChange`,
rows as an input, multi-face `ui`. The three tabs that are already table-driven are the regression
check: they must render identically through the generalised renderer.

**Stage 3 — one module per commit, both surfaces.** Vectorscope, Waveform, Loudness, Stats,
Spectrum for the main window and the Dock together; then the Dock side of Level Meter, Stereo Map
and Spectrogram. Each commit deletes the hand-written rows it replaces.

**Stage 4 — what is left over.** Slim `PanelSettingsProps` and its two call sites, simplify
`hasPanelSettings`, delete `PanelSettingsControls.jsx`, and update `docs/architecture.md` where it
describes the control table.

## Out of scope

- Adding controls to the Dock, or removing any.
- Splitting `PanelSettingsContent.test.jsx` by module.
- Any provider or context. This is not a state-ownership change.
- Class strings, tokens, visible labels, control keys, the Agent Control contract.

## One deliberate visible change

The Stereo Map's Channel Pair row is missing in fullscreen, because `SplitLayout.jsx` does not pass
the pair options that `LeafView.jsx` passes. It is fixed as **Stage 5**, a commit of its own after
everything else has passed the zero-pixel gate, so that the fix is the only source of a visible
difference. It carries a test that the fullscreen menu offers the row, and before/after screenshots
of the fullscreen Stereo Map settings for review. The 37-image reference does not include a
fullscreen scene, so it stays valid.

## Constraints

- No visual change in the main window or the Dock editor accessory, apart from Stage 5.
- No behaviour change: commit-on-release for key-changing sliders, draft/commit semantics of the
  number and range inputs, keyboard handling, the Dock's mode-resets-readout rule.
- Logic-only code imports `workspace/moduleCatalog.js`, never `workspace/registry.jsx`.
- `npm run check`, including typecheck at zero errors, on every commit.

## Verification

`artifacts/app-state/ps-walk.sh` (untracked, like the other scripts there) cold-starts the dev app
on an isolated profile and captures 37 screenshots with no analysed audio:

- main window: all eight modules' settings in their default state (through `ui:walkthrough`, with a
  manifest derived from `scripts/ui-walkthrough/product-surfaces.example.json`), plus thirteen mode
  variants that reveal rows the default state hides;
- Dock editor accessory: all eight Dock modules in their default state, plus eight variants.

Results before any change in this design:

- Two runs on the starting commit (`463b9463`) are identical: 37 of 37 images, zero changed pixels.
- The earlier split was checked by restoring the pre-`0824905f` file onto the same tree. One run
  matched the reference on 37 of 37 images. Another differed on 4 images by 1724 pixels each; in
  every case the pixels are the highlight on a different panel's header settings icon, the one the
  previous scene had opened, outside the settings surface. The same code produced both results, so
  it is a capture artefact. A run that shows it is repeated; a difference inside a settings surface
  fails the gate with no retry.

Two things the screenshots cannot show, which therefore rest on unit tests alone:

- the Channel rows, which appear only with more than two channels, and the test machine's device is
  stereo;
- open states: an expanded select, the Layers and Metrics lists, a hover tooltip. Agent Control
  navigation opens surfaces but does not click inside them.
