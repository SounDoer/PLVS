# Panel Display Controls Design

## Summary

Add unified panel header controls for loudness display preferences:

- `Loudness Stats` gets a `Stats` chip that lets users choose which stat rows are visible.
- `Loudness` gets a `Layers` chip that lets users choose which chart layers are visible.
- Existing Spectrum, Spectrogram, and Vectorscope channel chips move under the same `PanelHeaderControls` model.

Panel controls are saved as user display preferences and can be captured by custom layout presets. Editing panel controls does not make the active preset display as `Custom`; preset identity continues to primarily reflect layout and module visibility.

## Goals

- Keep all panel-level header controls under one consistent component model.
- Decouple loudness stat visibility from loudness history layer visibility.
- Remove the current row-button behavior from `Momentary` and `Short-term` stats.
- Persist panel control choices across app restarts.
- Save and restore panel control choices when users save and apply custom presets.
- Preserve current Spectrum, Spectrogram, and Vectorscope channel behavior.

## Non-Goals

- Do not migrate old `vectorscopePairX/Y` or `spectrumChannelType/X/Y/Ch` fields. Losing old channel preferences is acceptable.
- Do not make built-in presets define or reset panel controls.
- Do not add new loudness metrics or new history layers beyond `Momentary`, `Short-term`, and `Reference`.
- Do not add minimum-selection rules; users may turn all stats or all layers off.

## Product Behavior

### Header Chips

`PanelHeaderControls` renders the active panel's header controls:

- `vectorscope`: channel chip for vectorscope pair selection.
- `spectrum` and `spectrogram`: shared channel chip for frequency channel selection.
- `loudnessStats`: `Stats` chip with a checkbox menu.
- `loudness`: `Layers` chip with a checkbox menu.

The chip label is fixed. It does not summarize the current selection. Current state is visible inside the menu, similar to the existing layout module visibility menu.

### Stats

The `Stats` menu controls visible rows in `LoudnessStatsPanel`.

Default visible stats:

- `Momentary`
- `Short-term`
- `Integrated`
- `Loudness Range (LRA)`

Default hidden stats:

- `Momentary Max`
- `Short-term Max`
- `Dynamics (PSR)`
- `Avg. Dynamics (PLR)`

If all stats are hidden, the panel shows a lightweight empty state: `No stats selected`.

### Layers

The `Layers` menu controls visible layers in `LoudnessHistoryChart`.

Default visible layers:

- `Short-term`
- `Reference`

Default hidden layers:

- `Momentary`

`Reference` controls the reference line, tolerance band, and reference label together.

If all layers are hidden, the chart still shows axes, grid, hover, and snapshot interaction affordances. It also shows a lightweight empty state: `No layers selected`.

## State And Persistence

Introduce a unified `panelControls` object:

```js
{
  vectorscopePair: { x: 0, y: 1 },
  spectrumChannel: { type: "pair", x: 0, y: 1 },
  loudnessStatsVisibleIds: ["momentary", "shortTerm", "integrated", "lra"],
  loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
}
```

`plvs.ui` stores the current `panelControls` as user display preferences. Any panel control change updates this object and persists it.

Workspace state also stores the current `panelControls` so custom presets can capture it. UI changes update the live app state and dispatch the same normalized object into workspace state. `SAVE_PRESET` includes the workspace state's current `panelControls` in the preset snapshot. `APPLY_PRESET` restores `panelControls` only when applying a custom preset that includes it.

Built-in presets do not include `panelControls` and do not overwrite current panel control preferences when applied.

Changing panel controls does not clear `activePresetId` and does not make the preset dropdown show `Custom`. Existing layout and module visibility preset behavior remains unchanged.

## Component Design

Rename or replace `PanelChannelSelector` with `PanelHeaderControls`.

Internal components:

- `PanelSingleSelectControl`: shared single-select chip used for Vectorscope and Spectrum/Spectrogram channels.
- `PanelMultiSelectControl`: shared checkbox-menu chip used for `Stats` and `Layers`.

`LeafView` should render only `PanelHeaderControls` in the header action area. It should not grow active-tab-specific control branches.

`PanelHeaderControls` may branch by `activeTab`, but metric calculation, chart rendering, persistence, and backend command side effects remain outside the component.

## Data Flow

`App.jsx` owns the live panel control state, exposes it through `AudioDataContext`, and mirrors normalized changes into workspace state for preset capture.

Stats flow:

- `useLoudnessHistory` continues to produce the full metric list.
- `LoudnessStatsPanel` filters metrics by `panelControls.loudnessStatsVisibleIds`.
- `MetricRow` becomes a pure display row, not a toggle button.

Layers flow:

- `LoudnessHistoryChart` receives visibility derived from `panelControls.loudnessHistoryVisibleLayerIds`.
- `Momentary`, `Short-term`, and `Reference` render only when their layer id is present.
- Future bands, markers, and event layers can use the same layer id list.

Channel flow:

- Vectorscope and Spectrum/Spectrogram channel choices continue to live in panel controls.
- Spectrum and Spectrogram share `panelControls.spectrumChannel`.
- Channel changes still exit snapshot mode as they do now.
- Runtime channel choices are clamped to currently available channel options.
- When running, channel changes continue to call the relevant backend commands.

## Edge Cases

- If a saved channel is unavailable for the current input layout, fall back to the first valid option.
- Applying a custom preset while running should apply restored channel choices to the backend.
- Turning all stats off shows the stats empty state.
- Turning all history layers off shows the layers empty state while preserving chart interaction affordances.
- Built-in presets keep the current panel controls unchanged.

## Test Plan

- `PanelHeaderControls` renders the expected chip for `vectorscope`, `spectrum`, `spectrogram`, `loudnessStats`, and `loudness`.
- Channel controls preserve existing callbacks and labels.
- `Stats` and `Layers` multi-select controls toggle items without closing the menu.
- `LoudnessStatsPanel` filters rows by visible ids and renders `No stats selected` when empty.
- `LoudnessHistoryChart` hides and shows `Momentary`, `Short-term`, and `Reference` from layer ids, and renders `No layers selected` when all are hidden.
- Workspace reducer saves `panelControls` into custom presets.
- Workspace reducer restores `panelControls` from custom presets.
- Applying built-in presets leaves current `panelControls` unchanged.
- App initialization reads `panelControls` from `plvs.ui`.
- App persistence writes `panelControls` to `plvs.ui` after changes.

## Open Decisions

None. The design intentionally drops old channel preference compatibility and uses `Layers` instead of `Curves` for the Loudness history chip.
