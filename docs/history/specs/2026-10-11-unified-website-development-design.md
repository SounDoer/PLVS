# Unified Website Development and Publication

## Status

Accepted for implementation on 2026-10-11.

## Problem

PLVS publishes one static website, but its current development path exposes the implementation
pieces rather than the assembled product. The checked-in `landing/` directory began as one product
landing page and now owns the homepage, Privacy Policy, Docs template, shared assets, domain, and
the presentation code used by Sharesets. The name no longer describes the boundary.

The other website inputs intentionally live elsewhere:

- `docs/user/` is the source of truth for the generated user guide;
- `sharesets/catalogue/` is a versioned, independently publishable content source containing
  Listings, immutable Release artifacts, and sealed previews.

Production assembles these inputs in a GitHub Actions shell block, while local development requires
maintainers to reproduce the steps manually. Serving only the generated Sharesets subtree breaks
root-relative `/assets/` and `/sharesets/files/` URLs. Multiple ignored output directories and
ad-hoc servers also make stale pages and port collisions easy to mistake for source defects.

## Goals

- Give the complete public website one accurate source-directory name: `website/`.
- Provide one local entry point that builds, serves, watches, and reloads the complete website.
- Provide one deterministic complete-site build used by both local development and publication.
- Keep all generated HTML outside checked-in website source.
- Preserve the detachable `sharesets/catalogue/` boundary and its immutable-history publication
  checks.
- Fail clearly on port conflicts and publish only a completely assembled, validated site.
- Retain the current static architecture and progressive enhancement.

## Non-goals

- Replacing the static site with React, Next.js, Astro, or another application framework.
- Changing Catalogue schemas, preview contracts, curation, or Release immutability.
- Redesigning the homepage, Docs, Privacy Policy, or Sharesets pages.
- Moving Sharesets content to a separate repository now.
- Automatically generating or accepting publication previews during ordinary file watching.

## Source architecture

The repository has three website inputs with distinct ownership:

```text
website/                 presentation source and deployable static files
docs/user/               user-guide source rendered into /docs/
sharesets/catalogue/     independently versioned content rendered into /sharesets/
```

`sharesets/` names the product domain. `sharesets/catalogue/` names the curated public collection
within that domain and remains the explicit input accepted by validators, builders, sparse
checkouts, and a future external content repository.

Generated development and verification output lives only under ignored `artifacts/`. No generated
Docs page is written back beneath `website/`.

## Complete-site builder

`npm run website:build` invokes one Node entry point. It accepts an optional Catalogue input and
output directory so production can combine a stable website checkout with a different exact
content checkout.

The builder:

1. resolves and validates its source and output boundaries;
2. assembles into a sibling staging directory;
3. copies `website/` recursively;
4. removes source-only tests;
5. renders `docs/user/` through the Docs template into `/docs/index.html`;
6. validates and renders the selected Catalogue into `/sharesets/`;
7. synchronizes Sharesets presentation assets and navigation visibility;
8. removes the Docs template;
9. validates the complete local-link and asset graph;
10. replaces the requested output only after every previous step succeeds.

A failed rebuild leaves the last successful output intact. Existing output replacement must be
restricted to an explicitly resolved directory below the repository's `artifacts/` directory for
default/local operation. Explicit CI output may live outside the checkout but must never equal a
filesystem root, repository root, or any source input.

## Development server

`npm run website:dev` performs an initial complete build, then serves the generated root at
`http://127.0.0.1:4173/` with strict port ownership. It watches website presentation source, user
guide source, Catalogue content, and website builder dependencies. A relevant change starts a fresh
builder process so edits to builder modules are not hidden by the running process's module cache.

Successful rebuilds trigger a full browser reload. Failed rebuilds report the error and continue
serving the last successful site. Product-preview generation remains an explicit, reviewed command;
the watcher only incorporates previews already present in the Catalogue source.

Binding the documented URL to IPv4 avoids ambiguous `localhost` resolution when another process
owns the same port on IPv6. The server must stop rather than silently select another port.

## Validation

`npm run website:check` builds the complete current site and validates at least:

- every local `href` and `src` target resolves inside the assembled root;
- directory URLs resolve to `index.html`;
- generated output contains neither source tests nor the Docs template;
- required homepage, Docs, Privacy, Sharesets, asset, download, and preview surfaces exist;
- absolute `/assets/` and `/sharesets/` references are evaluated from the assembled site root.

Existing focused unit and contract tests remain. The full website check joins the repository merge
gate without replacing the lower-level Catalogue source validation.

## Publication

Both publication triggers continue to call one shared workflow and deploy one immutable Pages
artifact:

- a PLVS Release selects the released website ref and, by default, its matching content ref;
- a content-only Sharesets publication selects the latest stable website ref and an explicit
  content ref.

The shared workflow performs live-baseline discovery and immutable-history validation before
calling the same complete-site builder used locally. It then writes the exact content commit into
`/sharesets/publication.json` and uploads the whole assembled root. The Pages concurrency lock and
non-cancelling behavior remain unchanged.

Workflow names should describe their current scope: `deploy-website.yml` is the Release-triggered
entry point, `deploy-sharesets.yml` is the content-only entry point, and `publish-site.yml` remains
the shared guarded publisher.

## Migration and compatibility

- Rename checked-in `landing/` to `website/` and update code, documentation, tests, and workflows in
  one change.
- Keep low-level `docs:site` and `sharesets:site` commands for focused tooling, but document
  `website:dev` as the ordinary development entry point.
- Keep the public URL structure unchanged: `/`, `/docs/`, `/privacy/`, and `/sharesets/`.
- Keep existing Pages history protection and publication markers unchanged.
- Defer visual-system migration of the homepage, Docs, and Privacy Policy to separately reviewed
  changes after the workflow migration is stable.
