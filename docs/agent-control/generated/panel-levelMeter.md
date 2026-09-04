<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Level Meter — Public Controls

Module id `levelMeter`. Rendered against panel-control defaults and the assumed stereo
topology PLVS reports before a device is known; channel choices widen with the real topology.

## Defaults

```json
{
  "mode": "peak",
  "playbackMax": false,
  "floatingValue": false,
  "tpMaxMarker": false,
  "levelRangeDbfs": {
    "min": -60,
    "max": 3
  },
  "loudnessRangeLufs": {
    "min": -64,
    "max": 0
  }
}
```

## Fields

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `mode` | string | - | `"peak"` | "peak", "rms", "momentary", "shortTerm" | active |
| `playbackMax` | boolean | - | `false` | - | inactive (peakMode) |
| `floatingValue` | boolean | - | `false` | - | inactive (nonLoudnessMode) |
| `tpMaxMarker` | boolean | - | `false` | - | active |
| `levelRangeDbfs` | object | dBFS | - | requires min, max; min < max; span >= 12 | active |
| `levelRangeDbfs.min` | number | - | - | -60 to 3 | - |
| `levelRangeDbfs.max` | number | - | - | -60 to 3 | - |
| `loudnessRangeLufs` | object | LUFS | - | requires min, max; min < max; span >= 12 | inactive (levelMode) |
| `loudnessRangeLufs.min` | number | - | - | -64 to 0 | - |
| `loudnessRangeLufs.max` | number | - | - | -64 to 0 | - |

The last column is this field's availability while every control sits at its default. A field
reported inactive still accepts a patch; the result carries a `currentlyInactive` warning.
