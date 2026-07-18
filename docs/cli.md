# PLVS CLI

PLVS ships an installed command-line companion named `plvs-cli`. It is meant for agents, support workflows, and terminal automation that need PLVS analysis without opening the desktop UI.

The CLI is read-only. It does not route, process, or modify audio.

## Install Location

Installed builds place the CLI next to the desktop app binary.

Windows:

```powershell
$env:LOCALAPPDATA\PLVS\plvs-cli.exe
```

macOS:

```bash
/Applications/PLVS.app/Contents/MacOS/plvs-cli
~/Applications/PLVS.app/Contents/MacOS/plvs-cli
```

When PATH setup is enabled from Settings on Windows, a fresh terminal can also run:

```powershell
plvs-cli --help
```

Portable builds may require calling the executable by its full path.

## Agent Discovery

Agents should not assume `plvs-cli` is on `PATH`. Use this discovery order:

1. Try `plvs-cli` from `PATH`.
2. On Windows, read the installed CLI record:

```powershell
$plvs = Get-ItemProperty HKCU:\Software\SounDoer\PLVS -ErrorAction SilentlyContinue
& $plvs.CliPath doctor --json
```

3. On Windows, fall back to the default install path:

```powershell
& "$env:LOCALAPPDATA\PLVS\plvs-cli.exe" doctor --json
```

4. On macOS, inspect the app bundle manifest:

```bash
cat /Applications/PLVS.app/Contents/Resources/plvs-agent.json
/Applications/PLVS.app/Contents/MacOS/plvs-cli doctor --json
```

5. On macOS, fall back to the user Applications folder:

```bash
~/Applications/PLVS.app/Contents/MacOS/plvs-cli doctor --json
```

Always run `doctor --json` first to verify that the installed runtime and sidecars are usable.

## Commands

```powershell
plvs-cli doctor [--json] [--out <file>]
plvs-cli probe <path> --json [--out <file>]
plvs-cli analyze <path> [--json] [--track <index>] [--target-lufs <n> --lufs-tolerance <n>] [--max-true-peak <n>] [--out <file>]
plvs-cli analyze-batch <paths...> --json [--concurrency <n>] [--out <file>]
plvs-cli analyze-batch --manifest <file.json> --json [--concurrency <n>] [--out <file>]
plvs-cli devices --json [--out <file>]
plvs-cli report <analysis.json> --format markdown [--out <file>]
plvs-cli capture [--device <substring|stable-id>] --seconds <n> [--every <n>] --json [--out <file>]
```

Use `plvs-cli --help`, `plvs-cli help`, or `plvs-cli <command> --help` for the installed command reference.

### probe

`probe` reads media metadata without decoding the complete file. Its `source.audioTracks` array lists every audio track with its absolute ffprobe stream index, codec, sample rate, channel count, and language when available.

```powershell
plvs-cli probe "C:\media\movie.mkv" --json
plvs-cli analyze "C:\media\movie.mkv" --track 3 --json
```

`analyze --track` accepts an index returned by `probe`. Without `--track`, analysis keeps the existing behavior and selects the first audio track.

### analyze quality control

Quality control is opt-in and entirely user-defined. PLVS does not write platform delivery targets into the measurement path.

```powershell
plvs-cli analyze mix.wav --target-lufs -14 --lufs-tolerance 1 --max-true-peak -1 --json
```

`--target-lufs` and `--lufs-tolerance` must be supplied together. They accept the measured Integrated LUFS value when it lies within `target ± tolerance`. `--max-true-peak` independently sets a dBTP ceiling.

Without QC options, the report contains `qualityControl.status: "notEvaluated"` and the command does not make a pass/fail claim. With QC options, the status is `pass` or `fail`; a failed or unavailable requested metric returns exit code `1` while preserving the valid measurement report. The top-level analysis `status` remains `ok` because QC failure is not an analysis error.

### devices

`devices --json` lists every capture row the CLI can open, with stable ids (`lb-*` / `cap-*`), labels, kind (`systemOutput` or `input`), default flag, sample rate, channel count, and backend. Use it when a script needs a stable selector instead of guessing a substring.

```powershell
plvs-cli devices --json
plvs-cli capture --device "cap-…" --seconds 10 --json
```

Substring matching remains available for interactive use. Ambiguous substrings are still errors, and a failed substring match still prints the available device labels.

### capture

`capture` measures **live audio from a device**, where `analyze` measures a file. It opens the real capture path the desktop app uses, without a window.

It is unlike the other commands in two ways worth planning around:

- **It blocks for `--seconds` of wall-clock time.** `capture --seconds 10` takes ten seconds. Every other command returns as fast as it can.
- **It holds an audio device open** for that span. Still read-only — it never routes or modifies audio — but a device under exclusive-mode use by another application may refuse to open.

`--device` accepts either a stable id from `devices --json` (`default`, `lb-*`, `cap-*`, or legacy `out:N` / `in:N`) or a case-insensitive substring of the device label that matches exactly one device; omit it for the system default. A substring that matches nothing prints the available devices. A substring matching several devices is an error rather than a guess — virtual cables commonly install as multiple rows (`CABLE Input`, `CABLE Output`, `CABLE In 16ch`), and picking the wrong one silently captures the wrong end of the loop.

```powershell
plvs-cli capture --seconds 10 --json                        # default device
plvs-cli capture --device "CABLE Output" --seconds 10 --json
```

With `--every <n>`, output switches from a single report to **JSONL**: one line every `n` seconds, then the same final report as the non-streaming mode. Use it to see drift over a long run, which a single averaged number would hide.

```powershell
plvs-cli capture --device "CABLE Output" --seconds 14400 --every 10 --json --out soak.jsonl
```

Sample lines carry `t` (whole seconds elapsed), `integratedLufs`, and `droppedChunks`. A sample line is distinguishable from the final report by the presence of `t`. The final summary also includes LRA, Momentary Max, Short-term Max, True Peak Max, and combined/per-channel Sample Peak maxima. Process memory is deliberately absent — sample it externally against the PID if you need it.

Silence reports `null` metrics, not `0`: an all-silent capture has no finite loudness, and non-finite values serialize to `null` as they do in `analyze`.

## Agent Workflow

- Use `doctor --json` first when you need to verify that the installed PLVS runtime and bundled sidecars are usable. Its checks include device enumeration (skipped on hosts with no sound card), bundled dialogue VAD engines, and the CLI capabilities summary for this build.
- Use `probe <path> --json` when you need media metadata or an audio track index without running full analysis.
- Use `devices --json` to discover stable capture ids before automating `capture`.
- Use `analyze <path> --json` for exactly one local media file.
- Use `analyze-batch <paths...> --json` for two or more files.
- Use `analyze-batch --manifest <file.json> --json` when paths are numerous, generated programmatically, or need reproducibility.
- Use `report <analysis.json> --format markdown` when the user asks for a human-readable report, summary, table, or Markdown output.
- Use `capture --seconds <n> --json` when the question is about **live audio on a device** rather than a file — "what level is coming in right now", or verifying that the capture path itself is healthy. Budget `<n>` seconds of wall clock for it.

## JSON First, Markdown Second

`doctor` and `analyze` default to concise human-readable text; add `--json` for their stable machine-readable reports. `probe`, `analyze-batch`, `devices`, and `capture` require `--json`. `report --format markdown` reads JSON produced by `analyze`, `analyze-batch`, or `capture` and renders a human-readable Markdown table.

This split keeps the analysis commands stable for automation while still giving users readable output when needed.

## Output Files

`--out <file>` uses tee semantics: stdout stays intact, and the same JSON or Markdown payload is also written to disk.

Examples:

```powershell
plvs-cli analyze "C:\media\mix.wav" --json --out analysis.json
plvs-cli report analysis.json --format markdown --out report.md
```

For `capture`, the payload `--out` receives depends on the mode: the single report without `--every`, or the whole JSONL stream (samples plus the final report) with it. The file always mirrors what went to stdout.

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
| `1`  | Command produced an error result or a requested QC check failed |
| `2`  | Invalid usage or CLI failure before a valid report             |

For `doctor`, `ok` and `warning` reports exit `0`; an `error` report exits `1`.

## Development

Run the CLI from source with Cargo:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin plvs-cli -- doctor --json
cargo run --manifest-path src-tauri/Cargo.toml --bin plvs-cli -- probe "C:\media\movie.mkv" --json
cargo run --manifest-path src-tauri/Cargo.toml --bin plvs-cli -- analyze "C:\media\mix.wav" --json
cargo run --manifest-path src-tauri/Cargo.toml --bin plvs-cli -- capture --seconds 5 --json
```

Focused CLI tests:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --bin plvs-cli
cargo test --manifest-path src-tauri/Cargo.toml cli_analyze
cargo test --manifest-path src-tauri/Cargo.toml cli_probe
cargo test --manifest-path src-tauri/Cargo.toml cli_devices
cargo test --manifest-path src-tauri/Cargo.toml cli_analyze_batch
cargo test --manifest-path src-tauri/Cargo.toml cli_report
cargo test --manifest-path src-tauri/Cargo.toml cli_capture
```

`capture`'s device-touching code is not unit-tested and cannot be: CI runners have no sound card, so device enumeration returns an empty list and the code path is unreachable. Only the pure parts — substring matching, report shaping, argument parsing — carry tests. Verifying the rest needs real hardware.

For installed Windows validation, build and verify the installer:

```powershell
npm run desktop:release-nsis
npm run desktop:verify-windows-installer
```
