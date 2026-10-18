# ADR 0033: Linux deb packages bundle private FFmpeg sidecars

Date: 2026-10-18

Supersedes: [ADR 0032](0032-linux-deb-uses-distribution-decoders.md)

## Context

The first Ubuntu Preview delegated file decoding to Ubuntu's `ffmpeg` package because Tauri places
ordinary external binaries in `/usr/bin`, where distribution FFmpeg already owns the names. That
made Linux behavior depend on the user's configured repositories and decoder version, unlike the
checksum-pinned Windows and macOS packages. It also prevented an offline-complete stable package.

The conflict is a layout problem, not a requirement to use system FFmpeg. Debian packages can own
private executables below `/usr/lib/<package>`, and the runtime already resolves decoder paths
without searching `PATH`.

## Decision

Stable and Preview x86_64 Ubuntu packages bundle PLVS-built FFmpeg 7.1.5 `ffmpeg` and `ffprobe` in
identity-private directories:

- stable: `/usr/lib/plvs/sidecars`
- Preview: `/usr/lib/plvs-preview/sidecars`

The runtime resolves only the matching identity's directory in packaged Linux builds. It never
falls back to `/usr/bin/ffmpeg` or `/usr/bin/ffprobe`; `PLVS_FFMPEG_DIR` remains an explicit
development/test override. The Debian package neither depends on nor conflicts with Ubuntu's
`ffmpeg` package.

All desktop targets use the same audio-only LGPL recipe and enabled codec set. Binaries and the
complete corresponding-source archive are immutable GitHub Release assets pinned by SHA-256.
Linux targets x86_64 and the Ubuntu 24.04 baseline (glibc 2.39 or older symbols); its sidecars may
depend only on glibc, libm, and the ELF loader. Package verification installs into a disposable
Ubuntu root with no system FFmpeg, decodes representative real fixtures, launches the app and CLI,
then uninstalls and checks that the private sidecars were removed without deleting user data.

The recipe disables GPL and nonfree components, encoders except the raw PCM output required by
PLVS, video, network access, and external codec libraries. Codec patent exposure is not settled by
the LGPL: supported compressed formats may be patent-encumbered in some jurisdictions, so PLVS
does not claim patent rights or add optional patented encoders.

## Consequences

Linux decoding is reproducible, works without an FFmpeg APT dependency, and matches the version and
codec surface shipped on Windows and macOS. Installing or removing PLVS cannot replace the system
FFmpeg tools. The package grows by roughly 4 MB before compression and PLVS must retain the offered
corresponding source and build records for every published sidecar set.

This establishes only the Ubuntu 24.04 x86_64 deb baseline. Other architectures, older glibc
baselines, AppImage, Flatpak, and broader desktop/hardware acceptance remain separate work.
