# Unified Website Development Implementation Plan

**Design:** `docs/history/specs/2026-10-11-unified-website-development-design.md`

## 1. Establish the website source boundary

- [x] Rename `landing/` to `website/` without changing public page output.
- [x] Update source, documentation, tests, screenshot tooling, and workflow references.
- [x] Rename the Release-triggered workflow from `deploy-landing.yml` to
      `deploy-website.yml` and update its caller.
- [x] Keep `sharesets/catalogue/` as the independent content root.

## 2. Add a reusable complete-site builder

- [x] Add a Node builder that copies website source into staging, renders Docs and Sharesets,
      removes source-only files, validates the result, and replaces output after success.
- [x] Make Catalogue input and output explicit for the separate-checkout publication workflow.
- [x] Guard destructive replacement targets and preserve the previous successful output on error.
- [x] Move the default Docs-only generated output out of checked-in website source.

## 3. Add complete-site validation

- [x] Validate local HTML links and assets from the assembled root.
- [x] Reject leaked test files and Docs templates.
- [x] Cover path resolution, missing targets, and safe-output behavior with focused tests.
- [x] Add `website:build` and `website:check` package commands.

## 4. Add the local development entry point

- [x] Add `website:dev` with an initial build, fixed `127.0.0.1:4173` server, and strict-port
      failure.
- [x] Watch presentation, guide, Catalogue, and builder inputs.
- [x] Rebuild in a fresh process, retain the last successful site on failure, and issue a full
      reload after success.
- [x] Print the canonical root and Sharesets URLs.

## 5. Use the builder in publication

- [x] Replace the workflow's hand-assembled copy/render sequence with the complete-site builder.
- [x] Preserve baseline discovery, history validation, publication marker writing, Pages locking,
      and one-artifact deployment.
- [x] Update workflow contract tests for the renamed entry point and builder command.

## 6. Document and verify

- [x] Make `website:dev` the documented ordinary website workflow and explain the three inputs.
- [x] Run formatting and focused website tests while iterating.
- [x] Run `npm test`, frontend formatting/lint/typecheck, and `npm run website:check` before commit.
- [x] Run the full `npm run check` before any push or merge.

## Deferred follow-up

- Migrate homepage, Docs, and Privacy presentation to shared website tokens, navigation, and footer
  one page at a time with visual review. This implementation must not change their appearance.
