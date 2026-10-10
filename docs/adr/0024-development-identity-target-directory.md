# ADR 0024: Development-identity builds have their own target directory

## Status

Accepted. Amends the target-directory statement in
[ADR 0006](0006-isolate-plvs-cli-cargo-package.md) for the development identity only.

## Context

`plvs-cli` is a forwarder: it runs the `plvs` executable in its own directory, and refuses with
`cliHostIdentityMismatch` when that host was built for another app identity.

`npm run desktop` builds `plvs` and `plvs-cli` with the `dev-identity` feature. `cargo test`, which
`npm run check` runs, builds `plvs` without it. Both wrote `target/debug/plvs` in the one workspace
target directory, so the two commands could not be used together:

- On Windows a running executable cannot be replaced. With the development app open, `cargo test`
  failed with "failed to remove file ... plvs.exe. Access is denied".
- Where the replacement succeeds, the development `plvs-cli` is left beside a release-identity
  host and every `desktop:control` command fails with `cliHostIdentityMismatch`.

`npm run release:preflight` runs `npm run check` and then the Agent Control desktop smoke, which
needs the development app running and the development CLI working. Both failures were observed on
Windows on 2026-10-10: the gate could not pass as one command.

Reordering the gate does not help, because the check and a running development app conflict
whichever comes first. Giving `cargo test` the `dev-identity` feature would make the two builds
agree, at the cost of testing a different build from the one that ships.

## Decision

Every development-identity build uses `src-tauri/target/dev-identity` as its Cargo target
directory. `scripts/build-plvs-cli.mjs` owns the path, passes it to Cargo for the development CLI,
and `scripts/run-tauri-dev.mjs` hands it to `tauri dev` as `CARGO_TARGET_DIR`.

The directory is nested under `target/` so that Git and the Tauri development watcher ignore it
without further configuration, and `cargo clean` removes it.

`npm run desktop:build` is unchanged. Its release-profile app still goes to `target/release`; only
the development CLI it stages is built in the new directory, and staging copies it out.

## Consequences

- The first `npm run desktop` after this change is a full build, and the directory holds a second
  set of debug artifacts: 6.8 GB and 3 min 37 s on the Windows machine it was measured on.
- A script that needs the development app or CLI gets the path from `buildPlvsCli` or
  `DEVELOPMENT_TARGET_DIRECTORY`. `target/debug/plvs` is whatever `cargo` last built there and is
  never the development app.
- Verified on Windows only. macOS never had the file-lock failure but had the identity mismatch;
  the same change applies there and has not been run.
