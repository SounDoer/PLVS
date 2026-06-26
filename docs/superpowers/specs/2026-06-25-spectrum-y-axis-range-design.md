# Spectrum Y-axis range controls — design

Date: 2026-06-25
Status: Implemented

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

Change the Spectrum panel Y-axis display range and add a precise `Y range` endpoint control in
panel settings. Also expose matching range endpoint controls for other non-time display axes:

- Spectrum `X range` in Hz and `Y range` in dB.
- Spectrogram `Y range` in Hz.
- Loudness `Y range` in dB/LUFS display units.
- Level Meter `Y range`, writing to peak-range controls in Peak mode and loudness-range controls
  in M/ST modes.

Out of scope:

- Automatic Y-axis range detection.
- Nonlinear/compressed Y-axis scaling.
- Rust FFT/DSP changes.
- Changing the underlying dB values shown in hover readouts.
- Time-axis range controls in panel settings.

## Product Semantics

### Default Range

The default Spectrum Y-axis range is:

```text
Y range = -96 dB to -12 dB
```

This removes the mostly unused `0..-12 dB` headroom from the default view while preserving enough
top margin that loud material or tilted high-frequency content does not immediately pin to the top.
The bottom remains close to the current `-100 dB` floor, so low-level detail is still visible.

### User Controls

Add two range controls to `Panel Settings > Spectrum`, below the existing `Tilt` control:

1. `Peak hold`
2. `Smoothing`
3. `Tilt`
4. `X range`
5. `Y range`

The range controls use two compact numeric endpoint fields rather than sliders, because the user
intent is exact axis endpoint control.

The same `Y range` endpoint pattern is available in Spectrogram, Loudness, and Level Meter panel
settings. Spectrogram renders a settings panel even when this range is the only available setting.
Loudness keeps `Layers` first and places `Y range` below it. Time range is intentionally omitted
from panel settings.

## Data Model

Extend per-panel controls:

```text
spectrumYMaxDb: -12
spectrumYMinDb: -96
```

These values are normalized with defaults and clamped to product ranges. They are persisted through
the existing workspace `panelControlsById` path. Legacy `spectrumYRangeDb` input is accepted as a
migration path and normalized into `spectrumYMinDb` / `spectrumYMaxDb`.

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

- `panelControls` defaults and clamping for `spectrumYMinDb` and `spectrumYMaxDb`.
- Spectrum request key generation proving Y-axis display settings are excluded.
- Range-aware dB-to-Y mapping for the default `-12..-96 dB` range.
- Tick generation for default and non-default ranges.
- Spectrum panel rendering uses the selected range for labels/grid/hover positions.
- Settings UI order: `Peak hold`, `Smoothing`, `Tilt`, `X range`, `Y range`.
- Settings UI range controls for Spectrogram, Loudness, and Level Meter.
