# Spectrum Y-axis range controls — design

Date: 2026-06-25
Status: Approved, pending implementation plan

## Background

The Spectrum panel currently uses a fixed `0..-100 dB` vertical range. Users report that starting
the Y axis at `0 dB` wastes top space for typical program material, especially with the existing
tilted spectrum display where useful detail often sits well below full scale.

Reference products generally favor stable manual display ranges over always-on auto scaling:

- Voxengo SPAN and Youlean expose range/offset style controls.
- iZotope Insight allows scale zooming and scrolling.
- Flux Analyzer/MiRA provide auto-range modes, but document the trade-off: auto-range improves
  local vertical detail while reducing visual comparability against a stable reference level.

PLVS should keep the Spectrum panel visually stable by default and add explicit per-panel controls
for users who want a tighter or wider view.

## Scope

Change the Spectrum panel Y-axis display range and add two Spectrum-only panel settings:

- `Y Max` — the dB value at the top of the Spectrum plot.
- `Y Range` — the visible dB span below `Y Max`.

The visible minimum is derived:

```text
Y Min = Y Max - Y Range
```

Out of scope:

- Automatic Y-axis range detection.
- Nonlinear/compressed Y-axis scaling.
- Spectrogram range controls.
- Rust FFT/DSP changes.
- Changing the underlying dB values shown in hover readouts.

## Product Semantics

### Default Range

The default Spectrum Y-axis range is:

```text
Y Max = -12 dB
Y Range = 84 dB
Y Min = -96 dB
```

This removes the mostly unused `0..-12 dB` headroom from the default view while preserving enough
top margin that loud material or tilted high-frequency content does not immediately pin to the top.
The bottom remains close to the current `-100 dB` floor, so low-level detail is still visible.

### User Controls

Add both controls to `Panel Settings > Spectrum`, below the existing `Tilt` control:

1. `Peak hold`
2. `Smoothing`
3. `Tilt`
4. `Y Max`
5. `Y Range`

Control values:

- `Y Max`
  - Default: `-12 dB`
  - Range: `-48..0 dB`
  - Step: `6 dB`
  - Display label: integer dB, e.g. `-12 dB`
- `Y Range`
  - Default: `84 dB`
  - Range: `48..120 dB`
  - Step: `6 dB`
  - Display label: integer dB, e.g. `84 dB`

The `6 dB` step keeps the controls aligned with common audio scale reading and avoids implying
fine calibration precision for a display-only viewport.

## Data Model

Extend per-panel controls:

```text
spectrumYMaxDb: -12
spectrumYRangeDb: 84
```

These values are normalized with defaults and clamped to their product ranges. They are persisted
through the existing workspace `panelControlsById` path.

These settings are frontend display controls only. They must not enter the Spectrum analysis request
key and must not create additional Rust `SpectrumMeter` instances. Existing live and snapshot
spectrum dB data can be remapped to the selected display range at render time.

## Rendering

Replace the current fixed Spectrum scale constants with range-aware helpers for the Spectrum panel:

```text
spectrumDbToYViewBox(db, { yMaxDb, yRangeDb })
spectrumDbToTopFrac(db, { yMaxDb, yRangeDb })
```

The mapping remains linear and clamped:

```text
yMinDb = yMaxDb - yRangeDb
clampedDb = clamp(db, yMinDb, yMaxDb)
```

Apply the selected range consistently to:

- Spectrum curve paths.
- Peak-hold paths.
- Secondary LR/MS curve paths.
- Horizontal grid lines.
- Y-axis labels.
- Hover crosshair and point position.
- Snapshot and live display.

Hover labels continue to show the actual dB value from the underlying spectrum data, not the
clamped display value.

## Ticks

Generate Spectrum Y-axis ticks from the selected range instead of using a fixed list.

For the default `-12..-96 dB` range, render:

```text
-12, -24, -36, -48, -60, -72, -84, -96
```

Use `12 dB` tick spacing for normal ranges so labels stay legible in small panels. Always include
the top and bottom values, even when the interior ticks are spaced every `12 dB`.

## Tests

Add/adjust tests for:

- `panelControls` defaults and clamping for `spectrumYMaxDb` and `spectrumYRangeDb`.
- Spectrum request key generation proving Y-axis display settings are excluded.
- Range-aware dB-to-Y mapping for the default `-12..-96 dB` range.
- Tick generation for default and non-default ranges.
- Spectrum panel rendering uses the selected range for labels/grid/hover positions.
- Settings UI order: `Peak hold`, `Smoothing`, `Tilt`, `Y Max`, `Y Range`.
