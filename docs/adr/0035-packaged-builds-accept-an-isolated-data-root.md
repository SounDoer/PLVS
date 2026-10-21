# ADR 0035: Packaged builds accept an isolated data root

## Status

Accepted (2026-10-21). Supersedes the sentence in ADR 0028 that Stable and Preview builds reject
`--plvs-test-app-data-root` and `PLVS_TEST_IDENTITY_ROOT`; the rest of ADR 0028 stands.

## Context

Release checks built and smoke-tested each package, but nothing proved that the file users download
opens, answers Agent Control, renders and meters a signal. The maintainer opened the build by hand
on the Mac and on Ubuntu. Automating that on the self-hosted rig runners means launching the exact
stable package on machines where the maintainer's own stable PLVS is installed and may be running.

A stable package always opened the real stable profile. On Windows the app-data directory comes from
`SHGetKnownFolderPath`, which ignores `%APPDATA%`, so no environment change can move it. A test
launch would either join the running workbench's multi-instance workspace or become the coordinator
of the real profile, and the test then has to enable Agent Control in that profile. Rebuilding the
package under another identity, as update acceptance does, would test a file nobody downloads.

## Decision

Every build, Stable and Preview included, accepts `--plvs-test-app-data-root <absolute path>`, and
every `plvs-cli` honours `PLVS_TEST_IDENTITY_ROOT`. The argument only moves the app-data, log and
multi-instance roots below the given absolute path; it grants nothing else. Launches without it are
unchanged, and an installed app is never started with it.

Keeping the packaged builds closed was the obvious simpler choice: it is what ADR 0028 chose, and a
hidden argument is surface a user will never need. It also makes the downloaded package untestable
without touching the maintainer's real settings, which is the larger risk.

## Consequences

- The release-package smoke (`scripts/release-package-smoke.mjs`) runs the exact release candidate
  from a temporary directory with a seeded profile that enables Agent Control there only.
- The argument does not move the WebView's own data store. The smoke sets
  `WEBVIEW2_USER_DATA_FOLDER` on Windows and `XDG_DATA_HOME`/`XDG_CACHE_HOME` on Linux. macOS keeps
  WebKit's store keyed by bundle identifier; PLVS keeps no state there, only caches.
- Anyone can start a stable PLVS on an empty profile in a directory of their choosing. That needs no
  privilege a user lacks already: deleting the profile has the same effect.
