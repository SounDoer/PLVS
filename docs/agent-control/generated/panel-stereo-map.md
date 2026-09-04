<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Stereo Map — Public Controls

Module id `stereo-map`. Rendered against panel-control defaults and the assumed stereo
topology PLVS reports before a device is known; channel choices widen with the real topology.

## Defaults

```json
{
  "mode": "position",
  "channelPair": {
    "x": 0,
    "y": 1
  },
  "maxHold": false,
  "speedPercent": 50,
  "octaveSmoothing": "1/12",
  "monoLossFloorDb": -24,
  "msRatioRangeDb": {
    "min": -48,
    "max": 24
  }
}
```

## Fields

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `mode` | string | - | `"position"` | "position", "correlation", "monoLossDb", "msRatioDb" | active |
| `channelPair` | object | - | `{"x":0,"y":1}` | {"x":0,"y":1} | active |
| `maxHold` | boolean | - | `false` | - | active |
| `speedPercent` | integer | % | `50` | 0 to 100 | active |
| `octaveSmoothing` | string | - | `"1/12"` | "off", "1/12", "1/6", "1/3" | active |
| `monoLossFloorDb` | number | dB | `-24` | -60 to -6 | inactive (nonMonoLossMode) |
| `msRatioRangeDb` | object | dB | - | requires min, max; min < max; includes 0 | inactive (nonMsRatioMode) |
| `msRatioRangeDb.min` | number | - | - | -96 to 48 | - |
| `msRatioRangeDb.max` | number | - | - | -96 to 48 | - |

The last column is this field's availability while every control sits at its default. A field
reported inactive still accepts a patch; the result carries a `currentlyInactive` warning.
