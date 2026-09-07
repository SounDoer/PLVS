# Module Control

Module Control describes the kinds of Panel that the running PLVS version can create. A Module is
a product-defined Panel type such as `spectrum`; a Panel is one live Workspace instance of that
type. Module Control is read-only. `workspace.applyLayout` creates instances, while Panel and Axis
Control configure them.

## Commands

```powershell
plvs-cli module list --json
plvs-cli module describe <module-id> --json
```

The wire methods are `module.list` and `module.describe`. Neither command accepts
`--expected-revision` or `--dry-run`, changes state, writes persistence, or marks a Preset dirty.

## List

`module.list` returns every creatable Module in the stable catalog order:

```json
{
  "revision": 12,
  "modules": [
    { "moduleId": "levelMeter", "title": "Level Meter" },
    { "moduleId": "spectrum", "title": "Spectrum" }
  ]
}
```

The compact list deliberately contains no React component, icon, renderer, or other UI
implementation detail. `app.capabilities.modules` remains the handshake copy of the same compact
catalog; Module Control provides the task-oriented discovery surface.

## Describe

`module.describe` describes a Module before an instance exists. Its public-control defaults and
schema come from the same builders used by `panel.describe`:

```json
{
  "revision": 12,
  "schemaBasis": "defaultControls",
  "context": {
    "channelTopology": { "status": "detected", "channelCount": 6 },
    "hasLoudnessReference": true
  },
  "module": {
    "moduleId": "spectrum",
    "title": "Spectrum",
    "layout": {
      "hardMinimumWidth": 32,
      "hardMinimumHeight": 36,
      "unit": "logicalPx"
    },
    "axisKinds": ["frequency"],
    "defaultControls": {},
    "controlsSchema": {}
  }
}
```

`schemaBasis` means that `effective` and `inactiveReason` fields are evaluated with every control
at its default. Dynamic choices use the current channel topology and Loudness Profile context.
After creating a Panel, `panel.describe` is authoritative for that instance and `panel.update`
revalidates every patch against then-current runtime context.

The layout dimensions are the Workspace drag clamps that keep a tab icon visible. They are hard
minimums, not a claim that the Module remains visually useful at that size. Full Axis constraints
stay in `axis.describe`; `axisKinds` only declares membership.

An unknown ID fails with `moduleNotFound` at `$.params.moduleId`. Successful queries report the
current process-local revision but never increment it.
