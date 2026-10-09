# Linux Preview Publication Workflow

Date: 2026-10-09
Starting commit: `cb0f0e19`

## Scope

Extend the existing immutable Preview workflow with a selected Linux target. Preserve the Windows
default, exact-commit input, full repository gate, read-only build jobs, Draft promotion, attestation
verification, unique Preview tags, and retention policy. Official release versioning, updater
metadata, and website deployment stay outside this change.

## Design

The Linux job builds on Ubuntu 24.04, exercises real Rust file analysis with system decoders, then
builds the optimized Preview deb. A new disposable-root wrapper recreates the already-tested local
installation rig with debootstrap and private mount/PID namespaces. The final installed program,
decoder paths/codecs, certificates, user storage, discovery identity, and uninstall are verified.
Evidence remains a workflow artifact; the public asset set contains only the tested deb.

The platform-aware validator rejects mixed, missing, empty, or wrongly named assets. Draft promotion
waits for validation and the selected platform's successful build, handling the other platform's
intentional skip. The release notes record the platform, exact commit, installation steps and Linux
acceptance limits. The Preview skill documents dispatch and verification for both platforms.

## Acceptance

- Preserve the existing Windows bundle tests and add Linux asset-set and workflow contracts.
- Validate YAML and GitHub Actions expressions/references with actionlint.
- Exercise the fresh-root wrapper locally against the already-tested deb; never weaken WebKit's
  sandbox or run the GUI as root to pass the gate.
- Run the full repository gate before pushing, then select and dispatch an explicit committed SHA.
- Require a successful exact workflow run, complete immutable Pre-release and valid attestation
  before returning a public download link.

## Local verification

`npm run check` passed, including 5,200 Vitest tests, production frontend build, Windows strict
Clippy and Rust tests. All 38 focused workflow/bundle/documentation tests passed after final
publication-condition changes. Actionlint 1.7.12 accepted workflow syntax, expressions and job
references. The fresh-root wrapper's first run exposed mktemp's 0700 root mode; it now explicitly
sets the disposable system root to 0755 before unprivileged execution. A second fresh bootstrap
passed installed Preview/decoder/certificate checks, GUI startup, seven codecs, and removal with
user-data checksums preserved. Its temporary root was removed and evidence retained at
`/home/plvs/linux-preview-workflow-evidence-final` in the WSL development distribution.

## First cloud run

Run `37900774377` passed the full repository gate, real file-analysis tests and deb build, but
installation verification rejected the packaged discovery identity before any Draft was created.
Tauri combines CLI configuration patches before applying them to the base: resetting the entire
resource map to null and then adding Preview resources therefore leaves the base stable manifest
mapping intact. Two sources then race to the same installed destination. The reset now deletes the
specific stable manifest key; that null survives patch composition. The contract test covers the
combined map, and acceptance still requires a newly built package and successful cloud publication.

After the fix, rebuilding the Linux application and three separate bundling/extraction passes all
confirmed the Preview identifier and CLI path. A local full-gate retry encountered the existing
PID-named multiprocess test directory residue; both Library multiprocess tests passed with a fresh
temporary directory. The full gate is rerun with that isolated temporary root, without changing
database code or weakening the assertions.

The corrected package passed another complete fresh Ubuntu bootstrap/install/runtime/remove run;
evidence is in `/home/plvs/linux-preview-manifest-clean-evidence`. No sandbox bypass was used.

## Cloud test-user environment

Run `37906489048` passed the full gate, file-analysis tests, package build and corrected installed
identity check. Its private PulseAudio test server then rejected an inherited XDG configuration
path under `/home/runner`, which does not exist after pivoting into the fresh userspace. No Draft
was created. The unprivileged test session now starts with an empty environment and explicit test
user HOME/USER/LOGNAME, system PATH and UTF-8 locale before Xvfb/DBus are launched. This also keeps
host decoder overrides and sandbox-disable variables out of the test without relaxing the checks.

A full fresh-root run with deliberately invalid host XDG config/data/cache/runtime, PulseAudio and
DBus variables passed installation, audio/decoder checks, sandboxed GUI startup and removal. The
evidence is in `/home/plvs/linux-preview-environment-clean-evidence`.
