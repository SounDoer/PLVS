<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Spectrogram — Public Controls

Module id `spectrogram`. Rendered against panel-control defaults and the assumed stereo
topology PLVS reports before a device is known; channel choices widen with the real topology.

## Defaults

```json
{
  "channel": {
    "type": "pair",
    "x": 0,
    "y": 1
  },
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

## Fields

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `channel` | object | - | `{"type":"pair","x":0,"y":1}` | {"type":"pair","x":0,"y":1} | active |
| `mode` | string | - | `"heatmap"` | "heatmap", "lines", "surface" | active |
| `tiltDbPerOctave` | number | dB/oct | `3` | 0 to 6; step 0.25 (UI hint) | active |
| `octaveSmoothing` | string | - | `"off"` | "off", "1/12", "1/6", "1/3" | active |
| `dbFloor` | integer | dB | `-84` | -96 to -12 | active |
| `threeD` | object | - | - | - | inactive (heatmapMode) |
| `threeD.azimuthDeg` | number | deg | `135` | 0 to <360 | inactive (heatmapMode) |
| `threeD.elevationDeg` | number | deg | `60` | 5 to 85 | inactive (heatmapMode) |
| `threeD.heightScale` | number | - | `1` | 0.3 to 3 | inactive (heatmapMode) |
| `threeD.colorize` | boolean | - | `true` | - | inactive (heatmapMode) |
| `threeD.grid` | boolean | - | `true` | - | inactive (heatmapMode) |

The last column is this field's availability while every control sits at its default. A field
reported inactive still accepts a patch; the result carries a `currentlyInactive` warning.
