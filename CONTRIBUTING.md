# Contributing

Thanks for your interest in PLVS. This covers local development and CI conventions; product scope and promises are in [`docs/prd.md`](docs/prd.md), and the technical architecture is in [`docs/architecture.md`](docs/architecture.md).

## Environment

- **Node.js**: `.nvmrc` is the single version source, and CI's `setup-node` reads it too; `engines` in `package.json` only declares the lower bound.
- **Rust**: stable (matching `rust-version` in `src-tauri/Cargo.toml`)
- **FFmpeg sidecar**: `npm run ffmpeg:fetch`. `src-tauri/binaries/` is not committed (sidecars ship as Release assets), so every fresh clone and worktree starts empty. `npm ci` automatically restores checksum-verified sidecars in linked worktrees, and supported npm Rust/desktop commands self-prepare before Cargo; use `npm run worktree:doctor` to diagnose the common environment. The build process is in [`docs/ffmpeg-sidecar-build.md`](docs/ffmpeg-sidecar-build.md).

## Common commands

```bash
npm ci
npm run ffmpeg:fetch     # once per primary clone; linked-worktree npm ci does this automatically
npm run worktree:setup   # use instead of npm ci when initializing a linked worktree
npm run desktop:dev
npm run lint
npm run typecheck
npm test
npm run build
npm run check:changes    # final local gate before push or merge
npm run website:dev
```

For a newly created linked worktree, use `npm run worktree:setup` instead. It runs the locked
dependency install, restores sidecars from the machine-level verified cache, and checks Node and
Rust. A plain `npm ci` in a linked worktree also restores the sidecars automatically. Task-specific
requirements such as Playwright Chromium, VLC, virtual audio devices and active desktop sessions
remain with the commands that use them; they are not installed into every worktree.

## Focused workflows

The contributor path stays short; use the dedicated living guide when a change reaches one of these
specialized areas:

- [Desktop development and platform packages](docs/desktop-development.md)
- [Visual and capture validation](docs/visual-and-capture-validation.md)
- [Website and Sharesets maintenance](docs/website-and-sharesets.md)
- [Stable release operations](docs/release-operations.md)
- [Dependency license review](docs/dependency-license-review.md)

## Version numbers

When releasing or bumping the version, change all of these together (and keep them identical):

- `version` in the root `package.json`
- `version` under `[workspace.package]` in `src-tauri/Cargo.toml` (inherited by both `plvs` and `plvs-cli`)
- `version` in `src-tauri/tauri.conf.json`

`npm run version:check` verifies the three match, and CI runs it too. If you change dependencies in `Cargo.toml`, run `cargo check` under `src-tauri` and commit `Cargo.lock` as appropriate.

## Code comments

All **comments and docstrings in source code** (`*.rs`, `*.js`, `*.jsx`, `*.css`, etc.) must be **English** (line/block/JSDoc, Rust `///` / `//!`). **String literals** that must match localized OS or UI text (e.g. Windows device name heuristics) are exempt.

## Git commits and PRs

Use **English only** for commit messages, PR titles/descriptions, and any text that accompanies `git push` (no Chinese in those strings).

Commits use a scoped Conventional Commit message such as `fix(cli): handle an unavailable app`.

Checks happen in three phases:

1. **While implementing:** run focused tests for the behaviour being changed.
2. **At commit:** the pre-commit hook checks only relevant staged formatting, Rust formatting and
   Cargo lock consistency. Creating a commit does not trigger the full repository gate.
3. **Before push or merge:** run `npm run check:changes` once after the final intended commit. It
   examines all pending commits and working changes, then selects contracts, frontend, website or
   the full repository gate. Unknown or mixed changes fall back to `npm run check`.

A successful `check:changes` remains valid while `HEAD`, the index and the worktree are unchanged.
A rebase, amended commit, generated-file update or edit invalidates it; otherwise do not repeat it.

**Changelist (CL) descriptions**—the full narrative in a pull request body (or any equivalent review “description” field)—must also be **English** (what changed, why, risks or follow-ups in clear technical prose).

## Release operations

Stable-release review, packaged update acceptance, self-hosted capture runners, broken-release
response, and signing-secret inventory live in
[docs/release-operations.md](docs/release-operations.md). Follow the repository release skill for
the executable end-to-end release sequence.

## CI

- **Pull requests / pushes to `main`**: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) uses
  the same change classifier. Documentation and tooling run contracts; frontend changes add the
  frontend lane; native changes add Rust checks on Ubuntu, Windows and macOS; unknown paths run all
  lanes. The website lane still runs on every push and pull request.
- **Ordinary package checks**: [`.github/workflows/package-check.yml`](.github/workflows/package-check.yml)
  builds only affected platforms on GitHub-hosted runners. Shared package inputs select Windows,
  macOS and Ubuntu together; platform-only inputs select one. A weekly all-platform run catches
  omissions in the classifier. Signing, physical capture and updater acceptance remain release gates.
- **Publishing a release**: after the release commit's `ci.yml` push run succeeds, dispatch
  [`.github/workflows/release.yml`](.github/workflows/release.yml) with its version and full commit
  SHA. The workflow builds each platform once, smoke-tests those exact files, assembles a draft
  release, and publishes it only after the complete asset set is verified. Enable immutable
  releases in the repository settings and confirm that dispatch input before starting; tag pushes
  do not start the release workflow.

## Dependency updates

[Dependabot](.github/dependabot.yml) proposes npm, cargo and Rust toolchain updates every Monday. Its
pull requests are never merged: the
[`plvs-deps-update`](.agents/skills/plvs-deps-update/SKILL.md) skill applies the compatible ones to
main as one commit, normally from a weekly scheduled run, and reports the rest.

## Line endings and encoding

The repository uses **LF** (see [`.editorconfig`](.editorconfig) and [`.gitattributes`](.gitattributes)). If Git on Windows still reports CRLF, run `git add --renormalize .` once to normalise.

## Dependency license review

Dependency and native-component license changes require the review process in
[docs/dependency-license-review.md](docs/dependency-license-review.md); do not accept a changed
license merely to make the automated check green.

## Linux development and Preview packaging

Experimental Linux capture and Ubuntu Preview package verification live in
[docs/desktop-development.md](docs/desktop-development.md#experimental-linux-capture-verification).
