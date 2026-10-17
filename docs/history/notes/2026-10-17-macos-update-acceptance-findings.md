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

A later runner-owned replay is under `runs/runner-owned-faults-v5/`. It passed the stale-signature
and truncated-package rejection scenarios with real error screenshots, then completed the same
offline update and cleanup. Its only required automated gap is the read-only DMG scenario.

## Defects found and fixed

1. The builder assumed that the base fixture version must change when applying the base version.
   That rejected an unchanged, valid base snapshot. The seam now accepts exactly one matching
   workspace version whether or not replacement changes the text.
2. The isolated bundled CLI read the stable settings location when deciding whether Agent Control
   was enabled. It now honors the same `PLVS_TEST_IDENTITY_ROOT` boundary as the isolated app.
3. macOS `tar` copied AppleDouble `._*.app` metadata into the updater archive. Tauri attempted to
   unpack that metadata entry as the application bundle and refused installation. The builder now
   sets `COPYFILE_DISABLE=1` for updater archives, and a contract test protects that requirement.
4. LaunchServices redirected a repeated run to an older extracted app with the same bundle ID. The
   runner now starts the exact executable path, and the process-path cleanup guard remains exact.
5. Immediate CLI polling could create the multi-instance directory before the app completed its
   first persistence migration. The runner now waits for the migration marker before discovery.

## Rig and automation findings

- Launching through macOS LaunchServices completed the helper handoff in the first run, but a later
  repeated run proved that LaunchServices may redirect the same test bundle identifier to an older
  extracted copy. The runner now launches the exact bundle executable as a background child of the
  long-lived acceptance process. This keeps path ownership deterministic without recreating the
  earlier disposable-terminal failure that killed the helper's process session.
- The disposable app path had no macOS Accessibility grant. Reserve Screen Space was refused with
  the expected guidance, while ordinary Dock geometry and restart restoration passed. The run did
  not change System Settings. This remains a clearly reported non-blocking rig boundary.
- Routine UI confirmation is intentionally visible. The macOS runner automates fault switching,
  error-surface detection and capture, staging, feed shutdown, offline transition, evidence
  collection, comparison, and verification, but pauses for Auto Download, each real Retry, normal
  offline restart, and Update and Restart.

## Remaining work

- Fold the proven read-only DMG check into a runner-owned scenario, and add deterministic helper
  interruption.
- Add manual `/Applications` approval and cancellation evidence without storing credentials.
- Run the migrated Windows NSIS adapter on a Windows acceptance host. Its install, launch, helper,
  cleanup, result-schema, and common npm-command contracts are implemented, but macOS code tests do
  not count as Windows execution evidence.
- Produce the first real Windows-host evidence. Stable release preflight now reports exact-SHA
  evidence for both platforms as an advisory, including missing, invalid, incomplete, and stale
  states; it can become blocking only after comparable Windows and macOS runs are routine.
