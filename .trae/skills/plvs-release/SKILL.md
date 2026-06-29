---
name: "plvs-release"
description: "Guides PLVS release process: version bump, CHANGELOG update, preflight checks, and tagging. Invoke when user wants to release a new version or asks about release workflow."
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
the version, update the CHANGELOG, run preflight, and tag `vX.Y.Z` — all on
`main`. This is deliberate: before 1.0 there's no shipped version to back-port
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
  when finalizing; bump / CHANGELOG / preflight / `vX.Y.Z` tag happen on it.
- **Hotfixes land on the release branch, then cherry-pick back to `main`** so
  the next version doesn't regress.

No tooling changes are needed to adopt this: `release.yml` triggers on **tag
push** (`refs/tags/v*`), branch-agnostic, and the release-state check does not
enforce a branch. When the time comes, the only change is *where* you run the
existing flow. Until then, ignore this section.

---

## Release Workflow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: Analyze Commits                                        │
│  - Get commits since last tag                                   │
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
│  Step 7: Push & Tag                                             │
│  - git push                                                     │
│  - git tag vX.Y.Z                                               │
│  - git push origin vX.Y.Z                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 8: Automated Release (GitHub Actions)                     │
│  - Build Windows NSIS + portable exe                            │
│  - Build macOS DMG                                              │
│  - Create GitHub Release with CHANGELOG notes                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Analyze Commits

### Get Commits Since Last Tag

**Bash (Linux/macOS):**
```bash
git log --pretty=format:"%s" $(git describe --tags --abbrev=0)..HEAD
```

**PowerShell (Windows):**
```powershell
# Two-step approach (recommended for PowerShell)
$tag = git describe --tags --abbrev=0
git --no-pager log --pretty=format:"%s" "$tag..HEAD"

# Or use explicit tag name
git --no-pager log --pretty=format:"%s" v0.2.3..HEAD
```

**Important:** PowerShell's `$(...)` subexpression syntax does not work correctly inside git command arguments. Always use a two-step approach or explicit tag names.

### Version Bump Recommendation

Analyze commit messages following [Conventional Commits](https://www.conventionalcommits.org/):

| Commit Type | Version Bump | Example |
|-------------|--------------|---------|
| `BREAKING CHANGE:` or `!:` | MAJOR | `feat!: drop support for Node 16` |
| `feat:` | MINOR | `feat: add dark mode support` |
| `fix:` | PATCH | `fix: correct loudness calculation` |
| `chore:`, `docs:`, `style:` | None (skip) | `chore: update dependencies` |

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

| Commit Type | CHANGELOG Section |
|-------------|-------------------|
| `feat:` | Added |
| `fix:` | Fixed |
| `refactor:` | Changed |
| `perf:` | Changed |
| `docs:` | (usually skip, or add to Changed) |
| `chore:`, `style:`, `test:` | (skip) |

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

| File | Field |
|------|-------|
| `package.json` | `version` |
| `src-tauri/Cargo.toml` | `[package].version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.lock` | (via `cargo update`) |

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

| # | Check | Command | Failure Action |
|---|-------|---------|----------------|
| 1 | Release state | `node scripts/check-release-state.mjs` | Fix version / CHANGELOG / git / tag state |
| 2 | Full repository gate | `npm run check` | Fix format / lint / test / build / Rust errors |

Branch selection is a release-management decision from the Branching Model
section. The automated preflight command does not enforce a branch name.

### Complete Preflight Script

```bash
npm run release:preflight
```

This command runs the fast release-state checks first, then runs the full
repository gate. Use it as the single local pre-tag command.

`node scripts/check-release-state.mjs` is still available when you only need the
fast version / CHANGELOG / git / tag check.

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

<!-- legacy sample retained only for historical context; do not follow it

```
Checking versions…
  ✅ Versions consistent (0.2.0)

Checking CHANGELOG…
  ✅ CHANGELOG has [0.2.0] section

Checking git status…
  ✅ Working tree clean

Checking tag…
  ✅ Tag v0.2.0 not yet created

Checking branch…
  ✅ On main branch

Running lint…
  ✅ Lint passed

Running tests…
  ✅ Tests passed

Running build…
  ✅ Build succeeded

✅ Ready to release v0.2.0:
   git push; git tag v0.2.0; git push origin v0.2.0
```
-->

> **Note:** In PowerShell 5, use `;` instead of `&&` for command chaining.

### If Preflight Fails

```
❌ Fix the issues above before releasing.
```

Do NOT proceed to Step 7. Fix issues and re-run `npm run release:preflight`.

---

## Step 7: Push & Tag

### Push Commit First

```bash
git push
```

### Create and Push Tag

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

**Why push before tag?**
- Ensures commit is on remote
- Tag points to the correct commit
- CI can access the commit

### ⚠️ Do NOT force-move a released tag

Never `git tag -f` / force-push a tag that already shipped a GitHub
Release. It silently bypasses this whole skill (preflight never runs) and
re-publishes a *different* build under an *unchanged* version number —
exactly the kind of accident the release gate exists to catch. To ship a
fix on top of a released version, run the normal flow with a **new**
version number (e.g. 0.3.2 → 0.3.3).

---

## Step 8: Automated Release

After pushing the tag, watch the release run and judge it by its
**conclusion**, not the tail of the log:

```bash
gh run list --workflow=release.yml --limit 1
gh run watch <run-id>
gh run view <run-id> --json conclusion -q .conclusion   # want: success
```

Judge the run by its `conclusion`, not the tail of the log. If `conclusion`
is `failure`, the verify gate likely tripped — see "No Installers Were
Produced" below.

GitHub Actions workflow (`.github/workflows/release.yml`) handles:

### Release Gate (runs first, blocks builds on failure)

Before any installer is built, two `verify` jobs run the **same checks as CI**:

| Gate Job | Mirrors | Checks |
|----------|---------|--------|
| `verify` | CI `frontend` | `version:check`, `format:check`, `lint`, `test`, `build` |
| `verify-rust` | CI `rust` | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` |

`build-windows` and `build-macos` declare `needs: [verify, verify-rust]`.
**If either gate fails, both build jobs are skipped — no installers are
produced and no GitHub Release is created or overwritten.** This is a
server-side, unskippable backstop: even a manual `git tag -f` cannot
bypass it. The Step 6 preflight is the *fast local* layer; this gate is
the *enforced* layer. Both are intentional (defense in depth) — do not
remove the preflight just because the gate exists.

### Smoke Gates

The build jobs also run package-oriented smoke checks that `npm run check`
cannot cover:

| Gate | Platform | Checks |
|------|----------|--------|
| `npm run smoke:file-analysis` | Windows + macOS | Fetches FFmpeg sidecars, stages runtime names, and runs real file-analysis Rust tests |
| `npm run desktop:verify-windows-installer` | Windows | Silent-installs NSIS output and checks app binary, FFmpeg / ffprobe sidecars, and no diagnostic binary |
| `npm run desktop:verify-macos-dmg` | macOS | Mounts the DMG and checks the `.app`, main binary, FFmpeg / ffprobe sidecars, and no diagnostic binary |

### Build Matrix

| Platform | Runner | Artifacts |
|----------|--------|-----------|
| Windows | `windows-latest` | NSIS installer, portable exe |
| macOS | `macos-latest` | DMG |

### Release Creation

1. Extract CHANGELOG section for version via `scripts/changelog-release-body.mjs`
2. **Auto-append installation instructions** (Chinese + English) with
   version-filled filenames — maintained in the script, not in CHANGELOG.md
3. Create GitHub Release with the combined notes
4. Attach all build artifacts

> The installation section (SmartScreen / Gatekeeper bypass, download
> filenames) is injected by `changelog-release-body.mjs` so it ships with
> every release automatically. Edit it there, not in CHANGELOG.md.

### Artifact Naming

| Platform | Artifact Name |
|----------|---------------|
| Windows NSIS | `PLVS_X.Y.Z_x64-setup.exe` |
| Windows Portable | `PLVS-vX.Y.Z-x64-portable.exe` |
| macOS DMG | `PLVS-vX.Y.Z-aarch64.dmg` |

---

## Build Artifacts

| Platform | Type | Location |
|----------|------|----------|
| Windows | NSIS Installer | `src-tauri/target/release/bundle/nsis/*.exe` |
| Windows | Portable | `src-tauri/target/release/plvs.exe` |
| macOS | DMG | `src-tauri/target/release/bundle/dmg/*.dmg` |

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

```bash
# Delete local tag
git tag -d vX.Y.Z

# Delete remote tag
git push origin :refs/tags/vX.Y.Z
```

### Preflight Fails

| Failure | Fix |
|---------|-----|
| Lint errors | `npm run lint` and fix |
| Test failures | `npm test` and fix |
| Build errors | `npm run build` and fix |
| Not on main | `git checkout main` (post-1.0: the release branch) |
| Uncommitted changes | `git add -A; git commit` |

### No Installers Were Produced

If a release tag ran but no `.exe`/`.dmg` appeared, the `verify` or
`verify-rust` **gate** likely failed and skipped the build jobs. Open the
Release run, find the red gate job, fix the reported check locally
(it mirrors CI exactly), then ship a **new** version (do not re-move the
tag — see the Step 7 warning).

### CI Build Fails

1. Check GitHub Actions logs
2. Fix issues locally
3. Delete tag: `git push origin :refs/tags/vX.Y.Z`
4. Amend commit or create new commit
5. Re-run `npm run release:preflight`
6. Re-tag and push

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
- **No auto-update**: Users need to manually download new versions
- **Semantic versioning**: Breaking = MAJOR, Feature = MINOR, Fix = PATCH

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run version:check` | Verify version consistency |
| `node scripts/bump-version.mjs X.Y.Z` | Bump version |
| `node scripts/check-release-state.mjs` | Fast release-state checklist |
| `npm run release:preflight` | Complete local pre-tag gate |
| `npm run smoke:file-analysis` | Real FFmpeg sidecar file-analysis smoke |
| `npm run lint` | Run linting |
| `npm test` | Run tests |
| `npm run build` | Build frontend |
| `npm run check` | Full check (lint + test + build + rust) |
| `npm run desktop:release-nsis` | Build Windows installer |
| `npm run desktop:release-dmg` | Build macOS DMG |
| `npm run desktop:verify-windows-installer` | Smoke-test Windows installer |
| `npm run desktop:verify-macos-dmg` | Smoke-test macOS DMG |
