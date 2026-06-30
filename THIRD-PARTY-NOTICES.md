# Third-Party Notices

PLVS itself is licensed under the MIT License (see `LICENSE`). It additionally distributes the
following third-party components.

## FFmpeg

PLVS bundles the **FFmpeg** `ffmpeg` and `ffprobe` programs as separate executables (sidecars) to
decode audio tracks from media files in File mode.

- **License:** GNU Lesser General Public License, version 2.1 (LGPL-2.1).
  The bundled binaries are built with `--disable-gpl --disable-nonfree`, so only LGPL-licensed
  components are included. A copy of the LGPL-2.1 license text is available at
  <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>.
- **Source:** Built from the FFmpeg `n7.1` release. Corresponding source is available from the
  FFmpeg project at <https://ffmpeg.org/download.html> and <https://git.ffmpeg.org/ffmpeg.git>
  (tag `n7.1`). The exact `configure` options used are recorded in `docs/ffmpeg-sidecar-build.md`.
- **Replaceability:** FFmpeg is invoked as a standalone executable, not linked into PLVS. Users may
  replace the bundled `ffmpeg`/`ffprobe` binaries with their own compatible builds, satisfying the
  LGPL-2.1 relinking provision.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.

## Voice activity detection models

PLVS bundles voice-activity-detection (VAD) models for the optional dialogue-gated loudness feature.
A single engine is selected at runtime; the model weights are embedded in the application binary.

- **Silero VAD** — **MIT.** Embedded via the [`voice_activity_detector`](https://github.com/nkeenan38/voice_activity_detector)
  crate (MIT, © 2024 Nicholas Keenan). Model source: <https://github.com/snakers4/silero-vad>.
- **TEN VAD** — **Apache-2.0.** Upstream: <https://github.com/TEN-framework/ten-vad>. Integrated via the
  [`ten-vad-rs`](https://github.com/wangfu91/ten-vad-rs) crate (Apache-2.0).
- **FireRedVAD** — **Apache-2.0** (© Xiaohongshu — Kaituo Xu, Wenpeng Li, Kai Huang, Kun Liu). Upstream:
  <https://github.com/FireRedTeam/FireRedVAD>. Embedded via the [`firered-vad`](https://github.com/uqio/firered-vad)
  crate (crate code MIT OR Apache-2.0).

A copy of the Apache-2.0 license text is available at <https://www.apache.org/licenses/LICENSE-2.0>.

## Other dependencies

PLVS's remaining Rust and JavaScript dependencies are distributed under permissive licenses
(predominantly MIT and Apache-2.0, with some BSD/ISC). A full snapshot of the dependency licensing,
including how it was audited and why no copyleft obligations beyond FFmpeg apply, is in
`docs/licenses-audit.md`.
