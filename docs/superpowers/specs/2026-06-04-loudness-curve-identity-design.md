# Loudness Curve Identity Design

## Summary

Improve how the Loudness history chart distinguishes `Momentary` (`M`) and `Short-term` (`ST`) curves across all built-in themes.

`M` and `ST` are both primary data series. They should remain visually equal in importance, match the active theme's signal color family, and avoid consuming dashed-line semantics that belong to reference, threshold, marker, and event layers.

## Goals

- Make `M` and `ST` easier to identify in every built-in theme.
- Preserve equal visual importance between `M` and `ST`.
- Keep Loudness aligned with the same theme accent family used by Spectrum and Vectorscope.
- Reserve dashed and marker styles for auxiliary chart layers such as `Reference`, thresholds, markers, and future events.
- Update the design token guidance so future chart layers follow the same visual language.

## Non-Goals

- Do not introduce global fixed colors for `M` and `ST`.
- Do not make Loudness more colorful than the rest of the app by adding unrelated palette colors.
- Do not use dashed lines for `M` or `ST`.
- Do not change the meaning of `Reference`; it remains an auxiliary reference layer.
- Do not add a dedicated reference text color token unless existing semantic text tokens fail in implementation.
- Do not add hover HUD or layer menu swatches unless the curve styling alone proves insufficient.
- Do not add user customization for trace colors or line styles.

## Current Behavior

`LoudnessHistoryChart` renders:

- `M` as a solid path using `--ui-chart-momentary`.
- `ST` as a solid path using `--ui-chart-shortterm`.
- `Reference` as a dashed line and tolerance band using `--ui-chart-target-line`.

The active theme writes these tokens from `src/theme/builtinThemes.js` through `applyThemeToDocument`.

Today, `M` and `ST` are mostly distinguished by same-family color, line width, and `ST` opacity. This works best in `Abyss`, `Phosphor`, and `Tungsten`, but can be too subtle in `Dark` and `Light`.

## Visual Language

Chart layer style should carry semantic meaning:

- Solid colored curves are primary data series.
- Dashed lines are references, targets, thresholds, or future marker-like auxiliary layers.
- Bands are ranges or tolerances around an auxiliary layer.

Under this model, `M` and `ST` stay solid because both are primary loudness history series. `Reference` keeps the dashed style because it is not a measured data series.

## Theme Color Strategy

Each theme should define `M` and `ST` as sibling traces within the same signal family.

The sibling traces may differ by:

- lightness,
- saturation,
- slight hue shift within the theme family,
- opacity,
- line width.

They should not differ by unrelated high-contrast palette jumps. For example, a warm orange theme should not make one loudness curve blue only to force contrast. A theme such as `Abyss` may use cyan for snap or selection accents, but live `M` and `ST` should still feel like members of the same chart family unless the broader theme language changes.

## Product Behavior

### Loudness History Chart

`M` and `ST` both render as solid curves.

`M` should use a thinner stroke. `ST` should use a thicker stroke. This gives users a stable shape cue without borrowing dashed-line semantics from reference or marker layers.

The data curve paths should use screen-space stroke widths. In SVG, that means using non-scaling strokes so the `M` / `ST` width difference remains visible when the chart viewBox is stretched or compressed by the panel size.

### Hover HUD

The hover HUD should stay compact:

- `M` row uses the `M` label and value.
- `ST` row uses the `ST` label and value.

Do not add trace swatches here unless visual review shows the chart still needs disambiguation after line-width and color tuning.

### Reference Layer

`Reference` should remain visually lower priority than `M` and `ST`.

The reference line uses `--ui-chart-target-line` and keeps its dashed style. The tolerance band may derive from the same token at low opacity. The reference label text should use existing semantic text color, such as muted foreground, instead of a dedicated chart text color.

Reference axis text should also use semantic text color rather than decorative `text-chart-*` palette slots. Do not color reference text as a third primary trace.

## Design Token Guidance

`docs/design-tokens.md` should describe the chart trace semantics:

- `--ui-chart-momentary` and `--ui-chart-shortterm` are sibling primary data trace tokens.
- `--ui-chart-target-line` is an auxiliary reference token with lower visual priority than primary traces.
- Reference labels and reference axis text should use semantic text color.
- Theme authors may tune sibling trace colors per theme, but must keep them within the theme's signal family.

## Testing

Implementation should include focused tests for:

- `LoudnessHistoryChart` keeps the hover HUD compact without trace swatches.
- `LoudnessHistoryChart` does not color reference axis text with decorative `text-chart-*` palette slots.
- `LoudnessHistoryChart` renders `M` and `ST` paths with non-scaling strokes so token width changes are visible at runtime.
- Theme token tests assert `M` uses a thinner stroke than `ST` for every built-in theme.
- Theme token tests continue to assert stable token presence for all built-in themes.

Visual review should check every built-in theme:

- `Dark`
- `Light`
- `Phosphor`
- `Tungsten`
- `Abyss`

## Open Decision

Do not implement HUD or Layers swatches for now. Revisit only if visual review shows line width and sibling theme colors are not enough.
