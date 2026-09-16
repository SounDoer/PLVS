# PLVS CLI Doctor - Design

## Problem

PLVS is becoming useful to agents, but the desktop application binary is optimized for humans: it opens a Tauri window and, on Windows release builds, intentionally does not attach a console. Agents need a stable non-UI entrypoint that can collect runtime health facts and return machine-readable output without launching or scraping the desktop UI.

The first CLI capability should avoid unsettled product areas such as file-analysis session history, saved reports, or analysis result persistence. A runtime doctor command is a smaller and safer first slice because it checks whether an installed PLVS environment can support core app behavior.

## Goals

- Add a console-oriented CLI entrypoint for agents and terminal automation.
- Start with one command: `plvs-cli doctor --json`.
- Report installed-runtime health, not repository or CI health.
- Keep diagnostic logic in a reusable Rust module so future UI and MCP surfaces can call the same implementation.
- Return structured JSON with stable check identifiers, statuses, and details.
- Make directory checks trustworthy by performing real write/delete probes with small temporary files.
- Treat missing FFmpeg/FFprobe sidecars as warnings for the whole app, because live metering can still work while file analysis is impaired.

## Non-Goals

- Do not implement `plvs analyze` in this slice.
- Do not define session, report, or file-analysis history persistence.
- Do not inspect realtime audio devices or microphone permissions.
- Do not add a Settings diagnostics panel.
- Do not implement an MCP server.
- Do not check developer-only repository state such as `package.json` / `Cargo.toml` / `tauri.conf.json` version consistency, formatting, linting, or `npm run check`.
- Do not change the existing desktop `plvs.exe` Windows subsystem just to make it behave like a console app.

## Entry Points

PLVS should keep separate human and automation entrypoints:

| Binary | Audience | Behavior |
| --- | --- | --- |
| `plvs.exe` | Humans | Launches the Tauri desktop UI without a console window on Windows release builds. |
| `plvs-cli.exe` | Agents, support, automation, advanced users | Runs commands and writes machine-readable output to stdout. |

The first command is:

```powershell
plvs-cli doctor --json
```

The first implementation only needs JSON output. Human-readable text output can be added later without changing the JSON contract.

## Architecture

Create a reusable Rust doctor module and a thin CLI binary:

```text
src-tauri/src/doctor.rs
  Collects facts, runs checks, returns DoctorReport.

src-tauri/src/bin/plvs-cli.rs
  Parses CLI arguments, calls doctor::run_doctor(), prints JSON, sets exit code.
```

Future surfaces should reuse `doctor.rs`:

```text
plvs-cli doctor --json
        |
        v
doctor module
        ^
        |
future Settings diagnostics panel
future MCP server
```

The doctor module should avoid depending on a live Tauri `AppHandle` for first-pass checks. This keeps the CLI lightweight and prevents diagnostics from requiring the desktop window/runtime to start.

## JSON Contract

Top-level shape:

```json
{
  "schemaVersion": 1,
  "status": "warning",
  "summary": {
    "ok": 4,
    "warning": 2,
    "error": 0,
    "skipped": 0
  },
  "app": {
    "name": "PLVS",
    "version": "0.6.3",
    "executablePath": "C:\\Program Files\\PLVS\\plvs-cli.exe"
  },
  "platform": {
    "os": "windows",
    "arch": "x86_64"
  },
  "paths": {
    "configDir": "C:\\Users\\user\\AppData\\Roaming\\com.soundoer.plvs",
    "dataDir": "C:\\Users\\user\\AppData\\Local\\com.soundoer.plvs"
  },
  "checks": [
    {
      "id": "config-directory-writable",
      "status": "ok",
      "severity": "error",
      "title": "Configuration directory is writable",
      "details": {
        "path": "C:\\Users\\user\\AppData\\Roaming\\com.soundoer.plvs"
      }
    },
    {
      "id": "ffmpeg-sidecar",
      "status": "warning",
      "severity": "warning",
      "title": "FFmpeg sidecar is unavailable",
      "details": {
        "path": "C:\\Program Files\\PLVS\\ffmpeg.exe",
        "exists": false,
        "runnable": false,
        "fileAnalysisAvailable": false
      }
    }
  ]
}
```

Top-level `status` aggregation:

- `error` if any check has `status: "error"`.
- `warning` if there are no errors and any check has `status: "warning"`.
- `ok` otherwise.
- `skipped` checks are counted but do not affect top-level status.

Allowed check statuses:

- `ok`
- `warning`
- `error`
- `skipped`

Each check should include:

- `id`: stable machine-readable identifier.
- `status`: result for this run.
- `severity`: the status level used when the check fails.
- `title`: concise English human-readable summary.
- `details`: structured evidence for agents and support workflows.

## First Checks

### `app-info`

Collect:

- app name: `PLVS`
- package version from Rust package metadata
- current executable path

This is informational and should normally be `ok`.

### `platform-info`

Collect:

- OS family
- architecture

This is informational and should normally be `ok`.

### `config-directory-writable`

Resolve the installed app configuration directory and verify it is writable by creating and deleting a small temporary file.

Failure status: `error`.

Rationale: settings, workspace state, presets, themes, and Rust-owned sibling keys depend on writable app configuration storage.

### `data-directory-writable`

Resolve the installed app data/cache/log-related directory and verify it is writable by creating and deleting a small temporary file.

Failure status: `error`.

Rationale: diagnostics should catch environments where PLVS cannot persist runtime data or support files.

### `ffmpeg-sidecar`

Use the existing sidecar location rules to find `ffmpeg` next to the running executable, honoring `PLVS_FFMPEG_DIR` as the existing dev/test escape hatch. Check existence and attempt to run a lightweight version command.

Failure status: `warning`.

Rationale: file analysis is impaired, but live metering may still work.

### `ffprobe-sidecar`

Use the same sidecar location rules for `ffprobe`. Check existence and attempt to run a lightweight version command.

Failure status: `warning`.

Rationale: file probing and file analysis are impaired, but live metering may still work.

## Exit Codes

- `0`: the doctor command ran successfully and the report status is `ok` or `warning`.
- `1`: the doctor command ran successfully and the report status is `error`.
- `2`: the CLI failed before producing a valid report, such as invalid arguments or an internal serialization failure.

Warnings should not make the process fail. Agents should read both the exit code and the JSON report.

## Packaging Notes

The intended installed layout should include:

```text
plvs.exe
plvs-cli.exe
ffmpeg.exe
ffprobe.exe
```

The first implementation may require explicit Tauri bundler or installer work to include the CLI binary next to the desktop binary. The current FFmpeg/FFprobe sidecar layout already matches the existing `locate_sidecar()` behavior, which expects sidecars next to the running executable after packaging.

PATH integration is optional follow-up work. Without PATH integration, agents can call the full installed path to `plvs-cli.exe`. With PATH integration, agents can call `plvs-cli doctor --json` from any working directory.

## Future Extensions

- Human-readable `plvs-cli doctor` output.
- A Settings diagnostics panel that calls the same doctor module.
- MCP tools backed by `plvs-cli doctor --json`.
- Audio device checks once realtime permission/platform behavior is deliberately scoped.
- `plvs analyze` after file-analysis session/report/persistence semantics are settled.
- Optional launcher or wrapper work that makes a user-facing command feel closer to `plvs doctor --json` without compromising the desktop app binary behavior.
