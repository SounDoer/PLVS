# Spectrum — Multi-resolution FFT curve (Pro-Q / SPAN style)

**Date:** 2026-06-14
**Status:** Draft

## Overview

The spectrum analyzer currently runs a single 4096-point FFT, integrates bin power into 1/24-octave RTA bands, and renders a polyline through the ~245 band centers. This is a legitimate "FFT engine + RTA display" approach, but the product is now positioned for **music / mixing / mastering** users who expect a Pro-Q / SPAN style **per-frequency FFT curve** with fine low-frequency detail and a spectral slope.

This spec replaces the RTA-band display path with a **multi-resolution FFT engine** that combines several FFT sizes in the power-spectral-density (PSD) domain, resamples onto a fixed log-frequency grid, and applies a default **+4.5 dB/octave slope**. All DSP stays in Rust; the JS path only renders the `(frequency, dB)` list the engine emits.

This is an engine + rendering + defaults change only. It does **not** add user-facing controls.

## Current state

- `SpectrumMeter` (`src-tauri/src/dsp/spectrum.rs`) owns a single `FFT_LEN = 4096`, Hann window, hop `N/4`, 4-frame power averaging, fractional-bin integration into 1/24-octave RTA bands, Z/A/C weighting, `tilt_db_per_octave` (implemented but hardcoded `0`), frequency-kernel smoothing, attack/release, and peak-hold.
- `paths.rs` turns `(centers_hz, smooth_db, peak_db)` into SVG path strings (`freq → x`, `db → y`).
- `meter_pipeline.rs` puts `spectrum_band_centers_hz` + smooth/peak dB into the frame payload.
- **The JS path does no FFT.** `FrameIntake.buildSpectrumDataSnapshot` consumes the payload's `spectrumSmoothDb` and reconstructs x-geometry via `buildRtaBands`, falling back to `getBandsFromCenters` when band count and dB length disagree. `spectrumMath.buildSpectrumSvgFromBandsAndDb` and the hover code already work on a generic `(center, db)` list.

So the engine is Rust-only, and the frontend is already a generic `(frequency, dB)` renderer.

## Goals

- Low-frequency detail materially finer than a single 4096 FFT (sub-3 Hz bins in the bass).
- A single smooth curve on a fixed log-frequency grid, stable in length frame to frame.
- Seamless level continuity across the FFT-size crossovers for broadband content.
- Default **+4.5 dB/octave** slope so typical mixes read roughly flat.
- The frame payload shape is unchanged: a list of x-frequencies plus per-point smooth/peak dB.
- The JS render/snapshot path trusts the payload frequencies and needs no FFT.

## Non-goals

- No user-facing controls (slope / smoothing / resolution / range selectors) — separate spec.
- No Peak Hold redesign (keep current behavior).
- No selectable window function (Hann only).
- No frequency range or zoom changes (still 20 Hz .. min(20 kHz, Nyquist)).
- No note-name hover readout.
- No multichannel overlay (multichannel stays one summed-power curve, as today).
- No JS-side FFT.
- Not metrology-grade (IEC 61260) — this is a visualization analyzer, matching pro-plugin practice. Absolute dB is display-referenced (dBFS-relative), not calibrated SPL.

## Engine design (Rust, `spectrum.rs`)

### Multi-resolution FFT bank

Three fixed FFT sizes run in parallel, each with its own ring buffer, Hann window, 75%-overlap hop, and short-term power averaging (same averaging policy as today):

| Name | Size | Bin spacing @48k | Frequency region |
| --- | --- | --- | --- |
| `BIG` | 16384 | ≈2.9 Hz | below `XOVER_LO` |
| `MID` | 4096 | ≈11.7 Hz | `XOVER_LO`..`XOVER_HI` |
| `SMALL` | 1024 | ≈46.9 Hz | above `XOVER_HI` |

Crossovers are tunable constants: `XOVER_LO = 200 Hz`, `XOVER_HI = 2000 Hz`. Each crossover uses a short log-frequency crossfade region (e.g. ±1/6 octave) that linearly blends the two adjacent FFTs' PSD so no seam is visible.

Sizes/crossovers are a deliberate engineering simplification of continuous multi-resolution: stable to implement, sufficient for monitoring. More stages can be added later without changing the output contract.

### PSD-domain combination

Different FFT sizes produce different per-bin power for the same broadband signal (per-bin power scales with bin width). To combine them seamlessly, each FFT's bins are converted to **power spectral density** (power per Hz) before sampling: `psd[k] = bin_power[k] / bin_width_hz`. PSD is independent of FFT size for broadband content, so crossovers are continuous. Coherent tones still appear as peaks.

A fixed calibration offset maps levels into the display window so a full-scale (0 dBFS) sine peak lands at ≈0 dB. The offset is a constant verified by manual test; absolute dB remains display-referenced, not SPL.

### Output: fixed log-frequency grid

Output is a fixed log-frequency grid spanning `20 Hz .. min(20 kHz, Nyquist)` at **96 points/octave** (≈960 points over the audible range). For each grid frequency:

1. Select the source FFT for that frequency (with crossfade in the crossover regions).
2. Sample that FFT's PSD by linear interpolation in power between the two adjacent bins.
3. Convert to dB.

A fixed grid gives uniform smoothness on the log-x axis and a stable output length (good for history/snapshots and the JS renderer).

### Post-processing (per grid point, in order)

1. PSD → dB (with calibration offset).
2. Z/A/C weighting (default Z) — reuse existing `weighting_db`.
3. **Slope/tilt: default `+4.5 dB/octave`** via `tilt * log2(f / f_min)` — reuse existing `tilt_db_per_octave`, default changed from `0` to `4.5`.
4. Octave smoothing: light Gaussian in the log-frequency domain, default **1/24 octave**, to keep the multi-resolution curve clean.
5. Temporal attack/release per grid point — reuse existing (30 ms / 150 ms).
6. Peak-hold per grid point — reuse existing behavior.

## Defaults (this spec; no UI)

- FFT bank: 16384 / 4096 / 1024; crossovers 200 / 2000 Hz; crossfade ±1/6 octave.
- Render grid: log, 96 points/octave, 20 Hz .. min(20 kHz, Nyquist).
- Combination: PSD domain, calibrated so 0 dBFS sine ≈ 0 dB.
- Slope: +4.5 dB/octave.
- Octave smoothing: 1/24 octave.
- Weighting: Z. Attack/release: 30 / 150 ms.

## Frame payload & JS rendering

The payload shape is unchanged; only its contents become the grid:

- `spectrum_band_centers_hz` now carries the **log-grid frequencies**.
- `spectrum_smooth_db` / peak dB are **per grid point**.
- `paths.rs` `freq → x` / `db → y` is unchanged.

JS changes are minimal:

- `FrameIntake.buildSpectrumDataSnapshot` should trust the payload frequencies (use `getBandsFromCenters`) and stop reconstructing/length-matching via `buildRtaBands`. The `buildRtaBands`-based geometry path for spectrum becomes dead for this consumer.
- `buildSpectrumSvgFromBandsAndDb` and hover (`computeSpectrumHoverIndex`) already operate on `(center, db)` and need no change.
- `pushVisualHistRow` likewise stores payload frequencies instead of recomputed RTA bands.

## Error handling

- Rings not yet full → emit nothing (as today, return `None` until the largest FFT's ring fills).
- Sample-rate changes / channel-count changes reset all three FFT rings and the grid (extend the existing `reset_rings_for_channels`).
- Grid frequencies above Nyquist are clamped out of the grid range.
- All per-bin power is floored (`max(1e-12)`) before log, as today.

## Testing

Rust unit tests:

- Pure tones at low (50 Hz), mid (1 kHz), high (8 kHz) resolve at the correct grid frequency and at a consistent level across the crossovers.
- Two close low-frequency tones (e.g. 60 Hz and 70 Hz) are resolved as two peaks (the single 4096 FFT cannot).
- A constant slope value shifts the curve by the expected dB/octave (high-vs-low grid-point delta).
- Broadband (white / pink) input is continuous across both crossovers — no step larger than a small tolerance at `XOVER_LO` / `XOVER_HI` (validates PSD-domain combination + crossfade).
- Output grid length is stable across frames and matches the configured points/octave.
- Multichannel (N>2) still produces one summed-power curve, louder than the stereo-average curve for the same tone (port the existing assertion to the grid output).

Manual verification:

- Feed a 0 dBFS sine: its peak lands at ≈0 dB (calibration check).
- Feed pink noise: with +4.5 dB/oct slope the curve reads roughly the expected gentle tilt; inspect for seams at 200 Hz / 2 kHz.
- Compare bass detail against the old build on a real mix.
