# File Analysis Mode

**Date:** 2026-06-22
**Status:** Draft

## Summary

Add a first-class `File` source mode beside the existing realtime `Live`
monitoring mode. In `File` mode, users can drag a local media file into PLVS, or
choose one through a picker, and run a fast local analysis without routing,
processing, uploading, or playing the source audio.

The first version should provide both:

- a whole-file summary for delivery checks, including integrated loudness, LRA,
  true peak max, sample peak max, duration, sample rate, channel count, and
  selected audio track metadata;
- the existing meter panels and history scrub experience, fed by the same
  `AudioFramePayload` shape used by realtime monitoring.

`Live` and `File` are mutually exclusive active sources. PLVS should never run
system capture and file analysis at the same time in this slice.

## Motivation

The current product is optimized for long-running realtime monitoring, but sound
design and mix workflows also include quick checks of local deliverables:

```txt
drop final_mix.wav -> confirm integrated LUFS and true peak
drop cutscene.mov -> confirm the first audio track is not clipping
drop reference.mp4 -> inspect loudness, spectrum, and stereo image quickly
```

This is still read-only metering. The app does not edit, route, encode, render,
or play the file. It only decodes local audio samples, runs the existing DSP, and
shows measurement results.

This changes the current PRD boundary. `docs/prd.md` currently lists offline
audio file analysis as a non-goal unless the PRD is revised. This spec is the
design basis for that revision: local file analysis becomes an explicit read-only
source mode, not a replacement for realtime monitoring.

## Current Model

Today PLVS has one active engine path:

```txt
cpal / Core Audio tap
  -> PCM chunks
  -> MeterPipeline
  -> AudioFramePayload Channel
  -> FrameIntake
  -> AudioDataContext
  -> panels and snapshot scrub
```

Frontend engine lifecycle is centered in `src/App.jsx` and
`src/hooks/useAudioEngine.js`. Rust control commands are declared in
`src-tauri/src/ipc/commands.rs` and wrapped by `src/ipc/commands.js`. UI code
must keep using the `src/ipc/` boundary instead of invoking Tauri commands
directly.

The current `MeterPipeline` is reusable, but it assumes realtime wall-clock
cadence:

- frame emission is throttled around 60 Hz;
- history and visual ticks are paced by `Instant`;
- `timestamp_ms` is session elapsed wall time;
- frame backpressure is tied to UI acks for a live stream.

File analysis needs media-time timestamps and bounded UI emission while the
decode worker may scan faster than realtime.

## Target Product Model

Replace the current separate left status pill and transport button with a
source-aware transport cluster. The cluster is the single place where the header
shows the active source, the current session identity or time, and the primary
action.

```txt
[ Source | Status ] [ Primary Action ]
```

The source segment is clickable and opens a small source menu:

```txt
Source
* Live    System playback / input monitoring
  File    Analyze a local audio or video file
```

The right-side toolbar icons should not be redesigned in the first UI slice.
`Devices`, `Clear`, workspace, preset, focus, and settings controls keep their
current placement unless a later implementation detail proves that a specific
button must be disabled or hidden in file mode.

### Live Mode

`Live` keeps the existing behavior:

- START begins system output or physical input monitoring;
- STOP ends realtime capture;
- LIVE returns from a scrubbed history point to the live stream;
- the device picker remains visible and meaningful;
- existing tray and shortcut behavior continue to target live monitoring unless
  a later spec extends them for file mode.

Live transport states:

```txt
not started: [ Live v | Ready ] [ START ]
capturing:   [ Live v | 00:12 ] [ STOP  ]
scrubbed:    [ Live v | 00:08 ] [ LIVE  ]
```

In the scrubbed state, the time shown in the cluster is the selected history
time, not the current capture session timer. The cluster does not show the word
`Snapshot`; the `LIVE` action and visual state are enough to communicate that the
view is not following the latest live input.

### File Mode

`File` is a separate source mode:

- the primary way to choose a file is a native file picker opened by the
  `ANALYZE` action through the `@tauri-apps/plugin-dialog` `open()` wrapper;
- users may also drag a supported local file onto the window, but only while
  `File` mode is already active (see source switching rules below);
- choosing or dropping a file clears the current file session history and starts
  a new file analysis session;
- the transport can stop an in-progress file analysis;
- after completion, panels remain populated with the completed file session so
  users can scrub history snapshots;
- choosing `Live` while file analysis is active stops the file session before
  returning to live controls.

File transport states:

```txt
empty:       [ File v | Drop file ]       [ ANALYZE   ]
ready:       [ File v | final_mix.wav ]   [ ANALYZE   ]
analyzing:   [ File v | final_mix.wav 42% ] [ STOP    ]
complete:    [ File v | final_mix.wav Done ] [ REANALYZE ]
scrubbed:    [ File v | 01:24 ]          [ RESULT    ]
```

`ANALYZE` opens the file picker when no file is selected. When a file is already
selected, it starts analysis for that file. `REANALYZE` clears the completed file
session and runs the same file again. `STOP` cancels the in-progress offline
analysis; it does not imply media playback. `RESULT` exits the scrubbed history
point and returns to the completed file result.

In the scrubbed state, the time shown in the cluster is the selected file media
time. The cluster does not show the word `Snapshot`.

OS file drops are only handled while `File` mode is active. In `Live` mode the
window ignores OS file drags entirely. To analyze a file, the user must first
switch the source to `File` through the source menu. That manual switch is the
single, deliberate transition point: if `Live` capture is running when the user
switches to `File`, capture stops and local meter state resets as part of the
switch. There is no drop-while-live confirmation dialog, because dropping a file
can no longer trigger a surprising source change.

Switching sources does not restore hidden prior sessions in the first version.
If users leave an active or completed file session for `Live`, the file session
is stopped or cleared through an explicit transition. Switching from `Live` to
`File` stops live capture as part of the manual switch.

## Supported Inputs

The first version should support common audio files and common video containers
when they contain a supported audio track:

- audio-oriented files: WAV, AIFF, FLAC, MP3;
- video/container files: MP4, M4V, MKV, WebM;
- audio codecs should be limited to codecs supported by the chosen Rust decode
  stack, expected to include PCM, FLAC, MP3, AAC, ALAC, Vorbis, and Opus where
  the container support is enabled.

Use a Rust audio demux/decode library such as `symphonia` rather than decoding
in the browser. This keeps metering in the Rust engine and avoids adding FFmpeg
as a first-version dependency. PLVS does not decode video frames; for video
files, it only extracts an audio track.

The backend always receives an absolute local path. The file picker uses the
`@tauri-apps/plugin-dialog` `open()` wrapper, which returns a real path. Drag and
drop uses the Tauri webview drag-drop event (`onDragDropEvent`), whose payload
carries dropped file `paths`. The browser HTML5 drop `dataTransfer.files[...]`
must not be relied on for a filesystem path, because the webview does not expose
absolute paths there.

For a media file with multiple audio tracks, the first version automatically
selects the first decodable audio track. The UI must show enough metadata for the
choice to be visible, such as track index, codec, sample rate, channel count, and
language if available. Manual audio-track selection is a future enhancement.

Unsupported containers, unsupported codecs, files without audio tracks, encrypted
media, and corrupt files must fail visibly with an actionable message.

## Backend Design

Introduce a `FileAnalysisSession` as a sibling to the realtime capture session.
It should not reuse the live capture trait directly if that would force
realtime-only assumptions into file mode. The shared abstraction should be lower:
decoded interleaved `f32` PCM chunks feeding `MeterPipeline`.

The file session owns a worker thread or task that:

1. opens the local path and probes the container once;
2. selects the audio track using the same shared track-selection rule as the
   standalone probe command, so the worker and the metadata probe never select
   different tracks;
3. decodes packets into sample buffers;
4. converts samples into interleaved `f32` PCM;
5. feeds chunks into `MeterPipeline` with the current analysis requests,
   loudness weights, and dialogue gating setting captured once at worker start;
6. emits throttled UI frames, real progress events, completion events carrying
   authoritative summary metrics, and errors;
7. responds to cancellation without leaving stale subscribers or stale engine
   state.

Track selection must be a single shared function (for example
`select_first_decodable_track`). The worker selects by the index that function
returns rather than re-implementing a different "first non-null codec" rule,
because a non-null video track can otherwise be selected and fail to decode on a
container that the probe accepted.

The configuration the worker reads (analysis requests, loudness weights,
dialogue gating) is snapshotted once when the worker starts. Changing a panel
chip during an in-progress file analysis does not retune the current run; it
takes effect on the next analysis (for example `REANALYZE`). This is acceptable
because file analysis completes quickly.

The worker may scan faster than realtime. UI frames must still be bounded so
React is not flooded, while panel history must still be filled at fine
resolution. To get both, the worker/pipeline path emits frames on a wall-clock
throttle (matching the live cadence), but each emitted frame carries a batch of
all the fine-grained history ticks accumulated in that window (see
[History And Frame Batching](#history-and-frame-batching)).

Whole-file summary metrics must be derived from the complete pipeline state, not
from the subset of frames emitted for UI display. The completion event carries an
authoritative summary payload read from the pipeline's final state.

## Time And History Semantics

File mode timestamps represent media time, not wall-clock time. A frame for the
middle of a three-minute file should carry a timestamp around `90000`, even if
analysis reached it in a few seconds.

This requires extending the pipeline path used by file analysis so frame,
history, and visual ticks can be emitted against media time. The live path can
keep using wall-clock `Instant`.

Note on time-based DSP smoothing: some DSP state (Spectrum temporal smoothing,
peak-hold decay) is driven by wall-clock `now_sec`, not by media time. In file
mode the worker scans faster than realtime, so these visual decays do not track
media time and will look "frozen"/under-decayed during scrub. This is acceptable
for the first version because it only affects visual smoothing, not authoritative
metrics: integrated loudness, LRA, and true/sample peak are sample-driven and
remain correct regardless of decode speed. The media-time slice should document
this boundary explicitly rather than try to retime `now_sec`.

History should remain bounded. The first version should keep the current
frontend history contract stable, but it should not promise sample-perfect,
unbounded full-file visualization for arbitrarily long files. Summary metrics
are the authoritative whole-file results. Panel history is an inspectable,
session view bounded by the existing frontend history caps; for files longer
than those caps, scrub covers the most recent window, not the whole file.

### History And Frame Batching

File analysis must not flood the UI with one frame per decoded packet, and must
not throttle away history points (which would make Spectrum/Vectorscope scrub
coarse). The chosen model decouples UI frame rate from history resolution:

- the pipeline keeps generating loudness and visual history ticks at full,
  fine media-time resolution;
- UI frames are still emitted on a wall-clock throttle (the live cadence), so the
  number of frames crossing the IPC channel stays bounded regardless of decode
  speed;
- each emitted frame carries a batch (a list) of all the history ticks
  accumulated since the previous emitted frame, instead of at most one tick;
- `FrameIntake` ingests the whole batch into the bounded history rings in order.

This keeps history accumulation in the frontend (no backend history ownership
change), preserves a live preview during analysis, and means a mid-analysis
`STOP` still leaves the already-streamed partial history scrubbable.

## IPC Contract

Add frontend wrappers in `src/ipc/commands.js` for new Rust commands. Candidate
command names:

```txt
file_analysis_probe(path)
file_analysis_start(path, onFrame)
file_analysis_stop()
```

`file_analysis_probe` returns metadata including the selected track and the file
`duration_ms`, computed from the decodable track (sample/frame count and time
base). Duration enables a real progress percentage.

Add events or channel payload fields for file session status:

```txt
file-analysis-progress   (carries decoded position and a real 0..1 progress)
file-analysis-completed  (carries an authoritative whole-file summary payload)
file-analysis-error
```

The progress payload must carry a real fraction derived from decoded frames over
total frames (from duration), not a constant placeholder. The completion payload
must carry summary metrics read from the pipeline's final state (integrated LUFS,
LRA, true peak max, sample peak max, duration, sample rate, channel count, and
selected track metadata), so the summary surface does not depend on whichever UI
frame happened to arrive last.

`AudioFramePayload` should remain the panel data shape. In file mode its history
tick fields carry batches (see History And Frame Batching). File-only metadata
and summary results are separate payloads so existing panels do not need to
understand file-specific fields.

Drag and drop is wired through the Tauri webview drag-drop event rather than the
IPC command boundary; the resulting path is then passed to `file_analysis_probe`
/ `file_analysis_start` through the normal `src/ipc/` wrappers.

The Rust app state should model the active source explicitly:

```txt
EngineSource =
  Stopped
  LiveCapture
  FileAnalysis
```

Only one active source is allowed. Starting one source clears or stops the other
through a deliberate state transition.

## Frontend Integration

Add source mode state in `src/App.jsx`:

```txt
sourceMode: "live" | "file"
```

The existing `running` boolean can remain as a compatibility layer during the
first implementation, but the UI should move toward source-aware derived state:

```txt
isLiveRunning
isFileAnalyzing
hasFileResult
selectedOffset
```

File mode should reuse:

- `buildTauriFrameApply` for applying `AudioFramePayload`;
- `FrameIntake` for loudness, visual, spectrum, and vectorscope history;
- `useSnapshot` for history scrub;
- `AudioDataContext` so panels remain mostly unchanged;
- `deriveAnalysisRequests` and `set_analysis_requests` so per-instance
  Spectrum, Spectrogram, and Vectorscope requests stay consistent.

The `ANALYZE` action opens a native file picker through the
`@tauri-apps/plugin-dialog` `open()` wrapper. This is the primary, always-working
entry point and does not depend on drag support.

Drag-and-drop is a secondary convenience. The drop overlay is wired through the
Tauri webview drag-drop event and activates only while `File` mode is active and
only for OS file drags; in `Live` mode OS file drags are ignored. Internal
panel/tab drags must continue using the workspace drag model and never trigger
the file overlay.

`REANALYZE` must re-run analysis even for the same path. Because re-analyzing the
same file does not change the selected path, the file engine cannot key its run
solely on the path; it must use an explicit run trigger (for example an
incrementing run id) so that pressing `REANALYZE` re-opens and re-decodes the
file from disk, picking up both on-disk changes and current panel chip state.

The existing `StatusPill` and `TransportButton` concepts should become one
source-aware header cluster rather than three independent controls for source,
status, and action. This keeps the header compact and avoids scattering the
meaning of the current source across multiple places.

Clear keeps its current toolbar location. In both source modes, Clear clears the
current source session history and peak/result state. Exiting a scrubbed history
point is handled by `LIVE` in live mode and `RESULT` in file mode, not by Clear.

## Summary Display

After completion, show a compact summary surface in the shell, populated from the
authoritative completion summary payload (not from the last displayed UI frame).
It should include:

- file name;
- duration;
- selected track metadata when applicable;
- sample rate and channel count;
- loudness layout and whether it was recognized;
- Integrated LUFS;
- LRA;
- dialogue-gated loudness values when dialogue gating is enabled;
- True Peak Max;
- sample peak max;
- completion status or warning.

The summary should remain visible while users scrub the completed file history.
Clearing the session removes both the summary and panel history.

## Error Handling

File mode follows the existing product rule: no silent failure.

Required visible states:

- unsupported file type or container;
- supported container with no decodable audio track;
- unsupported codec;
- decode error or corrupt file;
- permission/path access error;
- file too large or history reduced due to bounded memory policy;
- user cancellation.

Errors should not leave the app pretending to analyze a file. The mode may remain
`File`, but the session state should be stopped with an error status and a clear
next action.

## Non-Goals

This slice does not include:

- editing, rendering, transcoding, routing, or playing files;
- decoding video frames;
- manual audio-track selection;
- comparing multiple files at once;
- running file analysis in parallel with live capture;
- persistent file-analysis history across app restarts;
- export of analysis reports;
- arbitrary user-configurable codec/plugin support.

## Testing Strategy

Rust tests should cover:

- the shared track-selection rule, and the worker selecting the same track index
  the probe returns (including a model with a non-null video track before the
  audio track);
- duration computation from the decodable track;
- converting decoded sample formats into interleaved `f32` chunks;
- file-time timestamp behavior in the pipeline path used by file analysis;
- batched history ticks: one emitted frame carrying multiple fine-grained ticks;
- cancellation and error state cleanup;
- summary metrics read from final pipeline state on small deterministic fixtures.

Frontend tests should cover:

- source mode toggle behavior;
- the file picker entry path (mocked dialog) starting analysis;
- drag overlay activating only in `File` mode and only for OS file drags, and
  being ignored in `Live` mode;
- `REANALYZE` re-running analysis for the same path via the run trigger;
- IPC wrappers in `src/ipc/commands.js`;
- real file progress percentage, completion, and error states;
- the summary surface reading the authoritative completion payload;
- `FrameIntake` ingesting a batch of history ticks from one frame;
- completed file sessions remaining scrubbable through existing snapshot logic.

Existing panel tests should continue to pass because panel data still arrives
through `AudioDataContext` in the existing frame shape.

## Implementation Slices

1. Product and state shell: PRD update, source-aware transport cluster, and
   `File` mode states. Manual source switch is the only entry into `File` mode.
2. Backend decode spike: local file probe, shared decodable-track selection,
   duration computation, metadata reporting, and visible unsupported-file errors.
3. File session frame path: decoded PCM into `MeterPipeline` (worker reusing the
   probe-selected track index and a config snapshot), bounded `AudioFramePayload`
   emission, real progress, stop, and completion carrying an authoritative
   summary payload.
4. File-time history: media-time timestamps, batched history ticks (bounded UI
   frame rate with fine-resolution history), and stable snapshot scrub for
   completed file sessions.
5. Frontend integration: file picker entry, `File`-mode-only drag/drop via the
   Tauri webview drag-drop event, run-id-triggered `REANALYZE`, and the summary
   surface fed by the authoritative completion payload.
6. Hardening: fixtures, cancellation, long-file memory policy, and cross-platform
   path/permission behavior.
