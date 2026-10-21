---
name: "plvs-preview-build"
description: "Builds and publishes a tested, immutable Windows, macOS and Ubuntu PLVS Preview for an exact commit. Use when someone needs an installable test build; do not use for official versioned releases."
---

# PLVS Preview Build

Publish an unofficial Preview for an exact pushed commit. Preview is a third application identity
(`PLVS Preview`, `com.soundoer.plvs.preview`), isolated from stable PLVS and the local dev app. It
has separate settings, installation and Agent Control discovery on every platform, and its updater
is compiled out, so testers install each new Preview by hand.

One dispatch builds Windows, macOS and Ubuntu in parallel (`all`, the default) and publishes them in
one Pre-release. A single platform (`windows`, `macos` or `linux`) is available when only one is
needed. The Ubuntu deb installs `plvs-preview` and `plvs-preview-cli` and coexists with the stable
deb; Linux live Agent Control is available after the user enables it in Settings.

Use `plvs-release` instead when the user intends to ship a stable version.

## Invariants

- Build the full 40-character commit SHA the user chose, never an inferred branch tip.
- Do not dispatch while relevant changes are uncommitted or the SHA is absent from the remote branch.
- A published Preview uses a unique `preview-<short-sha>-<run-id>` tag. Never reuse or move it.
- The workflow runs `npm run check`, real file-analysis tests, and package smoke for every selected
  platform on pinned GitHub-hosted runners before publishing. Never use the `plvs-rig` runners.
- The macOS DMG is signed and notarized with the release Developer ID credentials; its smoke checks
  Gatekeeper, the Preview bundle identifier, discovery manifest and CLI doctor identity.
- Linux package smoke installs the exact deb beside a stable deb built from the same commit in a
  fresh Ubuntu userspace, launches both, removes Preview and checks that stable still works. It
  decodes with package-private FFmpeg sidecars and is not native desktop/hardware or four-hour soak
  acceptance.
- The tested packages are assembled in a Draft Pre-release, verified, then published once. The
  published result must report `immutable: true` and have a valid attestation.
- Preview releases are temporary; the workflow retains the ten newest ones, deleting older Preview
  releases only after a newer Preview published successfully.

## Dispatch

Work from the branch and commit the user wants testers to receive, then run:

```bash
npm run preview:dispatch
```

Pass one platform to build only that one, for example `npm run preview:dispatch -- linux`.
`scripts/preview-dispatch.mjs` refuses a dirty tree, a detached HEAD, or a HEAD that is not exactly the pushed tip of the
current branch. It generates the request id, dispatches `preview-build.yml` on that branch, finds the
run whose title carries the request id (`--commit $sha --event workflow_dispatch`), and prints its
id, URL, watch command and the tag it will publish.

Do not silently commit or push unrelated work merely to satisfy these checks. If the tree is dirty or
the remote differs, explain which commit would actually be built and let the user decide how to
prepare it.

## Watch the exact run

Use the run id the script printed. Do not use the most recent run without filtering: another person
may dispatch at the same time.

```bash
gh run watch <run-id> --repo SounDoer/PLVS --exit-status
```

The run conclusion (`gh run view <run-id> --json conclusion -q .conclusion`) is the source of truth.
Do not report success from a green-looking individual job or from the presence of a Draft.

## Verify and hand back the Preview

The tag is deterministic from the tested SHA and workflow run id:

```powershell
$shortSha = $sha.Substring(0, 7)
$tag = "preview-$shortSha-$runId"
$release = gh release view $tag --json isDraft,isPrerelease,tagName,targetCommitish,url,assets |
  ConvertFrom-Json
$immutable = gh api "repos/SounDoer/PLVS/releases/tags/$tag" --jq .immutable

if ($release.isDraft) { throw "$tag is still a Draft" }
if (-not $release.isPrerelease) { throw "$tag is not marked as a Pre-release" }
if ($release.targetCommitish -ne $sha) { throw "$tag does not target $sha" }
if ($immutable -ne "true") { throw "$tag is not immutable" }
gh release verify $tag
```

Require exactly the selected platforms' non-empty assets, using the package version and first seven
SHA characters:

| Artifact     | Filename                                                       |
| ------------ | -------------------------------------------------------------- |
| Installer    | `PLVS-Preview_<version>-preview.<short-sha>_x64-setup.exe`     |
| Portable ZIP | `PLVS-Preview-v<version>-preview.<short-sha>-x64-portable.zip` |
| macOS DMG    | `PLVS-Preview_<version>-preview.<short-sha>_aarch64.dmg`       |
| Ubuntu deb   | `PLVS-Preview_<version>-preview.<short-sha>_amd64.deb`         |

Windows requires the installer and Portable ZIP, macOS the DMG, Linux the deb, and `all` all four.
Reject mixed or incomplete sets with
`scripts/validate-preview-bundle.mjs <version> <sha> <directory> <all|windows|macos|linux>`.

The Portable ZIP contains `plvs.exe`, `plvs-cli.exe`, `ffmpeg.exe`, and `ffprobe.exe`; testers must
keep the extracted files together. The macOS DMG targets Apple Silicon on macOS 14.2 or later and
installs `PLVS Preview.app`, which asks for its own macOS permissions. For Linux, explain APT
installation, the `plvs-preview` / `plvs-preview-cli` commands, bundled private FFmpeg/FFprobe, the
required PulseAudio/pipewire-pulse service, that the PLVS 0.23.0 deb still declares a conflict with
Preview, and the pending native hardware/desktop/soak acceptance. Do not describe a passing package
smoke as full Linux support.

Return the immutable Release URL, full commit SHA, filenames, and the fact that repository,
file-analysis, and package gates passed.

## Failure boundaries

- Before a Draft exists: fix the source or workflow, push the new exact SHA, and dispatch again.
  With `all`, one failing platform blocks the whole Preview; dispatch a single platform only when the
  user accepts a partial Preview.
- If a run leaves a mutable Draft: report it. It may be deleted with its workflow-created tag before
  retrying, but deletion is not required because the next run receives a unique tag.
- After publication: never replace assets or move/reuse the tag. Fix the code and create a new Preview.
- `preview-build.yml` does not update the official version, CHANGELOG, stable updater metadata, or
  website.
