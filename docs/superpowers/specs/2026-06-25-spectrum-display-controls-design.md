# Spectrum display controls — design

Date: 2026-06-25
Status: Approved, ready for implementation

## Background

PLVS already applies two fixed display transforms to the spectrum curve in
`src-tauri/src/dsp/spectrum.rs`:

- Temporal smoothing via attack/release envelope constants (`30 ms` attack, `150 ms` release).
- A `+4.5 dB/oct` display tilt around a fixed `1 kHz` pivot.

The user wants MiniMeters-like Spectrum panel settings for these display controls. The controls
must be per panel, persisted with the workspace, and must not affect Spectrogram in this slice.

## Scope

Add two Spectrum-only panel settings:

- `Smoothing` — temporal smoothing amount for the primary/secondary spectrum curves.
- `Tilt` — display slope in `dB/oct` around the existing `1 kHz` pivot.

Keep the existing `Peak hold` switch, but order Spectrum settings as:

1. `Peak hold`
2. `Smoothing`
3. `Tilt`

Out of scope:

- Spectrogram smoothing/tilt.
- Frequency-axis smoothing.
- Negative tilt.
- User-configurable tilt pivot.
- Global app-level defaults.

## Product Semantics

### Smoothing

`Smoothing` is temporal smoothing: it controls how quickly the displayed curve follows new FFT
frames. It is separate from `Peak hold`.

- Range: `0..100`
- Step: `1`
- Default: `50%`
- Display label: integer percent, e.g. `50%`
- `0%`: bypass smoothing; incoming dB values become the displayed values immediately.
- `50%`: current PLVS behaviour (`attack = 30 ms`, `release = 150 ms`).
- `100%`: very slow smoothing (`attack ~= 200 ms`, `release ~= 1000 ms`).

The release mapping is logarithmic so the default can sit at `50%` while the high end still has
room for very stable MiniMeters-style display:

```text
p = smoothingPercent / 100
releaseMs = 10 * (1000 / 10) ^ (p ^ 1.85)
attackMs = releaseMs * 0.2
```

Implementation may clamp `0%` to a direct bypass rather than using the formula.

### Tilt

`Tilt` is a display-only slope added to each dB bin:

```text
displayDb = rawDb + tiltDbPerOctave * log2(freqHz / 1000Hz)
```

- Range: `0..6 dB/oct`
- Step: `0.25 dB/oct`
- Default: `4.5 dB/oct`
- Display label: two decimals with the full unit, e.g. `4.50 dB/oct`
- `0 dB/oct`: raw spectrum display.
- `4.50 dB/oct`: current PLVS default.

## Data Model

Extend per-panel controls:

```text
spectrumSmoothingPercent: 50
spectrumTiltDbPerOctave: 4.5
```

These fields are normalized with defaults and clamped to their product ranges. They are persisted
through the existing workspace `panelControlsById` path.

Because both settings change Rust-generated spectrum data, they must be part of the Spectrum
analysis request and request key. `Peak hold` remains a frontend display toggle and must not enter
the request key.

## Request Key

Keep the existing channel/view key prefix and append a compact settings suffix:

```text
spectrum:pair:<x>:<y>:<view>:sm<percent>:tilt<centidb>
spectrum:single:<ch>:combined:sm<percent>:tilt<centidb>
```

Examples:

```text
spectrum:pair:0:1:combined:sm50:tilt450
spectrum:single:2:combined:sm0:tilt0
```

`tilt<centidb>` stores `dB/oct * 100` as an integer, so `4.50` becomes `450`. This avoids decimal
format drift between JS and Rust validators.

## Engine

`SpectrumAnalysisRequest` carries:

```text
smoothingPercent: f64
tiltDbPerOctave: f64
```

`MeterPipeline` applies these settings to the per-key `SpectrumMeter` before pushing PCM. The
existing `spectrum_by_key` architecture remains the right boundary: each unique request key maps
to one `SpectrumMeter`, so panels with different smoothing/tilt do not share state or history.

`SpectrumMeter` exposes a small settings method that clamps and stores:

```text
set_display_controls(smoothing_percent, tilt_db_per_octave)
```

The tilt value replaces the current fixed `4.5`. The smoothing percent maps to attack/release in
`apply_envelope`; `0%` copies incoming values directly and keeps peak state coherent.

## UI

Add a compact local `SettingsSlider` inside `PanelSettingsContent.jsx`, matching existing
`SettingsRow` density:

- Native `input type="range"` for keyboard and pointer accessibility.
- Fixed-width value chip on the right.
- `aria-label="spectrum smoothing"` and `aria-label="spectrum tilt"`.

The controls render only for `activeTab === "spectrum"`. Spectrogram keeps channel selection only.

## Tests

Add/adjust tests for:

- `panelControls` default normalization and clamping.
- `analysisRequests` key grammar: smoothing/tilt included; `Peak hold` excluded.
- Shared analysis-request key fixture accepted by JS and Rust.
- Rust request validation rejects mismatched smoothing/tilt keys.
- Rust smoothing mapping pins `50% -> 30/150 ms`.
- Rust tilt setting changes spectrum output and default remains `4.5`.
- Settings UI order and labels: `Peak hold`, `Smoothing 50%`, `Tilt 4.50 dB/oct`.
