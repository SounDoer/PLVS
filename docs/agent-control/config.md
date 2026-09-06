# Configuration Transfer

Status: Implemented

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

```powershell
npm run desktop:control -- config import backup.plvsconfig --expected-revision 12 --json --dry-run
npm run desktop:control -- config import backup.plvsconfig --expected-revision 12 --json
Get-Content backup.plvsconfig -Raw | npm run desktop:control -- config import - --expected-revision 12 --json
```

Import validates and normalizes the complete document before the first write. It is revision
guarded and is refused while a blocking editor is open, because replacing the complete setup would
destroy that editor's draft.

Dry-run performs validation and returns the normalized configuration without writing or
relaunching. A successful real import replaces the same four domains and machine-specific siblings
as Settings **Everything**, preserves the local `agentControlEnabled` permission, and returns
`relaunch: true`.

The successful response is not merely queued. Rust flushes the named-pipe response and waits until
the CLI has read every buffered byte; only then does the frontend relaunch PLVS. The revision in the
result belongs to the ending process. Rediscover the relaunched app and call `inspect` rather than
comparing revisions across the two sessions.
