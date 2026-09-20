---
name: "plvs-release"
description: "Guides PLVS official releases: version selection, CHANGELOG and public-doc updates, preflight gates, exact-SHA immutable Draft publication, and recovery. Use when preparing, publishing, or troubleshooting an official PLVS release."
---

# PLVS Release Skill

This skill guides the complete release workflow for PLVS, a Tauri-based desktop audio metering application.

## When to Invoke

- User wants to release a new version of PLVS
- User asks about the release process or workflow
- User needs help with version bumping or CHANGELOG updates
- User wants to create a release tag

---

## Branching Model

### Current (pre-1.0.0): release directly from `main`

While PLVS is pre-1.0, development and releases both happen on `main`. Bump
the version, update the CHANGELOG, run preflight, and dispatch the exact commit
from `main`. The release workflow creates the tag while assembling the Draft.
This is deliberate: before 1.0 there's no shipped version to back-port
fixes to, so a dedicated release branch would be ceremony with no payoff.
**Follow the workflow below as-is, on `main`.**

### Planned (after 1.0.0): GitHub Flow + release branches

Once 1.0.0 ships and old versions need to be maintained while `main` keeps
moving, switch to cutting a `release/<MAJOR.MINOR>` branch per release:

```
main            ──●──●──●──●──●──────●──●──●──     ← active development line
                        \                  ↑
                         \            cherry-pick hotfix back
                          \                │
release/1.0          ●──●──●  ← tag v1.0.0 (and v1.0.1 hotfixes) live here
```

- **`release/<MAJOR.MINOR>` freezes a version for shipping.** Cut from `main`
  when finalizing; bump / CHANGELOG / preflight / exact-SHA dispatch happen on it.
- **Hotfixes land on the release branch, then cherry-pick back to `main`** so
  the next version doesn't regress.

No workflow change is needed to adopt this: `release.yml` accepts an explicit
commit SHA, and the release-state check does not enforce a branch. When the time
comes, the only change is which branch owns the SHA supplied to the workflow.
Until then, ignore this section.

---

## Release Workflow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: Analyze Commits                                        │
│  - Get commits since the last official vX.Y.Z tag               │
│  - Recommend version bump type                                  │
│  - Generate CHANGELOG draft                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: User Confirmation                                      │
│  - Show version recommendation                                  │
│  - Show CHANGELOG draft                                         │
│  - User confirms or modifies                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: Version Bump                                           │
│  - Update package.json                                          │
│  - Update src-tauri/Cargo.toml                                  │
│  - Update src-tauri/tauri.conf.json                             │
│  - Update src-tauri/Cargo.lock                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: Update CHANGELOG                                       │
│  - Insert new section at the top                                │
│  - Preserve existing entries                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 4b: Reconcile the public documents                        │
│  Read this release's CHANGELOG entry, then check:               │
│  - docs/user/: every user-visible change is described in its    │
│    chapter, and no claim contradicts what now ships             │
│  - README.md highlights still summarise the product             │
│  - landing/index.html selling points still hold                 │
│  - landing/assets screenshots: retake if the UI visibly changed │
│  - A changed promise or non-goal also updates docs/prd.md       │
│  The website deploys from the tag after the release publishes.  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: Commit Changes                                         │
│  - git add -A                                                   │
│  - git commit -m "chore(release): bump version to X.Y.Z"        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 6: Preflight Check                                        │
│  - Version consistency                                          │
│  - CHANGELOG entry exists                                       │
│  - Git working tree clean                                       │
│  - Tag does not exist                                           │
│  - Confirm the correct release branch/model                     │
│  - Lint passes                                                  │
│  - Tests pass                                                   │
│  - Build passes                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 7: Push, Pass CI, Then Dispatch                           │
│  - Push main                                                    │
│  - Require successful ci.yml run for the exact HEAD SHA         │
│  - Confirm immutable releases are enabled                       │
│  - Dispatch release.yml with version + full HEAD SHA            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 8: Automated Release (GitHub Actions)                     │
│  - Build and smoke-test Windows + macOS exactly once            │
│  - Assemble every asset and latest.json in a Draft Release      │
│  - Publish once, locking the tag and assets                     │
│  - Verify the immutable Release attestation                     │
│  - Dispatch the website deployment (deploy-landing)             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Analyze Commits

### Get Commits Since Last Tag

**Bash (Linux/macOS):**

```bash
git log --pretty=format:"%s" $(git describe --tags --match "v[0-9]*.[0-9]*.[0-9]*" --abbrev=0)..HEAD
```

**PowerShell (Windows):**

```powershell
# Two-step approach (recommended for PowerShell)
$tag = git describe --tags --match "v[0-9]*.[0-9]*.[0-9]*" --abbrev=0
git --no-pager log --pretty=format:"%s" "$tag..HEAD"

# Or use explicit tag name
git --no-pager log --pretty=format:"%s" v0.2.3..HEAD
```

**Important:** PowerShell's `$(...)` subexpression syntax does not work correctly inside git command arguments. Always use a two-step approach or explicit tag names.

### Version Bump Recommendation

Analyze commit messages following [Conventional Commits](https://www.conventionalcommits.org/):

| Commit Type                 | Version Bump | Example                             |
| --------------------------- | ------------ | ----------------------------------- |
| `BREAKING CHANGE:` or `!:`  | MAJOR        | `feat!: drop support for Node 16`   |
| `feat:`                     | MINOR        | `feat: add dark mode support`       |
| `fix:`                      | PATCH        | `fix: correct loudness calculation` |
| `chore:`, `docs:`, `style:` | None (skip)  | `chore: update dependencies`        |

**Recommendation Logic**:

```
1. If any commit has BREAKING CHANGE → MAJOR bump
2. Else if any feat: commit → MINOR bump
3. Else if any fix: commit → PATCH bump
4. Else → No release needed (inform user)
```

### CHANGELOG Auto-Generation

Group commits by type:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- feat: description (from feat: commits)

### Changed

- refactor: description (from refactor: commits)

### Fixed

- fix: description (from fix: commits)

### Breaking Changes

- BREAKING CHANGE: description (if any)
```

**Commit Type to Section Mapping**:

| Commit Type                 | CHANGELOG Section                 |
| --------------------------- | --------------------------------- |
| `feat:`                     | Added                             |
| `fix:`                      | Fixed                             |
| `refactor:`                 | Changed                           |
| `perf:`                     | Changed                           |
| `docs:`                     | (usually skip, or add to Changed) |
| `chore:`, `style:`, `test:` | (skip)                            |

---

## Step 2: User Confirmation

Display a summary for user to confirm:

```
╔══════════════════════════════════════════════════════════════════╗
║  Release Summary                                                 ║
╠══════════════════════════════════════════════════════════════════╣
║  Current version:  0.1.5                                         ║
║  New version:      0.2.0 (MINOR bump)                            ║
║                                                                  ║
║  Commits since v0.1.5:                                           ║
║  - feat: add auto channel layout detection                       ║
║  - feat: add 7.1 loudness metering support                       ║
║  - fix: correct panel header visibility                          ║
║                                                                  ║
║  CHANGELOG draft:                                                ║
║  ─────────────────────────────────────────────────────────────── ║
║  ## [0.2.0] - 2026-06-05                                         ║
║                                                                  ║
║  ### Added                                                       ║
║  - Auto channel layout detection for mono, stereo, 5.1, and 7.1  ║
║  - 7.1 loudness metering following BS.1770 standard              ║
║                                                                  ║
║  ### Fixed                                                       ║
║  - Panel header controls remain visible in all panel sizes       ║
║  ─────────────────────────────────────────────────────────────── ║
╚══════════════════════════════════════════════════════════════════╝

Proceed with release? [Y/n]
```

**User Options**:

- `Y` / `Enter`: Proceed with recommended version
- `n`: Cancel release
- Custom version (e.g., `1.0.0`): Override recommendation

---

## Step 3: Version Bump

### Command

```bash
node scripts/bump-version.mjs <version>
```

### Files Updated

| File                                                                                                    | Field                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `package.json`                                                                                          | `version`                                                          |
| `src-tauri/Cargo.toml`                                                                                  | `[workspace.package].version` (inherited by `plvs` and `plvs-cli`) |
| `src-tauri/tauri.conf.json`                                                                             | `version`                                                          |
| `src-tauri/Cargo.lock`                                                                                  | (via `cargo update`)                                               |
| `src-tauri/plvs-agent.json`, `src-tauri/nsis/agent-discovery.nsh`, `src-tauri/nsis/installer-hooks.nsh` | (via `npm run agent:generate`)                                     |

These generated files embed the version string and are committed to git. `bump-version.mjs`
regenerates them itself (via `npm run agent:generate`) so they can't go stale — don't hand-edit
them, and don't skip re-running `bump-version.mjs` if you ever bump a version some other way.

### Version Validation

Before bumping, validate:

- Must be valid semver: `X.Y.Z` format
- Must be greater than current version
- Must not skip versions (e.g., 0.1.5 → 0.2.0 is OK, 0.1.5 → 0.3.0 is unusual)

---

## Step 4: Update CHANGELOG

### Location

`CHANGELOG.md` at project root

### Format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):

```markdown
# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Added

- New features

### Changed

- Changes to existing features

### Deprecated

- Features to be removed

### Removed

- Features removed

### Fixed

- Bug fixes

### Security

- Security fixes
```

### Insertion Point

Insert new section after `## [Unreleased]`, before the latest released version.

---

## Step 5: Commit Changes

```bash
git add -A
git commit -m "chore(release): bump version to X.Y.Z"
```

**Do NOT push yet** — wait for preflight check.

---

## Step 6: Preflight Check

Run comprehensive checks before pushing:

### Check List

| #   | Check                       | Command                                 | Failure Action                                                                                                              |
| --- | --------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Release state               | `node scripts/check-release-state.mjs`  | Fix version / CHANGELOG / git / tag state                                                                                   |
| 2   | Full repository gate        | `npm run check`                         | Fix format / lint / test / build / Rust errors                                                                              |
| 3   | Capture smoke (conditional) | Runs inside `npm run release:preflight` | Only when `src-tauri/src/audio`/`dsp`/`engine` changed since the last tag. Needs VB-Cable + VLC. See "Capture Smoke" below. |

Branch selection is a release-management decision from the Branching Model
section. The automated preflight command does not enforce a branch name.

### Complete Preflight Script

```bash
npm run release:preflight
```

This command runs the fast release-state checks first, then runs the full
repository gate. Use it as the single local pre-dispatch command.

`node scripts/check-release-state.mjs` is still available when you only need the
fast version / CHANGELOG / git / tag check.

### Capture Smoke

`release:preflight` runs `npm run smoke:capture` **only if** audio code changed
since the last tag. Most releases touch dock/UI code and skip it entirely,
touching no hardware.

When it does run, read the exit code:

| Exit | Meaning                                             | What to do                                                                         |
| ---- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0    | Live capture agrees with the file path              | Continue                                                                           |
| 1    | **Assertion failed**                                | A real capture-layer defect. **Stop.** Do not widen the tolerance, do not proceed. |
| 2    | **Rig unusable** (no VB-Cable, no VLC, device busy) | Not a code signal. Fix the rig, or **stop and ask the user**.                      |

**There is no bypass flag, on purpose.** The capture layer has no other
coverage — CI runners have no sound card — so skipping this ships a version whose
audio path nobody checked. If you cannot get it green, that decision belongs to
the user, not to you.

### Expected Output

Current output is intentionally ASCII-only so it is readable in Windows
PowerShell:

```text
== Release state ==

Checking versions...
  OK Versions consistent (0.2.0)

Checking CHANGELOG...
  OK CHANGELOG has [0.2.0] section

Checking git status...
  OK Working tree clean

Checking tag...
  OK Local tag v0.2.0 not yet created
  OK Remote tag v0.2.0 not found on origin

OK Ready for the full release gate for v0.2.0:
   npm run release:preflight

== Full repository check ==
...

OK Local release preflight passed.
```

Older versions of this skill showed the release-state check running lint,
tests, and build directly. That is no longer accurate: the complete command is
`npm run release:preflight`.

> **Note:** In PowerShell 5, use `;` instead of `&&` for command chaining.

### If Preflight Fails

```
❌ Fix the issues above before releasing.
```

Do NOT proceed to Step 7. Fix issues and re-run `npm run release:preflight`.

---

## Step 7: Push, Pass CI, Then Dispatch

### Push Commit First

```bash
git push origin main
```

### Mandatory Remote Gate

Do **not** create or push the release tag. `ci.yml` must succeed for the exact
release commit first. `release.yml` then builds each platform once, smoke-tests
those exact files, and creates the tag as part of the Draft Release flow.

**PowerShell (Windows):**

```powershell
$sha = git rev-parse HEAD
$runId = $null

1..30 | ForEach-Object {
  $runs = gh run list --workflow=ci.yml --commit $sha --event push --limit 1 --json databaseId | ConvertFrom-Json
  $runId = ($runs | Select-Object -First 1).databaseId
  if ($runId) { break }
  Start-Sleep -Seconds 2
}

if (-not $runId) { throw "No CI run appeared for $sha" }
gh run watch $runId --exit-status
if ((gh run view $runId --json conclusion -q .conclusion) -ne "success") {
  throw "CI did not succeed for $sha"
}

$remoteMain = (git ls-remote origin refs/heads/main).Split()[0]
if ($remoteMain -ne $sha) { throw "origin/main moved after CI verification" }
$version = node -p "require('./package.json').version"
gh api --header "X-GitHub-Api-Version: 2026-03-10" repos/SounDoer/PLVS/immutable-releases
gh workflow run release.yml --ref main -f version=$version -f commit_sha=$sha -f confirm_immutable_releases=true
```

**Bash (Linux/macOS):**

```bash
sha=$(git rev-parse HEAD)
run_id=""
for _ in $(seq 1 30); do
  run_id=$(gh run list --workflow=ci.yml --commit "$sha" --event push --limit 1 --json databaseId -q '.[0].databaseId')
  [ -n "$run_id" ] && break
  sleep 2
done

[ -n "$run_id" ] || { echo "No CI run appeared for $sha" >&2; exit 1; }
gh run watch "$run_id" --exit-status
[ "$(gh run view "$run_id" --json conclusion -q .conclusion)" = "success" ]
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$sha" ]

version=$(node -p "require('./package.json').version")
gh api --header "X-GitHub-Api-Version: 2026-03-10" repos/SounDoer/PLVS/immutable-releases
gh workflow run release.yml --ref main -f version="$version" -f commit_sha="$sha" -f confirm_immutable_releases=true
```

The immutable-releases API call requires repository admin read access and returns
404 when the setting is disabled. Enable **Settings → General → Releases →
Enable release immutability** before dispatching. `GITHUB_TOKEN` cannot inspect
that admin setting, so this maintainer-side check is mandatory; the workflow also
requires an explicit confirmation input and verifies that the published Release
actually became immutable.

If CI fails, keep the already-bumped version, fix the failure on `main`, re-run
`npm run release:preflight`, push again, and repeat this step for the new exact
SHA. Do not create a tag manually.

**Why dispatch instead of tagging?**

- The workflow receives the exact reviewed commit explicitly.
- Windows and macOS installers are built and smoke-tested once.
- The tested files, rather than a second rebuild, become the release assets.
- No public Release appears until every required asset is assembled.
- Publishing the Draft is the single irreversible operation.

### ⚠️ Do NOT force-move a released tag

Never `git tag -f` / force-push a tag that already shipped a GitHub Release.
Immutable Releases reject that operation, and the process treats a published
version as permanently consumed. To ship a fix, run the normal flow with a
**new** version number (e.g. 0.3.2 → 0.3.3).

---

## Step 8: Automated Release

After dispatching, watch the release run and judge it by its **conclusion**, not
the tail of the log:

```bash
gh run list --workflow=release.yml --limit 1
gh run watch <run-id>
gh run view <run-id> --json conclusion -q .conclusion   # want: success
```

The `release` environment is attached only to `publish-release`. Configure a
required reviewer on that environment when a human must inspect the Draft before
publication. Without an environment protection rule, the workflow still creates
and validates the Draft first, then publishes it automatically.

GitHub Actions workflow (`.github/workflows/release.yml`) handles:

### Release Gate (runs first, blocks builds on failure)

The `validate` job refuses the run unless:

- `version` is plain `X.Y.Z` semver and matches all version files
- `commit_sha` is a full SHA and still equals the tip of `origin/main`
- the maintainer explicitly confirmed repository release immutability is enabled
- the exact SHA has a successful completed `ci.yml` push run
- the CHANGELOG contains the version's release notes
- neither the remote tag nor a GitHub Release already exists

The normal CI is the enforced source gate; `release.yml` does not repeat its
frontend and Rust suites. The Release workflow is instead responsible for the
platform builds and package-level smoke checks. This removes the former second
full Release build while preserving the exact-SHA gate.

### Smoke Gates

The build jobs also run package-oriented smoke checks that `npm run check`
cannot cover:

| Gate                                       | Platform        | Checks                                                                                                                                             |
| ------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run smoke:file-analysis`              | Windows + macOS | Fetches FFmpeg sidecars, stages runtime names, and runs real file-analysis Rust tests                                                              |
| `npm run desktop:verify-windows-installer` | Windows         | Silent-installs NSIS output and checks the app, independently built CLI, `doctor --json`, discovery registry values, and FFmpeg / ffprobe sidecars |
| `npm run desktop:verify-macos-dmg`         | macOS           | Mounts the DMG and checks the `.app`, main binary, independently built CLI, `doctor --json`, and FFmpeg / ffprobe sidecars                         |

### Build Matrix

| Platform | Runner           | Artifacts                          |
| -------- | ---------------- | ---------------------------------- |
| Windows  | `windows-latest` | NSIS installer, portable ZIP       |
| macOS    | `macos-latest`   | DMG, `.app.tar.gz` updater payload |

### Draft Assembly and Publication

1. Windows and macOS build and smoke-test their final packages exactly once.
2. Each platform uploads the tested files and signed updater descriptor as a
   short-lived Actions artifact; build jobs have read-only repository access.
3. `prepare-draft` downloads both candidates, generates release notes and
   `latest.json`, and runs `scripts/validate-release-bundle.mjs`.
4. The validator requires exactly the five public assets below, verifies that
   none is empty, and checks updater versions, platforms, URLs, and signatures.
5. `prepare-draft` creates a Draft Release for the exact SHA, uploads the whole
   set, verifies the Draft tag still points to the requested SHA, and compares
   the uploaded asset inventory with the local set.
6. `publish-release` rechecks that `origin/main` has not moved and that the
   Release is still a Draft whose tag still points to the tested SHA, then
   publishes it once. This is the only irreversible step. The repository's
   immutable-release policy locks the tag and assets at this point.
7. The workflow requires the published Release's API `immutable` field to be
   true and verifies its GitHub Release attestation.
8. Only then does `deploy-landing` dispatch the website deployment from the
   published tag.

> The installation section (SmartScreen / Gatekeeper bypass, download
> filenames) is injected by `changelog-release-body.mjs` so it ships with
> every release automatically. Edit it there, not in CHANGELOG.md.

### Artifact Naming

`scripts/release-assets.mjs` is the source for the public asset names; the release
notes use it, and tests hold `release.yml` and the public documents to it. The table
below is a reading aid.

| Platform              | Artifact Name                  |
| --------------------- | ------------------------------ |
| Windows NSIS          | `PLVS_X.Y.Z_x64-setup.exe`     |
| Windows Portable      | `PLVS-vX.Y.Z-x64-portable.zip` |
| macOS DMG             | `PLVS-vX.Y.Z-aarch64.dmg`      |
| macOS updater payload | `PLVS.app.tar.gz`              |
| Updater manifest      | `latest.json`                  |

The portable entry is a ZIP staged by `release.yml`, not a bare exe: it holds
`plvs.exe`, `plvs-cli.exe`, `ffmpeg.exe` and `ffprobe.exe`, which is why the
release notes tell users to keep the extracted files together.

The Draft cannot publish unless all five assets are present and valid. This
prevents a platform failure or updater-manifest failure from leaving a partial
public Release.

**Check that `deploy-landing` succeeded, then that its dispatched "Deploy Landing
Page" run did.** A failure there also leaves the Release looking complete while the
website keeps describing the previous version. Redeploy from the tag with:

```bash
gh workflow run deploy-landing.yml -f ref=vX.Y.Z
```

---

## Build Artifacts

| Platform | Type           | Location                                     |
| -------- | -------------- | -------------------------------------------- |
| Windows  | NSIS Installer | `src-tauri/target/release/bundle/nsis/*.exe` |
| Windows  | Portable       | `src-tauri/target/release/plvs.exe`          |
| macOS    | DMG            | `src-tauri/target/release/bundle/dmg/*.dmg`  |

---

## Manual Build Commands

For local testing:

```bash
# Windows NSIS installer
npm run desktop:release-nsis

# macOS DMG
npm run desktop:release-dmg

# Full build (all bundles)
npm run desktop:build
```

---

## Troubleshooting

### Version Mismatch

```bash
# Check current versions
npm run version:check

# Fix by re-running bump
node scripts/bump-version.mjs <version>
```

### CHANGELOG Missing Entry

Add section manually to `CHANGELOG.md`:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- Description
```

### Tag Already Exists

Check both locations before acting:

```bash
git rev-parse -q --verify refs/tags/vX.Y.Z
git ls-remote --tags origin refs/tags/vX.Y.Z refs/tags/vX.Y.Z^{}
```

- First inspect `gh release view vX.Y.Z --json isDraft,isImmutable`. If the
  Release is a mutable Draft left by a failed pre-publication run, delete that
  Draft and its workflow-created tag with
  `gh release delete vX.Y.Z --cleanup-tag --yes`, then rerun the complete gate.
- If the Release was published, treat the version as consumed. Do not delete or
  move it; select the next patch version.
- If the tag exists only locally and has never been pushed, it may be removed
  with `git tag -d vX.Y.Z`, then the full pre-dispatch gate must run again.

### Preflight Fails

| Failure             | Fix                                                |
| ------------------- | -------------------------------------------------- |
| Lint errors         | `npm run lint` and fix                             |
| Test failures       | `npm test` and fix                                 |
| Build errors        | `npm run build` and fix                            |
| Not on main         | `git checkout main` (post-1.0: the release branch) |
| Uncommitted changes | `git add -A; git commit`                           |

### No Installers Were Produced

If no Draft appears, inspect the first failing `validate`, `build-windows`, or
`build-macos` job. Before publication, fix the issue, keep the same version,
re-run `npm run release:preflight`, push the new exact SHA, and dispatch again.
If a mutable Draft was already created, remove it and its workflow-created tag
as described above before retrying.

### Exact-SHA Gate Fails

1. Check the exact-SHA `ci.yml` or `release.yml` validation logs.
2. Fix the issue on `main` without changing the release version.
3. Re-run `npm run release:preflight`.
4. Push the fix, wait for CI, and dispatch with the new full SHA.

### Draft or Published Release Fails

1. Before publication, a mutable Draft and its workflow-created tag may be
   removed, fixed, and rebuilt under the same version.
2. After publication, fix the issue on `main` and ship the next patch version
   through the complete workflow.
3. Never delete, move, recreate, or add assets to a published immutable Release.

---

## FFmpeg Sidecar Dependency

File-mode decoding uses bundled FFmpeg `ffmpeg`/`ffprobe` sidecars. They are **not in git**;
`scripts/fetch-ffmpeg-sidecar.mjs` downloads them (SHA-256 verified) from a dedicated
`ffmpeg-sidecar-<ffmpeg-version>` release, and the `desktop:*` build scripts run it automatically.

- **Normal releases need no action** — the Windows and macOS build jobs fetch the sidecars themselves
  (`npm run ffmpeg:fetch` is wired into `desktop:release-nsis` / `desktop:release-dmg`).
- **When bumping the FFmpeg version**, before releasing you must:
  1. Rebuild the trimmed binaries — Windows locally, macOS via the `build-ffmpeg-sidecar-macos.yml`
     workflow (`gh workflow run build-ffmpeg-sidecar-macos.yml`).
  2. Upload them to a new `ffmpeg-sidecar-<version>` release.
  3. Update `TAG` and the four SHA-256 values in `scripts/fetch-ffmpeg-sidecar.mjs`.

  Full recipe: `docs/ffmpeg-sidecar-build.md`.

- The sidecar `externalBin` is declared only in `tauri.windows.conf.json` / `tauri.macos.conf.json`,
  so the Linux CI gate (PLVS ships no Linux app) does not require a binary.

---

## Important Notes

- **No code signing**: Users may see SmartScreen (Windows) or Gatekeeper (macOS) warnings
- **Auto-update is active**: `src-tauri/src/lib.rs` registers
  `tauri_plugin_updater` unconditionally, and `tauri.conf.json`'s `plugins.updater`
  points it at `releases/latest/download/latest.json`, so a shipped tag reaches
  existing installs on its own. Updates are signed — the matching `pubkey` means an
  unsigned or wrongly signed payload is refused. **There is no `active` flag to turn
  this off** — plugin 2.x's `Config` has no such field and the crate sets no
  `deny_unknown_fields`, so a v1-style `"active": false` would be read by nothing
  and silently change nothing (one was carried here until 8683b052; the
  `bundle.active` next door is a real field and gates the bundler).
  `tauri.no-updater.conf.json` only sets `bundle.createUpdaterArtifacts: false`,
  which stops a build producing updater payloads but leaves the updater client in
  the app. Disabling it for real means not registering the plugin in `lib.rs`.
- **Semantic versioning**: Breaking = MAJOR, Feature = MINOR, Fix = PATCH

---

## Quick Reference

| Command                                                | Purpose                                 |
| ------------------------------------------------------ | --------------------------------------- |
| `npm run version:check`                                | Verify version consistency              |
| `node scripts/bump-version.mjs X.Y.Z`                  | Bump version                            |
| `node scripts/check-release-state.mjs`                 | Fast release-state checklist            |
| `npm run release:preflight`                            | Complete local pre-dispatch gate        |
| `node scripts/validate-release-bundle.mjs X.Y.Z <dir>` | Verify the complete public asset set    |
| `npm run smoke:file-analysis`                          | Real FFmpeg sidecar file-analysis smoke |
| `npm run lint`                                         | Run linting                             |
| `npm test`                                             | Run tests                               |
| `npm run build`                                        | Build frontend                          |
| `npm run check`                                        | Full check (lint + test + build + rust) |
| `npm run desktop:release-nsis`                         | Build Windows installer                 |
| `npm run desktop:release-dmg`                          | Build macOS DMG                         |
| `npm run desktop:verify-windows-installer`             | Smoke-test Windows installer            |
| `npm run desktop:verify-macos-dmg`                     | Smoke-test macOS DMG                    |
