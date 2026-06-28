# FFmpeg Sidecar Build

File mode decodes audio through a bundled, trimmed **FFmpeg** pair (`ffmpeg` + `ffprobe`) run as
Tauri sidecars (`externalBin` in `tauri.conf.json`). This replaces Symphonia and gives full codec
coverage (AC-3, E-AC-3, DTS, Opus, HE-AAC, AAC-LC, PCM, …) for audio tracks inside video containers.

The binaries are **not committed** to git (`src-tauri/binaries/.gitignore` ignores everything but
itself). They are produced out-of-band and hosted as GitHub Release assets; the bundle step pulls
them into `src-tauri/binaries/`.

## Naming

Tauri's `externalBin` resolves per-platform by appending the Rust host target triple, then strips it
on install. Files must be named:

- `src-tauri/binaries/ffmpeg-<target-triple>.exe`
- `src-tauri/binaries/ffprobe-<target-triple>.exe`

Get the triple from `rustc -vV` (the `host:` line). On Windows it is `x86_64-pc-windows-msvc`.

## Dev shortcut

For local development you can drop any full `ffmpeg`/`ffprobe` build in `src-tauri/binaries/` with the
triple naming (e.g. a winget/gyan.dev build) to satisfy the build and exercise the real decode path.
The Rust runtime locator also honors `PLVS_FFMPEG_DIR`, which should point at a directory containing
plainly-named `ffmpeg.exe`/`ffprobe.exe` — handy for running the gated `file_analysis::session`
integration tests against a real binary:

```bash
PLVS_FFMPEG_DIR="/path/to/ffmpeg/bin" cargo test --manifest-path src-tauri/Cargo.toml file_analysis
```

## Building the trimmed distribution binary (Windows)

Use MSYS2 + MinGW64. Open the **MSYS2 MINGW64** shell.

```bash
pacman -Syu
pacman -S --needed base-devel mingw-w64-x86_64-toolchain \
  mingw-w64-x86_64-yasm nasm git make pkgconf diffutils
git clone --branch n7.1 --depth 1 https://git.ffmpeg.org/ffmpeg.git
cd ffmpeg
./configure \
  --disable-everything --disable-gpl --disable-nonfree \
  --disable-doc --disable-avdevice --disable-postproc --disable-swscale \
  --disable-network --disable-encoders --disable-muxers --disable-filters \
  --enable-small --enable-static --disable-shared --extra-ldflags=-static \
  --enable-ffmpeg --enable-ffprobe \
  --enable-filter=aresample --enable-protocol=file \
  --enable-demuxer=mov,matroska,wav,aiff,flac,mp3,ogg,aac,ac3,eac3,dts,w64 \
  --enable-decoder=aac,aac_latm,ac3,eac3,dca,opus,vorbis,flac,mp3,alac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8
make -j$(nproc)
strip ffmpeg.exe ffprobe.exe
```

- `dca` = DTS, `eac3` = E-AC-3. No video decoders are enabled — only audio tracks are read.
- Confirm the `configure` summary lists `ac3`, `eac3`, `dca`, `opus` decoders before `make`.
- Target size: ~15–25 MB per binary.

Then copy with the triple naming:

```bash
cp ffmpeg.exe  /path/to/PLVS/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
cp ffprobe.exe /path/to/PLVS/src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe
```

macOS / Linux binaries are built the same way (no MSYS2 layer) and are deferred to a later phase.

## Licensing (LGPL)

`--disable-gpl --disable-nonfree` keeps the build under **LGPL v2.1**, so PLVS stays MIT. The DTS
(`dca`), AC-3/E-AC-3, Opus, and AAC decoders are all within the LGPL set — no GPL flag needed.

LGPL redistribution requires attribution and a pointer to the FFmpeg source. PLVS surfaces this in the
About panel (see `src/`), crediting the FFmpeg project under LGPLv2.1 with a link to
<https://ffmpeg.org/download.html> for the corresponding source.
