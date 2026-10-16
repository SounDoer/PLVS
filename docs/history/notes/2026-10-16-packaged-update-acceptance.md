# Packaged update acceptance

## Windows isolated installer run

Source: `658b15b428e8d5c49a6ec20a1dc271fa214f4c56`. Packages: 0.21.0 and 0.21.1,
with application identity `com.soundoer.plvs.updatetest.h658b15b4`. The test uses the
stable updater code path, an ephemeral signing key and a loopback-only feed, debug
Rust with an embedded desktop frontend, and zlib NSIS compression. It does not use
Preview, whose updater is intentionally disabled. The only runtime source
substitution is the Windows installation registry namespace. Package hashes and
public signatures are recorded in ignored `artifacts/update-acceptance/658b15b4/acceptance.json`.

The initial acceptance script omitted the desktop environment flag during its
standalone Vite build. Those browser-mode packages were invalidated and rebuilt
with `TAURI_ENV_PLATFORM=windows`; they are not acceptance evidence.

Observed on Windows:

- Fresh setup displayed check enabled and download disabled. No feed request was
  recorded before Save Preferences. Enabling download and saving triggered the
  manifest request and package download.
- A stale feed signature paired with the rebuilt installer was rejected: no ready
  package was retained. Restarting with the corrected feed staged the verified
  package without opening an update dialog during the session.
- With the feed process stopped, manual confirmation installed the cached package
  into `Installed App With Spaces`, replacing the actual PLVS executable and CLI.
- Both open workbenches returned after upgrade. Their workspace IDs remained
  `default` and `workspace-8cf323cc-fa38-4101-aa0f-a91d665ae1b7`; instance IDs changed.
  CLI and installation registry reported 0.21.1. The helper recorded `finished`,
  no error, and installer PID/start identity. Ready state was cleared.
- The existing stable installation remained registered at
  `%LOCALAPPDATA%/PLVS`, version 0.15.1. The isolated upgrade used its own registry,
  application-data directory, and destination.
- The upgraded executable entered a 136 CSS px bottom Dock at 200% Windows scale.
  Agent Control captured `artifacts/update-controls/installed-dock-136.png`:
  the vertical transport/toolbar/return controls fit, and no update icon remained.

The run exposed an accessory startup race: hiding the update window before native
setup created it reported an error in ordinary first-launch setup. Commit
`79d117d4` makes hiding a missing window a no-op while preserving errors when
showing a missing window. All 5,655 Vitest tests, Rust checks/tests, frontend
format/lint/typecheck passed before that commit. Logs are under
`artifacts/update-controls/acceptance-*.log`.

## Final delivery verification

Source `3dc7daa318176cbb136ec7d11c0f821eff051bde` was rebuilt as both signed test
versions and installed into its own identity. The complete offline Dock startup
upgrade passed again. Agent Control connected on that fresh launch without
toggling it, and the cached offer contained no feed-error alert. After explicit
startup confirmation, the CLI reported 0.21.1, the helper attempt was `finished`
with no error, and serialized Dock/settings were unchanged. Evidence:
`artifacts/update-controls/delivery-result.json`, `delivery-offline-launch-ui.json`,
`delivery-offline-clean-offer.png`, `delivery-after-upgrade.json`, and
`delivery-restored-dock.png`.

The final code gate passed 5,656 Vitest tests across 527 files; Rust passed 779
library tests (3 intentionally ignored), workspace/CLI tests, formatting and
Clippy. Frontend formatting, lint and typecheck passed. Logs are named
`offline-fixes-*.log`. Standard debug binaries were rebuilt after the isolated
package builds so their signing configuration is not left in the default target.

Manual delivery is under `artifacts/update-acceptance/3dc7daa3/Manual Acceptance/`.
It contains two installers, signatures, the source/hash receipt, local feed runner,
launch shortcuts and instructions; it excludes the private key. The feed is
stopped after testing. The prepared installation is restored to 0.21.0 with fresh
test settings; validated app data is archived beside it. No packages were published.

## Additional Dock run

The `79d117d4` package run additionally verified the corrected first-launch setup,
the dependent switches, and a complete quit/reopen into a 136 CSS px bottom Dock
with the feed offline. The ready accessory opened on startup. Skip retained the
package and the Dock update entry reopened the same version. This run also exposed
two startup defects addressed by the follow-up: background check errors leaking
into cached details, and Agent Control announcing readiness before its native
broker existed. The broker now starts before webview creation, and background
checks preserve the cached dialog's installation status.
The subsequent offline confirmation upgraded to 0.21.1 and returned to the same
bottom Dock. Serialized Dock configuration and system settings were exactly equal
before quit and after upgrade. Evidence: `dock-upgrade-comparison.json`,
`final-dock-before-restart.json`, `final-dock-after-upgrade.json`, and
`final-installed-dock-after-upgrade.png` under `artifacts/update-controls/`.

## Reproduction

From the feature worktree on Windows:

```powershell
node scripts/build-update-acceptance.mjs
node scripts/serve-update-acceptance.mjs artifacts/update-acceptance/<short-sha>
```

The builder archives HEAD and makes its substitutions only inside ignored
artifacts. Install the older package into a disposable directory. Save first-run
preferences with automatic download enabled, wait for staging, quit normally,
stop the feed, and reopen the app. Skip retains the ready package; explicit
confirmation installs it offline. Keep `acceptance.key` private and local. These
packages are acceptance tools, not stable or Preview releases; do not publish them.

## Platform boundaries

### Preference review and packaged failure probe

Source `aee74d402b5ee98a2d44c86f9139944cb04379a4` was rebuilt as signed isolated
0.21.0/0.21.1 installers. Actual installed first-launch, Settings, normal update details,
and content-sized Dock details screenshots are `audit-first-launch.png`,
`audit-settings-ready.png`, `audit-update-ready.png`, and `audit-dock-ready.png` under
`artifacts/update-controls/`. The local feed recorded no request before preferences were saved.

A separately signed NSIS fixture returned exit code 42 before replacing files. With the
feed stopped after staging, the real application/helper handoff recorded a failed attempt,
relaunched 0.21.0, retained the staged package, and suppressed the automatic startup offer.
Settings and Dock state compare equal before/after. Evidence is
`artifacts/update-controls/audit-failure-result.json` and the before/after inspections beside it.
This does not certify recovery after partial filesystem replacement or forced interruption.

The probe exposed a presentation defect: manually reopening details erased the previous
installation error. A follow-up controller regression preserves that error for its target
version, including after a background feed failure or dismissal, without attaching it to
a different target. The installed screenshots above predate this small follow-up.

The source gate passed 5,662 tests across 527 files and the complete repository check,
including Rust. Standard debug binaries were restored after the isolated builds.
The failure-explanation follow-up passed 5,663 tests across 527 files, frontend formatting,
lint, and typecheck. The test app quit through its normal confirmation and the local feed
was stopped; no owned acceptance window was left running.

### Remaining platform evidence

Windows evidence does not certify macOS bundle replacement, authorization
cancellation, read-only installations, or native Dock focus/work-area behavior.
Those require a Mac run before release. Automated recovery/peer/editor tests and
the standalone installer/helper probes remain supporting evidence, not a claim
that every packaged failure mode was exercised.
