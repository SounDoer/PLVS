# Configuration Transfer

Configuration Transfer exposes the Settings **Everything** export as a running-app command. The
portable resource is the same versioned `.plvsconfig` document produced by the GUI.

## Export

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

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
    "version": 2
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
Missing required sections or malformed collection containers return `invalidConfiguration` and
leave the existing configuration and Library intact.

Dry-run performs validation and returns the normalized configuration without writing or
relaunching. A successful real import replaces the same four domains and machine-specific siblings
as Settings **Everything**, preserves the local `agentControlEnabled` permission, and returns
`relaunch: true`.

The frontend relaunches PLVS after Rust confirms response delivery. Windows confirms delivery
after the CLI reads the named-pipe response. macOS and Linux use a CLI acknowledgement over the
Unix socket. The revision in the result belongs to the ending process. Rediscover the relaunched
app and call `inspect` to obtain the new process's revision.
If that restart cannot finish, the configuration remains saved. The toolbar's **Restart Required**
notice offers **Restart PLVS** to finish with the saved configuration.

## Reset

`config reset --expected-revision <n> --json [--dry-run]` runs the Settings reset and restarts
PLVS after the CLI receives the result. The command refuses a blocking editor before writing.
Dry-run reports `wouldRelaunch: true` and leaves the data and process intact. A real reset clears
the profile domains and resets first-run starter preferences while preserving the local Agent
Control switch.
