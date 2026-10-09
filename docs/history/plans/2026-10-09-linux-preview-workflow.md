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
