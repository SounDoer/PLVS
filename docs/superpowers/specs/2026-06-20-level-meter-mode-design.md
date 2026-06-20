# Level Meter Mode - Peak, Momentary, Short-term

**Date:** 2026-06-20
**Status:** Draft

## Summary

Evolve the existing Peak panel into a Level Meter surface. In v1 the panel gains
a single-select chip with three modes:

- `Peak`
- `M` (Momentary LUFS)
- `ST` (Short-term LUFS)

The user-facing panel title becomes `Level Meter`. The implementation should not
perform a broad code rename in this slice: existing `peak` module ids,
`PeakPanel`, and peak data-flow names may remain while the product semantics move
forward.

This spec is intentionally separate from the panel-instance workspace work. v1
does not let users show two Level Meter panels at once.

## Motivation

Users want loudness values to appear in the same compact meter form as the Peak
meter. Peak, Momentary, and Short-term are all level-style monitoring values:
they are scalar readings, fit a meter display, and need clear units/scale.

Keeping the panel named `Peak` while it displays loudness would make the product
language misleading. Renaming the user-facing surface to `Level Meter` gives the
panel a broader meaning without forcing a disruptive file/module rename.

## Product Behavior

### Title

The panel title is fixed:

```txt
Level Meter
```

The title does not change to `Peak Meter`, `Momentary Meter`, or
`Level Meter - Momentary`. The chip expresses the current metric. The title
expresses the panel type.

### Header Chip

Add a single-select chip in the panel header:

```txt
[Peak] [M] [ST]
```

Only one mode is active at a time.

Suggested mode ids:

```js
"peak"
"momentary"
"shortTerm"
```

Suggested labels:

- `Peak`
- `M`
- `ST`

### Units and Scale

The displayed unit and visual scale follow the selected mode:

- `Peak` uses `dBFS`.
- `M` uses `LUFS`.
- `ST` uses `LUFS`.

The v1 visual goal is to reuse the existing meter form as much as practical.
If the current Peak panel is vertical/channel-oriented, Momentary and Short-term
should appear in the same panel form with loudness values and LUFS labeling.

### Modules Entry

The module registry title should become `Level Meter` so the workspace header and
Modules popover use the new product language.

The module id may remain `peak` in v1. This avoids a storage/preset/layout
migration just for the label change.

## State and Persistence

Add a persistent panel control field:

```js
levelMeterMode: "peak" | "momentary" | "shortTerm"
```

Default:

```js
"peak"
```

This belongs with existing `panelControls` because it is a panel display
preference and should be captured by presets.

## Implementation Boundary

Do not broadly rename files or module ids in v1:

- keep `src/components/panels/PeakPanel.jsx`;
- keep module id `peak`;
- keep existing peak math/data helpers unless a small local helper is needed;
- do not rename persisted workspace ids;
- do not implement multi-instance workspace behavior.

Small user-facing text changes are in scope:

- registry title `Peak` -> `Level Meter`;
- panel header title follows registry title;
- chip labels `Peak`, `M`, `ST`.

## Data Sources

`Peak` mode uses the existing peak data currently rendered by `PeakPanel`.

`M` and `ST` should read from the same live/display loudness data already used by
loudness panels:

- Momentary LUFS;
- Short-term LUFS.

If channel-specific loudness data is not available, v1 may show a single
program-level value in the meter form rather than inventing per-channel loudness.

## Out of Scope

- Multi-instance workspace.
- A full `LevelMeterPanel` file/module rename.
- A combined Peak + loudness simultaneous display inside one panel.
- True Peak.
- Integrated LUFS.
- Loudness Range.
- Custom meter metric ordering.
- Per-instance Level Meter config.

## Testing Notes

- `PanelHeaderControls` renders the Level Meter chip for the `peak` module.
- Changing the chip updates `panelControls.levelMeterMode`.
- `PeakPanel` renders Peak mode by default.
- `PeakPanel` renders Momentary LUFS when mode is `momentary`.
- `PeakPanel` renders Short-term LUFS when mode is `shortTerm`.
- Registry title for `peak` is `Level Meter`.
- Presets save and restore `levelMeterMode`.
- Old persisted `panelControls` normalize to `levelMeterMode: "peak"`.
