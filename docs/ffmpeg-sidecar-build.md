# FFmpeg Sidecar Build

File mode decodes audio through a bundled, trimmed **FFmpeg** pair (`ffmpeg` + `ffprobe`) run as
Tauri sidecars (`externalBin` in `tauri.conf.json`). This replaces Symphonia and gives full codec
coverage (AC-3, E-AC-3, DTS, Opus, HE-AAC, AAC-LC, PCM, …) for audio tracks inside video containers.

The binaries are **not committed** to git (`src-tauri/binaries/.gitignore` ignores everything but
itself). They are produced out-of-band and hosted as GitHub Release assets; the bundle step pulls
them into `src-tauri/binaries/`.

## Fetching the published binaries

The binaries live on a dedicated, version-pinned release (named after the FFmpeg version, not the
app version): <https://github.com/SounDoer/PLVS/releases/tag/ffmpeg-sidecar-7.1>.

`scripts/fetch-ffmpeg-sidecar.mjs` downloads them into `src-tauri/binaries/` and verifies each
against a pinned SHA-256. It is idempotent — a file already present with the right hash is skipped —
so it runs automatically before the desktop build/dev/release scripts (`npm run desktop`,
`desktop:build`, `desktop:release-nsis`) and can also be run on its own:

```bash
npm run ffmpeg:fetch
```

Windows (`x86_64-pc-windows-msvc`) and macOS (`aarch64-apple-darwin`) binaries are published.
PLVS does not ship a Linux app, so no Linux sidecar exists; `externalBin` is declared only in
`tauri.windows.conf.json` / `tauri.macos.conf.json` (not the base config), so Linux builds — including
the ubuntu CI fmt/clippy/test job — do not require a binary. When you bump the FFmpeg version, upload
the new binaries to a new `ffmpeg-sidecar-<version>` release and update `TAG` + the SHA-256 values in
the fetch script.

The trimmed audio-only build is tiny: **~2 MB each** (ffmpeg + ffprobe), versus ~220 MB for a full
prebuilt. No video decoders, encoders, filters, network, or x86 assembly are included.

## Naming

Tauri's `externalBin` resolves per-platform by appending the Rust host target triple, then strips it
on install. Files must be named:

- `src-tauri/binaries/ffmpeg-<target-triple>.exe`
- `src-tauri/binaries/ffprobe-<target-triple>.exe`

Get the triple from `rustc -vV` (the `host:` line). On Windows it is `x86_64-pc-windows-msvc`. (The
FFmpeg binary itself is built with MinGW, but the name must match the *Rust* target triple so Tauri
can find it — the sidecar's own toolchain is irrelevant since it runs as a standalone process.)

## Dev shortcut

The Rust runtime locator honors `PLVS_FFMPEG_DIR`, which should point at a directory containing
plainly-named `ffmpeg.exe`/`ffprobe.exe`. Handy for running the gated `file_analysis::session`
integration tests against a real binary (e.g. the build output dir):

```bash
PLVS_FFMPEG_DIR="/c/ffmpeg-build/ffmpeg-7.1" cargo test --manifest-path src-tauri/Cargo.toml file_analysis
```

Any full `ffmpeg`/`ffprobe` build placed in `src-tauri/binaries/` with the triple naming also
satisfies the Tauri build during development.

## Building the trimmed binary (Windows)

> **We do NOT use the MSYS2 installer.** Its GUI installer reliably hangs on first-run GPG keyring
> setup ("Updating trust database") in unattended environments. Instead we use the **winlibs**
> standalone MinGW-w64 toolchain (a plain zip — no installer, no gpg, no pacman) and run FFmpeg's
> POSIX `configure` under **Git Bash** (which ships an MSYS2 runtime + coreutils). No `nasm` is needed
> because x86 assembly is disabled (audio decode correctness is unaffected).

### 1. Toolchain (one-time)

Download a winlibs UCRT x86_64 build (plain zip) and extract it, e.g. to `C:\ffmpeg-build\mingw64`:

```bash
# Asset list: https://github.com/brechtsanders/winlibs_mingw/releases
curl -sL -o winlibs.zip "<winlibs x86_64-posix-seh ucrt .zip url>"
"/c/Program Files/7-Zip/7z.exe" x winlibs.zip -oC:\\ffmpeg-build -y   # -> C:\ffmpeg-build\mingw64
```

It provides `gcc`, `ld`, `ar`, `strip`, and `mingw32-make` (copied to `make` by the build script).

### 2. Source

```bash
curl -sL -o ffmpeg-7.1.tar.xz "https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz"
tar -xf ffmpeg-7.1.tar.xz       # Windows' tar.exe handles .xz
```

### 3. Configure + build (run in Git Bash)

```bash
export TMPDIR=/c/ffmpeg-build/tmp && mkdir -p "$TMPDIR"   # Git Bash's Windows TMP breaks configure
cp -f /c/ffmpeg-build/mingw64/bin/mingw32-make.exe /c/ffmpeg-build/mingw64/bin/make.exe
export PATH="/c/ffmpeg-build/mingw64/bin:$PATH"
cd ffmpeg-7.1
./configure \
  --disable-everything --disable-gpl --disable-nonfree \
  --disable-doc --disable-avdevice --disable-postproc --disable-swscale \
  --disable-network --disable-encoders --disable-muxers --disable-filters \
  --disable-x86asm \
  --enable-small --enable-static --disable-shared --extra-ldflags=-static \
  --enable-ffmpeg --enable-ffprobe \
  --target-os=mingw32 --arch=x86_64 \
  --enable-filter=aresample \
  --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,wav,aiff,flac,mp3,ogg,aac,ac3,eac3,dts,w64 \
  --enable-decoder=aac,aac_latm,ac3,eac3,dca,opus,vorbis,flac,mp3,alac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8 \
  --enable-encoder=pcm_f32le \
  --enable-muxer=pcm_f32le
make -j"$(nproc)"
strip ffmpeg.exe ffprobe.exe
```

**Why each non-obvious flag matters:**

- `dca` = DTS, `eac3` = E-AC-3. No video decoders are enabled — only audio tracks are read.
- The **output** side is easy to over-trim. PLVS decodes to raw f32le PCM on a pipe, which needs all
  three of: `--enable-protocol=pipe` (for `pipe:1` stdout and `-progress pipe:2`), the
  `--enable-encoder=pcm_f32le`, and the `--enable-muxer=pcm_f32le` (the muxer's component name is
  `pcm_f32le`, *not* `f32le` — `f32le` is only the `-f` format alias).
- `--disable-gpl --disable-nonfree` keeps the build under **LGPL** (see below).

### 4. Install with the triple naming

```bash
cp -f ffmpeg.exe  <repo>/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
cp -f ffprobe.exe <repo>/src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe
```

### 5. Verify

```bash
ffmpeg.exe -hide_banner -decoders | grep -E ' (ac3|eac3|dca|opus|aac) '   # all present
ffmpeg.exe -nostdin -loglevel error -progress pipe:2 -i SAMPLE.mkv \
  -map 0:a:0 -vn -f f32le pipe:1 | wc -c                                  # > 0 bytes of PCM
```

The macOS (`aarch64-apple-darwin`) binary is built on a CI runner — see
`.github/workflows/build-ffmpeg-sidecar-macos.yml` — which compiles the same trimmed configuration on
`macos-latest` (native clang/make, no winlibs/Git-Bash layer; drop `--target-os`/`--arch` and the
`-static` link flag, add `-mmacosx-version-min`) and uploads the result to the release. PLVS ships no
Linux app, so no Linux binary is built.

## Licensing (LGPL)

`--disable-gpl --disable-nonfree` keeps the build under **LGPL v2.1**, so PLVS stays MIT. The DTS
(`dca`), AC-3/E-AC-3, Opus, and AAC decoders are all within the LGPL set — no GPL flag needed.

LGPL redistribution requires attribution and a pointer to the FFmpeg source. PLVS records this in
`THIRD-PARTY-NOTICES.md` (FFmpeg `n7.1`, LGPLv2.1, source at <https://ffmpeg.org/download.html>).
Because FFmpeg runs as a separate, user-replaceable executable, the LGPL relinking provision is
satisfied without further action.
