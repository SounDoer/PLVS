# Contributing

Thanks for your interest in PLVS. This covers local development and CI conventions; product scope and promises are in [`docs/prd.md`](docs/prd.md), and the technical architecture is in [`docs/architecture.md`](docs/architecture.md).

## Environment

- **Node.js**: `.nvmrc` is the single version source, and CI's `setup-node` reads it too; `engines` in `package.json` only declares the lower bound.
- **Rust**: stable (matching `rust-version` in `src-tauri/Cargo.toml`)
- **FFmpeg sidecar**: `npm run ffmpeg:fetch`. `src-tauri/binaries/` is not committed (sidecars ship as Release assets), so every fresh clone and worktree starts empty, and the Rust build fails without it — with an error pointing at an unrelated third-party crate such as a `serde_derive` compile failure, while the real cause is buried in the build script output. The build process is in [`docs/ffmpeg-sidecar-build.md`](docs/ffmpeg-sidecar-build.md).

## Common commands

```bash
npm ci
npm run ffmpeg:fetch     # once per clone/worktree: downloads the gitignored FFmpeg sidecars
npm run theme:generate   # optional: regenerates src/generated/theme-fallbacks.css (also runs via prebuild)
npm run lint
npm test
npm run build
npm run community:validate -- path/to/item.plvspreset
npm run community:metadata -- path/to/item.plvspreset
npx playwright install chromium # once per clone/worktree when generating Community previews
npm run community:preview -- path/to/item.plvspreset path/to/new-preview-directory
npm run community:source:check -- path/to/catalogue
npm run community:curate -- path/to/published path/to/candidate path/to/new-review-output
npm run community:curate -- --write path/to/published path/to/candidate path/to/new-review-output
```

`community:validate` is the repository/CI intake boundary for one immutable Community artifact. It
accepts `.plvsloudness`, `.plvspreset`, or `.plvstheme`, requires canonical Pack V2 bytes and one
primary Item, and prints a JSON report containing the exact byte length, SHA-256, versions, and
derived compatibility facts.

`community:metadata` runs the same validation boundary and emits only Pack-derived static Catalogue
input: content identity and summary, dependency hashes, compatibility facets, and the versioned
preview plan. Author, description, tags, licence, and release notes are submission metadata and are
therefore never invented from the artifact.

`community:preview` validates one canonical artifact, builds the isolated browser harness, and uses
the Chromium revision pinned by Playwright to generate the exact contract-owned PNG set plus
`preview-result.json`. The output path is explicit and must not already exist; the command never
edits Catalogue records or deploys content. Run `npx playwright install chromium` once after
installing dependencies on a machine that generates previews.

`community:source:check` validates the detachable Catalogue content manifest. The directory argument
is optional while content lives at `community/catalogue`; external Catalogue checkouts pass their
own root without changing website code.

### Curating Community content

`community:curate` is the maintainer path from a candidate content tree to a local review. The first
form above is always a dry run: it validates the candidate records and new canonical artifacts,
compares all existing Release records and bytes with the published baseline, and prints a concise
JSON summary of additions, one-way withdrawals, and Listing copy edits. It writes nothing.

After reading that summary, repeat the same command with `--write`. This generates previews only for
new Releases, validates the now-complete candidate and its immutable history, then creates a new
review directory containing `site/`, `report.json`, and `report.md`. Preview IDs and paths belong in
the new Release record; dimensions, hashes, Pack-derived metadata, and site copies are generated.
The command refuses an existing review directory or existing new-Release preview target, and it
does not commit or deploy. Serve the review directory's `site/` as a static website when browser
review is useful; for example, `npx vite preview --outDir path/to/review/site`.

The baseline must be the exact content commit currently named by the deployed
`/community/publication.json`, not an arbitrary old checkout. For the first publication, use the
stable PLVS Release tag that supplies the empty Catalogue. Keep both checkouts unchanged while
curating so the byte comparison remains meaningful.

To publish after review, commit the candidate content, wait for the normal merge gate, then dispatch
`.github/workflows/deploy-community.yml` with that exact commit SHA as `content_ref`. The workflow
repeats source and immutable-history validation against the deployed marker before GitHub Pages is
changed. The first public Catalogue instead ships through the normal PLVS Release workflow so the
navigation and initial content appear together.

To withdraw a bad Release, leave its artifact, previews, paths, notes, and date untouched; change
only `status` to `withdrawn` and add `withdrawalReason`, then run the dry run and `--write` review
again. Never delete, restore, renumber, or replace a published Release. Before deployment, recovery
means fixing the candidate and creating a fresh review directory—the live Pages artifact is
unchanged. After deployment, publish a withdrawal or a higher-numbered corrective Release; do not
redeploy an older tree as though the newer history never existed.

Desktop (Tauri):

```bash
npm run desktop
```

`npm run desktop` and `npm run desktop:build` both pass `--config src-tauri/tauri.dev.conf.json --features dev-identity`, which changes the app identifier to `com.soundoer.plvs.dev`. The development build therefore has its own `%APPDATA%\com.soundoer.plvs.dev\plvs-settings.json` and its own webview data, and never overwrites the settings, window position or dock state of an installed release. The build script first builds the standalone `src-tauri/plvs-cli` workspace package with the same identity, then stages it as a Tauri external binary; host and CLI must always come as a pair. Cargo refreshes only the packages affected when switching identities.

To let an agent inspect or adjust the Workspace of the running development build, open a second terminal:

```bash
npm run desktop:control -- inspect --json
npm run desktop:control -- workspace apply layout.json --json
npm run smoke:agent-control
```

Use `npm run cli:build` to build only the CLI package without starting the GUI.

`desktop:control` quietly builds the standalone CLI package incrementally, always with the same `dev-identity`, then forwards the arguments directly to the flat `plvs-cli` commands; the development GUI must already be running. It does not depend on Agent Control / PATH in Settings, and it never discovers or changes an installed release. The public release CLI uses the same flat commands but talks to the installed app through the release identity. Windows uses a current-user named pipe and macOS a private Unix socket; Visual Capture screenshots and recording work on both platforms. `smoke:agent-control` assumes the development GUI is running, verifies capabilities, inspect, a screenshot and a 3-second silent recording, and writes the files and a verification report to `artifacts/agent-control-smoke/`.

Installable test packages use a third identity rather than either of those two. `npm run desktop:preview-nsis` combines `tauri.preview.conf.json` with `preview-identity`, producing **PLVS Preview** (`com.soundoer.plvs.preview`) with its own settings, installer registration and Agent Control discovery. The Preview feature also compiles out updater registration. `scripts/generate-agent-discovery.mjs` owns both the stable and Preview manifests and NSIS hooks; do not edit those generated files by hand.

Windows Preview build (matching CI `preview-build.yml`):

```bash
npm run desktop:preview-nsis
npm run desktop:verify-windows-preview-installer
```

Windows release build (matching CI `release.yml`: NSIS installer + Portable ZIP):

```bash
npm run build
npm run desktop:release-nsis
```

Raw outputs: the installer under `src-tauri/target/release/bundle/nsis/`, plus
`src-tauri/target/release/plvs.exe` and `plvs-cli.exe`. The tag release workflow packages the latter
two under their original names as `PLVS-v<version>-x64-portable.zip`; like the installer, the
portable build needs WebView2 installed on the machine. `scripts/build-plvs-cli.mjs` is the single
build entry point for CLI debug/release, development/Preview/release identity and Tauri staging; the Tauri
input files carry the target triple, while the public names in the installation and Portable do not.

macOS release build (DMG):

```bash
npm run desktop:release-dmg
```

Rust (inside `src-tauri`):

```bash
cd src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

From the root, `npm run rust:check` runs all three (`npm run check` includes it).

One command from the root checks **frontend + version numbers + Rust format/lint/tests**:

```bash
npm run check
```

Real-machine verification outside `check`, run manually as needed:

```bash
npm run smoke:file-analysis   # File mode analysis smoke test
npm run smoke:capture         # real capture smoke test; needs VB-Cable and VLC on the machine
npm run soak:capture          # long capture run, 4 hours by default; the only check that finds leaks and metric drift
```

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

**Changelist (CL) descriptions**—the full narrative in a pull request body (or any equivalent review “description” field)—must also be **English** (what changed, why, risks or follow-ups in clear technical prose).

## CI

- **Pull requests / pushes to `main`**: see [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (frontend + Rust on Ubuntu; Rust `fmt` / `clippy` / `test` on Windows).
- **Release builds**: after the release commit's `ci.yml` push run succeeds, dispatch
  [`.github/workflows/release.yml`](.github/workflows/release.yml) with its version and full commit
  SHA. The workflow builds each platform once, smoke-tests those exact files, assembles a draft
  release, and publishes it only after the complete asset set is verified. Enable immutable
  releases in the repository settings and confirm that dispatch input before starting; tag pushes
  do not start release builds.

## Dependency updates

[Dependabot](.github/dependabot.yml) is enabled (npm and cargo, weekly). Run `npm run check` locally before merging.

## Line endings and encoding

The repository uses **LF** (see [`.editorconfig`](.editorconfig) and [`.gitattributes`](.gitattributes)). If Git on Windows still reports CRLF, run `git add --renormalize .` once to normalise.
