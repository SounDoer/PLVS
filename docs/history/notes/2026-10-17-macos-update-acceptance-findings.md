# macOS Packaged Update Acceptance Findings

**Date:** 2026-10-17

**Source:** `32fb38bac51ab174182dca1683f8c2a6597e011d`

## Outcome

The Apple Silicon writable-path scenario passed with an ad-hoc-signed isolated app. A packaged
0.21.0 app discovered and cached 0.21.1, retained the offer across an offline restart, replaced the
same `.app` bundle while the loopback feed was stopped, relaunched, and reported 0.21.1 from both
the application and bundled CLI. The helper recorded `finished`, the ready cache was cleared, and
the bottom Dock returned at 160 CSS px with the same eight panels.

Three additional packaged checks passed. From the mounted read-only DMG, automatic download was
disabled with guidance to move PLVS to Applications and no package was staged. A stale signature
and a deliberately truncated updater archive were both rejected before Ready state; the UI showed
an actionable failure and the cache retained `ready: null`.

Evidence is under the ignored directory
`artifacts/update-acceptance/32fb38ba/runs/launchservices-offline/`. The verifier reports the routine
run as complete while listing privileged install, authorization cancellation, and notarization as
the remaining explicit gaps.

## Defects found and fixed

1. The builder assumed that the base fixture version must change when applying the base version.
   That rejected an unchanged, valid base snapshot. The seam now accepts exactly one matching
   workspace version whether or not replacement changes the text.
2. The isolated bundled CLI read the stable settings location when deciding whether Agent Control
   was enabled. It now honors the same `PLVS_TEST_IDENTITY_ROOT` boundary as the isolated app.
3. macOS `tar` copied AppleDouble `._*.app` metadata into the updater archive. Tauri attempted to
   unpack that metadata entry as the application bundle and refused installation. The builder now
   sets `COPYFILE_DISABLE=1` for updater archives, and a contract test protects that requirement.

## Rig and automation findings

- Launching the test binary as the foreground process of a disposable terminal session caused the
  detached update helper to die when that terminal session closed. Launching the packaged app
  through macOS LaunchServices matched production behavior and completed the handoff. The runner
  therefore uses `open -n -a ... --args` rather than attaching the GUI process to its terminal.
- The disposable app path had no macOS Accessibility grant. Reserve Screen Space was refused with
  the expected guidance, while ordinary Dock geometry and restart restoration passed. The run did
  not change System Settings. This remains a clearly reported non-blocking rig boundary.
- Routine UI confirmation is intentionally visible. The macOS runner automates staging, feed
  shutdown, offline transition, evidence collection, comparison, and verification, but pauses for
  enabling Auto Download and confirming Update and Restart.

## Remaining work

- Fold the proven read-only DMG, stale-signature, and truncated-package checks into runner-owned
  scenarios, and add deterministic helper interruption.
- Add manual `/Applications` approval and cancellation evidence without storing credentials.
- Migrate the Windows operator flow onto the same guided runner and result schema; only then add the
  common npm command aliases.
- Add advisory exact-SHA evidence reporting to stable release review after both platform runners
  have produced comparable evidence.
