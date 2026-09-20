# Third-Party Notices

PLVS itself is licensed under the MIT License. The complete PLVS license is distributed as
`licenses/PLVS-LICENSE.txt`. The complete standard license texts referenced below are distributed
in `licenses/license-texts/`.

This notice describes software and model artifacts included in PLVS release packages. It is an
engineering inventory, not legal advice.

## FFmpeg 7.1 sidecars

PLVS distributes `ffmpeg` and `ffprobe` from **FFmpeg 7.1** (upstream tag `n7.1`) as separate
executables for File mode. The binaries are fetched from the PLVS
[`ffmpeg-sidecar-7.1`](https://github.com/SounDoer/PLVS/releases/tag/ffmpeg-sidecar-7.1)
release and are checksum-pinned by
[`scripts/fetch-ffmpeg-sidecar.mjs`](https://github.com/SounDoer/PLVS/blob/main/scripts/fetch-ffmpeg-sidecar.mjs).

- **License:** GNU Lesser General Public License, version 2.1 only (LGPL-2.1-only). The build uses
  `--disable-gpl --disable-nonfree`; a complete copy is in
  `licenses/license-texts/LGPL-2.1-only.txt`.
- **Corresponding source:** <https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz> or the `n7.1` tag in
  <https://git.ffmpeg.org/ffmpeg.git>.
- **Build parameters:** the Windows recipe and shared trimmed configuration are recorded in
  [`docs/ffmpeg-sidecar-build.md`](https://github.com/SounDoer/PLVS/blob/main/docs/ffmpeg-sidecar-build.md).
  The macOS job records its platform-specific flags in
  [`.github/workflows/build-ffmpeg-sidecar-macos.yml`](https://github.com/SounDoer/PLVS/blob/main/.github/workflows/build-ffmpeg-sidecar-macos.yml).
- **Independent and replaceable:** PLVS starts these programs as child processes and communicates
  through pipes; they are not linked into PLVS. On Windows and in the Portable ZIP they are
  `ffmpeg.exe` and `ffprobe.exe` beside `plvs.exe`. In a macOS bundle they are
  `PLVS.app/Contents/MacOS/ffmpeg` and `ffprobe`. Users may replace both files with compatible
  builds for the same platform.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.

## Voice activity detection

PLVS embeds the following model weights in the application binary. A single engine is selected at
runtime.

- **Silero VAD V5** — model and `voice_activity_detector` **0.2.1** integration under MIT.
  Upstream model: <https://github.com/snakers4/silero-vad/releases/tag/v5.0>. Integration:
  <https://github.com/nkeenan38/voice_activity_detector>. The exact embedded model has SHA-256
  `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f`.
- **TEN VAD** — model embedded from `ten-vad-rs` **0.1.7**, under Apache-2.0. Upstream model:
  <https://github.com/TEN-framework/ten-vad>. Integration:
  <https://github.com/wangfu91/ten-vad-rs>. The exact embedded model has SHA-256
  `e10b98a0cab1c98e847fbdda14cb3d45a38336d47535a3f63a0fb6c4e0f4cdf4`.
- **FireRedVAD** — streaming model and CMVN data embedded by `firered-vad` **0.1.0**, under
  Apache-2.0. Copyright Xiaohongshu — Kaituo Xu, Wenpeng Li, Kai Huang, Kun Liu. Upstream:
  <https://github.com/FireRedTeam/FireRedVAD>. Rust integration:
  <https://github.com/uqio/firered-vad> (crate code MIT OR Apache-2.0). The embedded model SHA-256
  is `b3c97836130dc34fc32d56fab551e88cf9454511de2b3c250a5e6578dee74b93`; the embedded CMVN data
  SHA-256 is `c87f6f13edf0f0ec7535ddfc9cc3387d9268cb234b70182d566c5e2edf3ca473`.

The complete MIT and Apache-2.0 texts are in `licenses/license-texts/MIT.txt` and
`licenses/license-texts/Apache-2.0.txt`.

## Rust and JavaScript dependencies

The production dependency graphs are pinned by `src-tauri/Cargo.lock` and `package-lock.json`.
Most components are available under MIT and/or Apache-2.0. The current shipped graphs also contain
the following license families, so their complete texts are included rather than assuming that
MIT/Apache covers the entire product:

- **BSD-3-Clause** — including `alloc-no-stdlib`, `alloc-stdlib`, `atomic-write-file`, `subtle`,
  and the BSD portion of `brotli`.
- **ISC** — including the ISC portion of `ring`, plus `rustls-webpki`, `untrusted`,
  `@ungap/structured-clone`, and `lucide-react`.
- **0BSD** — `tslib` in the production JavaScript graph.
- **MPL-2.0** — `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, and `selectors` in the
  Tauri/WebView dependency graph.
- **Unicode-3.0** — Unicode/ICU data and support crates including `unicode-ident` and the ICU4X
  crates in the Rust graph.
- **Zlib** — `foldhash` and components that offer Zlib among their applicable license choices.

Complete texts are provided in `licenses/license-texts/BSD-3-Clause.txt`, `ISC.txt`, `0BSD.txt`,
`MPL-2.0.txt`, `Unicode-3.0.txt`, and `Zlib.txt`.

`licenses/DEPENDENCY-INVENTORY.txt` records the complete production package snapshot used for this
review, including component versions, declared licenses, and available upstream author/repository
metadata.

Dependency metadata can change when either lockfile changes. Maintainers should re-run the
production license inventory when updating dependencies and update this notice if a new license or
attribution requirement appears.
