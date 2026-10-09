# Linux Support: Initial Implementation Plan

Date: 2026-10-09
Branch: `codex/linux-support`
Starting commit: `5722deb5`

## First milestone

Produce a development build for Ubuntu 24.04 x86_64 with a PipeWire desktop:
normal application windows, the existing meters, physical audio inputs, system-output
monitoring, and file analysis. This target is an initial validation environment, not a
promise of compatibility with every Linux distribution or desktop.

Per-application capture, desktop-edge reservation, screenshots, recording, and broader
distribution packaging require subsequent platform work. Unsupported capabilities must be
reported accurately rather than exposing Windows assumptions as working Linux features.

## Confirmed starting point

- CI already checks and tests the Rust workspace on Ubuntu 24.04, including the Linux
  Tauri/WebKitGTK and ALSA development dependencies. It does not verify live capture.
- `audio/platform_backend.rs` routes Linux through cpal. `audio/device_enum.rs` currently
  presents output devices as loopback sources; this is not evidence that Linux output
  monitoring works.
- The meter pipeline and DSP can be reused behind the capture abstraction.
- Agent Control transport currently supports Windows and macOS only. The macOS Unix
  socket implementation is a candidate for reuse, subject to a Linux peer-credential and
  filesystem-security review; changing conditional compilation alone is insufficient.
- Visual capture explicitly reports unsupported platforms.
- The FFmpeg fetch script has Windows and macOS assets only. Linux file analysis needs a
  verified binary supply and packaging path before it can be considered supported.
- This Windows host has WSL2's Docker distribution only; no general-purpose Linux
  development distribution was present during initial inspection.

## Implementation sequence

1. Bootstrap this isolated worktree and establish a test baseline. Provision a reproducible
   Linux build environment using the existing Ubuntu CI dependencies. Verify a development
   GUI launch before assuming that workspace compilation implies a usable desktop app.
2. Inspect the pinned cpal Linux backends and prototype a PipeWire-compatible capture
   path. Decide between native PipeWire and an appropriate compatibility API using actual
   enumeration, routing, channel-layout, and idle-stream measurements.
3. Implement source discovery and stable identities, physical inputs, and output monitors
   behind the capture abstraction. Reuse the existing bounded PCM delivery and metering
   pipeline; do not allocate, lock, or syscall in realtime callbacks.
4. Supply and verify Linux FFmpeg/FFprobe, then validate representative file formats.
5. Audit window, tray, autostart, updater, and capability reporting. Test the normal window
   on the target desktop and explicitly track X11/Wayland differences.
6. Add a Linux capture rig and package verification before producing an installable Preview.
   Keep Linux publication separate from the Windows-only Preview workflow until its
   platform contract is extended deliberately.

## Validation and completion evidence

- Run repository-required checks for each changed area and the full gate before a push.
- Use known audio fixtures to compare loudness, peak, sample rate, channel order, and
  dropped-frame behavior. Reject silent or null-loudness runs as successful capture proof.
- Exercise idle/resume, default-output changes, disconnect/reconnect, and clean shutdown.
- Verify rendering through screenshot comparisons once Linux Agent Control capture is
  available; record any earlier manual visual checks as manual evidence only.
- Run real capture smoke and a four-hour soak on the Linux desktop, comparing drift with
  retained baselines. WSL or headless CI is not the native desktop acceptance environment.
- Update relevant living architecture and user-guide documentation alongside implemented
  behavior. Do not advertise support based on this plan or a green compile alone.

## Current state

The isolated worktree has been created. Platform inspection is complete for the initial
scope above. No Linux runtime or capture validation has been performed, and no Linux
support is claimed by this setup step.

## Development environment established

On 2026-10-09, imported Canonical's Ubuntu 24.04.5 WSL image as
`PLVS-Ubuntu-24.04`, after verifying its SHA-256 against the official release checksum.
The existing Docker distribution was left separate. The distro is stored at
`C:\Users\shenxichen\WSL\PLVS-Ubuntu-24.04` and uses the unprivileged `plvs` account.
No account password was created; administrative setup used WSL's explicit root user.

Installed Node 24.19.0, Rust 1.98.1 with Clippy/rustfmt, the Linux CI build dependencies,
PipeWire/PulseAudio development libraries, and Ubuntu's FFmpeg/FFprobe. The latter are
development tools, not the future distributable sidecars; file-analysis experiments can
use `PLVS_FFMPEG_DIR=/usr/bin`.

The editable source remains the Windows `codex/linux-support` worktree. A disposable
source copy at `/home/plvs/build/PLVS-linux` has its own Linux dependencies and build
outputs. Synchronize source changes from the worktree before Linux checks, excluding
`.git`, `node_modules`, `target`, `.codex`, `artifacts`, `dist`, logs, and Windows binaries.
Do not treat this source copy as a second Git worktree or edit it as the source of truth.

Enter the environment from PowerShell with:

```powershell
wsl -d PLVS-Ubuntu-24.04
```

For noninteractive project commands, use `wsl -d PLVS-Ubuntu-24.04 -- bash -lc '...'
so the user toolchain paths are loaded.

Validation completed: project `npm ci`, `npm run typecheck`, and `npm run build`;
a Rust executable compiled, linked, and ran; required libraries resolved through
`pkg-config`; FFmpeg/FFprobe ran; and `pactl info` connected to WSLg's PulseAudio server.
WSLg exposes RDP audio endpoints, not a native PipeWire desktop. At environment bootstrap,
full PLVS Rust build and runtime validation were still outstanding; the first implementation
iteration below records the subsequent work.

## First implementation iteration

Implemented Linux source discovery through cpal's PulseAudio backend and server monitor metadata,
including native source IDs and explicit default-output monitor resolution. Requests use float
PCM at the source rate and channel count. The first real smoke exposed oversized default server
fragments: the shared 100 ms pool rejected callbacks. Negotiating 20 ms fragments resolved the
drops without callback allocation or changing the existing metric tolerances.

Added `smoke:capture:linux` with an isolated null sink and the shared asymmetric signal/file-analysis
comparison. The signal smoke passed with zero dropped chunks; a separate seven-second silent
monitor capture also completed with zero drops and no false stall. Temporary sinks were removed.
These are WSLg protocol-path results, not native Linux hardware acceptance.

Added `desktop:linux`, using the development identity and explicitly located system decoders.
The real Tauri process and WebKit windows launched. Runtime inspection found and fixed a CLI/GUI
path mismatch: Linux CLI discovery now uses the same XDG data directory as Tauri. `plvs-cli instances`
then reported the visible development workbench and its selected output. Added the development
account to `video` and `render`; the bounded GUI verification sessions were stopped afterward.

Validation: 5,194 Vitest tests passed with two workers; Linux and Windows Rust unit and integration
suites passed after reducing resource contention. The new Linux identity-root regression test and
48 relevant tooling/documentation tests passed separately. Linux strict Clippy, formatting,
frontend lint/typecheck, and generated-license verification passed. Early high-concurrency runs
hit existing test timeouts and Windows paging-memory exhaustion; neither failure was waived.

Windows build artifacts grew large during the initial cross-platform checks. This worktree's
`src-tauri/target` now points through a directory junction to
`D:\PLVS-build-cache\linux-support-windows`. Source files and the Ubuntu distribution remain on C.
The external build cache will need separate cleanup when this feature worktree is retired.

Evidence is saved locally under `artifacts/linux/2026-10-09/`. Work remains on native desktop
and physical-device validation, multichannel routing, device switching, long-running soak,
per-application sources, Agent Control/visual capture, and distributable Linux sidecars/packages.
The PulseAudio dependency also logs normal discovery-client disconnections noisily; review that
diagnostic behavior before release without suppressing actual stream failures.
