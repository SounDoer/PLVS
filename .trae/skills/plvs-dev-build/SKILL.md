---
name: "plvs-dev-build"
description: "Builds an unofficial dev/preview installer for PLVS from the current branch and publishes it to a rolling GitHub Pre-release. Invoke when the user wants a dev build, preview build, or test installer — NOT for official releases (use plvs-release for those)."
---

# PLVS Dev Build Skill

Produces a throwaway **dev installer** for testing, downloadable from GitHub.
It builds whatever branch you point it at, marks the artifacts with a
`-dev.<short-sha>` suffix, and publishes them to a single rolling `dev`
Pre-release.

## When to Invoke

- User wants a dev / preview / nightly / test installer
- User wants to hand someone a build of a work-in-progress branch
- User wants to download an installer of the current branch from GitHub

## NOT for official releases

This skill is intentionally separate from `plvs-release`:

| | `plvs-dev-build` (this) | `plvs-release` |
|---|---|---|
| Version | unchanged; `-dev.<sha>` in filename only | bumped `X.Y.Z`, synced 3 places |
| CHANGELOG | untouched | new section required |
| Git tag | none (rolling `dev` tag, auto-managed) | permanent `vX.Y.Z` |
| GitHub Release | **Pre-release**, overwritten each build | normal Release, kept forever |
| Platforms | **Windows only** | Windows + macOS |
| Preflight gate | **skipped** (fast, unverified) | full `npm run check` gate |

If the user means to ship a real version, stop and use `plvs-release` instead.

## How It Works

The build runs in CI — workflow `.github/workflows/dev-build.yml`, triggered
manually via `workflow_dispatch`. It checks out the ref you pass, builds the
NSIS installer + portable exe, then **replaces** the `dev` Pre-release so it
always holds only the latest build. The verify/lint/test gate is skipped, so
dev builds are fast but unverified — a green run only means it compiled.

## Steps

### 1. Confirm the branch and push it

CI builds a ref that exists on `origin`, so the commit you want **must be
pushed first**.

```bash
git branch --show-current        # the branch that will be built
git status --porcelain           # warn if there are uncommitted changes
git push                         # ensure origin has the commit to build
```

If there are uncommitted changes, tell the user the dev build will reflect
the **last pushed commit**, not their working tree — commit + push first, or
proceed knowingly.

### 2. Trigger the dev build

```bash
git rev-parse --abbrev-ref HEAD                 # <branch>
gh workflow run dev-build.yml --ref <branch>
```

### 3. Watch the run

```bash
gh run list --workflow=dev-build.yml --limit 1
gh run watch <run-id>            # or open the Actions URL it prints
```

Treat the run as successful only by its **conclusion**, not by the tail of the
log:

```bash
gh run view <run-id> --json conclusion -q .conclusion   # want: success
```

The `conclusion` field is the source of truth. `gh run watch` can print a
scary `Process completed with exit code 1` annotation on a run that still
concludes `success` — it comes from the lenient "remove previous release"
cleanup step exiting non-zero when there is no prior `dev` release to delete
(first build, or right after a failed one). It does not mean the build failed.

### 4. Hand back the download link

On success, the installer is on the rolling Pre-release:

```bash
gh release view dev --web        # opens it in the browser
```

Give the user the page URL (`<repo>/releases/tag/dev`) and the asset names:

| Artifact | Filename |
|----------|----------|
| Installer | `PLVS_<version>-dev.<short-sha>_x64-setup.exe` |
| Portable | `PLVS-v<version>-dev.<short-sha>-x64-portable.exe` |

The `<short-sha>` lets a tester tell two dev builds apart even after download.

## Notes

- **Rolling, single build only.** Each run overwrites the `dev` Pre-release;
  earlier dev installers are gone. It's for "test the latest", not history.
- **No version collision.** The version number in `package.json` is never
  touched; the `-dev.<sha>` marker lives only in the artifact filenames.
- **Unsigned**, like official builds — testers will see SmartScreen warnings.
