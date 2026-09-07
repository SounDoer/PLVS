# Visual Capture Windows Recording Spike

**Date:** 2026-09-07  
**Scope:** Task 8 only; no production command surface

## Decision

Implement the production recorder with a deliberately narrow split:

- use `windows-capture` only to create and run Windows Graphics Capture against the exact Tauri
  `main` HWND, without a picker;
- use direct D3D11 video-processor calls for semantic crop, aspect-fit scaling, and black
  letterboxing into a fixed BGRA output canvas;
- hand completed BGRA frames through a bounded queue to a dedicated direct Media Foundation Sink
  Writer worker, with one H.264 stream and, later, an optional AAC stream;
- add no audio stream at all for `audio: none`.

The `windows-capture` encoder and compositor are not used: its public compositor only top-left
crops/pads, and disabling audio in its encoder still produced an AAC stream on this machine. Both
conflict with the approved contract. Its capture-session bootstrap does not impose either behavior
and is retained in production to avoid duplicating the HWND-to-WGC lifecycle.

## Required production `windows` features

The existing `windows = 0.61.3` dependency remains pinned for WebView2 compatibility. Production
recording isolates the following direct APIs behind the `windows62` alias already used by
`windows-capture`:

- `Win32_Foundation`
- `Win32_Graphics_Direct3D11`
- `Win32_Graphics_Dxgi_Common`
- `Win32_Media_MediaFoundation`

No Windows crate types cross the recording module's public API, which prevents the 0.61 and 0.62
types from being mixed.

## Probe and environment

Run the development app, make the renderer active, then execute:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml `
  --example visual_capture_windows_probe -- `
  "PLVS Dev" "$env:TEMP\plvs-visual-capture-task8-d3d-mf.mp4" 3 30
```

Observed environment:

- Windows 11 23H2, build 22631;
- NVIDIA GeForce RTX 4060, driver 32.0.15.9579;
- Microsoft Remote Display Adapter was also present;
- PLVS development window initially measured 946 x 662 physical pixels.

The probe locates the exact PLVS window title and creates its WGC item directly, so no system picker
or arbitrary desktop target is involved. Each frame is inset by eight pixels, passed through a
D3D11 video processor, aspect-fitted into a fixed 960 x 540 BGRA render target with black
letterboxing, read back into a bounded BGRA handoff, and submitted to a direct Media Foundation Sink
Writer. Production keeps that bounded handoff so Media Foundation never runs on the WGC callback.

## Results

The direct pipeline recorded 95 WGC arrivals in 3.045 seconds. Media Foundation finalized a valid
85,053-byte MP4 containing exactly one stream:

```text
codec=h264
dimensions=960x540
r_frame_rate=30/1
avg_frame_rate=30/1
duration=3.166633
audio_streams=0
```

This proves HWND acquisition, BGRA crop/scale/letterbox, H.264 encoder availability, MP4
finalization, and the no-audio stream shape on the test machine. It also proves that raw WGC arrival
count is not a frame clock: 95 arrivals became 3.166633 seconds at fixed 30-fps sample durations.
Production therefore needs its own cadence that drops excess frames and repeats the latest frame
when the compositor is idle.

The earlier wrapper-encoder run produced 78 arrivals in 3.092 seconds and a 3.0-second MP4, but it
contained H.264 plus an AAC stream despite audio being disabled. That output is rejected as a
contract result rather than treated as an implementation shortcut.

## Platform findings

- `SecondaryWindowSettings::Exclude` was rejected as unsupported on build 22631. The PLVS recorder
  must use the main HWND item and must not require the secondary-window capture extension.
- The WGC minimum-update-interval property was also rejected as unsupported. Frame pacing belongs
  to the recorder, not this optional session property.
- `CreateFreeThreaded` keeps frame delivery off the React/UI thread. Heavy compositor, encoder, and
  finalization work must remain on the recording worker.
- The initial output width and height must be even for broadly compatible H.264 4:2:0 encoding.
- Captured texture size may differ from current semantic bounds during resize. Use `ContentSize`,
  clamp the source rectangle, and hold the last complete frame across transient invalid geometry.
- Minimize/occlusion must not be modeled as a permanent target loss: WGC may stop producing new
  frames, so the fixed-rate encoder repeats the last frame until capture resumes.
- `GraphicsCaptureItem.Closed` is the permanent window-loss signal. The worker must initiate bounded
  finalization and report `windowLost` rather than waiting indefinitely for another frame.
- A failed or interrupted pre-finalization run can leave a zero-byte/non-playable MP4. Production
  writes only to the protected temporary sibling and publishes only after Sink Writer finalization.

## Production acceptance carried into Task 9

- Cache D3D device, video processor, views, and output textures; the probe deliberately favors
  clarity over allocation cost.
- Use a bounded frame handoff and never block WGC's frame callback on Media Foundation.
- Use QPC-relative WGC timestamps for observation, but generate monotonically paced video samples
  at the selected 15/30/60 fps.
- Keep the output canvas fixed after start and update only source/destination rectangles on resize.
- Measure start and finalization latency in the production state ledger; enforce bounded shutdown.
- Test resize, minimize/restore, occlusion, transparency, and window loss again through the
  production controller, because this probe freezes APIs and failure modes rather than replacing
  Task 12 acceptance.
