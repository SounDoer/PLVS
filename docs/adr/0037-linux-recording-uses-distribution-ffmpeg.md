# ADR 0037: Linux visual recording uses the distribution FFmpeg

Date: 2026-10-22

## Context

Agent Control visual recording produces H.264 MP4, with AAC audio when the measured Live source is
requested. Windows encodes with Media Foundation and macOS with AVAssetWriter: encoders that come
with the operating system, together with whatever codec patent coverage the OS vendor provides.

Linux recording pipes WebKitGTK frames into FFmpeg. In 0.23.0 it resolved FFmpeg like file analysis
does, which for a packaged build means the private sidecar under `/usr/lib/plvs/sidecars` or
`/usr/lib/plvs-preview/sidecars` ([ADR 0033](0033-linux-deb-bundles-private-ffmpeg-sidecars.md)).
That sidecar is deliberately audio-only and LGPL: GPL and nonfree code and every encoder except raw
PCM are disabled. It has no H.264 or AAC encoder, so packaged recording started and then always
failed. Development builds worked only because the development launcher points FFmpeg at
`/usr/bin`. The release-package smoke found the defect on the Ubuntu runner.

The obvious fix is to add libx264 and AAC to the sidecar. libx264 is GPL, which would turn the
sidecar into a GPL binary and change what PLVS must offer with every package. H.264 is also
patent-encumbered; shipping our own encoder would make PLVS the party distributing it.

## Decision

Linux visual recording encodes only with the distribution FFmpeg at `/usr/bin/ffmpeg`, which
Ubuntu's `ffmpeg` package builds with libx264 and the native AAC encoder. It never uses the private
sidecar, and the sidecar recipe and its licensing stay exactly as ADR 0033 describes. File analysis
keeps using the sidecar.

PLVS probes `ffmpeg -encoders` instead of assuming the encoders exist, and reports the result:

- `visual describe` marks recording unavailable, with reason `recordingEncoderUnavailable`, the
  missing encoders and the remedy `sudo apt install ffmpeg`, when libx264 is missing; without AAC
  only `--audio none` is offered.
- `visual recording start` probes again and fails immediately with the same code, before any
  recording record is created.
- `plvs-cli doctor` reports a `visual-recording-encoder` check on Linux.

`PLVS_RECORDING_FFMPEG` names another absolute FFmpeg executable for development and tests.
`PLVS_FFMPEG_DIR` names the decoder sidecar directory and does not apply to recording, because the
release-package smoke points it at the unpacked sidecars.

The deb packages do not declare a relationship with Ubuntu's `ffmpeg`. Tauri 2 can write
`Depends` and `Recommends` but not `Suggests`, and APT installs recommendations by default, which
would silently pull GPL FFmpeg into every installation and break the package verification that
installs PLVS without it. The install hint carries the information instead.

## Consequences

Recording works on any Ubuntu desktop with the standard `ffmpeg` package, and the encoder's
licence and patent position is the distribution's, as the system encoders are on Windows and
macOS. PLVS's own packages remain LGPL-only and audio-only.

Recording is no longer self-contained on Linux: without `ffmpeg` it is unavailable, and it follows
the distribution's FFmpeg version. Installing FFmpeg after PLVS has started requires restarting
PLVS before `visual describe` reports recording as available. Screenshots are unaffected.

The release-package smoke requires recording on every platform. On Linux an unavailable encoder is
a rig problem (exit 2), because the runner's system FFmpeg, not the package, provides it; the
release therefore cannot pass without exercising real Linux recording.
