<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Loudness — Public Controls

Module id `loudness`. Rendered against panel-control defaults and the assumed stereo
topology PLVS reports before a device is known; channel choices widen with the real topology.

## Defaults

```json
{
  "layers": [
    "momentary",
    "shortTerm"
  ],
  "loudnessRangeLufs": {
    "min": -64,
    "max": 0
  }
}
```

## Fields

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `layers` | array | - | `["momentary","shortTerm"]` | "momentary", "shortTerm"; unique | active |
| `loudnessRangeLufs` | object | LUFS | - | requires min, max; min < max; span >= 12 | active |
| `loudnessRangeLufs.min` | number | - | - | -64 to 0 | - |
| `loudnessRangeLufs.max` | number | - | - | -64 to 0 | - |

The last column is this field's availability while every control sits at its default. A field
reported inactive still accepts a patch; the result carries a `currentlyInactive` warning.
