<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Waveform — Public Controls

Module id `waveform`. Rendered against panel-control defaults and the assumed stereo
topology PLVS reports before a device is known; channel choices widen with the real topology.

## Defaults

```json
{
  "frequencyColor": false,
  "frequencyBandsHz": {
    "lowMid": 200,
    "midHigh": 2000
  },
  "centroid": false
}
```

## Fields

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `frequencyColor` | boolean | - | `false` | - | active |
| `frequencyBandsHz` | object | Hz | - | requires lowMid, midHigh; lowMid < midHigh | inactive (frequencyColorOff) |
| `frequencyBandsHz.lowMid` | integer | - | - | 20 to 20000 | - |
| `frequencyBandsHz.midHigh` | integer | - | - | 20 to 20000 | - |
| `centroid` | boolean | - | `false` | - | active |

The last column is this field's availability while every control sits at its default. A field
reported inactive still accepts a patch; the result carries a `currentlyInactive` warning.
