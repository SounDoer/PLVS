<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Spectrum — Public Controls

Module id `spectrum`. Rendered against panel-control defaults and the assumed stereo
topology PLVS reports before a device is known; channel choices widen with the real topology.

## Defaults

```json
{
  "channel": {
    "type": "pair",
    "x": 0,
    "y": 1
  },
  "view": "combined",
  "maxMode": "off",
  "peakLabels": false,
  "speedPercent": 25,
  "tiltDbPerOctave": 3,
  "octaveSmoothing": "off",
  "levelRangeDb": {
    "min": -96,
    "max": -12
  }
}
```

## Fields

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `channel` | object | - | `{"type":"pair","x":0,"y":1}` | {"type":"pair","x":0,"y":1} | active |
| `view` | string | - | `"combined"` | "combined", "lr", "ms" | active |
| `maxMode` | string | - | `"off"` | "off", "decay", "hold" | active |
| `peakLabels` | boolean | - | `false` | - | active |
| `speedPercent` | integer | % | `25` | 0 to 100 | active |
| `tiltDbPerOctave` | number | dB/oct | `3` | 0 to 6; step 0.25 (UI hint) | active |
| `octaveSmoothing` | string | - | `"off"` | "off", "1/12", "1/6", "1/3" | active |
| `levelRangeDb` | object | dB | - | requires min, max; min < max; span >= 12 | active |
| `levelRangeDb.min` | number | - | - | -120 to 0 | - |
| `levelRangeDb.max` | number | - | - | -120 to 0 | - |

The last column is this field's availability while every control sits at its default. A field
reported inactive still accepts a patch; the result carries a `currentlyInactive` warning.
