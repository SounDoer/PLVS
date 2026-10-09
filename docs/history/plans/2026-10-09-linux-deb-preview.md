# Ubuntu Preview Packaging

Date: 2026-10-09
Branch: `codex/linux-support`
Starting commit: `82ffe310`

## Scope

Produce and validate a local, optimized Ubuntu 24.04 x86_64 Preview deb. Keep the existing Preview
application identity, ship embedded frontend assets and the independent CLI, and disable automatic
updates. Do not publish assets, change the official release matrix, or claim native hardware support.

The deb uses APT-managed FFmpeg/FFprobe, with the durable decision in ADR 0024. Its build command
must reject unsupported hosts and extra feature flags. Package configuration contracts and the
normal JavaScript suites cover tooling changes.

## Acceptance

- Build the actual deb on Ubuntu 24.04, without development or capture-harness features.
- Install into a fresh Ubuntu userspace with only test tooling provisioned, resolving application
  libraries through the deb's declared dependencies.
- Verify Preview identity, writable isolated user storage, decoder locations and package ownership,
  desktop integration, license resources, and CLI discovery.
- Exercise representative codecs through the installed distribution decoders and run the existing
  real Rust file-analysis tests separately.
- Launch the installed GUI as an unprivileged user under Xvfb and a private PulseAudio server.
  Require a visible registered workbench and a live process. This is startup evidence, not pixel,
  accelerated graphics, physical-device, or native desktop acceptance.
- Remove the package and verify executable/resource/desktop cleanup without deleting user data or
  distribution decoders. Retain the package checksum and test logs.

## Environment

Builds run in `/home/plvs/build/PLVS-linux` in `PLVS-Ubuntu-24.04`. A fresh minbase Ubuntu root is
bootstrapped at `/home/plvs/rigs/ubuntu-24.04-deb`; mount isolation keeps its temporary `/proc` and
`/dev` mounts out of the development host's mount namespace. The root contains no Rust or Node
toolchain. Test scripts refuse to install/remove packages without an explicit disposable-rig marker.

## Implementation and evidence

Added `desktop:preview-deb`, an explicit Ubuntu x86_64 build guard, the deb dependency overlay,
generated Linux CLI discovery paths, configuration regression tests, and disposable-system package
verification scripts. Tauri's resource maps merge recursively: initial repackaging exposed stable
and Preview manifests targeting the same installed filename. The Linux builder now resets the base
resource map before applying Preview's full map; the package smoke verifies the actual installed
manifest rather than only the source config. Other Preview packaging entry points have not been
changed or audited in this iteration.

The first fresh-root installation successfully ran the installed GUI and seven decoder formats.
Its logs exposed missing system TLS certificates, so `ca-certificates` is now a declared dependency
and the runtime smoke requires a nonempty trust store. The initial removal assertion also assumed
the legacy settings filename; it now verifies the actual shared SQLite library and workspace state
created by normal GUI startup. No application state was injected or changed through a test shortcut.

The final optimized deb is 18.01 MiB. Installation, Preview identity, declared decoder ownership and
paths, TLS trust, seven codec decode checks, unprivileged GUI startup with a visible registered
workbench, and removal all passed. Uninstall retained both user-data checksums and the distribution
decoder binaries. All 16 packaged license assets passed the existing verifier. The GUI ran under
Xvfb without disabling WebKit's sandbox; this is not accelerated rendering or native desktop proof.

The existing 20 Rust file-analysis tests passed with real system decoders. The full Vitest run had
5,196 passing tests and one existing ESLint-probe timeout; its isolated rerun passed without changing
the timeout. After the resource-reset regression was added, all 29 focused packaging/security/docs
tests passed. Formatting, version consistency, shell/Python syntax, and diff-whitespace checks passed.

Artifact and evidence: `artifacts/linux/2026-10-09/deb-preview/` (ignored, local only).
Package: `plvs-preview_0.19.0_amd64.deb`.
SHA-256: `41e73457ebc8ee329681fa76e6a3d37d0d36c334de5bbef62ed2c6ce693b5026`.

No GitHub workflow was dispatched, no package was published, and no official release assets or
version were changed. Native hardware, Wayland/X11 desktop acceptance, four-hour Linux soak,
broader distribution compatibility, and integration into the official release pipeline remain.
