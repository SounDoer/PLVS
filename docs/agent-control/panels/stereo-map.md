# Stereo Map Panel Control

Status: Implemented.

## Public controls

Fields, types, units, defaults and bounds are generated from the schema:
[`../generated/panel-stereo-map.md`](../generated/panel-stereo-map.md). This page carries the
behaviour that a schema cannot state.

## Validation and availability

- Channel-pair validation matches Vectorscope: all distinct in-range pairs are valid, `x < y`, no
  swapping or clamping, and stereo L/R is assumed before topology detection.
- `maxHold` is effective in every mode.
- `monoLossFloorDb` is from -60 through -6 dB. Its upper bound is fixed at 0 dB and is not a public
  control.
- Mode-specific range values remain stored while another mode is active. Updating a range that the
  final mode does not use is valid and returns `currentlyInactive`.

The frequency axis is read-only within Panel Control and writable through
[`../axes.md`](../axes.md).

## Analysis

Request identity is affected by channel pair, speed, and octave smoothing. Modes share the same
analysis data; mode, Max Hold, and ranges do not change request identity. Identical keys share one
analysis request, every distinct valid request is sent to the backend, and there is no request-count
cap. The panel reports whether its request is active or waiting for channel availability.

## Reset and exclusions

Reset restores the generated defaults and the default linked frequency-axis state without changing the
shared Workspace frequency range. Clearing accumulated Max Hold is outside Panel Control.
