# Homepage images from the preview renderer — plan

Spec: `docs/history/specs/2026-10-29-homepage-images-renderer-design.md`. Branch:
`feat/homepage-renderer` in `.claude/worktrees/homepage-renderer`. Each task ends in one
Conventional Commit after its focused tests pass; `npm run check:changes` runs once before merge.

## 0. Baseline for Sharesets byte-stability

- Render every built-in Theme (`builtin:<id>`) and `builtin:preset:default` with
  `npm run sharesets:preview` on the branch base into `artifacts/homepage-render-baseline/`, and
  record each PNG's SHA-256.
- Verify: `npm run sharesets:fixture` (check mode) passes.

## 1. Fixture producer parameters (Rust)

- In `src-tauri/src/sharesets_preview_fixture.rs`, replace the Discovery constants with a layout
  parameter set: window end, window length, frequency-bin stride, dialogue analysis, frame
  selection (window end or last active speech), and per-row `dbB`.
- Keep every existing layout's output identical (`Stereo`, `Surround51`, `DialogueStereo`,
  `DialogueSurround51`).
- Add `HomepageStereo` (window end chosen in task 2, 60 s window, stride 1, dialogue on, frame at
  window end) and `Homepage714` (12 labels, 7.1.4 layout, 60 s window, end chosen in task 8,
  stride 1). Input gain is a parameter.
- Rust unit tests for the parameter selection and the frame choice.
- Verify: `npm run rust:test`, `npm run sharesets:fixture` check mode still passes.

## 2. Music source and stereo fixture

- Done with the arranged bed (spec, Music source): `assets/marketing/audio/full-band-crescendo/`
  holds the mastered stereo bed, its source JSON and `ATTRIBUTION.txt`;
  `scripts/marketing/build-music-beds.mjs --stems <dir>` rebuilds the bed byte for byte.
- `npm run homepage:fixture` (`scripts/generate-homepage-fixtures.mjs`, sharing sidecar staging and
  the producer call with the Sharesets driver through `scripts/preview-fixture-producer.mjs`)
  writes `src/transfer/fixtures/homepageStereoV1.{json,js}` with check mode.
- Analysis requests: the default workspace's Spectrum, Vectorscope and Stereo Map keys, which
  cover every stereo scene in the recipe.
- Verify: check mode passes; `homepageFixtures.test.js` reads I warn, ST warn and TP fail against
  the starter Profile on the committed fixture.

## 2b. Multichannel bed

- With `--stems <dir>`, the same driver applies the arrangement to the verified stems, places them
  for 7.1.4 (`BED_714_PLACEMENT`), and writes `homepageMultichannel714V1.{json,js}` from
  meters-only requests. Without the stems it reports the 7.1.4 fixture as source unavailable.
- Verify: `npm run test:marketing` (placement, filters, arrangement, limiter, 24-bit writer);
  per-channel levels, peaks and a waveform overview of the bed checked by eye.

## 3. Fixture values: Snapshot offset and shell inputs

- `src/sharesets-preview/fixture.js`: optional `snapshotOffsetSec`; keyed resolvers and the
  Spectrogram snapshot view read the row at `durationMs − offset` (tolerance as `useSnapshot.js`);
  rows carry `dbListB`.
- Defaults produce today's values object exactly (deep-equal test against the current output for
  every Sharesets fixture).
- Tests in `fixture.test.js`: offset resolution, missing row, offset 0 equals today's Snapshot.
- Verify: `npx vitest run src/sharesets-preview src/transfer`.

## 4. Harness: Snapshot Dock, shell inputs, first-run Dock, Interface Size

- Export the first-run Dock state from `src/dock/` (one definition shared by `useDockLayout.js`
  and the renderer), with its existing tests moved or extended.
- `SharesetsPreviewApp.jsx`: optional props for `snapshotOffsetSec`, elapsed time, Source label,
  and Snapshot in `DockExample`. Sharesets assets never pass them.
- New entry `homepage-preview.html` + `src/homepage-preview/main.jsx` with `render(plan, sceneId)`,
  Interface Size applied before mount. Add the entry to the Vite build inputs.
- Tests: `SharesetsPreviewApp.test.jsx` cases for the new props (jsdom), Dock Snapshot transport.
- Verify: focused Vitest; step 0 baseline re-rendered and byte-identical.

## 5. Recipe, generator and validation

- `scripts/marketing/recipes/homepage-images.json` with the hero, both Dock strips, history,
  frequency full and detail, multichannel and rules editor, translated from today's three recipes.
- `scripts/marketing/render-homepage-images.mjs` plus a tested library (`homepage-render-lib.mjs`):
  recipe validation, offset guard, hero verdict check, crop resolution, report and
  `comparison.html`. `--publish` writes raw PNGs and provenance and runs
  `prepare-homepage-assets.mjs`, refusing on a changed original.
- Tests in `scripts/marketing/*.test.js` (`npm run test:marketing`).
- Verify: `npm run test:marketing`; a render run writes all images at their published sizes.

## 6. Hero and default Dock

- Render, then compare with the published originals and with a fresh real-app capture of the same
  commit (`capture-live-hero.mjs`, `capture-dock-pair.mjs`) using the spike's `compare.mjs`.
- Investigate the Vectorscope fill (single frame vs accumulated display); fix only if the app's
  display path can be fed from fixture history.
- Review with the author before publishing.

## 7. Snapshot images: custom Dock, history, frequency

- Render at the recipe offsets (0 s, 22 s, 5 s). Check the Snapshot cursor position against the
  published images and that the 20–250 Hz detail curve is smooth at stride 1.
- Review with the author.

## 8. Multichannel

- Render the LIVE 7.1.4 scene over the arrangement's window and review with the author.

## 9. Rules editor

- Try mounting the Loudness Profile editor in the homepage entry with a preview Profile API. If it
  needs the app's stores, record it as the remaining real-app image in the spec and stop.

## 10. Publish and documentation

- `render-homepage-images.mjs --publish`, then `npm run website:verify`, responsive screenshots at
  1440, 820 and 390 px, and `review-dock-pair.mjs` against `npm run website:dev`.
- Rewrite `docs/marketing-screenshots.md` for the rendered pipeline; keep the capture commands
  documented as the release cross-check until they are removed.
- `npm run check:changes`; ask before merging to `main`.

## Later, separate

- After one release cross-check: remove the real-app capture commands and recipes.
- Move Sharesets previews to the undecimated fixtures (regenerates every published preview).
