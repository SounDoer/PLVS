# PLVS CLI

PLVS ships an installed command-line companion named `plvs-cli`. It is meant for agents, support workflows, and terminal automation that need PLVS analysis without opening the desktop UI.

The CLI is read-only. It does not route, process, or modify audio.

## Install Location

Windows installer builds place `plvs-cli.exe` next to the desktop app binary and add the install directory to the current user's `PATH`, so a fresh terminal can run:

```powershell
plvs-cli --help
```

Portable builds may require calling the executable by its full path.

## Commands

```powershell
plvs-cli doctor --json [--out <file>]
plvs-cli analyze <path> --json [--out <file>]
plvs-cli analyze-batch <paths...> --json [--concurrency <n>] [--out <file>]
plvs-cli analyze-batch --manifest <file.json> --json [--concurrency <n>] [--out <file>]
plvs-cli report <analysis.json> --format markdown [--out <file>]
```

Use `plvs-cli --help`, `plvs-cli help`, or `plvs-cli <command> --help` for the installed command reference.

## Agent Workflow

- Use `doctor --json` first when you need to verify that the installed PLVS runtime and bundled sidecars are usable.
- Use `analyze <path> --json` for exactly one local media file.
- Use `analyze-batch <paths...> --json` for two or more files.
- Use `analyze-batch --manifest <file.json> --json` when paths are numerous, generated programmatically, or need reproducibility.
- Use `report <analysis.json> --format markdown` when the user asks for a human-readable report, summary, table, or Markdown output.

## JSON First, Markdown Second

`doctor`, `analyze`, and `analyze-batch` currently produce machine-readable JSON. `report --format markdown` reads JSON produced by `analyze` or `analyze-batch` and renders a human-readable Markdown table.

This split keeps the analysis commands stable for automation while still giving users readable output when needed.

## Output Files

`--out <file>` uses tee semantics: stdout stays intact, and the same JSON or Markdown payload is also written to disk.

Examples:

```powershell
plvs-cli analyze "C:\media\mix.wav" --json --out analysis.json
plvs-cli report analysis.json --format markdown --out report.md
```

## Batch Manifests

Manifest input is a JSON file with a `files` array:

```json
{
  "files": ["C:\\media\\a.wav", "C:\\media\\b.wav"]
}
```

Do not mix positional paths with `--manifest`. Batch results preserve input order. `--concurrency` defaults to `2` and accepts values from `1` through `8`.

## Exit Codes

| Code | Meaning                                                        |
| ---- | -------------------------------------------------------------- |
| `0`  | Success                                                        |
| `1`  | Command completed and produced an analysis/report error result |
| `2`  | Invalid usage or CLI failure before a valid report             |

For `doctor`, `ok` and `warning` reports exit `0`; an `error` report exits `1`.

## Development

Run the CLI from source with Cargo:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin plvs-cli -- doctor --json
cargo run --manifest-path src-tauri/Cargo.toml --bin plvs-cli -- analyze "C:\media\mix.wav" --json
```

Focused CLI tests:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --bin plvs-cli
cargo test --manifest-path src-tauri/Cargo.toml cli_analyze
cargo test --manifest-path src-tauri/Cargo.toml cli_analyze_batch
cargo test --manifest-path src-tauri/Cargo.toml cli_report
```

For installed Windows validation, build and verify the installer:

```powershell
npm run desktop:release-nsis
npm run desktop:verify-windows-installer
```
