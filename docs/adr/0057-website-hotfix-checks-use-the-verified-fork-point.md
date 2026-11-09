# ADR 0057: Website Hotfix Checks Use the Verified Fork Point

Date: 2026-11-09

## Context

A website hotfix starts at a released desktop version to avoid publishing documentation for
unreleased application behavior. Its first push has no previous GitHub commit SHA, and the
release-based branch can diverge from current main. Treating either condition as an unknown
range unnecessarily runs desktop checks for image-only changes.

## Decision

For `website-hotfix/**`, resolve a missing first-push base or the local `origin/main` base to
the unique common ancestor of the candidate and refreshed `origin/main`. Inspect every commit
after that ancestor, including reverted changes, and all pending local files for the local gate.
Subsequent pushes retain the actual previous pushed SHA. Missing or ambiguous ancestry retains
the full-gate fallback.

Choose jobs from the complete file set. Do not exempt a branch by name or inspect only its last
commit: either would let desktop or dependency changes enter the fast path. Restrict website
classification to known website inputs, including the homepage encoder and maintenance guides.
Keep shared dependencies and changes to the classifier on their existing broader lanes.

## Consequences

Pure website changes run website validation without desktop builds or native-license checks.
Publication still reviews the actual live-to-candidate diff, released guide compatibility,
immutable Catalogue history and the deployed version. A CI comparison base is not publication
approval. Adopting the new gate in an older release checkout changes tooling and requires full
checks once; a release that includes the gate can use the fast path directly.
