# PLVS CLI

PLVS installs `plvs-cli` for diagnosis and automation of the running desktop app. The public
command tree has two roots:

```text
plvs-cli doctor
plvs-cli app ...
```

`doctor` works when PLVS is closed. Every `app` command controls or inspects the same state visible
in an already-running PLVS window. It requires Agent Control to be enabled in Settings and is
currently available only on Windows. The CLI never starts PLVS implicitly or edits its store behind
the running app.

## Install Location

Installed builds place the CLI next to the desktop binary.

Windows:

```powershell
& "$env:LOCALAPPDATA\PLVS\plvs-cli.exe" --help
```

macOS:

```bash
/Applications/PLVS.app/Contents/MacOS/plvs-cli
~/Applications/PLVS.app/Contents/MacOS/plvs-cli
```

When PATH setup is enabled from Settings on Windows, a fresh terminal can run:

```powershell
plvs-cli --help
```

Portable builds may require the executable's full path.

## Agent Discovery

Do not assume `plvs-cli` is on `PATH`. Use this order:

1. Try `plvs-cli` from `PATH`.
2. On Windows, read the installed CLI record:

```powershell
$plvs = Get-ItemProperty HKCU:\Software\SounDoer\PLVS -ErrorAction SilentlyContinue
& $plvs.CliPath doctor --json
```

3. On Windows, try the default install path:

```powershell
& "$env:LOCALAPPDATA\PLVS\plvs-cli.exe" doctor --json
```

4. On macOS, inspect the app-bundle manifest and run its CLI:

```bash
cat /Applications/PLVS.app/Contents/Resources/plvs-agent.json
/Applications/PLVS.app/Contents/MacOS/plvs-cli doctor --json
```

5. On macOS, try the user Applications folder:

```bash
~/Applications/PLVS.app/Contents/MacOS/plvs-cli doctor --json
```

Run `doctor --json` first to verify the installed runtime and bundled sidecars.

## Commands

```powershell
plvs-cli doctor [--json] [--out <file>]
plvs-cli app <command> [options]
plvs-cli --help
plvs-cli --version
```

Use `plvs-cli app --help` for the complete live-control command list. The current families are:

- `inspect`, `capabilities`, and `wait`;
- `workspace`, `panel`, and `axis`;
- `preset` and `settings`;
- `transport` and `dock`.

Detailed payloads and behavior are documented in [Agent Control](agent-control/README.md).

## JSON Contract

`doctor` defaults to concise human-readable output. Every `app` query, mutation, and action requires
`--json`; help does not. In JSON mode, stdout contains exactly one UTF-8 JSON document followed by a
newline, with no banners, progress text, or ANSI escapes.

Every successful JSON response has:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {}
}
```

Every failed JSON response has:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "agentControlDisabled",
    "message": "Agent Control is disabled."
  }
}
```

Exactly one of `result` and `error` is present. `error.code` is stable machine-readable lower camel
case; `error.message` is for people and must not be parsed. `error.details` may provide structured
context. Consumers must ignore unknown fields. A conceptually present but unavailable value is
`null`; an optional concept that does not apply is omitted. Timestamps are UTC RFC 3339 strings,
and identifiers are opaque strings whose spelling carries no type or chronology.

The canonical v1 examples live in
[`shared/cli-v1-envelope-fixtures.json`](../shared/cli-v1-envelope-fixtures.json).

### Doctor

`doctor --json` returns its diagnostic report under `result.report`:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "report": {
      "status": "warning",
      "summary": { "ok": 8, "warning": 1, "error": 0, "skipped": 0 },
      "checks": []
    }
  }
}
```

A completed report is a successful command even when it diagnoses an unhealthy installation. A
report with a required check in `error` state therefore keeps `ok: true` and exits `1`. This is the
only documented `ok: true` response with a nonzero exit code.

### App queries and global revision

Every `app` query returns one global `revision`:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "revision": 44,
    "workspace": {}
  }
}
```

The revision advances when observable Workspace, Preset, Settings, Transport, or Dock control state
changes. It is an in-process concurrency token and resets when PLVS restarts. Meter frames and other
continuously changing measurements do not advance it. Queries never accept
`--expected-revision`.

### State mutations

Every state mutation requires `--expected-revision <n>` and supports `--dry-run`. A successful
result includes:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "dryRun": false,
    "changed": true,
    "revision": 45,
    "warnings": [],
    "state": {}
  }
}
```

`changed` is a boolean. A no-op returns `changed: false` without advancing revision. A dry-run
performs validation and returns the predicted final `state`, but performs no native call,
persistence, or revision increment.

The CLI never retries a `revisionConflict`. Inspect again, reconcile the user's intervening change,
and issue a new explicit mutation.

### Actions

Transport start/stop and file analyze/reanalyze/stop are actions rather than state mutations.
Actions require `--expected-revision`, do not accept `--dry-run`, and return `action`, `status`, the
latest revision, and final state:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "action": "transport.live.start",
    "status": "completed",
    "revision": 45,
    "state": { "transport": {} }
  }
}
```

Transport source live/file, live clear, and file select/remove/clear are state mutations. They
require `--expected-revision` and support `--dry-run`.

### Waiting for change

Use the broad snapshot and global revision as a control loop:

```powershell
plvs-cli app inspect --json
plvs-cli app wait --after-revision 44 --timeout-ms 30000 --json
```

`--after-revision` is required. `--timeout-ms` defaults to `30000` and accepts `100` through
`300000`. Wait is a query: it accepts neither `--expected-revision` nor `--dry-run`.

A change returns `outcome: "changed"`, `matchedImmediately`, and the latest `revision`. Timeout is
an error with code `timeout` and exit `5`, not a successful unchanged result.

## Exit Codes

| Code | Class | Examples |
| ---: | --- | --- |
| `0` | Success | Query or mutation completed; healthy or warning-only doctor report |
| `1` | Runtime or system failure | Native operation failed; output write failed; doctor found a required error |
| `2` | App unavailable for control | App not running; Agent Control disabled; frontend not ready |
| `3` | Invalid command input | Unknown command; invalid argument; required revision omitted |
| `4` | Current state refuses the operation | Revision conflict; blocking editor; wait limit reached |
| `5` | Wait did not complete | Timeout or cancellation |

Under `--json`, every failure that reaches the CLI parser emits the error envelope as well as its
nonzero process exit code. A thin-forwarder failure before the host starts can only report on
stderr and exits `2`.

## Output Files

`doctor --out <file>` has tee semantics: stdout remains intact and the file receives the exact same
bytes. `app` commands do not currently accept `--out`; capture their clean JSON stdout
programmatically. In Windows PowerShell 5.1, use `cmd` for byte-preserving redirection because
PowerShell's `>` transcodes native output to UTF-16LE:

```powershell
plvs-cli doctor --json --out doctor.json
cmd /d /s /c "plvs-cli app inspect --json > inspect.json"
```

## Agent Workflow

1. Discover the installed binary and run `doctor --json`.
2. Ensure PLVS is running and Agent Control is enabled.
3. Run `app capabilities --json` and use its stable `commands` and `features` fields.
4. Run `app inspect --json` and retain its global revision.
5. Dry-run a state mutation with that revision when a preview is useful.
6. Apply the mutation with the same revision.
7. On `revisionConflict`, inspect and reconcile; never retry blindly.
8. Use `app wait` instead of polling when waiting for another visible state change.

## Development

Use two terminals:

```powershell
# Terminal A
npm run desktop

# Terminal B
npm run desktop:control -- inspect --json
npm run desktop:control -- capabilities --json
npm run desktop:control -- workspace apply layout.json --json --expected-revision 4
```

`desktop:control` selects the development app identity and adds the `plvs-cli app` prefix. It
controls only an already-running development app.

`npm run` prints its own banner, so use `--silent` or call the wrapper directly when stdout must be
parseable JSON:

```powershell
cmd /d /s /c "npm run --silent desktop:control -- inspect --json > inspect.json"
cmd /d /s /c "node scripts/run-desktop-control.mjs inspect --json > inspect.json"
```

The repository's release smoke and soak checks use a feature-gated internal capture harness. That
harness is not installed, advertised, or part of the public CLI.

For installed Windows validation:

```powershell
npm run desktop:release-nsis
npm run desktop:verify-windows-installer
```
