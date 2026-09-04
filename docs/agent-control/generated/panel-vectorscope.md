<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Vectorscope — Public Controls

Module id `vectorscope`. Rendered against panel-control defaults and the assumed stereo
topology PLVS reports before a device is known; channel choices widen with the real topology.

## Defaults

```json
{
  "channelPair": {
    "x": 0,
    "y": 1
  },
  "mode": "lissajous",
  "maxHold": false
}
```

## Fields

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `channelPair` | object | - | `{"x":0,"y":1}` | {"x":0,"y":1} | active |
| `mode` | string | - | `"lissajous"` | "lissajous", "polarSample", "polarLevel" | active |
| `maxHold` | boolean | - | `false` | - | inactive (nonPolarLevelMode) |

The last column is this field's availability while every control sits at its default. A field
reported inactive still accepts a patch; the result carries a `currentlyInactive` warning.
