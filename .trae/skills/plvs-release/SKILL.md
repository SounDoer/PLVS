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
│  - On main branch                                               │
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

```bash
git log --pretty=format:"%s" <last-tag>..HEAD
```

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
| 1 | Version consistency | `npm run version:check` | Run `bump-version.mjs` |
| 2 | CHANGELOG entry | Check `## [version]` exists | Update CHANGELOG |
| 3 | Git working tree | `git status --porcelain` | Commit changes |
| 4 | Tag not exists | `git tag` | Choose different version |
| 5 | On main branch | `git branch --show-current` | Switch to main |
| 6 | Lint passes | `npm run lint` | Fix lint errors |
| 7 | Tests pass | `npm test` | Fix failing tests |
| 8 | Build passes | `npm run build` | Fix build errors |

### Preflight Script

```bash
node scripts/preflight-release.mjs
```

### Expected Output

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
   git push && git tag v0.2.0 && git push origin v0.2.0
```

### If Preflight Fails

```
❌ Fix the issues above before releasing.
```

Do NOT proceed to Step 7. Fix issues and re-run preflight.

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

---

## Step 8: Automated Release

GitHub Actions workflow (`.github/workflows/release.yml`) handles:

### Build Matrix

| Platform | Runner | Artifacts |
|----------|--------|-----------|
| Windows | `windows-latest` | NSIS installer, portable exe |
| macOS | `macos-latest` | DMG |

### Release Creation

1. Extract CHANGELOG section for version
2. Create GitHub Release with notes
3. Attach all build artifacts

### Artifact Naming

| Platform | Artifact Name |
|----------|---------------|
| Windows NSIS | `PLVS-vX.Y.Z-x64-setup.exe` |
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
| Not on main | `git checkout main` |
| Uncommitted changes | `git add -A && git commit` |

### CI Build Fails

1. Check GitHub Actions logs
2. Fix issues locally
3. Delete tag: `git push origin :refs/tags/vX.Y.Z`
4. Amend commit or create new commit
5. Re-run preflight
6. Re-tag and push

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
| `node scripts/preflight-release.mjs` | Pre-release checklist |
| `npm run lint` | Run linting |
| `npm test` | Run tests |
| `npm run build` | Build frontend |
| `npm run check` | Full check (lint + test + build + rust) |
| `npm run desktop:release-nsis` | Build Windows installer |
| `npm run desktop:release-dmg` | Build macOS DMG |
