# PLVS CLI

PLVS installs `plvs-cli` for diagnosis and automation of the running desktop app. Commands are
organized directly by the product resource or operation they address:

```text
plvs-cli doctor
plvs-cli schema list --json
plvs-cli schema get app.inspect --json
plvs-cli inspect
plvs-cli panel ...
plvs-cli transport ...
plvs-cli device ...
```

`doctor` and `schema list/get` work when PLVS is closed or Agent Control is disabled. Every
running-app command controls or inspects the same state visible in an already-running PLVS window.
Those commands require Agent Control to be enabled in Settings and are available on Windows and
macOS. Individual native capabilities may still be platform-specific. The CLI never starts PLVS
implicitly or edits its store behind the running app.

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

PLVS does not edit shell startup files or install symlinks on macOS. Full-path invocation always
works; adding the bundled CLI to `PATH` is an optional user-owned setup step.

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
plvs-cli schema list --json
plvs-cli schema get <command-id> --json
plvs-cli completion <powershell|bash|zsh>
plvs-cli <command> [options]
plvs-cli --help
plvs-cli --version
```

Use `plvs-cli --help` for the command families. The generated
[command catalog](agent-control/generated/commands.md) is the complete static reference for CLI
paths, options, policies, and top-level wire parameters. The current families are:

- `inspect`, `capabilities`, `measurement`, `view`, `visual`, and `wait`;
- `module`, `workspace`, `panel`, and `axis`;
- `preset` and `settings`;
- `theme` and `loudness-profile`;
- `config`;
- `transport`, `device`, and `dock`.

## Shell Completion

`completion` works offline and prints a script generated from the same checked command manifest as
the parser and command catalog. PLVS does not modify shell profiles. Load the output from your own
profile, for example:

```powershell
plvs-cli completion powershell | Out-String | Invoke-Expression
```

```bash
source <(plvs-cli completion bash)
```

```zsh
source <(plvs-cli completion zsh)
```

Completion is intentionally static: it covers command paths, options, and declared enum values,
but does not contact the running app to suggest live IDs.

### Offline command schema

`schema list` returns a compact ordered catalog; `schema get` returns one full manifest entry:

```powershell
plvs-cli schema list --json
plvs-cli schema get visual.recording.start --json
```

These commands describe the installed CLI and never contact PLVS, so they work with PLVS closed,
Agent Control disabled, a different running app version, and on platforms without live-control
transport. An unknown command ID or option returns `invalidArguments` and exit `3`.

Static schema, runtime capabilities, and dynamic descriptions answer different questions:

1. `schema` reports syntax and structural input known by the installed CLI.
2. `capabilities` reports methods and feature availability accepted by the running app.
3. Family `describe` commands report current resources, choices, limits, and effective state.

`appVersion` and `cliVersion` in capabilities are independent build identities and may differ.

The library families share one shape:

```powershell
plvs-cli <preset|theme|loudness-profile> list --json
plvs-cli <preset|theme|loudness-profile> export <--all|--ids <id,...>> --json [--out <file>]
plvs-cli <preset|theme|loudness-profile> import <file|-> --json --expected-revision <n> [--dry-run]
```

Measurement Control reads the latest unscrumbed LIVE semantic sample:

```powershell
plvs-cli measurement describe --json
plvs-cli measurement inspect --json
plvs-cli measurement wait --after-generation <n> [--after-sequence <n>] [--timeout-ms <n>] --json
plvs-cli measurement wait-until <file|-> [--timeout-ms <n>] --json
```

These commands never start capture or optional analysis and do not expose File results, history,
or raw visual data. See [Measurement Control](agent-control/measurements.md) for freshness, null
reasons, profile evaluation, and revision behavior, and
[Measurement Wait](agent-control/measurement-wait.md) for identity waits, bounded predicates, hold
durations, and timeout semantics.

View Control reads and changes the persistent working-view scene:

```powershell
plvs-cli view describe --json
plvs-cli view inspect --json
plvs-cli view update <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli view reset --expected-revision <n> --json [--dry-run]
```

It covers Always on Top (`pinned`), Focus View, panel opacity, and macOS Glass. See
[View Control](agent-control/view.md) for strict patch validation, platform availability, Dock
suspension, and native rollback behavior.

Visual Capture saves the actual rendered pixels of the running app. Screenshots and recording are
available on Windows and macOS:

```powershell
plvs-cli visual describe --json
plvs-cli visual screenshot --target <main|workspace|panel|dock-header|dock-editor> [--panel-id <id>] [--expected-revision <n>] --out <file.png> --json
plvs-cli visual recording start --target <main|workspace> [--audio <none|measured-source>] [--cursor <none|visible>] [--fps <15|30|60>] [--max-duration-seconds <1..1800>] [--expected-revision <n>] --json
plvs-cli visual recording inspect <recording-id> --json
plvs-cli visual recording wait <recording-id> [--timeout-ms <100..300000>] [--out <file.mp4>] --json
plvs-cli visual recording stop <recording-id> [--out <file.mp4>] --json
```

Live recordings default to the measured source; File recordings default to `none`, and an explicit
File `measured-source` request fails. Recording output is finalized by `wait` or `stop`, not
`start`. See [Visual Capture](agent-control/visual.md) for target meaning, revision correlation,
audio gaps, lifecycle, limits, retention, output-file behavior, and stable errors.

`preset list` predates them and belongs to Preset Control; `preset export` and `preset import` are
Library Transfer. Loudness Profile Control additionally provides:

```powershell
plvs-cli loudness-profile describe <id> --json
plvs-cli loudness-profile select <id|off> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile create <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile update <id> <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile rename <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile delete <id> --expected-revision <n> --json [--dry-run]
plvs-cli loudness-profile reorder <file|-> --expected-revision <n> --json [--dry-run]
```

See [Loudness Profile Control](agent-control/loudness-profiles.md) for its document schema, mutation
semantics, and errors. Theme Control provides Appearance and authoring commands:

```powershell
plvs-cli theme inspect --json
plvs-cli theme describe <id> --json
plvs-cli theme select <id> --expected-revision <n> --json [--dry-run]
plvs-cli theme follow-system --expected-revision <n> --json [--dry-run]
plvs-cli theme create <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli theme update <id> <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli theme rename <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli theme duplicate <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli theme delete <id> --expected-revision <n> --json [--dry-run]
plvs-cli theme reorder <file|-> --expected-revision <n> --json [--dry-run]
```

See [Theme Control](agent-control/themes.md) for Theme V2 authoring, built-in permissions, selection
and fallback semantics, revision behavior, and editor blocking.

Everything configuration export uses the same `.plvsconfig` document as Settings:

```powershell
plvs-cli config export --json [--out <file>]
plvs-cli config import <file|-> --expected-revision <n> --json [--dry-run]
```

Configuration import validates or replaces the complete setup. A real import relaunches PLVS only
after the CLI has received its successful response; rediscover the new app session before issuing
another command.

Device Control uses the running app's same device-selection owner:

```powershell
plvs-cli device list --json
plvs-cli device inspect --json
plvs-cli device select <device-id|default> --expected-revision <n> --expected-generation <n> --json [--allow-measurement-restart] [--dry-run]
```

Selection accepts only `default` or an exact ID returned by `device list`. Inventory changes use a
separate generation token and do not advance the global revision. A running Live switch requires
`--allow-measurement-restart`. See [Device Control](agent-control/devices.md) for inventory fields,
Automatic semantics, dry-run, persistence/restart settlement, and copyable workflows.

Detailed payloads and behavior are documented in [Agent Control](agent-control/README.md).

## JSON Contract

`doctor` defaults to concise human-readable output. Running-app mutations, actions, waits, and
queries that write files require `--json`; help does not. Other running-app queries accept either
`--json` or explicit `--format text`. Text mode uses grouped fields and tables for flat collections,
with no ANSI color. In JSON mode, stdout contains exactly one UTF-8 JSON document followed by a
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
report with a required check in `error` state therefore keeps `ok: true` and exits `1`. This is one
of only two documented `ok: true` responses with a nonzero exit code; the other is a library export
whose `--out` file could not be written, described under [Output Files](#output-files).

### Running-app queries and global revision

Every running-app query returns one global `revision`:

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

The revision advances when observable Workspace, Preset, Settings, View, requested Device selection,
Transport, or Dock control state changes. It is an in-process concurrency token and resets when
PLVS restarts. Device inventory generations, meter frames, and other continuously changing
measurements do not advance it. Queries never accept
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
plvs-cli inspect --json
plvs-cli wait --after-revision 44 --timeout-ms 30000 --json
```

`--after-revision` is required. `--timeout-ms` defaults to `30000` and accepts `100` through
`300000`. Wait is a query: it accepts neither `--expected-revision` nor `--dry-run`.

A change returns `outcome: "changed"`, `matchedImmediately`, and the latest `revision`. Timeout is
an error with code `timeout` and exit `5`, not a successful unchanged result.

## Exit Codes

| Code | Class                               | Examples                                                                                |
| ---: | ----------------------------------- | --------------------------------------------------------------------------------------- |
|  `0` | Success                             | Query or mutation completed; healthy or warning-only doctor report                      |
|  `1` | Runtime or system failure           | Native operation failed; output write failed; doctor found a required error             |
|  `2` | App unavailable for control         | App not running; Agent Control disabled; frontend not ready; CLI/host identity mismatch |
|  `3` | Invalid command input               | Unknown command; invalid argument; required revision omitted                            |
|  `4` | Current state refuses the operation | Revision conflict; blocking editor; wait limit reached                                  |
|  `5` | Wait did not complete               | Timeout or cancellation                                                                 |

Under `--json`, every failure that reaches the CLI parser emits the error envelope as well as its
nonzero process exit code. A thin-forwarder failure before the host starts can only report on
stderr and exits `2`.

## Output Files

One flag, two semantics. `doctor --out <file>` **tees**: stdout remains intact and the file receives
the exact same bytes. `<library> export --out <file>`, `config export --out <file>`, and
`transport file report <session-id> --out <file>` **move**: the file receives the pretty-printed
exported document, and `result.pack`, `result.configuration`, or `result.report` is replaced by
`result.out` in the envelope, so stdout does not carry a duplicate. The document and
`out` fields never appear together. With `--report-format markdown`, `transport file report`
moves `result.markdown` instead, and the file receives the Markdown text verbatim rather than
pretty-printed JSON. No other command accepts `--out`; capture its clean JSON stdout
programmatically.

If an exported document cannot be written, the CLI prints one line on stderr and exits `1` while
stdout still carries the full `ok: true` envelope, including `result.pack`,
`result.configuration`, or `result.report` — the swap happens only after the bytes are on disk, so the export is
recoverable from stdout without re-running the command. This is the second of the two documented
`ok: true` responses with a nonzero exit code; the other is an unhealthy doctor report.

In Windows PowerShell 5.1, use `cmd` for byte-preserving redirection because PowerShell's `>`
transcodes native output to UTF-16LE:

```powershell
plvs-cli doctor --json --out doctor.json
plvs-cli theme export --all --json --out themes.plvstheme
plvs-cli config export --json --out plvs-configuration.plvsconfig
plvs-cli transport file report <session-id> --json --out mix-report.json
plvs-cli transport file report <session-id> --json --report-format markdown --out mix-report.md
cmd /d /s /c "plvs-cli inspect --json > inspect.json"
```

## Agent Workflow

1. Discover the installed binary and run `doctor --json`.
2. Ensure PLVS is running and Agent Control is enabled.
3. Run `capabilities --json` and use its stable `methods` and `features` fields.
4. Run `inspect --json` and retain its global revision.
5. Dry-run a state mutation with that revision when a preview is useful.
6. Apply the mutation with the same revision.
7. On `revisionConflict`, inspect and reconcile; never retry blindly.
8. Use `wait` instead of polling when waiting for another visible state change.

## Development

Use two terminals:

```powershell
# Terminal A
npm run desktop

# Terminal B
npm run desktop:control -- inspect --json
npm run desktop:control -- capabilities --json
npm run desktop:control -- measurement inspect --json
npm run desktop:control -- measurement wait --after-generation 0 --timeout-ms 30000 --json
npm run desktop:control -- view inspect --json
npm run desktop:control -- module list --json
npm run desktop:control -- module describe spectrum --json
npm run desktop:control -- workspace apply layout.json --json --expected-revision 4
```

`desktop:control` quietly rebuilds only the independent `src-tauri/plvs-cli` workspace package,
selects the development app identity, and forwards the supplied flat CLI command. It controls only
an already-running development app. If its thin CLI companion finds a stale release-identity host
binary in the shared Cargo target directory, it fails with
`cliHostIdentityMismatch` before parsing or executing the requested command.

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

Desktop build commands use `scripts/build-plvs-cli.mjs` to build the matching identity and stage a
target-triple-named Tauri external binary. Tauri installs it beside the host under the stable public
name `plvs-cli.exe` on Windows or `Contents/MacOS/plvs-cli` on macOS. The installer and DMG smoke
checks execute the installed CLI rather than relying on an unrelated artifact in Cargo's target
directory.
