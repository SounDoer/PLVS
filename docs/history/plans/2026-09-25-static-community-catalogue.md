# Static Community Catalogue Implementation Plan

Date: 2026-09-25
Status: In progress

## Direction

Build the first Catalogue UI inside `landing/`, while treating Community content as an independent
build input from day one. The default content directory lives in this repository for the initial
implementation, but every reader and build command accepts an explicit content directory so the
same tree can later move to a dedicated repository without changing page URLs or content schemas.

The portable artifact, validation, hashing, metadata, and preview contracts are already complete in
`src/transfer/communityContract.js`. This plan consumes them; it does not duplicate their rules.

Catalogue records do not carry per-Item or per-Release licence fields. Permission is one
content-repository-wide submission rule, to be selected before third-party submissions open.

## Deferred decisions

These are not needed for the source/build boundary and must be settled before the matching public
workflow is enabled:

- the content repository's single contribution/publication permission rule;
- author attribution and verification fields before accounts exist;
- submission channel, moderation checklist, and withdrawal operations;
- final content-repository host and independent deployment trigger.

## Phase 1 — Detachable content source

- [x] Add a versioned manifest in a top-level content directory, outside `landing/`.
- [x] Read the content root only through an explicit loader with path traversal, duplicate, and
      missing-file checks.
- [x] Add a repository/CI command that accepts an external content directory.
- [x] Keep an empty manifest valid so website code can land before real Listings are published.

Gate: copying the content directory elsewhere and passing its path produces the same normalized
source; no website module depends on the repository-relative default.

## Phase 2 — Curated Listing and Release records

- [x] Define strict Listing/Release schemas around the approved Listing, Release, and Artifact
      model without embedding portable Item facts in author-controlled fields.
- [x] Validate free tags, restricted Markdown, stable IDs/slugs, monotonic releases, safe paths,
      and Official/Community classification.
- [ ] Resolve every Release artifact through `communityContract.js` and reject metadata drift.
- [ ] Seal required generated previews and reject publisher-controlled primary screenshots.

Gate: one source tree either produces a complete normalized catalogue or fails before output.

## Phase 3 — Static generation and browsing

- [ ] Generate `/community/`, family browse views, and stable Listing detail URLs under `landing/`.
- [ ] Add client-side search over title, summary, description, and free tags.
- [ ] Add reliable filters from machine-derived type, module, metric, Theme scheme, feature, and
      compatibility facets.
- [ ] Show content summary, dependencies, compatibility, licence, size/hash, download/install
      instructions, previews, and Release history.
- [ ] Add responsive, accessible empty/no-result states and navigation from the existing landing
      and docs pages.

Gate: generated pages work with JavaScript disabled for navigation and core content; JavaScript
only enhances search and filtering.

## Phase 4 — Build and deployment isolation

- [ ] Generate Catalogue output during site assembly without committing derived pages or metadata.
- [ ] Test the site against a fixture content repository and the default local source.
- [ ] Add an independent content deployment path that cannot accidentally publish unreleased
      desktop documentation or marketing changes.
- [ ] Preserve the same builder invocation when the content directory moves to another checkout.

Gate: a content-only change validates, builds, and deploys without a desktop release, while landing
changes retain their release-bound deployment policy.

## Phase 5 — Submission and operations

- [ ] Add submission instructions after licence and attribution policy is approved.
- [ ] Document curator validation, preview generation, immutable publication, new Release creation,
      withdrawal, and rollback.
- [ ] Add end-to-end fixtures for accepted, rejected, updated, and withdrawn Releases.

Accounts, ratings, comments, favourites, download rankings, automatic updates, `Open in PLVS`, and
an in-app Community browser remain outside this plan.
