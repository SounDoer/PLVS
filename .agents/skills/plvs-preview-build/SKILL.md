---
name: "plvs-preview-build"
description: "Builds and publishes a tested, immutable Windows PLVS Preview installer and Portable ZIP for an exact commit. Use when someone needs an installable test build; do not use for official versioned releases."
---

# PLVS Preview Build

Publish an unofficial Windows Preview for an exact pushed commit. Preview is a third application
identity (`PLVS Preview`, `com.soundoer.plvs.preview`), isolated from stable PLVS and the local
development app. It has separate settings, installation and Agent Control discovery, and its
updater is compiled out.

Use `plvs-release` instead when the user intends to ship an official version.

## Invariants

- Build the full 40-character commit SHA the user chose, never an inferred branch tip.
- Do not dispatch while relevant changes are uncommitted or the SHA is absent from the remote branch.
- A published Preview uses a unique `preview-<short-sha>-<run-id>` tag. Never reuse or move it.
- The workflow runs `npm run check`, file-analysis smoke, and Preview installer smoke before publishing.
- The tested Installer and Portable ZIP are assembled in a Draft Pre-release, verified, then
  published once. The published result must report `immutable: true` and have a valid attestation.
- Preview releases are temporary; the workflow retains the ten newest ones, deleting older Preview
  releases only after a newer Preview published successfully.

## Dispatch

Work from the branch and commit the user wants testers to receive.

```powershell
$branch = git branch --show-current
$sha = git rev-parse HEAD
$dirty = git status --porcelain
if (-not $branch) { throw "Preview builds require a branch" }
if ($dirty) { throw "Commit or discard relevant working-tree changes before building a Preview" }

$remoteLine = git ls-remote origin "refs/heads/$branch"
if (-not $remoteLine) { throw "Push $branch before building a Preview" }
$remoteSha = ($remoteLine -split "`t")[0]
if ($remoteSha -ne $sha) { throw "Push the exact Preview commit before dispatching" }

$requestId = [guid]::NewGuid().ToString("N").Substring(0, 12)
gh workflow run preview-build.yml --ref $branch -f commit_sha=$sha -f request_id=$requestId
```

Do not silently commit or push unrelated work merely to satisfy these checks. If the tree is dirty or
the remote differs, explain which commit would actually be built and let the user decide how to
prepare it.

## Find and watch the exact run

Do not use the most recent run without filtering: another person may dispatch at the same time.

```powershell
$run = $null
1..30 | ForEach-Object {
  $runs = gh run list --workflow=preview-build.yml --commit $sha --event workflow_dispatch `
    --limit 20 --json databaseId,displayTitle,url | ConvertFrom-Json
  $run = $runs | Where-Object { $_.displayTitle -like "*$requestId*" } | Select-Object -First 1
  if ($run) { break }
  Start-Sleep -Seconds 2
}
if (-not $run) { throw "No Preview run appeared for request $requestId" }

gh run watch $run.databaseId --exit-status
$conclusion = gh run view $run.databaseId --json conclusion -q .conclusion
if ($conclusion -ne "success") { throw "Preview workflow concluded $conclusion" }
```

The conclusion is the source of truth. Do not report success from a green-looking individual job or
from the presence of a Draft.

## Verify and hand back the Preview

The tag is deterministic from the tested SHA and workflow run id:

```powershell
$shortSha = $sha.Substring(0, 7)
$tag = "preview-$shortSha-$($run.databaseId)"
$release = gh release view $tag --json isDraft,isPrerelease,tagName,targetCommitish,url,assets |
  ConvertFrom-Json
$immutable = gh api "repos/SounDoer/PLVS/releases/tags/$tag" --jq .immutable

if ($release.isDraft) { throw "$tag is still a Draft" }
if (-not $release.isPrerelease) { throw "$tag is not marked as a Pre-release" }
if ($release.targetCommitish -ne $sha) { throw "$tag does not target $sha" }
if ($immutable -ne "true") { throw "$tag is not immutable" }
gh release verify $tag
```

Require exactly these two non-empty assets, using the package version and first seven SHA characters:

| Artifact | Filename |
| --- | --- |
| Installer | `PLVS-Preview_<version>-preview.<short-sha>_x64-setup.exe` |
| Portable ZIP | `PLVS-Preview-v<version>-preview.<short-sha>-x64-portable.zip` |

The Portable ZIP contains `plvs.exe`, `plvs-cli.exe`, `ffmpeg.exe`, and `ffprobe.exe`; testers must
keep the extracted files together. Return the immutable Release URL, full commit SHA, filenames, and
the fact that repository, file-analysis, and installer gates passed.

## Failure boundaries

- Before a Draft exists: fix the source or workflow, push the new exact SHA, and dispatch again.
- If a run leaves a mutable Draft: report it. It may be deleted with its workflow-created tag before
  retrying, but deletion is not required because the next run receives a unique tag.
- After publication: never replace assets or move/reuse the tag. Fix the code and create a new Preview.
- `preview-build.yml` is Windows-only and does not update the official version, CHANGELOG, stable
  updater metadata, or website.
