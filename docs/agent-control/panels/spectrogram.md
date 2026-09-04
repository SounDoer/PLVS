# Spectrogram Panel Control

Status: Implemented.

## Public controls

Fields, types, units, defaults and bounds are generated from the schema:
[`../generated/panel-spectrogram.md`](../generated/panel-spectrogram.md). This page carries the
behaviour that a schema cannot state.

## Validation and availability

- Channel validation and assumed/detected topology reporting match Spectrum.
- `mode` is `heatmap`, `lines`, or `surface`. Heatmap is 2D; Lines and Surface are 3D.
- `threeD` supports nested partial patches.
- `azimuthDeg` is finite and satisfies `0 <= value < 360`. Unlike internal/UI drag repair, the API
  rejects rather than wraps an out-of-range value.
- Updating a touched 3D field while the final mode remains Heatmap is valid and returns
  `currentlyInactive`.

Frequency and time axes are read-only within Panel Control and writable through
[`../axes.md`](../axes.md).

## Analysis

Spectrogram shares the Spectrum-like request family with Spectrum, with no request-count cap. Its
public controls that affect unique request identity are channel and octave smoothing. A hidden
fixed/default speed still participates in the internal key. Mode, tilt, dB floor, 3D controls, and
displayed axes do not affect request identity. Identical keys share one analysis request.

The panel reports whether its valid request is active or waiting for channel availability.

## Reset

Reset restores the generated defaults, both axis links, and dormant local ranges. It does not change the
shared Workspace frequency or time axes.
