# ADR 0007: Publish immutable Preview builds under an isolated identity

## Status

Accepted (2026-09-20)

## Context

The former Windows Dev Build repeatedly deleted and recreated one published `dev` Pre-release and
tag. That rolling model is incompatible with repository release immutability: published assets and
their tag are locked, and a tag name associated with an immutable Release cannot later be reused.

Those packages also used the stable `PLVS` application identity. A test installer could therefore
share settings, installation registration, Agent Control discovery and updater behavior with the
official application. Filename suffixes made downloads distinguishable but did not isolate the
installed program.

## Decision

- Call installable test packages **PLVS Preview** and the agent workflow `plvs-preview-build`.
- Build the exact full commit SHA supplied to the workflow, after the normal repository gate.
- Build and smoke-test the Windows packages once, assemble them in a Draft Pre-release, verify the
  tag and asset inventory, then publish once under `preview-<short-sha>-<run-id>`.
- Require the published Pre-release to be immutable and attested. Never move or reuse its tag.
- Keep only the ten newest Preview releases. Cleanup happens after successful publication and is
  not a package-correctness gate.
- Compile Preview with `com.soundoer.plvs.preview`, separate manifests and Windows installer
  discovery, and no updater plugin. Local development remains `com.soundoer.plvs.dev`; stable PLVS
  remains `com.soundoer.plvs`.
- Keep Preview Windows-only. It does not change the official version or CHANGELOG and does not
  deploy the website.
- Exclude `preview-*` tags whenever tooling determines the previous official `vX.Y.Z` release.

## Consequences

- Every shared test package has a stable source commit, download URL and attestation.
- Preview and stable PLVS can be installed side by side without sharing settings or discovery.
- Rebuilding the same commit creates another uniquely tagged Preview instead of mutating history.
- Preview publication takes longer because it runs the full repository gate before packaging.
- Testers use the exact Release URL returned by the workflow; there is no mutable `/releases/tag/dev`
  download URL.
- Old Preview releases expire from GitHub after they fall outside the ten-build retention window.

## Verification

The change includes contract tests for exact-SHA dispatch, Draft promotion, permissions, bundle
inventory and isolated identity. A local release-profile Preview NSIS build completed, and its
silent-install smoke verified the Preview app name, identifier, configuration directory, bundled
Agent manifest, Windows discovery values, CLI identity and uninstall cleanup.
