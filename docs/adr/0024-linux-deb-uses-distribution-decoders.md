# ADR 0024: Ubuntu deb packages use distribution-managed decoders

Date: 2026-10-09

## Context

The initial Linux Preview targets Ubuntu 24.04 x86_64. Windows and macOS packages ship trimmed
FFmpeg executables beside PLVS. Tauri installs deb executables in `/usr/bin`, where the Ubuntu
`ffmpeg` package already owns `ffmpeg` and `ffprobe`. Shipping our own files at those paths would
conflict with that package. A portable Linux bundle would instead need a private binary layout,
its own verified decoder supply, and separate compatibility testing.

## Decision

The Ubuntu deb declares `ffmpeg (>= 7:6.1)` as a dependency and bundles only the PLVS CLI companion.
Both decoders resolve next to `/usr/bin/plvs` through the existing locator, without a PATH search
or environment override. APT installs and updates the decoders. Installation verification checks
their package ownership, runs the installed CLI diagnostics, and decodes representative codecs.

The Preview uses its existing separate application identity and disables automatic updates through
the `preview-identity` feature. Its package conflicts with `plvs`: the initial Linux Preview and a
future stable deb cannot coexist because both install `/usr/bin/plvs` and `/usr/bin/plvs-cli`.
No stable Linux package is currently published. Preview replacement uses APT, not the updater.

## Consequences

The deb does not redistribute decoder binaries or depend on a developer's local installation.
It does require access to Ubuntu repositories when missing dependencies are installed. This is not
a portable or offline-complete package, and does not establish an AppImage or Flatpak policy.
The build baseline is Ubuntu 24.04, including the glibc 2.39 requirement of the linked ONNX runtime.
Broader distribution, desktop, and hardware support still requires separate acceptance evidence.
