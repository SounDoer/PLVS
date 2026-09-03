# Stereo Map Panel Control

Status: Approved design; pending implementation

## Public controls

```json
{
  "mode": "position",
  "channelPair": { "x": 0, "y": 1 },
  "maxHold": false,
  "speedPercent": 50,
  "octaveSmoothing": "1/12",
  "monoLossFloorDb": -24,
  "msRatioRangeDb": { "min": -48, "max": 24 }
}
```

## Validation and availability

- `mode` is `position`, `correlation`, `monoLossDb`, or `msRatioDb`.
- Channel-pair validation matches Vectorscope: all distinct in-range pairs are valid, `x < y`, no
  swapping or clamping, and stereo L/R is assumed before topology detection.
- `maxHold` is effective in every mode.
- `speedPercent` is an integer from 0 through 100.
- `octaveSmoothing` is `off`, `1/12`, `1/6`, or `1/3`.
- `monoLossFloorDb` is from -60 through -6 dB. Its upper bound is fixed at 0 dB and is not a public
  control.
- `msRatioRangeDb` is atomic and must satisfy `-96 <= min <= 0 <= max <= 48` and `min < max`.
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

Reset restores the values above and the default linked frequency-axis state without changing the
shared Workspace frequency range. Clearing accumulated Max Hold is outside Panel Control.
