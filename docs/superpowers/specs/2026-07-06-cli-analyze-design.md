# PLVS CLI Analyze - Design

## Problem

Agents can now run `plvs-cli doctor --json`, but they still cannot ask an installed PLVS build to analyze a local media file without opening the desktop UI. File mode already decodes media through the bundled FFmpeg sidecars and computes whole-file delivery metrics in Rust. The CLI should expose that same core path as a stable, non-UI command.

## Goals

- Add `plvs-cli analyze <path> --json`.
- Reuse the existing Rust file-analysis decode and metering pipeline.
- Return one complete machine-readable JSON report on stdout.
- Keep the command non-interactive and independent of Tauri windows, channels, and events.
- Keep the first slice summary-only: probe metadata, decoded frame count, and final delivery metrics.
- Convert non-finite metric values to `null` in CLI JSON.

## Non-Goals

- Do not write report files in this slice.
- Do not persist analysis sessions or history.
- Do not stream progress or meter frames to stdout.
- Do not expose waveform, spectrum, spectrogram, vectorscope, or full history data.
- Do not add audio-track selection flags yet; use the same first-audio-track selection as file mode.
- Do not add human-readable output yet.

## Command

```powershell
plvs-cli analyze "C:\media\mix.wav" --json
```

Only JSON output is supported in this slice. `analyze` without `--json`, missing paths, unknown flags, and extra positional arguments are invalid CLI usage.

## JSON Contract

Success:

```json
{
  "schemaVersion": 1,
  "command": "analyze",
  "status": "ok",
  "app": {
    "name": "PLVS",
    "version": "0.6.4"
  },
  "source": {
    "path": "C:\\media\\mix.wav",
    "fileName": "mix.wav",
    "container": "wav",
    "durationMs": 10000,
    "selectedTrack": {
      "index": 0,
      "codec": "pcm_s16le",
      "sampleRateHz": 48000,
      "channels": 2,
      "language": null
    }
  },
  "analysis": {
    "decodedFrames": 480000,
    "dialogue": {
      "enabled": false,
      "engine": null
    }
  },
  "summary": {
    "durationMs": 10000,
    "sampleRateHz": 48000,
    "channelCount": 2,
    "integratedLufs": -16.2,
    "lra": 4.1,
    "mMaxLufs": -13.5,
    "stMaxLufs": -14.0,
    "truePeakMaxDbtp": -1.0,
    "samplePeakMaxLDb": -1.2,
    "samplePeakMaxRDb": -1.3,
    "samplePeakMaxDb": -1.2,
    "dialogueIntegratedLufs": null,
    "dialogueLra": null
  }
}
```

Error:

```json
{
  "schemaVersion": 1,
  "command": "analyze",
  "status": "error",
  "app": {
    "name": "PLVS",
    "version": "0.6.4"
  },
  "source": {
    "path": "C:\\media\\missing.wav"
  },
  "error": {
    "message": "Unsupported or unreadable media file"
  }
}
```

## Exit Codes

- `0`: analysis completed and stdout contains a success JSON report.
- `1`: analysis ran and stdout contains an error JSON report.
- `2`: invalid CLI usage or an internal CLI failure before a valid JSON report could be produced.

## Architecture

Add a small public CLI-facing module:

```text
src-tauri/src/cli_analyze.rs
  Builds the CLI JSON report and sanitizes metrics.

src-tauri/src/file_analysis/session.rs
  Exposes a reusable summary-only analysis function around the existing analyze_file_core().

src-tauri/src/bin/plvs-cli.rs
  Parses analyze arguments, prints JSON, and maps status to exit codes.
```

The desktop app continues to use `file_analysis_start` / `file_analysis_stop` through `src/ipc/`. The CLI should not construct Tauri channels or emit Tauri events.

## Future Extensions

- `--output <path>` to write the same report to disk.
- Human-readable `plvs-cli analyze <path>` output.
- Track-selection flags after file-mode track selection is designed.
- Optional progress streaming with newline-delimited JSON.
- MCP tools backed by `plvs-cli analyze --json`.
