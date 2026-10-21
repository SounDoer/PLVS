# Release-package smoke on the home runners

Date: 2026-10-21

## Problem

`release.yml` builds each platform once and smoke-tests the package at file level (NSIS silent
install, DMG mount, deb in a clean Ubuntu root). `capture-acceptance.yml` runs the capture harness,
and `update-acceptance.yml` drives a rebuilt package under a synthetic identity. Nothing proved that
the file users download opens, answers Agent Control, renders and meters a signal. Agent Control
smoke ran only locally on Windows against the dev app, and the release skill asked the maintainer to
open the build by hand on the Mac and on Ubuntu.

## Constraint that shaped the design

The runners are the maintainer's own machines with the stable PLVS installed and often running. The
check must not touch that installation or its settings, and stable packages ship with Agent Control
off.

Investigation (2026-10-21): stable builds rejected `--plvs-test-app-data-root` and ignored
`PLVS_TEST_IDENTITY_ROOT`. On Windows the app-data directory comes from `SHGetKnownFolderPath`, so no
environment override moves it; a test launch would join or take over the real profile. macOS and
Linux could have been redirected through `HOME`/`XDG_*`, but not Windows. The options were a product
change, a dedicated OS account on each runner, or testing a rebuilt package. The user chose the
product change: ADR 0035 lets every build accept the isolated data root.

## Design

`scripts/release-package-smoke.mjs`, run by `release-package-smoke.yml` on each `plvs-rig` runner:

1. Take `artifacts/release-candidate/<platform>/release-assets/<public asset>` from the
   `release-candidate-<platform>` artifact of the same release run (or of a named run when
   dispatched standalone). Record its size and SHA-256.
2. Stage without installing: portable ZIP (`Expand-Archive`), `PLVS.app` copied out of the
   read-only-mounted DMG (`ditto`), deb unpacked (`dpkg-deb -x`; missing `Depends` are a rig error).
3. Seed `<tmp>/data/plvs-settings.json` (Agent Control on, update choice made with checks off,
   close quits) and start the app with `--plvs-test-app-data-root <tmp>/data`. WebView data moves
   too: `WEBVIEW2_USER_DATA_FOLDER` on Windows, `XDG_DATA_HOME`/`XDG_CACHE_HOME` on Linux, plus
   `PLVS_FFMPEG_DIR` for the unpacked sidecars. Linux without a display gets a private Xvfb, and
   without a session bus a private `dbus-run-session`.
4. With the package's own `plvs-cli` and `PLVS_TEST_IDENTITY_ROOT`, wait for the one instance, check
   that the isolated store exists, then run `runAgentControlSmoke` (its six scenarios unchanged).
5. Select the rig capture device through `device select` (CABLE Output, BlackHole 2ch, or the run's
   private Pulse null sink), start the rig player under the lease (`--wait`), `transport live
start`, read `measurement inspect` after 10 s, and require running/fresh, integrated loudness
   within 0.5 LU of the tone's summed channel power (-22.04 LUFS) and Ch1/Ch2 sample peaks within
   0.5 dB of -20/-26 dBFS. Take a screenshot while metering.
6. Stop Live, the player and the app (by PID or process group), remove the temporary tree, and write
   `result.json` (domain `agent-control`, tool `release-package-smoke`) with the scenarios, package hash, measurement and
   artifacts. `verify-release-package-evidence.mjs` re-hashes the artifacts before upload.

`release.yml` calls the workflow after the three builds; `prepare-draft` needs it. The local
`release:preflight` no longer runs `smoke:agent-control`, which stays a development tool, and the
skill's manual Mac/Ubuntu GUI step is gone.

## Expected-value choice

Capture smoke compares live against `analyze` of the same WAV through the harness. The packaged app
has no harness, so the expected values are computed from the tone definition: for a 1 kHz sine the
K-weighting gain and the -0.691 offset cancel to within about 0.01 dB. The 0.5 dB tolerance is wide
enough for that and VB-Cable, and narrow enough to catch a channel swap (6 dB) or a quiet route.

## Residual risks

- macOS keeps WKWebView's website data store keyed by bundle identifier; PLVS keeps no state there.
- Whether WebView capture works with a locked macOS or Windows screen is unverified until the runner
  runs it.
