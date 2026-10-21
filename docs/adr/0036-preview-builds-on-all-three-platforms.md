# ADR 0036: Build Preview on Windows, macOS and Linux

## Status

Accepted (2026-10-21). Supersedes the "Keep Preview Windows-only" decision in ADR 0007 and the
sentence in ADR 0032 that a stable deb cannot coexist with the Preview deb; the rest of both stands.

## Context

ADR 0007 kept Preview Windows-only; an Ubuntu deb was added later for Linux bring-up and macOS never
had one. Stable releases now ship and smoke-test all three platforms as equals, so a change could
only be tried by testers on Windows and Ubuntu before it reached a stable release.

The Ubuntu Preview deb also installed `/usr/bin/plvs`, `/usr/bin/plvs-cli` and the `plvs` icons,
the same paths as the stable deb, and the two packages declared `Conflicts` on each other. Since the
stable deb shipped in 0.23.0, installing a Preview removed stable PLVS.

## Decision

- `preview-build.yml` builds Windows, macOS and Linux in parallel by default (`platform: all`) and
  publishes them in one immutable Pre-release; a single platform remains selectable. Every selected
  platform must pass; there is no partial publication for `all`.
- macOS Preview is an Apple Silicon DMG with `com.soundoer.plvs.preview` / `PLVS Preview`, signed
  and notarized with the release Developer ID credentials, and smoke-tested on a pinned hosted
  runner. The updater stays compiled out on every platform.
- The Linux Preview deb installs `plvs-preview` and `plvs-preview-cli` (Tauri `mainBinaryName` plus a
  renamed external binary). Its icons and desktop entry follow, every other path was already
  identity specific, and neither deb declares `Conflicts`. Both build scripts emit the names as
  `PLVS_HOST_BINARY` / `PLVS_CLI_BINARY` so the CLI forwarder, doctor and Agent Control find each
  other. Windows and macOS keep `plvs` / `plvs-cli`, because each identity has its own install
  folder there.
- The Linux clean-system verification installs Preview beside a stable deb built from the same
  commit, launches both, removes Preview and checks that stable still verifies and launches.
- `npm run preview:dispatch` replaces the hand-written dispatch snippet.

The obvious simpler alternatives were a Linux Preview that keeps the stable executable names and its
`Conflicts`, and an unsigned macOS DMG. The first silently uninstalls the tester's stable PLVS. The
second is blocked by Gatekeeper for every tester. Signing Preview uses the release secrets in a
workflow any repository writer can dispatch from any branch; repository write access already allows
changing `release.yml`, so this does not widen who can sign.

## Consequences

- Testers on every platform receive the same commit from one Release URL.
- On Linux the Preview command names differ from stable (`plvs-preview-cli` rather than `plvs-cli`);
  the discovery manifest records the Preview path. Help text still says `plvs-cli`.
- The PLVS 0.23.0 stable deb still declares a conflict with `plvs-preview`; coexistence starts with
  the next stable deb.
- A full Preview takes as long as the slowest platform, and the Linux job also builds a stable deb
  for the coexistence check. One platform failing blocks the whole `all` Preview.
- macOS Preview notarization depends on Apple's service and the shared Developer ID certificate.

## Verification

Contract tests cover the dispatch platforms, the gating of the Draft on every selected platform,
the macOS signing and smoke steps, the Linux executable names and coexistence check, and the
dispatch script. Run 39611316605 (`platform=all`, commit `14ae9bf`) published the immutable,
attested Pre-release `preview-14ae9bf-39611316605` with all four packages: the Windows installer
smoke passed, the macOS DMG was notarized and passed its Preview smoke, and the Ubuntu clean system
installed Preview beside a stable deb, launched both, removed Preview and launched stable again.
