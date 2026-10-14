#!/usr/bin/env bash
# Run in an extracted, pristine FFmpeg source directory. On Windows use Git Bash
# with the pinned MinGW bin directory first in PATH (see docs/ffmpeg-sidecar-build.md).
set -euo pipefail
platform="${1:?Usage: build-ffmpeg-sidecars.sh windows|macos}"
extra=()
case "$platform" in
  windows)
    extra+=(--target-os=mingw32 --arch=x86_64 --extra-ldflags=-static)
    ;;
  macos)
    extra+=(--extra-cflags=-mmacosx-version-min=14.2 --extra-ldflags=-mmacosx-version-min=14.2)
    ;;
  *) echo "Unsupported platform: $platform" >&2; exit 2 ;;
esac
./configure \
  --disable-everything --disable-gpl --disable-nonfree --disable-autodetect \
  --disable-doc --disable-avdevice --disable-postproc --disable-swscale \
  --disable-network --disable-encoders --disable-muxers --disable-filters \
  --disable-x86asm --disable-xlib --disable-libxcb --disable-libxcb-shm \
  --disable-libxcb-xfixes --disable-libxcb-shape --disable-sdl2 \
  --enable-small --enable-static --disable-shared --enable-ffmpeg --enable-ffprobe \
  "${extra[@]}" \
  --enable-filter=aresample --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,wav,aiff,flac,mp3,ogg,aac,ac3,eac3,dts,w64 \
  --enable-decoder=aac,aac_latm,ac3,eac3,dca,opus,vorbis,flac,mp3,alac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8 \
  --enable-encoder=pcm_f32le --enable-muxer=pcm_f32le
make -j"${JOBS:-8}"
if [ "$platform" = windows ]; then
  strip ffmpeg.exe ffprobe.exe
else
  strip ffmpeg ffprobe
fi
