# CI fast-path and package-check plan

## Evidence and objective

The ordinary `ci.yml` classifier currently has two outcomes: website-only and full. Recent full
runs show the Windows Rust job at roughly 16 minutes, macOS at 8–14 minutes, Linux at 7–20 minutes,
and frontend at 4–6 minutes. Release-content-only commits therefore take 16–20 minutes even though
their durable contract is exercised by Vitest and documentation tests. A failed license check also
does not stop the expensive jobs, and superseded runs are not cancelled.

The objective is to shorten ordinary development feedback without weakening the exact-SHA release
gate, while adding a symmetric three-platform package check before release day.

## Target model

1. One fail-safe change classifier is shared by local `check:changes` and GitHub CI. Unknown paths,
   an unavailable baseline, or a classifier failure select the full gate.
2. The classifier exposes independent lanes instead of one exclusive scope:
   - website
   - contracts (Vitest plus repository/documentation contracts)
   - frontend (format, lint, typecheck, build and coverage)
   - native (Rust on Ubuntu, Windows and macOS)
   - package checks for Windows, macOS and Linux
3. Shared native or package inputs select all affected platforms. Platform-only packaging inputs
   select that platform. The same rule and tests define every platform; the commands differ only
   where the operating systems require it.
4. Routine package checks use GitHub-hosted runners and publish nothing. A scheduled run exercises
   all three package checks so a missing path classification cannot stay hidden indefinitely.
5. Release continues to require successful CI for the exact SHA, then runs signed/notarized final
   package verification and the self-hosted capture, package-smoke and update-acceptance gates.

## Delivery sequence

### Phase 1: low-risk feedback and waste reduction

- Cancel superseded push/PR CI runs by ref.
- Make expensive jobs depend on the cheap license/policy check so a fast failure stops later work.
- Bound package-manager and network-dependent steps with retries and timeouts.
- Verify that the dialogue fixture test can use the reviewed decode-only sidecar; remove the full
  distribution FFmpeg install from ordinary frontend CI if the test proves it does not encode.
- Run platform-independent Rust formatting once rather than in every operating-system job.

### Phase 2: multi-lane classification

- Replace the website/full result with explicit boolean lane outputs.
- Keep pure website changes on `website:verify`.
- Run the full Vitest contract suite for every non-website change, including documentation and
  tooling changes, as required by `AGENTS.md`.
- Run frontend checks only for frontend/shared-JavaScript inputs.
- Run all three native jobs only for Rust, Tauri, native dependency or native build inputs.
- Preserve a single stable aggregate CI result even when lanes are skipped.
- Add fixture repositories and path-table tests for committed ranges, reverts, renames, staged,
  unstaged and untracked files, plus fail-open behavior.

### Phase 3: symmetric package checks

- Add one reusable package-check workflow with a Windows/macOS/Linux matrix and the same evidence
  contract for each platform.
- Windows builds a non-publishing stable-identity NSIS candidate, silently installs it, runs Doctor,
  checks CLI/sidecars/registry state, uninstalls it and restores prior user state.
- macOS builds a non-publishing unsigned/no-updater DMG candidate, mounts it, checks the app, CLI,
  Doctor and sidecars, then detaches it. Developer ID signing, notarization, stapling and Gatekeeper
  remain exact-release checks because routine PR jobs must not receive release secrets.
- Linux builds the stable deb and runs the existing disposable Ubuntu clean-install verifier.
- Shared Doctor/CLI/sidecar/packaging inputs run all three. Platform-only inputs run that platform.
- A scheduled full matrix verifies all three regardless of changed paths.

### Phase 4: measured compilation caching

- Trial Rust compilation caching on one hosted platform.
- Record restore/save time, cache size, hit rate and wall-clock change across representative edits.
- Expand only if the cache saves more time than it costs and has a bounded invalidation policy.

## Acceptance

- Website-only changes complete with website validation and no native jobs.
- Documentation/tooling-only changes run repository contracts but no native jobs.
- Frontend-only changes do not start Rust jobs.
- Native changes run Rust checks on Ubuntu, Windows and macOS.
- Shared package-chain changes run all three package checks; a platform-only fixture proves selective
  triggering; unknown paths prove fail-open full triggering.
- A cheap policy failure prevents expensive jobs from starting.
- A newer run cancels an older in-progress run for the same ref.
- Release still rejects a SHA without a successful completed `ci.yml` push run.
- Workflow contract tests hold the lane mapping, package commands, timeouts and three-platform
  symmetry.
