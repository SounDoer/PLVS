# Sharesets preview fixtures from the Full Band Crescendo arrangement — plan

Spec: `docs/history/specs/2026-10-30-sharesets-preview-fixtures-design.md`.

Work lands on `main` in the shared checkout; each commit stages only its own paths. Pushing,
deploying and dispatching the Sharesets deployment wait for the user.

## 1. 5.1 placement

- `scripts/marketing/music-beds.mjs`: add `BED_51_CHANNELS` and `BED_51_PLACEMENT` (spec table).
- `scripts/marketing/music-beds.test.js`: every stem in `BED_714_PLACEMENT` appears in the 5.1
  placement; no filtered duplicate of a stem whose unfiltered term is present; a short synthetic
  mix through `mixBed` puts each stem only in its channels.
- Verify: focused Vitest.

## 2. Producer layouts

- `src-tauri/src/sharesets_preview_fixture.rs`: `Stereo`/`Surround51` take the window end from the
  caller, drop the Discovery hashes, window constants and derivation, get the crescendo ids, file
  names, titles, artist and licence. Retention and stride unchanged.
- Update the unit tests (`window_end_is_fixed_for_discovery_…` becomes a required-window test).
- Verify: `npm run rust:test` (focused on the module), `cargo fmt`.

## 3. Driver

- `scripts/generate-sharesets-preview-fixture.mjs`: read and hash-check the arranged bed from
  `full-band-crescendo.source.json`; pass `windowEndMs: HOMEPAGE_ARRANGEMENT.durationMs`; record
  `source.derivation` as the homepage driver does; accept `--stems` / `PLVS_HOMEPAGE_STEMS`, mix
  the 5.1 bed with `readArrangedStems` + `mixBed` into the staging dir, and report "source
  unavailable" for 5.1 without it.
- Delete `scripts/sharesets-preview-audio.mjs` and its test.
- Verify: `npm run sharesets:fixture -- --write --stems "<archive>"`, then check mode passes.
  Record both fixture sizes and the `sharesetsPreview` chunk size from `vite build`.
  Measured: stereo 4.27 MB (was 4.28), 5.1 4.42 MB (was 4.48); `sharesetsPreview` chunk 9.20 MB
  (was 9.26). Readings at the window end match `homepageStereoV1`: Short-term −11.1, Integrated
  −13.2, True Peak −0.70.

## 4. Fixture-dependent tests and docs

- `src/sharesets-preview/fixture.test.js`, `src/transfer/sharesetsPreview.test.js`,
  `src/theme/…` tests that pin Discovery fields or the 18–78 s window.
- `docs/visual-and-capture-validation.md` Sharesets fixture section.
- Verify: `npm test` for the touched files; `scripts/documentationStructure.test.js`.
- Commit: `feat(sharesets): render previews from the Full Band Crescendo arrangement`.

## 5. Review renders (stop for the user)

- `npm run sharesets:preview` before (at the pre-change commit, via a scratch worktree of
  `main`) and after for: `builtin:plvs-dark`, `builtin:preset:<default id>`, the Meter Bridge
  artifact (stereo + 5.1), the Multichannel Monitoring artifact and the Dialogue Delivery Review
  artifact (stereo + 5.1). Outputs go to the scratchpad.
- Show the pairs to the user; continue only on their OK.

## 6. Catalogue revisions and homepage tiles

- Candidate content tree: add the next `previewRevisions` entry (today's date, new paths) for the
  18 affected Items. `npm run sharesets:curate -- <published> <candidate> <review>` dry run, then
  `--write` with a new review directory; inspect `report.md`.
- Copy the generated revision PNGs and records into `sharesets/catalogue/`.
- `node scripts/marketing/prepare-homepage-assets.mjs`; review the seven tiles.
- Verify: `npm run sharesets:source:check`, `npm run website:verify`.
- Commit: `feat(sharesets): publish preview revisions rendered from the new fixtures`.

## 7. Gate and hand-back

- `npm run check:changes` once after the last commit.
- Report commits, sizes, the review directory and what is left for the user: push, then dispatch
  `deploy-sharesets.yml` with the content commit (`docs/website-and-sharesets.md`).
