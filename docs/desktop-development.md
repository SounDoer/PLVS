# Desktop development and platform packages

This guide covers the dev app identities, Agent Control development checks, experimental Linux
capture, and Ubuntu Preview packaging. Environment setup and everyday commands remain in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Desktop development

Desktop (Tauri):

```bash
npm run desktop:dev
```

`npm run desktop:dev` and `npm run desktop:dev-optimized` both pass `--config src-tauri/tauri.dev.conf.json --features dev-identity`, which changes the app identifier to `com.soundoer.plvs.dev`. The dev app therefore has its own `%APPDATA%\com.soundoer.plvs.dev\plvs-settings.json` and its own webview data, and never overwrites the settings, window position or dock state of an installed stable PLVS. The build script first builds the standalone `src-tauri/plvs-cli` workspace package with the same identity, then stages it as a Tauri external binary; host and CLI must always come as a pair. Dev-identity debug builds go to `src-tauri/target/dev-identity`, apart from the directory `cargo test` writes to, so `npm run check` can run while the dev app is open ([ADR 0024](adr/0024-development-identity-target-directory.md)).

In a linked worktree (for example under `.claude/worktrees/`), `npm run desktop:dev` runs a dev app that can sit beside the main checkout's and other worktrees' ([ADR 0028](adr/0028-parallel-worktree-dev-apps.md)). It picks a Vite port in 1430–1499 instead of 1420 and keeps its app data in the worktree's ignored `.dev-data/`, which starts as a first run; delete the directory to start over. `desktop:control`, `smoke:agent-control`, `ui:walkthrough` and `theme:gallery` run from that worktree reach only that worktree's app. An optimized build from `npm run desktop:dev-optimized` in a worktree is launched by hand with `src-tauri/target/release/plvs --plvs-test-app-data-root <worktree>/.dev-data` to get the same isolation. The main checkout is unchanged.

The three app identities are named `stable` (`com.soundoer.plvs`), `dev` (`com.soundoer.plvs.dev`) and `preview` (`com.soundoer.plvs.preview`). "Release" names only the Cargo profile and the act of publishing a version, never an identity. ADRs written before this naming keep the earlier names:

| Earlier name                                                   | Current name                                              |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run desktop`                                              | `npm run desktop:dev`                                     |
| `desktop:build`                                                | `desktop:dev-optimized`                                   |
| `desktop:release-nsis`, `desktop:release-dmg`                  | `desktop:stable-nsis`, `desktop:stable-dmg`               |
| `desktop:verify-windows-installer`, `desktop:verify-macos-dmg` | `desktop:verify-stable-nsis`, `desktop:verify-stable-dmg` |
| `desktop:verify-windows-preview-installer`                     | `desktop:verify-preview-nsis`                             |
| `--identity development`, `--identity release`                 | `--identity dev`, `--identity stable`                     |
| `DEVELOPMENT_TARGET_DIRECTORY`                                 | `DEV_IDENTITY_TARGET_DIRECTORY`                           |
| Earlier stable/dev identity wording                            | stable identity, dev identity, dev app                    |

### Identities and build profiles

Two independent choices describe every build. The identity decides which app it is; the Cargo profile decides how it is compiled.

| Identity  | Window title | Identifier                  | Used for                              |
| --------- | ------------ | --------------------------- | ------------------------------------- |
| `stable`  | PLVS         | `com.soundoer.plvs`         | What users install                    |
| `dev`     | PLVS Dev     | `com.soundoer.plvs.dev`     | Local development                     |
| `preview` | PLVS Preview | `com.soundoer.plvs.preview` | Installable test packages; no updater |

Each identity has its own settings, webview data and Agent Control discovery, so all three can be installed side by side.

| Cargo profile | Trade-off                                | Used for                                |
| ------------- | ---------------------------------------- | --------------------------------------- |
| `debug`       | Fast to compile, slow to run             | Daily development and tests             |
| `release`     | Slow to compile, fast to run             | Packages and performance work           |
| `harness`     | `release` plus the capture test commands | `smoke:capture` and `soak:capture` only |

| Command                                             | Identity  | Profile   | Output under `src-tauri/target/` |
| --------------------------------------------------- | --------- | --------- | -------------------------------- |
| `npm run desktop:dev`                               | `dev`     | `debug`   | `dev-identity/debug/`            |
| `npm run desktop:dev-optimized`                     | `dev`     | `release` | `release/`                       |
| `npm run desktop:preview-nsis`                      | `preview` | `release` | `release/`                       |
| `npm run desktop:stable-nsis`, `desktop:stable-dmg` | `stable`  | `release` | `release/`                       |
| `npm run rust:test` (part of `npm run check`)       | `stable`  | `debug`   | `debug/`                         |
| Capture harness build                               | `stable`  | `harness` | `harness/`                       |

`release/plvs` is whichever of the three `release`-profile commands ran last. The dev `debug` build has its own directory because `cargo test` and a running dev app would otherwise fight over `debug/plvs`; see [ADR 0024](adr/0024-development-identity-target-directory.md). `plvs-cli` forwards to the `plvs` beside it, so the two are always built as a pair with the same identity.

`src-tauri/target/` is ignored by Git and can be deleted at any time. Everything in it is rebuilt on demand; the first dev build afterwards takes a few minutes.

To let an agent inspect or adjust the Workspace of the running dev app, open a second terminal:

```bash
npm run desktop:control -- inspect --json
npm run desktop:control -- workspace apply layout.json --json
npm run smoke:agent-control
```

Use `npm run cli:build` to build only the CLI package without starting the GUI. With no arguments it builds the stable-identity debug CLI; `desktop:control` is what builds the dev CLI.

`desktop:control` quietly builds the standalone CLI package incrementally, always with the same `dev-identity`, then forwards the arguments directly to the flat `plvs-cli` commands; the dev app must already be running. It does not depend on Agent Control / PATH in Settings, and it never discovers or changes an installed stable PLVS. The stable CLI uses the same flat commands but talks to the installed app through the stable identity. Windows uses a current-user named pipe; macOS and Linux use a private Unix socket. Linux requires a private `$XDG_RUNTIME_DIR` and verifies peer ownership with `SO_PEERCRED`. Visual Capture screenshots and recording work on all three desktop platforms; Linux supports measured-source audio but advertises only pointer-free recording. `smoke:agent-control` requires the current dev app in a visible normal window with no open surfaces or blocking editors. It verifies capabilities, inspect, Settings navigation, a screenshot and a 3-second silent recording, and writes artifacts plus the selected instance ID to `artifacts/agent-control-smoke/`. A successful run keeps the compatibility `smoke-report.json`; success or a caught product/cleanup failure writes the shared `result.json`. Formal evidence requires a clean worktree so its source SHA identifies the code that ran. Use `npm run smoke:agent-control -- --instance <id>` or `PLVS_INSTANCE_ID` with multiple workbenches. Without either, it discovers and pins the sole instance for the whole run, including cleanup.

`smoke:agent-control` is a development check of the current source. Releases do not run it locally:
`release-package-smoke.yml` runs the same scenarios against the exact release packages on the three
home runners (see [Release operations](release-operations.md#home-capture-runners)).
Ordinary hosted CI runs the protocol and orchestration tests; it does not certify native GUI
capture. Native capture still needs validation on each desktop
platform; Linux validation must use an unlocked real GNOME Wayland session with the window visible.

## Experimental Linux capture verification

Use `npm run desktop:linux` to launch the dev app with its dev identity. This
entry point requires system FFmpeg/FFprobe in `/usr/bin` (or an absolute `PLVS_FFMPEG_DIR` override)
and stages only the CLI as a sidecar. It does not produce a redistributable Linux package. In WSL,
keep a separate Linux dependency/build directory; do not share Windows `node_modules` or `target`.
The dev identity enables Agent Control by default. Verify the live Linux transport with
`npm run desktop:control -- capabilities --json` and
`npm run desktop:control -- inspect --json`. The endpoint is a mode-`0600` Unix socket under the
private `$XDG_RUNTIME_DIR`. Linux Visual Capture uses WebKitGTK snapshots for PNG screenshots and
H.264 MP4 recording with optional measured-source AAC audio; keep the real display session
unlocked and the PLVS window visible. Recording always encodes with `/usr/bin/ffmpeg` (ADR 0037),
whatever `PLVS_FFMPEG_DIR` says; set an absolute `PLVS_RECORDING_FFMPEG` to try another FFmpeg, or
a path that does not exist to see the unavailable-recording reporting. The release-package smoke
needs Ubuntu's `ffmpeg` on the Linux runner and reports its absence as a rig problem.

On a Linux development desktop with PulseAudio or `pipewire-pulse`, install `pactl`, `paplay`,
and FFmpeg/FFprobe, then build the current capture harness and run:

```sh
cargo build --manifest-path src-tauri/Cargo.toml --profile harness --bin plvs --features capture-harness,dev-identity
PLVS_FFMPEG_DIR=/usr/bin npm run smoke:capture:linux
```

The Linux smoke creates a temporary null sink, plays the asymmetric stereo fixture into it, and
compares live monitor capture with file analysis using the existing tolerances. It checks sample
rate, channel count, and dropped chunks, removes its sink afterward, and does not change the
default output. Missing tools, unsupported module loading, or stale harness binaries are rig
errors (exit 2); metric disagreement is exit 1. Passing in WSLg verifies the protocol path only;
native Linux desktop, device-switching, multichannel, and long-running soak checks are still needed.

## Ubuntu Preview package

On Ubuntu 24.04 x86_64, run `npm run desktop:preview-deb`. It builds the optimized application and
CLI with `preview-identity`, packages embedded frontend assets, and writes a `.deb` under
`src-tauri/target/release/bundle/deb/`. It does not publish anything. The Preview updater is disabled;
do not add the capture-harness or dev identity features to the package.

The builder clears the inherited resource map before loading the complete Preview resource map.
Without that reset, recursive config merging maps both the stable and Preview manifests to
`plvs-agent.json`, making the installed identity depend on copy order. Keep the config order intact.

The Preview deb sets `mainBinaryName` to `plvs-preview` and ships its CLI as `plvs-preview-cli`, so
its executables, icons and desktop entry never collide with the stable deb's and the two packages
install side by side without `Conflicts` (ADR 0036). The Rust build scripts emit the same names as
`PLVS_HOST_BINARY` / `PLVS_CLI_BINARY`; keep them in step with `tauri.linux-preview-deb.conf.json`.

The deb fetches checksum-pinned FFmpeg/FFprobe and installs them below
`/usr/lib/plvs-preview/sidecars`; it never owns, replaces, or depends on Ubuntu's
`/usr/bin/ffmpeg`. Stable packages use `/usr/lib/plvs/sidecars`. See
[ADR 0033](adr/0033-linux-deb-bundles-private-ffmpeg-sidecars.md). Build on the stated baseline;
building on a newer distribution can silently raise the required glibc version.

`scripts/verify-linux-deb.sh <package.deb> <output-directory> <fixture-directory> [companion.deb]`
installs, checks, and removes the package. With a companion (the other identity's deb), it installs
both, launches both, removes the primary package and checks that the companion still verifies and
launches; `preview-build.yml` passes a stable deb built from the same commit. It requires root **inside a disposable Ubuntu 24.04 system** with the marker file
`/etc/plvs-disposable-package-rig`; never run it against a personal desktop. Provision the test
tools `python3`, `xvfb`, `xauth`, `dbus-x11`, `pulseaudio`, and `desktop-file-utils` there first.
The script refuses an existing PLVS installation and any system FFmpeg executable. It checks the
private package-owned sidecars and identity, decodes representative codecs, starts the installed GUI as an unprivileged
user under Xvfb with a private PulseAudio null sink, and checks CLI instance discovery. Its logs,
package inventory, checksum, and JSON diagnostics go to the output directory. Uninstallation must
remove PLVS binaries, desktop integration, and private sidecars while preserving user data.

This package smoke does not validate the GUI file-picker interaction, physical devices, accelerated
rendering, or native Wayland/X11 desktop integration. Run `npm run smoke:file-analysis` against the
fetched sidecars separately and retain the native desktop/soak milestones.

For an automated fresh-system check, install `debootstrap` on the Ubuntu build host and run
`sudo bash scripts/verify-linux-deb-clean.sh <package.deb> <output-directory> <fixture-directory>`.
It bootstraps a
temporary Ubuntu userspace, runs the package verifier in private mount/PID namespaces, preserves
the logs, and removes the temporary root. Pass the fixture directory generated by
`scripts/generate-sidecar-fixtures.mjs` as the third argument. It never installs the package on the
build host.

The manually dispatched `preview-build.yml` accepts `platform=linux` or `platform=windows`
(default). Supply an explicit full commit SHA and unique request ID. It runs the full repository
gate, builds only the selected platform, runs real file-analysis and package tests, and promotes
the exact tested artifacts through a Draft Pre-release. Linux publishes one commit-labelled deb;
Windows publishes its installer and Portable ZIP. Official versions, updater metadata, and website
deployment are separate. Follow `.agents/skills/plvs-preview-build/SKILL.md` for dispatch and verification.
