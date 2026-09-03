# Spectrogram Panel Control

Status: Approved design; pending implementation

## Public controls

```json
{
  "channel": { "type": "pair", "x": 0, "y": 1 },
  "mode": "heatmap",
  "tiltDbPerOctave": 3,
  "octaveSmoothing": "off",
  "dbFloor": -84,
  "threeD": {
    "azimuthDeg": 135,
    "elevationDeg": 60,
    "heightScale": 1,
    "colorize": true,
    "grid": true
  }
}
```

## Validation and availability

- Channel validation and assumed/detected topology reporting match Spectrum.
- `mode` is `heatmap`, `lines`, or `surface`. Heatmap is 2D; Lines and Surface are 3D.
- `tiltDbPerOctave` is any finite number from 0 through 6. A 0.25 step is a UI hint only.
- `octaveSmoothing` is `off`, `1/12`, `1/6`, or `1/3`.
- `dbFloor` is an integer from -96 through -12 dB.
- `threeD` supports nested partial patches.
- `azimuthDeg` is finite and satisfies `0 <= value < 360`. Unlike internal/UI drag repair, the API
  rejects rather than wraps an out-of-range value.
- `elevationDeg` is finite from 5 through 85.
- `heightScale` is finite from 0.3 through 3.
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

Reset restores the values above, both axis links, and dormant local ranges. It does not change the
shared Workspace frequency or time axes.
