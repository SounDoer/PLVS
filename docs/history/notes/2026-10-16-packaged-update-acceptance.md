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

## Reproduction

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

Windows evidence does not certify macOS bundle replacement, authorization
cancellation, read-only installations, or native Dock focus/work-area behavior.
Those require a Mac run before release. Automated recovery/peer/editor tests and
the standalone installer/helper probes remain supporting evidence, not a claim
that every packaged failure mode was exercised.
