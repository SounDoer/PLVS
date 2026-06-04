# Chart Snapshot Color Design

## Summary

Define a consistent snapshot color language for PLVS chart traces.

Snapshot mode is entered when the user selects a historical offset. In that state, chart traces should read as "viewing a selected historical instant" rather than "live input". This design covers the chart traces in Loudness, Vectorscope, and Spectrum.

## Goals

- Make snapshot mode visually obvious across chart panels.
- Keep snapshot colors aligned with each built-in theme.
- Use one snapshot color family per theme across Loudness, Vectorscope, and Spectrum.
- Preserve each chart's existing token names and rendering flow.
- Avoid changing non-chart UI such as transport buttons, status pills, and footer status text.

## Non-Goals

- Do not introduce user-configurable snapshot colors.
- Do not add new CSS variable names for snapshot traces.
- Do not make snapshot colors global across all themes.
- Do not change Spectrogram behavior in this pass; it selects historical data differently and does not use the same stroke snapshot tokens.
- Do not redesign the transport button or status pill snapshot state.

## Current Behavior

Snapshot state is driven by `selectedOffset >= 0`.

The chart token path is:

- `src/theme/builtinThemes.js` defines theme chart snap colors.
- `applyThemeToDocument` writes those values to existing `--ui-chart-*-snap` CSS variables.
- Chart panels switch from live tokens to snap tokens when `selectedOffset >= 0`.

Current consumers:

- `LoudnessHistoryChart`: `--ui-chart-momentary-snap`, `--ui-chart-shortterm-snap`
- `VectorscopePanel`: `--ui-chart-vectorscope-snap`
- `SpectrumPanel`: `--ui-chart-spectrum-snap`

The existing colors generally use a lighter or alternate version of the live color. The relationship is not yet consistent enough across themes, and some themes do not make snapshot mode obvious enough.

## Visual Language

Chart trace color should carry two separate meanings:

- Live family: current live data.
- Snapshot family: selected historical data.

Snapshot colors are state colors for chart traces. They are not new data categories, hover colors, or warning colors.

Under this model, every built-in theme should have one snapshot family. Loudness, Vectorscope, and Spectrum should all enter that family when the chart is in snapshot mode.

## Token Strategy

Do not add new token names.

Continue using existing theme fields:

- `loudnessHistory.momentaryStrokeSnap`
- `loudnessHistory.shortTermStrokeSnap`
- `vectorscope.strokeSnap`
- `spectrum.strokeSnap`

Continue writing existing CSS variables:

- `--ui-chart-momentary-snap`
- `--ui-chart-shortterm-snap`
- `--ui-chart-vectorscope-snap`
- `--ui-chart-spectrum-snap`

Add design constraints:

- Within one theme, all snap tokens should belong to the same snapshot family.
- Snap tokens should be visibly distinct from their corresponding live tokens.
- Loudness `M` and `ST` snap tokens may keep sibling differences, but both should still read as members of the same snapshot family.
- Snapshot colors must remain compatible with the theme's visual language.

## Theme Direction

Suggested snapshot families:

- `Dark`: gold / pale amber
- `Light`: warm ochre / deeper amber, strong enough for light backgrounds
- `Phosphor`: pale phosphor green
- `Tungsten`: bright tungsten gold
- `Abyss`: cyan / teal

These are directionally descriptive, not a requirement to use exact color names or values.

## Testing

Implementation should include theme-level tests that assert:

- Every built-in theme defines all chart snap tokens.
- Snap tokens are visually distinct from their corresponding live tokens.
- Snap tokens within a theme are close enough to read as a family, rather than unrelated chart colors.

These tests should not pretend to fully validate aesthetics. They should prevent the known failure mode: snapshot colors that are only barely different from live colors or inconsistent across chart panels.

## Visual Review

Review snapshot state in:

- `Dark`
- `Light`
- `Phosphor`
- `Tungsten`
- `Abyss`

For each theme, verify:

- Loudness, Vectorscope, and Spectrum all clearly read as snapshot mode.
- Snapshot color is more obvious than a minor brightness tweak.
- Snapshot color still feels native to the active theme.
- Snapshot color does not conflict with Reference / target / threshold semantics.
