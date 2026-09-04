<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Stats — Public Controls

Module id `stats`. Rendered against panel-control defaults and the assumed stereo
topology PLVS reports before a device is known; channel choices widen with the real topology.

## Defaults

```json
{
  "metrics": {
    "visible": [
      "momentary",
      "shortTerm",
      "integrated",
      "momentaryMax",
      "shortTermMax",
      "lra",
      "psr",
      "plr"
    ],
    "order": [
      "momentary",
      "shortTerm",
      "integrated",
      "momentaryMax",
      "shortTermMax",
      "lra",
      "psr",
      "plr",
      "dialogueCoverage",
      "dialogueIntegrated",
      "dialogueRange",
      "dialogueOffset",
      "truePeak",
      "correlation",
      "sideToMid"
    ]
  }
}
```

## Fields

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `metrics` | object | - | - | - | active |
| `metrics.visible` | array | - | `["momentary","shortTerm","integrated","momentaryMax","shortTermMax","lra","psr","plr"]` | "momentary", "shortTerm", "integrated", "momentaryMax", "shortTermMax", "lra", "psr", "plr", "dialogueCoverage", "dialogueIntegrated", "dialogueRange", "dialogueOffset", "truePeak", "correlation", "sideToMid"; unique | active |
| `metrics.order` | array | - | `["momentary","shortTerm","integrated","momentaryMax","shortTermMax","lra","psr","plr","dialogueCoverage","dialogueIntegrated","dialogueRange","dialogueOffset","truePeak","correlation","sideToMid"]` | "momentary", "shortTerm", "integrated", "momentaryMax", "shortTermMax", "lra", "psr", "plr", "dialogueCoverage", "dialogueIntegrated", "dialogueRange", "dialogueOffset", "truePeak", "correlation", "sideToMid"; unique; every id exactly once | active |

The last column is this field's availability while every control sits at its default. A field
reported inactive still accepts a patch; the result carries a `currentlyInactive` warning.
