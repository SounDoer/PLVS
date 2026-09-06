# Configuration Transfer

Status: Approved export contract; import is not yet implemented

Configuration Transfer exposes the Settings **Everything** export as a running-app command. The
portable resource is the same versioned `.plvsconfig` document produced by the GUI.

## Export

```powershell
npm run desktop:control -- config export --json
npm run desktop:control -- config export --json --out plvs-configuration.plvsconfig
```

Export is a query. It accepts neither `--expected-revision` nor `--dry-run`, does not mutate state,
and does not advance the global revision. Before building the document, PLVS flushes pending domain
writes and reads the same native store snapshot used by the GUI Everything export.

Without `--out`, the successful result contains:

```json
{
  "revision": 12,
  "configuration": {
    "app": "PLVS",
    "kind": "configuration-profile",
    "version": 1
  }
}
```

The shown configuration is abbreviated. It contains Settings, Workspace, Presets, custom Themes,
window bounds, capture-device selection, and shortcut state according to the existing profile
schema. It deliberately excludes `agentControlEnabled`, so importing a shared configuration cannot
enable control on another machine.

With `--out`, the file receives the pretty-printed configuration document and
`result.configuration` is replaced by `result.out`. If the local file write fails, stdout retains
the complete successful result with `result.configuration` and the process exits `1`, so the export
can be recovered without asking the app to produce it again.

## Import

`config import` is reserved but not implemented. GUI Everything import replaces the complete setup
and relaunches PLVS. The public command will be added only with a transport-level guarantee that the
successful response is delivered before relaunch closes the Agent Control endpoint.
