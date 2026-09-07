# ADR 0006: Isolate `plvs-cli` as a Cargo workspace package

## Status

Accepted (Windows delivery scope confirmed by the owner, 2026-09-07)

## Implementation status

Delivered and verified on Windows (2026-09-07). `plvs-cli` is a separate standard-library-only
runtime package, and `desktop:control` quietly builds that package on every invocation.
Workspace-wide quality commands cover both packages, and one repository script builds and stages
the matching CLI identity as an explicit Tauri external binary. Local and clean-run Dev Build
verification covered NSIS, installed `doctor --json`, registry discovery, Portable layout, matching
release identities, and both cross-identity rejection directions. The downloaded Portable artifact
also passed isolated live `capabilities` and `inspect` calls.

macOS live CLI delivery is not part of this acceptance. The owner deferred it until macOS has the
corresponding CLI product functionality; its packaging path may remain prepared but is not a gate
for this Windows-scoped decision.

The checkpoint measured about 1.64 seconds for the first invocation after the package move and
0.80 seconds for an immediate cached invocation on the development machine, versus the roughly
nine-second changed-source measurement that motivated this ADR. The matching release identity
completed `capabilities --json`; the development CLI correctly rejected the adjacent release host
with `cliHostIdentityMismatch` before command execution. These timings are supporting evidence, not
a release threshold.

## Context

PLVS ships two executables together:

- `plvs` / `plvs.exe` is the Tauri application and owns the Agent Control command implementation.
- `plvs-cli` / `plvs-cli.exe` is a small console-subsystem forwarder. It starts the adjacent PLVS
  host in internal `--cli` mode, forwards standard input/output and the exit code, and supplies its
  independently compiled app identifier so the host can reject a development/release mismatch.

The runtime boundary is intentionally thin, but the build boundary is not. `plvs-cli` currently
lives under `src-tauri/src/bin/` in the same Cargo package as `app_lib`, Tauri, the audio engine, and
the DSP dependencies. `scripts/run-desktop-control.mjs` runs `cargo build --bin plvs-cli` before
every development command to avoid using a stale forwarder. Cargo therefore enters the full PLVS
package even though the forwarder source does not reference `app_lib`.

On the measured development machine, a command after relevant source changes took about nine
seconds; an immediate cached command took about 0.75 seconds. Cargo writes its normal progress to
stderr, so JSON stdout remains valid, but the delay and noise make a healthy Agent Control command
look unreliable to a new agent.

Prebuilding the current target only when the GUI starts would improve the common case, but it would
introduce a new cache-invalidation problem: a later forwarder change could leave
`desktop:control` running a stale binary. The structural issue is that an independently deployed
forwarder is not independently buildable.

## Decision

### 1. Make the existing forwarder a separate workspace package

`src-tauri/Cargo.toml` becomes the root of a Cargo workspace containing the existing `plvs` package
and a new package at `src-tauri/plvs-cli/`. The forwarder source moves from
`src-tauri/src/bin/plvs-cli.rs` to `src-tauri/plvs-cli/src/main.rs`.

Both packages share the workspace target directory and release profile. The produced executable
keeps the public name `plvs-cli` (`plvs-cli.exe` on Windows).

The CLI package must not depend on `app_lib`, Tauri, the audio/DSP stack, or another package that
pulls them in. Its runtime implementation should remain standard-library-only unless a small,
forwarder-specific dependency becomes demonstrably necessary.

### 2. Keep command ownership in the PLVS host

This change moves only the thin forwarder. Parsing and executing public commands remains in
`src-tauri/src/cli_main.rs`, reached through the adjacent `plvs` host's internal `--cli` entry
point.

The runtime path remains:

```text
agent -> plvs-cli -> adjacent plvs host in --cli mode -> running PLVS window
```

Moving the complete command implementation into the CLI package is out of scope. Doing so would
either recreate the full application dependency graph in the CLI or require a much larger protocol
and crate-boundary redesign.

### 3. Preserve build identity from the Tauri configuration

The CLI package keeps a `dev-identity` feature. Its build script reads the canonical identifier
from the parent Tauri configuration:

- release identity: `src-tauri/tauri.conf.json`
- development identity: `src-tauri/tauri.dev.conf.json`

The build script emits `PLVS_APP_ID` for the forwarder. Identifier strings are not copied into the
CLI manifest or source. The existing host-side identity handshake remains mandatory and rejects
every mismatched CLI/host pair before parsing or executing the public command.

### 4. Give the App and CLI one product version

The two packages inherit one Cargo workspace version. `package.json`, the workspace version, and
`src-tauri/tauri.conf.json` remain release-version peers and are checked together by
`npm run version:check`.

`plvs-cli` does not gain an independent release cadence or compatibility version.

### 5. Build the small package on every development invocation

`desktop:control` continues asking Cargo to make the forwarder current before executing it, but it
targets only the new CLI package and uses quiet output for a successful build. This keeps Cargo's
correct incremental invalidation without paying the main application's dependency and link cost.

Conceptually:

```text
cargo build --quiet --manifest-path src-tauri/plvs-cli/Cargo.toml --features dev-identity
```

The wrapper continues using Cargo metadata to honor a configured target directory instead of
assuming that `src-tauri/target` is always the output location.

### 6. Package the CLI explicitly with every Windows desktop distribution

Once the CLI becomes a sibling package, Tauri must not be expected to discover it as another binary
of the application package. A repository-owned build/staging script builds the matching CLI first
and stages it as a Tauri external binary for the current target.

The staging step handles Tauri's target-triple input naming. The Windows public names remain fixed:

- Windows install and Portable ZIP: `plvs-cli.exe` beside `plvs.exe`

The generated Agent discovery manifest and the Windows `CliPath` registry value continue pointing
to that public name. A target-triple suffix must not leak into the installed discovery path.
macOS CLI packaging and verification are deferred until that platform exposes the corresponding
product functionality.

### 7. Make Rust quality gates workspace-wide

Formatting, Clippy, and tests explicitly cover every workspace member. The intended commands are:

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Release and development workflows must not rely on an earlier unrelated build having left a
`plvs-cli` artifact in the shared target directory.

## Rollout

1. Create the workspace package and move the forwarder with its unit tests.
2. Add a single repository-owned CLI build/staging script for debug, release, development identity,
   and Tauri staging modes.
3. Point `desktop:control` at the isolated package and verify the build dependency graph and local
   command experience before changing packaging.
4. Update workspace-wide Rust checks and version validation.
5. Add explicit CLI staging to development installers and release builds.
6. Verify Windows NSIS and Windows Portable ZIP contents and execution.
7. Update `docs/cli.md`, `docs/agent-control/README.md`, `CONTRIBUTING.md`, and workflow contract
   tests where their build description changes.

The development-build checkpoint precedes packaging changes deliberately: it proves that the
isolation solves the original latency/noise problem before expanding the release surface.

## Acceptance criteria

- Public CLI commands, JSON envelopes, exit codes, and discovery paths are unchanged.
- A no-change `desktop:control` invocation produces no normal Cargo progress output.
- Building the CLI package does not build or check `app_lib`, Tauri, audio, or DSP dependencies.
- Changing GUI, audio, or DSP sources does not force a CLI rebuild.
- Development CLI + development host and release CLI + release host succeed.
- Both cross-identity CLI/host combinations fail with `cliHostIdentityMismatch` before command
  execution.
- A missing host and a stopped GUI retain their existing clear errors.
- Windows installer verification proves that `plvs-cli.exe` is installed, registered, and can run
  `doctor --json`.
- Windows Portable ZIP contains `plvs.exe` and `plvs-cli.exe` together.
- `npm run check` passes with workspace-wide Rust coverage.

Wall-clock timing is recorded before and after the change as supporting evidence, not as a brittle
CI threshold. Dependency isolation and absence of unnecessary rebuilds are the enforceable
performance contract.

## Consequences

- Development Agent Control remains automatically current while becoming faster and quieter.
- The installed product still contains the same two public executables and exposes the same agent
  workflow.
- The CLI gains a small build script and package manifest, while the main application loses an
  unrelated binary target.
- Release packaging becomes more explicit and therefore slightly more complex. This is preferable
  to relying on an incidental same-package binary build.
- macOS live CLI delivery and its packaging verification remain a separate future product decision.

## Alternatives considered

- **Prebuild the current CLI only when starting the development GUI**: rejected as the final design
  because a forwarder edit after startup can leave the command wrapper using stale code.
- **Skip the Cargo build when a CLI executable already exists**: rejected because file existence
  does not establish source freshness, feature identity, or matching compiler inputs.
- **Keep the same package and suppress Cargo stderr**: rejected because it hides the visible noise
  without removing the unnecessary build coupling or latency.
- **Move the complete CLI implementation into the new package**: rejected because it would pull the
  application dependency graph back into the CLI or require a much larger extraction of shared
  business logic.
- **Give the CLI its own version and release lifecycle**: rejected because it is an installed
  companion to a specific PLVS host and the identity/version pair must remain coherent.
