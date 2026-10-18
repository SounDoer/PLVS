# Linux stable update audit

Date: 2026-10-18
Candidate release: 0.22.0

## Question

Determine whether the first stable Linux package should enable PLVS's staged in-app installation,
and define the release interface that can be integrated without choosing how FFmpeg and FFprobe are
supplied inside the package.

This audit does not build a stable package or change the release workflow.

## Current behavior

- The updater plugin is registered for stable builds on every desktop platform. Preview compiles it
  out, and the dev identity is not treated as an installed distribution.
- Linux stable code can check `latest.json` if it contains a matching platform descriptor. The
  vendored updater searches `linux-x86_64-deb` before the generic `linux-x86_64` key for a deb.
- Downloaded bytes are signature-verified before entering the cache and are verified again by the
  copied update worker immediately before installation. The signed version is required.
- The vendored updater can install a deb with `dpkg -i`. It first tries `pkexec`, then a graphical
  password prompt plus `sudo -S`, then an inherited-terminal `sudo` fallback.
- PLVS deliberately returns `false` from `installed_distribution()` on Linux. As a result, a Linux
  stable build can display release information but refuses automatic download and installation and
  sends the user to GitHub Releases for a manual download.
- The shared update-acceptance report can represent Linux, but no Linux packaged-update producer or
  real Linux upgrade evidence exists. Current packaged acceptance proves Windows and macOS only.

## Recommendation for the first stable Linux release

Ship manual Linux upgrades first. Publish the stable deb as a signed release asset and include its
signed `linux-x86_64-deb` descriptor in `latest.json`, so an installed Linux build can discover the
new version and show its release notes. Keep `installed_distribution()` false for Linux, keep
automatic download disabled, and route the action to the immutable GitHub Release.

This separates two claims:

1. The exact stable deb was built, installed, launched, inspected, and removed successfully.
2. PLVS can replace that installed deb through its own helper and recover safely across native
   authorization, interruption, cancellation, and failure.

The first claim is required for the first stable package. The second is not established yet and
must not be implied by the existence of updater code.

## Decoder supply status

The immutable `ffmpeg-sidecar-7.1.5-r1` tooling release now supplies Linux x86_64 FFmpeg and
FFprobe binaries alongside the Windows and macOS assets. Its workflow builds all three platforms
from the same pinned FFmpeg 7.1.5 source, restricts Linux runtime dependencies to the reviewed base
glibc libraries, exercises representative real decodes, records binary hashes and build evidence,
and publishes the complete corresponding source.

That establishes the decoder supply input, not the Linux application integration. The app fetcher,
Linux Tauri bundle configuration, deb contents, runtime lookup, license inventory, clean-system
package verification, and release workflow still need to consume and prove those exact assets on
Ubuntu. Until that work lands, the Preview continues to use distribution-managed decoders under
ADR 0032 and no stable Linux package exists.

When the stable package becomes user-facing, provide a Linux-specific manual-update explanation
instead of the current generic text about an installed version. Update the matching user-guide
chapter in the release candidate change.

## Release integration contract

The decoder implementation may change independently, but the stable release lane should eventually
provide all of the following:

- one Ubuntu 24.04 x86_64 stable-identity deb built from the exact reviewed release SHA;
- a Tauri updater signature for those exact deb bytes;
- a public, versioned deb asset name owned by `scripts/release-assets.mjs`;
- an updater descriptor with platform key `linux-x86_64-deb`, the immutable Release URL, and the
  deb signature;
- fresh Ubuntu installation verification of package identity, CLI discovery, decoder resolution,
  representative file analysis, GUI startup, license resources, and clean removal;
- a short-lived verification-evidence artifact and a tested Linux release candidate artifact;
- inclusion in the all-platform Draft inventory and `validate-release-bundle.mjs` gate before the
  irreversible publication step.

Preview must retain `preview-identity`, its isolated data and manifest, no updater artifacts, and a
package conflict with stable PLVS. Stable and Preview may not silently overwrite one another.

## Conditions before enabling in-app deb installation

Add a Linux adapter to packaged update acceptance and collect real evidence for at least:

- an old-to-new upgrade between two real isolated deb packages;
- selection of `linux-x86_64-deb` and rejection of wrong, stale, and truncated signed bytes;
- offline installation after the signed package is cached;
- `pkexec` approval and cancellation in a real desktop session;
- a defined result when `pkexec` is unavailable, without collecting an administrator password in
  PLVS-owned UI or hanging on a terminal-less `sudo` process;
- behavior when the new deb introduces an unsatisfied dependency, because `dpkg -i` does not resolve
  dependencies like `apt install` does;
- helper interruption before replacement, installer failure, relaunch, retained settings, and
  multi-workbench restoration;
- cleanup proving no helper, gate, cache mutation, or isolated installation remains.

Before enabling the feature, review whether the graphical password and terminal `sudo` fallbacks
are acceptable product behavior. Prefer one documented native authorization path with an explicit
manual fallback over multiple weakly observable privilege mechanisms.

## Decoder decision boundary

[ADR 0032](../../adr/0032-linux-deb-uses-distribution-decoders.md) governs the current Preview and
chooses Ubuntu-managed FFmpeg/FFprobe. The stable package is intended to ship the new PLVS-managed
decoder sidecars, so its integration change must add a new ADR that supersedes ADR 0032 for stable
packages; ADRs are immutable. The new decision must cover private install paths, runtime lookup,
ABI and distribution compatibility, reproducible builds, hashes, license/source obligations,
package size, and package verification.

The stable release workflow should not be connected to the sidecars until the Linux-machine work
delivers that decision and real package evidence.
