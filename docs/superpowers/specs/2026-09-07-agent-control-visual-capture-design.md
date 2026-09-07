# Agent Control Visual Capture — Design

**Date:** 2026-09-07  
**Status:** Approved design contract; implementation pending

## Summary

Add a Windows-first `visual` Agent Control family that lets an agent discover the running app's
capture capabilities, take pixel-faithful screenshots, and asynchronously record the rendered PLVS
surface. The family captures only PLVS-owned WebViews. It does not become a general desktop,
camera, microphone, or arbitrary-window capture API.

Screenshots use WebView2's rendered preview and are cropped from semantic DOM bounds supplied by
the owning frontend. Recordings use Windows Graphics Capture for frames and Media Foundation for
H.264/AAC MP4 encoding. The existing bundled FFmpeg remains audio-decode-only and is not expanded
into a video recorder.

Large media never travels in JSON-RPC. The app writes an artifact into a bounded private staging
area and returns metadata. The CLI copies the completed artifact to `--out` and leaves JSON stdout
small and machine-readable.

## Goals

- Let agents capture what the user-visible PLVS renderer actually painted.
- Provide distinct `main`, `workspace`, and `panel` screenshot targets.
- Record `main` or `workspace` while other Agent Control commands continue to operate.
- Support silent recording and optional audio from the current Live Capture source.
- Keep capture state asynchronous, inspectable, bounded, and recoverable after a CLI process exits.
- Correlate captures with Agent Control revision and measurement generation without treating media
  creation as a workspace mutation.
- Preserve realtime-audio safety and the existing React ownership model.

## Non-goals

- Desktop, monitor, arbitrary-window, webcam, or microphone capture.
- Capturing Windows title bars, shadows, other applications, or content outside PLVS WebViews.
- Audio from File analysis.
- Recording a single panel in the first version.
- Editing, transcoding, trimming, compositing, captions, or GIF export.
- Embedding PNG or MP4 bytes in JSON or base64.
- A headless/offscreen PLVS renderer.
- macOS delivery in the first implementation. The public contract leaves room for it, but platform
  support must be reported dynamically rather than promised ahead of implementation.

## Public commands

The family contains six CLI commands and six matching wire methods:

```powershell
plvs-cli visual describe --json

plvs-cli visual screenshot --target <main|workspace|panel|dock-header|dock-editor> `
  [--panel-id <panel-id>] [--expected-revision <n>] --out <file> --json

plvs-cli visual recording start --target <main|workspace> `
  [--audio <none|measured-source>] [--fps <n>] [--max-duration <seconds>] `
  [--expected-revision <n>] --json

plvs-cli visual recording inspect <recording-id> --json
plvs-cli visual recording wait <recording-id> [--timeout-ms <n>] [--out <file>] --json
plvs-cli visual recording stop <recording-id> [--out <file>] --json
```

| CLI command                | Wire method                |
| -------------------------- | -------------------------- |
| `visual describe`          | `visual.describe`          |
| `visual screenshot`        | `visual.screenshot`        |
| `visual recording start`   | `visual.recording.start`   |
| `visual recording inspect` | `visual.recording.inspect` |
| `visual recording wait`    | `visual.recording.wait`    |
| `visual recording stop`    | `visual.recording.stop`    |

CLI spelling uses `measured-source`; the JSON wire value is `measuredSource`.

## Target model

Wire requests use a discriminated object rather than a selector string:

```json
{ "target": { "kind": "main" } }
{ "target": { "kind": "workspace" } }
{ "target": { "kind": "panel", "panelId": "spectrum-2" } }
{ "target": { "kind": "dockHeader" } }
{ "target": { "kind": "dockEditor" } }
```

Targets have these meanings:

- `main` is the complete current `main` WebView client area. In normal form this includes the app
  header, file summary when visible, workspace, footer, and visible overlays. In Dock form it is the
  compact main meter strip. It excludes native title-bar chrome, window borders, shadows, desktop,
  and other windows.
- `workspace` is only the normal-form region containing the split-tree Panel layout. It excludes
  the app header, file summary, footer, and Dock accessory windows.
- `panel` is the rendered leaf containing the named, currently active Panel instance, including its
  tab/header chrome. A Panel hidden behind another active tab is not rendered and fails rather than
  silently selecting the tab.
- `dockHeader` and `dockEditor` are the complete client areas of those accessory WebViews. They are
  screenshot-only and must currently exist, be ready, and be visible.

The capture is pixel-faithful. Open menus, cursors rendered by PLVS, hover state, selection hints,
and overlays intersecting the target remain visible. The capture path does not temporarily clean up
or mutate the user's UI.

## Capability discovery

`visual.describe` is a read-only dynamic query. An illustrative result is:

```json
{
  "revision": 18,
  "platform": "windows",
  "screenshot": {
    "available": true,
    "targets": ["main", "workspace", "panel", "dockHeader", "dockEditor"],
    "format": "png",
    "maxConcurrent": 1
  },
  "recording": {
    "available": true,
    "targets": ["main", "workspace"],
    "container": "mp4",
    "videoCodec": "h264",
    "audioSources": ["none", "measuredSource"],
    "defaultAudioSource": "none",
    "defaultFps": 30,
    "supportedFps": [15, 30, 60],
    "defaultMaxDurationSeconds": 60,
    "maximumDurationSeconds": 1800,
    "maximumArtifactBytes": 2147483648,
    "maxConcurrent": 1
  },
  "runtime": {
    "windowForm": "normal",
    "sourceMode": "live",
    "availableScreenshotTargets": ["main", "workspace", "panel"],
    "availableAudioSources": ["none", "measuredSource"]
  }
}
```

Static platform support and current runtime availability are deliberately separate. For example,
`workspace` is supported but unavailable while PLVS is in Dock form, and `measuredSource` is not an
available start option while File is the selected source mode. `app.capabilities.methods` advertises
the methods; `visual.describe` supplies formats, limits, and dynamic availability.

The query does not allocate a capture session, write a file, or change revision.

## Screenshot contract

The wire request is:

```json
{
  "target": { "kind": "panel", "panelId": "spectrum-2" },
  "expectedRevision": 18
}
```

`expectedRevision` is optional. When supplied it must match immediately before render settlement;
a stale value fails without creating an artifact. This gives an agent a strict
`inspect/apply -> screenshot` workflow without making every observational screenshot require a
prior inspection.

Before capture, the frontend waits for one bounded render-settlement barrier:

1. the expected revision, if supplied, still matches;
2. `document.fonts.ready` has resolved;
3. the semantic target exists, is visible, intersects the WebView, and has non-zero bounds;
4. its CSS-pixel bounds are stable across two animation frames;
5. visible canvas backing stores match their displayed dimensions;
6. an optional `afterMeasurementGeneration`/`afterMeasurementSequence` baseline, when later added
   to the request, has already been painted rather than merely received.

This is not a promise that live meters stop moving. It identifies the first complete,
correctly-sized painted frame after the requested control state. Settlement has a three-second
internal ceiling and fails explicitly rather than capturing a half-mounted surface.

The frontend supplies the target rectangle, viewport CSS size, and `devicePixelRatio`. Rust derives
the actual image-to-CSS scale from the captured bitmap dimensions before cropping. It must not use
only the monitor scale factor: on Windows, WebView2 text scaling also affects the frontend's pixel
space.

Successful wire output is metadata only:

```json
{
  "revision": 18,
  "measurement": { "generation": 7, "sequence": 412 },
  "artifact": {
    "artifactId": "art-...",
    "kind": "screenshot",
    "mediaType": "image/png",
    "stagedPath": "...",
    "width": 1280,
    "height": 720,
    "bytes": 483921,
    "sha256": "...",
    "createdAt": "2026-09-07T12:00:00Z"
  },
  "target": { "kind": "workspace" }
}
```

`plvs-cli visual screenshot` requires `--out`. After a successful app response, the CLI copies the
staged artifact to the caller-relative destination and replaces `artifact.stagedPath` with
`artifact.out` in its public result. It follows the repository's existing output-file behavior and
may overwrite an existing file. A local copy failure exits 1 while preserving the staged artifact
metadata so the caller can retry without recapturing.

Screenshots do not increment revision, dirty a Preset, persist app state, or clear measurements.

## Recording lifecycle

Recording is asynchronous and process-local. Only one recording may be active at a time.

`visual.recording.start` validates the target and optional expected revision, creates the encoder
and staging file, starts capture, and returns promptly:

```json
{
  "revision": 18,
  "recording": {
    "recordingId": "rec-...",
    "state": "recording",
    "target": { "kind": "workspace" },
    "startedAt": "2026-09-07T12:00:00Z",
    "startedRevision": 18,
    "video": { "width": 1280, "height": 720, "fps": 30, "codec": "h264" },
    "audio": { "source": "measuredSource", "codec": "aac", "sampleRate": 48000, "channels": 2 },
    "limits": { "maxDurationSeconds": 60, "maxArtifactBytes": 2147483648 }
  }
}
```

`--audio` defaults to `none`. `--fps` defaults to 30 and accepts 15, 30, or 60. Maximum duration
defaults to 60 seconds and accepts an integer from 1 through 1800. The hard file limit is 2 GiB.
Whichever limit is reached first initiates a normal finalization and records `stopReason` as
`durationLimit` or `sizeLimit`.

The initial target rectangle fixes the encoded canvas size for the complete recording. If the
window or target later changes size, a frontend `ResizeObserver` publishes new semantic bounds and
the native compositor aspect-fits the current target into the original canvas with letterboxing.
The encoder dimensions never change midstream. If the target becomes temporarily unavailable, the
last frame is held until it returns; a permanent window loss stops and finalizes the recording.

Agent Control mutations remain allowed while recording. Layout, Panel, Axis, Theme, View, Preset,
Transport, and Dock changes are therefore recordable. Normal command revision rules continue to
apply; recording itself does not increment the global revision.

The app displays a visible recording indicator in its normal UI. Because `main` means actual
rendered client pixels, that indicator is included when it lies inside a `main` capture. It is
outside a `workspace` capture. There is no hidden-clean-UI mode in v1.

### Inspect

`visual.recording.inspect` returns immediately with the latest state:

```json
{
  "revision": 21,
  "recording": {
    "recordingId": "rec-...",
    "state": "recording",
    "durationMs": 18420,
    "capturedFrames": 551,
    "droppedFrames": 2,
    "bytes": 17003211,
    "startedRevision": 18,
    "currentRevision": 21,
    "audio": {
      "source": "measuredSource",
      "silentDurationMs": 780,
      "interruptions": []
    }
  }
}
```

Stable states are `starting`, `recording`, `stopping`, `completed`, and `failed`. A completed record
contains the finalized artifact and `endedRevision`. A failed record contains a stable error and
retains a playable finalized artifact when finalization succeeded after the failure.

### Wait

`visual.recording.wait` long-polls until the named recording reaches `completed` or `failed`, or the
timeout expires. `timeoutMs` defaults to 30000 and accepts 100 through 300000. A timeout is a
successful observation with `outcome: "timeout"`; it does not stop the recording.

Wait uses the shared bounded long-wait pool but does not occupy the serialized Agent Control
mutation queue. A completed wait with `--out` copies the finalized staged artifact locally. If the
record is still active or failed without an artifact, `--out` writes nothing.

### Stop

`visual.recording.stop` is idempotent for a known recording. It requests stop, drains the bounded
pipelines, finalizes MP4, hashes the artifact, and returns the terminal state. Calling it for an
already completed or failed recording returns that same terminal state without rewriting media.
The broker gives finalization a dedicated bounded response budget; after a finalization timeout the
record remains inspectable and `wait` is the recovery path.

`--out` has the same CLI-only copy behavior as `wait`. Start deliberately has no `--out`: the CLI
that starts a recording may exit long before automatic finalization, while the app must retain
ownership of the live output file.

## Audio contract

Two audio sources exist:

- `none` writes a video-only MP4 track set and is the default.
- `measuredSource` records only the same current Live Capture PCM source PLVS is measuring. It does
  not add a microphone, mix other system devices, or capture File analysis audio.

Starting `measuredSource` while the selected source mode is File fails with `audioUnavailable`.
Starting it in Live mode while Live Capture is stopped is allowed: the recording begins with
silence and starts receiving audio if Live Capture starts later.

During an active recording:

- Live capture stop/restart/device transition inserts timestamp-correct silence while video
  continues;
- Live-to-File stops audio injection and records silence; File audio is never injected;
- File-to-Live may resume injection when Live Capture becomes ready;
- bounded PCM backpressure drops audio input and replaces the missing interval with silence rather
  than blocking capture or the realtime callback.

The video timeline is the master clock. Captured PCM is timestamped, resampled to 48 kHz, and
encoded as AAC-LC stereo at 192 kbit/s. Mono is duplicated; more than two channels use the existing
channel-layout semantics to produce a documented stereo downmix. Inspection reports total silent
duration and bounded interruption records with reasons such as `liveStopped`, `liveRestart`,
`sourceModeFile`, and `audioBackpressure`.

The PCM tap is strictly downstream of the realtime device callback. The callback may only hand a
preallocated buffer to the existing bounded queue. Copying, downmixing, resampling, timestamp-gap
repair, and encoding happen on ordinary worker threads. No recording path may allocate, lock,
perform file IO, call Media Foundation, or make a syscall from the audio callback.

## Native implementation boundary

On Windows:

- screenshots use WebView2 `CapturePreview` for the selected WebView, followed by lossless PNG crop;
- recordings use Windows Graphics Capture against the `main` HWND, Direct3D surfaces for crop/
  scale/letterbox, and Media Foundation H.264/AAC MP4 output;
- the bundled FFmpeg binaries and their build configuration remain unchanged.

WebView2 preview is preferred for screenshots because it captures the composed DOM, Canvas, SVG,
and WebGL surface without exposing the desktop. Windows Graphics Capture is preferred for sustained
recording because a repeated screenshot loop would add avoidable PNG encode/decode cost and poor
frame pacing.

The platform adapter lives behind a Rust trait with explicit unsupported responses. A future macOS
implementation may use `WKWebView.takeSnapshot` for stills and ScreenCaptureKit/AVFoundation for
recording, including the OS permission flow, without changing the command names or artifact model.

Authoritative platform references:

- [Tauri WebviewWindow platform access](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html)
- [Windows Graphics Capture](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture)
- [WKWebView snapshots](https://developer.apple.com/documentation/webkit/wkwebview/takesnapshot%28with%3Acompletionhandler%3A%29)
- [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)

## Artifact ownership and cleanup

The app owns a private directory under its app-data root:

```text
agent-artifacts/<artifact-id>.<png|mp4>
```

Writes use a temporary sibling and publish the final staged path only after the format is complete.
Artifacts are scoped to the running app identity and never use a caller-provided path. Metadata
includes an opaque ID, kind, media type, absolute staged path, dimensions, byte count, SHA-256,
creation time, and retention deadline.

Completed artifacts are retained for 24 hours. At startup and after finalization, cleanup removes
expired artifacts and then oldest completed artifacts until total staged usage is at most 4 GiB.
An active recording and its temporary file are never selected by ordinary cleanup. Abrupt-process
temporary files are safe to remove on next startup. Copying through `--out` does not extend staging
retention.

The Agent Control JSON-RPC request and response limits remain unchanged. Media bytes never count
toward the one-MiB response limit.

## Concurrency and failure semantics

- At most one screenshot operation and one recording may be active; a second operation of the same
  kind fails with `captureBusy`.
- Screenshot and recording state do not participate in global revision identity.
- `expectedRevision`, when supplied to screenshot or start, is checked after settlement and before
  native capture allocation.
- Recording records `startedRevision`, live `currentRevision`, and final `endedRevision`; revisions
  are correlation metadata, not a lock across the recording.
- Disabling Agent Control prevents new visual commands but does not abandon an active recording.
  The app safely finalizes it and exposes the result only if Agent Control is enabled again before
  retention cleanup.
- App shutdown attempts bounded finalization; an abrupt process exit may leave only a removable
  temporary file.

Initial stable errors are:

- `visualUnavailable` — the platform or runtime lacks the requested family capability;
- `targetUnavailable` — a supported target is not currently mounted, ready, visible, or capturable;
- `panelNotFound` — the Panel ID does not exist;
- `panelNotVisible` — the Panel exists but is behind an inactive tab or otherwise not rendered;
- `revisionConflict` — optional expected revision is stale;
- `renderNotSettled` — the semantic target did not reach the bounded paint barrier;
- `captureBusy` — the per-kind concurrency limit is reached;
- `captureFailed` — native still capture or crop failed without a completed artifact;
- `recordingNotFound` — the process-local recording ID is unknown;
- `audioUnavailable` — `measuredSource` was requested while File is selected or unsupported;
- `recordingFailed` — capture/encode/finalization failed; details state whether an artifact exists;
- `artifactExpired` — the record is known but its staged file has passed retention or disappeared;
- `artifactWriteFailed` — the app could not create or finalize its private staged artifact;
- `waitLimitReached` — the shared long-wait pool is full.

Failures after a recording starts return the recording ID and terminal/latest state when known.
Callers inspect rather than starting another recording blindly.

## Security and privacy

- Targets are a closed semantic enum. No HWND, monitor ID, DOM selector, URL, or filesystem path is
  accepted over the wire.
- Only PLVS-created WebViews are resolved internally by stable window label.
- Agent Control's existing current-user pipe ACL, launch token, enable switch, request bounds, and
  activity visibility remain mandatory.
- The default is silent recording. Microphone and arbitrary system-audio options do not exist.
- An active recording is visibly indicated to the user and stops safely when its source window is
  destroyed.

## Acceptance criteria

- All six methods appear in capabilities, root/family help, parser tests, and public documentation.
- `visual.describe` truthfully separates platform support from current runtime availability.
- Every screenshot target captures the exact intended WebView region at 100%, 125%, 150%, and 200%
  Windows scaling without off-by-one seams or unintended native/desktop pixels.
- Panel screenshots reject missing and inactive-tab Panels without changing the workspace.
- Expected-revision conflict creates no artifact.
- Screenshot and recording results contain metadata only; neither response can exceed the existing
  bound due to media content.
- Recording start is asynchronous; inspect, unrelated mutations, and long-poll wait remain usable.
- Resize preserves fixed encoder dimensions and aspect ratio.
- Automatic duration/size stop and explicit stop produce a playable, hashed MP4.
- `none` produces no audio track; `measuredSource` contains Live PCM, never File PCM, and reports
  silence/interruption accounting.
- Callback-reachable source retains the no-allocation/no-lock/no-syscall guard, capture smoke passes,
  and a real soak is completed after the audio tap work.
- Artifact retention and startup cleanup never delete an active recording or caller `--out` file.
- `npm run check` and real Windows WebView/recording verification pass.

## Locked decisions

1. The family has exactly the six commands listed above in v1.
2. Screenshots support `main`, `workspace`, `panel`, `dockHeader`, and `dockEditor`; recordings
   support only `main` and `workspace`.
3. Capture means actual rendered PLVS pixels, not a sanitized or reconstructed presentation.
4. Windows ships first. Unsupported platforms report capabilities rather than accepting a request
   and failing late.
5. PNG is the only still format; H.264 MP4 is the only video format in v1.
6. Audio defaults to `none`; `measuredSource` is optional and Live-only. File analysis is always
   audio-none.
7. Default recording duration is 60 seconds, hard maximum is 30 minutes, and hard artifact limit is
   2 GiB.
8. Media is staged by the app and copied by the CLI. It never travels in JSON.
9. Recording start has no `--out`; terminal `wait` and `stop` materialize the staged artifact.
10. The existing trimmed FFmpeg sidecars are not expanded for this feature.
