# Stats Panel Control

Status: Approved design; pending implementation

## Public controls

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

`metrics.visible` defaults to the first eight identifiers shown above. `metrics.order` defaults to
the full canonical order.

## Validation and patching

- `visible` is a complete set replacement. It may be empty and must contain only unique known IDs.
- Output `visible` is sorted according to `order`.
- `order` must be a full permutation of all 15 known IDs: no omissions, duplicates, or unknowns.
- The `metrics` object supports nested partial patching: a patch may supply only `visible` or only
  `order`.

## Dialogue Detection boundary

Dialogue Detection is intentionally absent from this panel contract. The engine is now one global
system setting (`settings.dialogueVadEngine`) rather than a value stored by each Stats panel.
Settings Control, not `panel.update`, owns engine selection.

The current engine choices are `firered`, `silero`, and `ten`, with `firered` as the default. Showing
at least one dialogue metric still activates Dialogue Detection; hiding all dialogue metrics makes
it inactive. It does not add a VAD field to Stats Panel Control.

`panel.describe` and `app.inspect` expose the indirect analysis state separately from controls:

```json
{
  "analysis": {
    "dialogueDetection": {
      "requestedByPanel": true,
      "runtime": "active"
    }
  }
}
```

- `requestedByPanel` is true when this Stats panel displays at least one dialogue metric.
- `runtime` is `active` when any Stats panel requests Dialogue Detection and `notRequested` when no
  panel does.
- `{ "requestedByPanel": false, "runtime": "active" }` is valid: another Stats panel is the
  requester.
- Adding or removing dialogue metrics is a normal Stats controls update and produces no warning
  merely because it starts or stops the shared runtime.
- A dry run previews both fields from the proposed final Workspace state without actually starting
  or stopping Dialogue Detection.
