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
```

Desktop (Tauri):

```bash
npm run desktop
```

`npm run desktop` and `npm run desktop:build` both pass `--config src-tauri/tauri.dev.conf.json --features dev-identity`, which changes the app identifier to `com.soundoer.plvs.dev`. The development build therefore has its own `%APPDATA%\com.soundoer.plvs.dev\plvs-settings.json` and its own webview data, and never overwrites the settings, window position or dock state of an installed release. The build script first builds the standalone `src-tauri/plvs-cli` workspace package with the same identity, then stages it as a Tauri external binary; host and CLI must always come as a pair. When switching between development and release identity, Cargo only needs to refresh the packages affected by that feature.

To let an agent inspect or adjust the Workspace of the running development build, open a second terminal:

```bash
npm run desktop:control -- inspect --json
npm run desktop:control -- workspace apply layout.json --json
npm run smoke:agent-control
```

Use `npm run cli:build` to build only the CLI package without starting the GUI.

`desktop:control` quietly builds the standalone CLI package incrementally, always with the same `dev-identity`, then forwards the arguments directly to the flat `plvs-cli` commands; the development GUI must already be running. It does not depend on Agent Control / PATH in Settings, and it never discovers or changes an installed release. The public release CLI uses the same flat commands but talks to the installed app through the release identity. Windows uses a current-user named pipe and macOS a private Unix socket; Visual Capture screenshots and recording work on both platforms. `smoke:agent-control` assumes the development GUI is running, verifies capabilities, inspect, a screenshot and a 3-second silent recording, and writes the files and a verification report to `artifacts/agent-control-smoke/`.

The NSIS scripts (`desktop:dev-nsis`, `desktop:release-nsis`) do **not** use that overlay: the registry key `HKCU\Software\SounDoer\PLVS` is hard-coded, and `scripts/generate-agent-discovery.mjs` reads only the base `tauri.conf.json`, so applying the overlay would only produce a self-contradictory registration.

Windows release build (matching CI `release.yml`: NSIS installer + Portable ZIP):

```bash
npm run build
npm run desktop:release-nsis
```

Raw outputs: the installer under `src-tauri/target/release/bundle/nsis/`, plus
`src-tauri/target/release/plvs.exe` and `plvs-cli.exe`. The tag release workflow packages the latter
two under their original names as `PLVS-v<version>-x64-portable.zip`; like the installer, the
portable build needs WebView2 installed on the machine. `scripts/build-plvs-cli.mjs` is the single
build entry point for CLI debug/release, development/release identity and Tauri staging; the Tauri
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
- **Release builds**: pushing a `v*` tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml).

## Dependency updates

[Dependabot](.github/dependabot.yml) is enabled (npm and cargo, weekly). Run `npm run check` locally before merging.

## Line endings and encoding

The repository uses **LF** (see [`.editorconfig`](.editorconfig) and [`.gitattributes`](.gitattributes)). If Git on Windows still reports CRLF, run `git add --renormalize .` once to normalise.
