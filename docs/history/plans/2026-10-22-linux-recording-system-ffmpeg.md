# Linux visual recording on the distribution FFmpeg

Date: 2026-10-22

## Problem

The 0.23.0 Ubuntu packages could start an Agent Control recording but never finish one. Linux
recording encoded with `-c:v libx264` (and AAC for measured-source audio) through
`sidecar::locate_sidecar("ffmpeg")`, which in a packaged build is the audio-only LGPL sidecar under
`/usr/lib/plvs*/sidecars`. That sidecar has no H.264 or AAC encoder, so every recording ended
`failed` with no useful reason. The dev launcher pointed `PLVS_FFMPEG_DIR` at `/usr/bin`, which hid
it. The release-package smoke found it on the Ubuntu runner at `silent-recording`.

## Decision (maintainer's option A)

Record with the distribution FFmpeg, report its encoder availability truthfully, and leave the
sidecar's licensing unchanged. Rationale: ADR 0037.

## Steps

1. `visual_capture/recording/system_ffmpeg.rs`: resolve `/usr/bin/ffmpeg` (override
   `PLVS_RECORDING_FFMPEG`, not `PLVS_FFMPEG_DIR`, which the release smoke points at the sidecars),
   probe `-encoders`, map the result to recording capabilities with an `unavailable` reason,
   message and details. Unit tests on every host.
2. `visual_capture_capabilities` becomes async so the probe never blocks the main thread; recording
   start re-probes and refuses with `recordingEncoderUnavailable` before creating a record; the
   recorder uses the probed path.
3. `plvs-cli doctor`: `visual-recording-encoder` check on Linux.
4. Frontend: `visual describe` exposes `recording.unavailable`; start returns the same failure;
   `recordingEncoderUnavailable` joins the Visual error set.
5. Smokes: the unsupported recording scenario records the reported reason; the release-package
   smoke turns it into `rigUnavailable` (exit 2) on Linux and `failed` elsewhere.
6. Docs: user guide (`cli.md`, `command-line.md`), `agent-control/visual.md`, architecture,
   sidecar build notes, CONTRIBUTING runner setup, CHANGELOG, ADR 0037.

`Suggests: ffmpeg` was considered for the deb metadata; Tauri 2.12 cannot write it, and
`Recommends` would install GPL FFmpeg by default and break the no-system-FFmpeg package
verification, so the packages declare no relationship.

## Verification

Windows: `npm run rust:check`, `npm test`, frontend checks. Linux code paths (`cfg(target_os =
"linux")`) are not compiled on Windows; the maintainer reruns the release-package smoke on the
Ubuntu runner with a rebuilt stable deb, and optionally with `PLVS_RECORDING_FFMPEG` pointing at a
missing path to see the rig-problem outcome.
