# Community Launch Readiness Implementation Plan

Date: 2026-09-25
Status: In progress

Design: `docs/history/specs/2026-09-25-community-launch-readiness-design.md`

## Phase 1 — Freeze launch contracts

- [x] Add contract tests for launch visibility and fully withdrawn Listings.
- [x] Add a preview-generation result contract: asset ID, dimensions, byte length, hash, renderer
      identity, content hash, and fixture hash.
- [x] Record why Community previews use an isolated browser harness rather than a running desktop
      capture rig or independently drawn marketing cards.

Gate: visibility, withdrawal and renderer ownership fail in tests before implementation changes.

## Phase 2 — Browser preview harness

- [x] Add a preview-only Vite entry that cannot enter the normal desktop boot path.
- [x] Build fixture providers for measurement, history, Loudness Profile, Workspace and Dock state.
- [x] Render the production Loudness Profile editor, Stats panel, Workspace and Dock components.
- [x] Render portable custom Themes across the Theme semantic overview and fixed product scenes.
- [x] Expose explicit font/canvas/render settlement and reject interactive or network state.

Gate: every contract asset can be inspected in a browser from a validated Pack without Tauri,
persistence, audio hardware or external network access.

## Phase 3 — Capture command

- [x] Add the pinned browser dependency and update dependency attribution.
- [x] Implement `community:preview` for one artifact and an explicit output directory.
- [x] Enforce contract viewports, PNG output, exact asset sets and safe output paths.
- [x] Emit a deterministic JSON report and pass generated assets through Catalogue sealing.
- [x] Cover all three families, malformed requests, missing settlement and filesystem refusal.

Gate: one command turns each valid artifact into its complete sealed preview set and never modifies
Catalogue records or deploys anything.

## Phase 4 — Maintainer curation

- [x] Add a dry-run-first curator command for a candidate content tree and published baseline.
- [x] Generate only new Release previews; refuse every old Release mutation.
- [x] Build a review site and concise add/withdraw/change report without deploying.
- [x] Document validation, preview generation, local review, publication, withdrawal and recovery.
- [x] Mark the curated-operations plan complete when its final documentation item lands.

Gate: a maintainer can prepare and review a candidate from commands alone, with no public
submission path and no manual editing of hashes or generated metadata.

## Phase 5 — Catalogue launch behaviour

- [ ] Hide fully withdrawn Listings from all browse and search views while retaining detail pages.
- [ ] Remove download/copy actions when no published Release exists.
- [ ] Gate landing and docs Community navigation on visible assembled content.
- [ ] Test empty, active, partially withdrawn and fully withdrawn Catalogues without JavaScript.

Gate: visitors never reach an empty promoted feature or download withdrawn content, and historical
URLs remain explanatory rather than becoming 404s.

## Phase 6 — First official content

- [ ] Author canonical Pack V2 artifacts for Signal Amber, Stereo Overview and
      `I −23 ±0.5 · TP ≤ −1`.
- [ ] Generate and review every required preview before adding the Listings to the default manifest.
- [ ] Write English Listing copy with `official` classification and PLVS attribution.
- [ ] Confirm the Loudness Profile copy makes no certification, platform or endorsement claim.
- [ ] Validate lineage and build the complete local site from the real default source.

Gate: the default manifest contains exactly one reviewed official Listing per supported family and
no fixture or placeholder content.

## Phase 7 — Qualification and release handoff

- [ ] Run focused renderer, source, lineage, static-site, navigation and withdrawal tests.
- [ ] Run the full frontend test suite and production build.
- [ ] Exercise one local curator dry run from clean content to review site.
- [ ] Reconcile the user guide, landing summary and CHANGELOG for the actual launch behaviour.
- [ ] Hand the completed commit to the normal PLVS official release process; do not publish from
      this implementation plan.

Gate: launch readiness is complete, while version selection and official publication remain a
separate explicit release action.
