# Visual Capture

Visual Capture lets an agent save the pixels currently rendered by a running PLVS window. It is
available for screenshots on Windows and macOS; recording is currently Windows-only. Screenshots
are PNG files; recordings are H.264 MP4 files with either no audio or the same Live source PCM that
PLVS measures. It does not capture File-analysis audio, microphones, arbitrary system audio, other
windows, or raw canvas/DOM data.

## Commands

```powershell
plvs-cli visual describe --json
plvs-cli visual screenshot --target <main|workspace|panel|dock-header|dock-editor> [--panel-id <id>] [--expected-revision <n>] --out <file.png> --json
plvs-cli visual recording start --target <main|workspace> [--audio <none|measured-source>] [--cursor <none|visible>] [--fps <15|30|60>] [--max-duration-seconds <1..1800>] [--expected-revision <n>] --json
plvs-cli visual recording inspect <recording-id> --json
plvs-cli visual recording wait <recording-id> [--timeout-ms <100..300000>] [--out <file.mp4>] --json
plvs-cli visual recording stop <recording-id> [--out <file.mp4>] --json
```

`visual describe` is the discovery query. It reports platform support, current runtime
availability, formats, codecs, audio sources, cursor modes, frame rates, duration and size limits,
and the current global revision. It creates no capture session or artifact.

## Targets and pixels

- `main` is the complete PLVS main WebView client area, excluding native window chrome.
- `workspace` is the rendered workspace inside the main WebView. It is unavailable in Dock form.
- `panel` is one currently rendered Panel body selected by `--panel-id`; hidden inactive tabs fail.
- `dock-header` and `dock-editor` are the complete client areas of those accessory WebViews. They
  are screenshot-only and must currently exist, be ready, and be visible.

Capture preserves actual rendered pixels. Open menus, PLVS-rendered cursors, hover state, selection
hints, overlays, and the recording indicator remain visible when they intersect the target. There
is no clean-UI mode. Target bounds settle across the font and paint barrier before capture, and
screenshot metadata reports the actual output width and height after device/WebView scaling.

On macOS, screenshots use WebKit's app-owned snapshot path. They do not request Screen Recording
permission and do not include the native title bar, window shadow, desktop, or pixels from another
application behind transparent PLVS content.

Screenshots and recordings do not increment the global revision. Optional `--expected-revision`
is checked after render settlement and before native capture allocation, so a conflict creates no
artifact. Screenshot results include the captured revision and coherent measurement generation
and sequence. Recordings retain `startedRevision`, `currentRevision`, and `endedRevision` as
correlation metadata; they do not lock the app against later mutations.

## Screenshot workflow

```powershell
$state = plvs-cli inspect --json | ConvertFrom-Json
plvs-cli visual screenshot --target workspace --expected-revision $state.result.revision --out .\workspace.png --json
plvs-cli visual screenshot --target panel --panel-id spectrum-2 --out .\spectrum.png --json
```

`--out` is required. The app first creates a private staged PNG, then the CLI copies it to the
caller-relative path and returns metadata with `artifact.out`. A copy failure leaves the staged
artifact intact, but media bytes never appear in JSON.

## Recording workflow

Recording is currently available on Windows only. Only one recording may be active. `start`
returns promptly with a process-local recording ID;
`inspect` returns its latest state; `wait` long-polls for a terminal state; and `stop` requests
bounded drain and finalization. States are `starting`, `recording`, `stopping`, `completed`, and
`failed`. Stop is idempotent for a known ID. A wait timeout is a successful observation with
`outcome: "timeout"` and does not stop the recording.

Start has no `--out`. A terminal `wait` or `stop` copies the finalized artifact:

```powershell
# Explicitly silent recording.
$silent = plvs-cli visual recording start --target main --audio none --max-duration-seconds 10 --json | ConvertFrom-Json
plvs-cli visual recording wait $silent.result.recording.recordingId --timeout-ms 30000 --out .\silent.mp4 --json

# Live defaults to the measured source when --audio is omitted.
$live = plvs-cli visual recording start --target workspace --fps 30 --json | ConvertFrom-Json
plvs-cli visual recording inspect $live.result.recording.recordingId --json
plvs-cli visual recording stop $live.result.recording.recordingId --out .\live.mp4 --json

# The same Live choice can be made explicitly.
plvs-cli visual recording start --target workspace --audio measured-source --json

# Include the system pointer while it is over the captured PLVS window.
plvs-cli visual recording start --target workspace --cursor visible --json
```

The initial target fixes the encoded canvas size. Later target resizing is aspect-fitted with
letterboxing; a temporary target loss holds the last frame, while permanent window loss finalizes
the recording. App mutations remain allowed and visible during recording. The recording indicator
is inside `main` and outside `workspace`.

Frame rate defaults to 30 and accepts 15, 30, or 60. Duration defaults to 60 seconds, accepts 1
through 1800 seconds, and is capped at 30 minutes. The hard artifact limit is 2 GiB. Duration or
size exhaustion performs normal finalization with `durationLimit` or `sizeLimit`.

The system pointer is excluded by default. `--cursor visible` includes it while it is over the
captured PLVS window. This option does not alter PLVS-rendered cursors, hover state, or overlays;
those are ordinary application pixels and are always preserved.

## Audio

`none` creates a video-only MP4 and is always available. When `--audio` is omitted, Live defaults
to `measuredSource` and File defaults to `none`. An explicit `measured-source` start while File is
selected fails with `audioUnavailable`; File decoder PCM is never recorded.

Measured-source audio is the current Live Capture PCM only. Starting while Live is stopped is
allowed and begins with silence. Live stop/restart/device transitions, switching to File, timestamp
gaps, and bounded audio backpressure insert timeline-correct silence while video continues. Video
is the master clock. Output is AAC-LC stereo at 48 kHz and 192 kbit/s; mono is duplicated and
supported multichannel layouts are downmixed. Inspection reports aggregate silent duration and a
bounded interruption history.

## Artifacts and errors

PLVS stages completed artifacts under its identity-specific app-data directory. Development and
release apps therefore do not share artifacts. Files are published atomically with 24-hour
retention, then removed; cleanup also evicts the oldest completed files until staged usage is at most
4 GiB. Active recording temporary files are not evicted. Copying with `--out` does not extend
retention.

Stable Visual Capture errors are:

- `visualUnavailable`, `targetUnavailable`, `panelNotFound`, and `panelNotVisible` for capability
  or semantic-target failures;
- `revisionConflict` and `renderNotSettled` for correlation or paint-settlement failures;
- `captureBusy` and `captureFailed` for screenshot/recording resource and native capture failures;
- `recordingNotFound`, `recordingFailed`, and `audioUnavailable` for lifecycle or audio failures;
- `artifactExpired` and `artifactWriteFailed` for staged-media failures;
- `waitLimitReached` when the shared bounded wait pool is full.

A failure after start includes the recording ID and latest state when known. A failed record keeps
a playable finalized artifact when finalization succeeded. Inspect the known recording before
starting another one blindly.
