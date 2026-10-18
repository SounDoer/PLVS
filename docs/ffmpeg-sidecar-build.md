# FFmpeg Sidecar Build

File mode decodes audio through a bundled, trimmed FFmpeg pair (`ffmpeg` and `ffprobe`). PLVS uses
the same pinned FFmpeg version and audio codec surface on Windows x86_64, macOS Apple Silicon, and
Linux x86_64. The executables are separate child processes, not libraries linked into PLVS.

The binaries are not committed to git. `scripts/fetch-ffmpeg-sidecar.mjs` downloads immutable
GitHub Release assets into `src-tauri/binaries/`, verifies their SHA-256 values, inspects platform
dependencies, and executes them before a desktop build accepts them:

```bash
npm run ffmpeg:fetch
```

The pinned set is FFmpeg 7.1.5 under the dedicated
[`ffmpeg-sidecar-7.1.5-r1`](https://github.com/SounDoer/PLVS/releases/tag/ffmpeg-sidecar-7.1.5-r1)
release. Its source ZIP contains the unmodified upstream source archive, exact shared recipe,
per-platform configuration and toolchain evidence, dependency reports, and binary hashes.

## Targets and package layout

| Target | Asset suffix | Installed location |
| --- | --- | --- |
| Windows x86_64 | `x86_64-pc-windows-msvc.exe` | Beside `plvs.exe` |
| macOS Apple Silicon | `aarch64-apple-darwin` | `PLVS.app/Contents/MacOS` |
| Ubuntu 24.04 x86_64 | `x86_64-unknown-linux-gnu` | Stable: `/usr/lib/plvs/sidecars`; Preview: `/usr/lib/plvs-preview/sidecars` |

Windows and macOS use Tauri `externalBin`. Linux deb configs map the fetched triple-named inputs
to plain `ffmpeg`/`ffprobe` names in the identity-private directory. Linux never installs these
files in `/usr/bin` and does not depend on Ubuntu's `ffmpeg` package.

The Rust runtime honors an absolute `PLVS_FFMPEG_DIR` development/test override. Packaged Linux
otherwise resolves only its identity-private directory; Windows and macOS resolve adjacent tools.

## Reproducible recipe

`.github/workflows/build-ffmpeg-sidecars.yml` is the authoritative one-shot build, test, and
publication workflow. It downloads FFmpeg 7.1.5 from upstream and verifies SHA-256
`de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f`, then invokes the shared
`scripts/build-ffmpeg-sidecars.sh` recipe on every target.

The recipe starts with `--disable-everything`, disables GPL/nonfree components, autodetection,
networking, video-related libraries, all encoders/muxers/filters, and x86 assembly. It then enables
only:

- the `file` and `pipe` protocols;
- MOV, Matroska, WAV, AIFF, FLAC, MP3, Ogg, AAC, AC-3, E-AC-3, DTS, and W64 demuxers;
- AAC/AAC-LATM, AC-3, E-AC-3, DTS (`dca`), Opus, Vorbis, FLAC, MP3, ALAC, and required PCM decoders;
- `aresample`, plus the PCM float encoder/muxer needed to stream f32le samples to PLVS.

No external codec library is linked. `--enable-static --disable-shared` folds FFmpeg's own internal
libraries into each executable; it does not attempt to statically link the operating system C
runtime. Windows uses the checksum-pinned winlibs GCC/MinGW-w64 UCRT toolchain recorded in
`licenses/ffmpeg-builds.json`. macOS sets a 14.2 deployment target. Linux is built for x86_64 and
may depend only on `libc.so.6`, `libm.so.6`, and the ELF loader, with no symbol newer than the
Ubuntu 24.04 glibc 2.39 baseline.

The current trimmed binaries are roughly 2 MB each. A full generic FFmpeg build is intentionally
not shipped.

## Verification

The sidecar workflow creates deterministic audio, encodes representative AAC, AC-3, E-AC-3, DTS,
Opus, Vorbis, FLAC, MP3, ALAC, and 24-bit PCM fixtures with a full build, and verifies that both the
candidate `ffprobe` and `ffmpeg` can inspect and decode them. It also records the reported license,
configuration, toolchain, dependency list, and hashes.

For repository changes, run:

```bash
npm run ffmpeg:fetch
npm run smoke:file-analysis
```

Linux package verification additionally installs the exact deb into a disposable Ubuntu root that
has no `/usr/bin/ffmpeg` or `/usr/bin/ffprobe`, decodes the fixture set with the installed private
sidecars, starts the GUI and CLI, removes the package, and proves those private files were removed.

## Licensing and codec patents

The binaries report LGPL-2.1-or-later because the build explicitly disables GPL and nonfree
components. Every PLVS package includes the LGPL text and third-party notices. The immutable
sidecar release offers complete corresponding source and build records; its URL and checksum are
pinned in `licenses/native-components.json` and checked by `npm run licenses:sources`.

An LGPL-compliant build does not grant codec patent rights. AAC, AC-3/E-AC-3, DTS, MP3, and other
formats may be patent-encumbered in some jurisdictions or uses. PLVS enables decoding needed for
user-supplied media, does not ship optional patented encoders, and makes no patent-license claim.

Never replace an asset on an existing tag. A future FFmpeg change uses a new immutable sidecar tag,
updates all six binary hashes and the corresponding-source hash, regenerates native notices, and
passes the real decoding and package tests before a PLVS release consumes it.
