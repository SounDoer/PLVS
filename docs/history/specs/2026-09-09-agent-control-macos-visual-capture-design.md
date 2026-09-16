# Agent Control: macOS Visual Capture Design

Date: 2026-09-09

Status: Approved for implementation

## Summary

PLVS already has a complete Agent Control Visual Capture contract and a Windows implementation.
The frontend can identify semantic PLVS surfaces, wait for stable paint, track resize, and expose
runtime availability. Rust already owns bounded artifact staging, recording state, measured-source
audio timing, and the public Tauri commands. The missing macOS work is therefore a native pixel and
encoding backend, not a second Visual Capture product.

This design adds macOS screenshots through `WKWebView` snapshotting and macOS recordings through a
window-scoped ScreenCaptureKit stream plus an AVFoundation MP4 encoder. Screenshots remain app-only
and do not request Screen Recording permission. Recording permission is inspected without side
effects by `visual describe` and requested only by `visual recording start`.

The existing commands, semantic targets, artifacts, concurrency rules, revision model, recording
lifecycle, H.264/AAC formats, cursor choices, and measured-source audio meaning remain unchanged.

## Decisions requested

The recommended choices below are part of this proposal. Approval of the spec approves them:

1. **Stage delivery:** land screenshots first, then silent recording, then measured-source audio and
   resize hardening. Each step remains mergeable and does not advertise unfinished capability.
2. **Permission timing:** `visual describe` never prompts. The first recording start that lacks
   access asks macOS for Screen Recording permission; screenshots never ask for it.
3. **Permission contract:** add the stable error `screenCapturePermissionRequired` and report
   `recording.permission` as `granted` or `required` in `visual describe`.
4. **App-only screenshot semantics:** snapshot the rendered WebView, excluding the desktop, window
   shadow, native title bar, and pixels from applications behind translucent PLVS content. This
   preserves the existing app-only privacy boundary.
5. **Native boundary:** use one small Objective-C bridge compiled with ARC, matching the existing
   macOS audio-tap bridge. Do not introduce a Swift build pipeline or duplicate the Agent Control
   lifecycle in native code.

## Goals

- Make all existing Visual Capture commands available on supported macOS builds.
- Preserve the same public behavior on Windows and macOS wherever the OS permits it.
- Capture only PLVS-owned content; never present a desktop/window source picker.
- Keep screenshots usable when Screen Recording permission is absent.
- Keep `visual describe`, `app capabilities`, and CLI schema queries free of permission prompts.
- Produce PNG screenshots and fixed-canvas H.264 MP4 recordings with optional AAC
  `measuredSource` audio.
- Preserve the selected semantic target during main-window resize without changing the encoded
  canvas size.
- Reuse the existing bounded artifact, session, audio-timeline, and frontend settlement layers.
- Keep all native capture, conversion, and encoding work off the audio callback and React thread.
- Report permission and native failures through stable Agent Control errors.

## Non-goals

- Capturing the desktop, another application, an arbitrary window, or a user-selected region.
- Capturing system output audio through ScreenCaptureKit. `measuredSource` means the exact PCM
  stream already being measured by PLVS, not whatever happens to be audible on the Mac.
- Adding microphone or system-audio permission requests for Visual Capture.
- Recording Panel, Dock Header, or Dock Editor targets; the existing recording targets remain
  `main` and `workspace`.
- Changing the CLI command names, JSON-RPC envelope, revision semantics, artifact retention, or
  maximum recording duration.
- Making screenshots reproduce the desktop wallpaper or another application's pixels behind PLVS
  transparency or vibrancy.
- Linux Visual Capture.
- Replacing the Windows WebView2, Windows Graphics Capture, or Media Foundation backends.
- Changing the audio callback, DSP, or measurement pipeline.

## Existing reusable system

The macOS implementation must reuse these authoritative layers:

- `src/agentControl/visualControl.js` owns public targets, formats, defaults, and description
  projection.
- `src/agentControl/visualSurfaces.js` and `useVisualCaptureSurfaces.js` own semantic DOM discovery,
  paint settlement, frontend geometry, and resize observation.
- `src/agentControl/useAgentControlBridge.js` owns command routing, revision checks, request
  cancellation, runtime validation, and recording metadata.
- `src/ipc/commands.js` is the only frontend-to-Rust boundary.
- `src-tauri/src/visual_capture/artifacts.rs` owns private staging, final publication, hashes,
  retention, and cleanup.
- `src-tauri/src/visual_capture/recording/state.rs` owns recording IDs, lifecycle, limits, events,
  and terminal snapshots.
- `src-tauri/src/visual_capture/recording/audio.rs` owns downmixing, resampling, silence insertion,
  discontinuity accounting, and the AAC input timeline.
- `crate::audio::MeasuredPcmReceiver` is the existing downstream, bounded PCM subscription. The
  native recorder must consume it without modifying the realtime producer.

Live mutations and state reads continue through the running React application. Native capture is a
pixel/encoding service, not a shortcut around application business logic.

## Target architecture

```text
plvs-cli visual ...
        |
        v
React Agent Control bridge
        |
        |-- semantic target + paint settlement + revision
        |-- resize subscription
        v
src/ipc/commands.js
        |
        v
Rust visual_capture service
        |-- shared ArtifactStore
        |-- shared RecordingRegistry
        |-- shared AudioTimeline
        |
        `-- platform backend
             |-- Windows (existing)
             `-- macOS adapter
                    |
                    v
              Objective-C bridge
                 |-- WKWebView snapshot -> PNG
                 `-- ScreenCaptureKit window frames
                       -> Core Image crop/aspect-fit
                       -> AVAssetWriter H.264/AAC MP4
```

The native bridge owns Apple objects and callbacks. Rust owns public requests, validation,
artifacts, session state, audio policy, and completion publication.

## Intended module layout

```text
src-tauri/
|-- build.rs
|-- Info.plist
|-- native/macos/
|   |-- tap_bridge.m
|   `-- visual_capture_bridge.m
`-- src/visual_capture/
    |-- mod.rs
    |-- artifacts.rs
    |-- platform.rs
    |-- windows.rs
    |-- macos.rs
    `-- recording/
        |-- mod.rs
        |-- state.rs
        |-- audio.rs
        |-- session.rs
        |-- windows.rs
        `-- macos.rs
```

`recording/session.rs` contains the small platform-neutral session operations currently expressed
as a Windows-only concrete map: recording ID, stop request, geometry update, audio-state update,
finished state, and bounded shutdown. Platform modules implement that interface.

The Objective-C bridge has a narrow C ABI. Opaque native session pointers never enter JSON, React,
logs, or artifact metadata. Callback contexts use explicit retain/release ownership so a delayed
Apple callback cannot access dropped Rust state.

## Screenshot design

### Source and permission behavior

The selected Tauri WebView is accessed through `WebviewWindow::with_webview`. On macOS its platform
object contains the `WKWebView`. The bridge creates a `WKSnapshotConfiguration`, assigns the
frontend rectangle in WebView coordinates, requests `afterScreenUpdates`, and calls
`takeSnapshotWithConfiguration:completionHandler:`.

Apple defines the snapshot rectangle in the WebView's own coordinate system. This matches the CSS
viewport rectangle returned after frontend settlement and avoids screen/window coordinate
conversion. The resulting `NSImage` is encoded as PNG into the pending artifact path.

This path does not use ScreenCaptureKit and therefore must not preflight or request Screen Recording
permission. It captures WebView-owned pixels only. Native title bars, window shadows, the desktop,
and applications behind PLVS translucency are out of scope. DOM overlays and PLVS-rendered cursor
or hover state intersecting the target remain visible under the existing contract.

The implementation must still validate that the requested rectangle is finite, non-empty, and
inside the current WebView bounds. A resize between frontend settlement and native snapshot either
produces a safely clamped non-empty target or returns `targetUnavailable`; it must never capture an
unrelated region.

### Scale and PNG output

`snapshotWidth` is expressed in WebView points. The implementation must first verify WebKit's
returned point and backing-pixel dimensions on 1x and 2x displays; it must not blindly multiply a
point width by DPR and accidentally produce a 4x bitmap. The returned bitmap dimensions, not the
requested DPR alone, are authoritative for artifact metadata. PNG encoding preserves alpha where
WebKit supplies it.

Encoding writes only to the private pending path supplied by `ArtifactStore`. Completion returns to
Rust through a one-shot callback. Rust publishes and hashes the file only after the native callback
reports a complete write.

## Recording design

### Permission model

ScreenCaptureKit recording requires macOS Screen Recording consent. `Info.plist` includes
`NSScreenCaptureUsageDescription` with PLVS-specific wording.

Capability discovery calls `CGPreflightScreenCaptureAccess()` only. It reports:

```json
{
  "recording": {
    "available": true,
    "permission": "required"
  }
}
```

`available` means this build and OS contain the recording backend. `permission` means whether a
recording can start without user action. The public values are:

- `granted` — the preflight check currently succeeds;
- `required` — the preflight check does not succeed.

Core Graphics does not expose a reliable public distinction between never requested and previously
denied for this use, so the contract does not claim one.

If access is absent, `visual recording start` calls `CGRequestScreenCaptureAccess()` once as part of
that explicit user/agent action. When the call does not grant access, start fails with:

```json
{
  "reason": "screenCapturePermissionRequired",
  "details": {
    "permission": "screenRecording",
    "action": "grantInSystemSettingsAndRestartApp"
  }
}
```

The request creates no published artifact and leaves no active recording. PLVS does not open System
Settings automatically. Some macOS versions require restarting the application after the user
grants access; the stable action text deliberately covers that case. `visual describe` can be run
again after restart to verify `granted`.

### Selecting the PLVS window

The native adapter obtains the main Tauri `NSWindow` and its `windowNumber`. After permission is
available, the bridge calls `SCShareableContent` and matches exactly one `SCWindow` using the native
window ID plus the current process identity. It does not accept a caller-supplied window ID and does
not show `SCContentSharingPicker`.

The stream uses `SCContentFilter`'s desktop-independent single-window form. Window shadows are
disabled and ScreenCaptureKit audio capture is disabled. Cursor inclusion maps directly from the
existing `none`/`visible` option to `SCStreamConfiguration.showsCursor`.

Failure to find the current PLVS window is `targetUnavailable`. Permission loss or ScreenCaptureKit
startup failure after allocation is `recordingFailed`, with sanitized diagnostic details.

### Frame geometry and fixed canvas

The encoded canvas is chosen once from the settled target size and rounded to valid even H.264
dimensions, exactly as on Windows. It never changes during one recording.

Apple's online `sourceRect` reference says the value is not used for single-window capture, while
newer SDK header wording describes independent-window cropping. PLVS supports macOS 14.2 and cannot
base correctness on that version-dependent ambiguity. The bridge therefore receives full PLVS
window frames and treats native source cropping, if later proven safe, as an optimization only. For
every frame it:

1. reads ScreenCaptureKit frame metadata and the current WebView position within the `NSWindow`;
2. maps the latest frontend CSS target rectangle into the captured frame;
3. clamps and crops that rectangle;
4. aspect-fits it into the fixed canvas with an opaque black background;
5. renders into a `CVPixelBuffer` using a reusable GPU-backed Core Image context;
6. appends the pixel buffer to the AVAssetWriter video input with monotonic time.

Geometry updates replace one small synchronized value. They do not rebuild the stream or writer.
The last valid geometry remains active until a new valid geometry arrives. An invalid or empty
mapping fails the recording rather than exposing outside-target pixels.

Pure Rust geometry helpers own coordinate normalization, clamping, even canvas sizing, and
aspect-fit calculations. Native code owns only the Apple coordinate conversion and rendering calls.
Tests cover Retina scale, flipped Y axes, title/content offsets, resize, one-pixel edges, and
letterboxing.

### Frame cadence and backpressure

`minimumFrameInterval` is configured from the requested 15, 30, or 60 FPS. ScreenCaptureKit frame
delivery occurs on a private serial queue. The queue depth is bounded. The bridge never blocks the
main thread or audio callback waiting for the encoder.

AVAssetWriter readiness is treated as backpressure. Frames may be dropped when the video input is
not ready; timestamps remain monotonic and the shared registry records diagnostics. Memory must not
grow with recording duration. The writer canvas, pixel-buffer pool, Core Image context, and scratch
objects are reused where Apple APIs permit it.

### MP4 encoding and completion

The bridge creates an `AVAssetWriter` for MP4 with:

- one H.264 video input sized to the fixed even canvas;
- an `AVAssetWriterInputPixelBufferAdaptor` for video frames;
- one AAC input only when `measuredSource` was selected;
- a single session time origin shared by video and audio.

Stop, duration limit, source failure, window close, permission revocation, and app shutdown converge
on one idempotent finalization path. The stream stops before writer inputs are marked finished.
AVAssetWriter completion is asynchronous. Only a successful completed writer causes Rust to publish
the pending artifact. Failed or cancelled writers leave no successful artifact and follow the
existing cleanup rules.

### Measured-source audio

ScreenCaptureKit's audio capture remains off. Rust attaches the existing bounded
`MeasuredPcmReceiver` only when `measuredSource` is selected. The existing `AudioTimeline` converts
source packets to the fixed stereo 48-kHz signed-16-bit AAC input timeline, inserts explicit silence
for stopped/restarting states, and accounts for dropped input.

A Rust audio drain worker sends bounded PCM packets and presentation timestamps to the native
session. The bridge copies each packet into a `CMSampleBuffer` and appends it only when the
AVAssetWriter audio input is ready. Native backpressure is reported to Rust; it must not cause an
unbounded retry queue. The registry's existing audio stats and silence reasons remain authoritative.

This reuses the current downstream subscription and does not alter the macOS audio tap, cpal
backend, audio callback, or measurement frames.

## Capability and error contract

The existing `visual.describe` result gains one field under `recording`:

```json
{
  "recording": {
    "available": true,
    "permission": "granted"
  }
}
```

On Windows, `permission` is `granted` because no separate TCC grant is required by the current
backend. On unsupported platforms it is `unsupported`. This field is descriptive and does not
change the static CLI schema.

`app.capabilities` continues to advertise `visual.recording` from platform support, not the
current TCC decision. Agents use `visual.describe` for runtime readiness. This prevents denial from
making implemented commands appear nonexistent.

One stable error is added:

- `screenCapturePermissionRequired` — macOS Screen Recording access must be granted before a
  recording can start.

All existing errors retain their meaning. In particular, permission denial is not
`visualUnavailable`, because the backend exists and the user can resolve the condition.

## Concurrency, shutdown, and ownership

The existing limits remain one screenshot and one recording at a time. Screenshot and recording
may overlap because they use independent native paths and existing per-kind guards.

The platform-neutral recording controller retains an opaque session implementation instead of a
Windows concrete type. Session operations are synchronous control messages into platform workers;
they do not synchronously wait for native encoding.

Application shutdown requests `StopReason::Shutdown`, waits within the existing bounded deadline,
then releases the native session. Late callbacks become no-ops after their context is detached.
Abrupt termination may leave a temporary artifact, which existing startup cleanup removes.

## Privacy and security

- Callers provide semantic targets only, never native window IDs, selectors, source filters, or
  output paths.
- The native source is always the current process's PLVS main window.
- Screenshots never invoke system screen capture.
- Recordings disable ScreenCaptureKit audio and capture no unrelated application audio.
- Artifacts remain inside the identity-scoped private staging directory.
- Native errors are sanitized before crossing IPC and never expose pointers or arbitrary paths.
- Permission prompting occurs only on explicit recording start.

## Testing and verification

### Automated tests

- Frontend tests for permission projection, supported-versus-ready semantics, and the new stable
  error mapping.
- Rust tests for macOS capability projection through injectable permission probes.
- Screenshot rectangle, returned image dimension, callback ownership, write failure, and
  unsupported-platform tests.
- Platform-neutral session-map tests for insert, inspect, stop, geometry/audio updates, reaping,
  and shutdown.
- Pure geometry tests for WebView-to-window-to-frame mapping, Retina scales, flipped coordinates,
  clamp/refusal, resize, even canvas, and aspect fit.
- Audio packet bridge tests for timestamps, backpressure, silence, discontinuity, and bounded
  queues.
- Native bridge compile/link coverage on macOS and unchanged Windows build coverage.
- Source-contract tests that keep ScreenCaptureKit audio disabled and prevent user-selectable
  sources from entering the bridge.

### Real macOS acceptance matrix

Run on a physical Mac with the development app identity:

1. permission absent: `visual describe` does not prompt and reports `required`;
2. screenshot absent permission: every mounted screenshot target produces a valid PNG;
3. first recording start: the system prompt appears and the command returns the stable permission
   result when access is not immediately usable;
4. restart after grant: `visual describe` reports `granted` and silent main/workspace recordings
   complete as playable H.264 MP4 files;
5. cursor `none` and `visible` differ as requested;
6. main-window resize preserves the fixed canvas and follows the semantic target with letterboxing;
7. Live `measuredSource` produces synchronized AAC audio and reports bounded drop/silence stats;
8. File mode rejects `measuredSource` and defaults to silent recording as before;
9. explicit stop, maximum duration, window close, and app shutdown finalize or fail cleanly;
10. normal, Dock, Retina, and multi-display scale transitions do not capture outside PLVS.

Run `npm run check` before landing each completed slice. This design deliberately does not change
the audio capture layer. If implementation unexpectedly touches `src-tauri/src/audio`, `dsp`, or
`engine`, the repository's real capture smoke/soak requirements apply.

## Rollout

### Slice 1 — Screenshot backend

Add the WKWebView snapshot bridge, enable macOS screenshot capabilities, add tests, and update
public docs. Recording remains unavailable on macOS in this slice.

### Slice 2 — Permission and silent recording

Add TCC description/probe/request behavior, ScreenCaptureKit window selection, crop/composition,
H.264 writer, platform-neutral session storage, and lifecycle tests. Advertise macOS recording only
after real silent-recording acceptance passes.

### Slice 3 — Audio, resize, and hardening

Attach the shared audio timeline to AVAssetWriter AAC, finish dynamic geometry/cursor behavior,
exercise stop/failure/shutdown paths, and complete the acceptance matrix.

### Slice 4 — Documentation and release verification

Update the public Visual Capture documentation, architecture, CLI support matrix, roadmap, and
packaged-app verification. Run the full merge gate on both supported desktop platforms where CI
coverage is split.

## Apple API references

- [WKWebView snapshot API](https://developer.apple.com/documentation/webkit/wkwebview/takesnapshot%28with%3Acompletionhandler%3A%29)
- [WKSnapshotConfiguration](https://developer.apple.com/documentation/webkit/wksnapshotconfiguration)
- [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)
- [Capturing screen content in macOS](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)
- [Desktop-independent window filter](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init%28desktopindependentwindow%3A%29)
- [SCStreamConfiguration](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration)
- [Single-window source rectangle behavior](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/sourcerect)
- [Screen Capture access preflight](https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess%28%29)
- [Screen Capture access request](https://developer.apple.com/documentation/coregraphics/cgrequestscreencaptureaccess%28%29)
- [AVAssetWriter](https://developer.apple.com/documentation/avfoundation/avassetwriter)
