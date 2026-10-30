# Sharesets preview fixtures from the Full Band Crescendo arrangement — design

Status: approved, 2026-10-30.

## Goal

Move the music fixtures behind every Sharesets Preset and Theme preview off Discovery
(Scott Buckley, CC BY 4.0) and its upmix onto the "Full Band Crescendo" stem arrangement that
the homepage images already use (`docs/history/specs/2026-10-29-homepage-images-renderer-design.md`,
decision 5 and "Music source"). Afterwards the website and the Sharesets catalogue show the same
music, and the 5.1 previews show a real channel-by-channel mix instead of an upmix.

## Decisions

| #   | Decision                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------- |
| 1   | Stereo: the committed arranged bed, same 60 s window as `homepageStereoV1` (15–75 s).                   |
| 2   | Frequency-bin stride stays 4 for Sharesets.                                                             |
| 3   | 5.1: a real bed mixed from the same arranged stems, regenerated from the stem archive, never committed. |
| 4   | Contract, renderer and result versions stay 1; fixture file names stay `…V1`; the fixture `id` changes. |
| 5   | Dialogue fixtures keep their source and are regenerated against today's analyzer.                       |
| 6   | Every affected Item gets a new preview revision; nothing published is replaced.                         |
| 7   | Discovery stays in Git for the real-app capture commands.                                               |

## Fixtures

### Stereo — `sharesetsPreviewStereoV1`

- Source: `assets/marketing/audio/full-band-crescendo/full-band-crescendo-arranged.wav`, verified
  against `full-band-crescendo.source.json` (`arranged.sha256`) by the driver, as
  `npm run homepage:fixture` does.
- Window: end 75 000 ms (`HOMEPAGE_ARRANGEMENT.durationMs`), start 15 000 ms. The same frame and
  history as the homepage stereo fixture.
- Unchanged from today's Sharesets stereo fixture: the default analysis requests
  (`buildDefaultSharesetsPreviewAnalysisRequests`), dialogue analysis off, one Spectrum curve per
  visual row (no `dbB`), stride 4.
- `source`: title "Full Band Crescendo", artist "SounDoer (generated with Suno)", licence "All
  rights reserved by SounDoer", plus a `derivation` naming the bed, its hash and the song hash,
  like the homepage fixture.

### 5.1 — `sharesetsPreviewMultichannelV1`

- Source: a 5.1 bed (`L R C LFE Ls Rs`) mixed by `mixBed` from `readArrangedStems`, so the stems
  enter group by group exactly as in the stereo and 7.1.4 beds; one gain to a −1 dBFS sample peak,
  no limiter (as 7.1.4).
- Placement `BED_51_PLACEMENT`, folded from `BED_714_PLACEMENT` by three rules: front heights fold
  into L/R, backs and rear heights into Ls/Rs; a stem folded from several channels keeps its
  largest gain rather than the sum; a high-passed term is dropped where its channel already
  carries the same stem full-band, since it exists only to give the heights content.
  The promo `make_mc.py` dropped the heights instead; here that would lose Strings and Woodwinds
  completely, and Strings is half of the first group.

  | Channel | Terms                                                                                                       |
  | ------- | ----------------------------------------------------------------------------------------------------------- |
  | L / R   | Drums 1, Keyboard 0.5, Bass 0.4, Brass 0.8, Strings 0.7 (own side)                                          |
  | C       | Bass 0.8, Brass 0.5, Keyboard 0.5 (mono)                                                                    |
  | LFE     | Bass 1, Drums 0.7 (mono, 120 Hz low-pass)                                                                   |
  | Ls / Rs | Guitar 1, Synth 0.7, Strings 0.6, Percussion 1, Other 0.7, Woodwinds 1, Keyboard 0.6 high-passed (own side) |

- Window and analysis requests as the stereo fixture (the 5.1 previews show Spectrum and the other
  full-request panels today, so the request set stays the default one). Loudness layout 5.1.
- The bed is about 65 MB as 24-bit WAV and is not committed. `npm run sharesets:fixture` takes
  `--stems <dir>` or `PLVS_HOMEPAGE_STEMS` (the same archive) and, without it, checks or writes
  the stereo and dialogue fixtures and reports the 5.1 fixture as "source unavailable", as the
  homepage driver does for 7.1.4. `derivation` records every used stem hash, the recipe
  (`plvs-sharesets-arranged-stems-5-1`, version 1), the song start and the peak.
- Risk accepted: after an analyzer change the 5.1 fixture can only be regenerated where the stem
  archive is. The homepage 7.1.4 fixture already has the same dependency.

### Dialogue fixtures

`sharesetsPreviewDialogueStereoV1` and `sharesetsPreviewDialogueMultichannelV1` keep their source
(the dialogue benchmark corpus) and recipe, and are regenerated in this change because they have
drifted against today's analyzer (measured on 214457a4). In the first ~20 history rows, Short-term
reads up to about 15 LU lower than the committed values (warm-up handling), and Momentary up to
6 LU lower; LRA moves from 5.68 to 5.50 LU (stereo) and from 1.27 to 0.94 LU (5.1); the max values
move by less than 0.13 LU. Dialogue Delivery Review therefore gets a preview revision too.

## Width and early fill (added after the first review)

The first review renders showed two weaknesses shared with the homepage images, so both beds
change for both sites:

- Stereo image. Drums (L/R correlation 0.98) and Bass (0.95) are nearly mono and dominate the sum;
  the end of the window read Corr 0.80 against Discovery's 0.15, with a mostly flat Stereo Map.
  Two changes, compared in hero renders: `STEREO_MASTER` gains `sideGain: 1.5`, a mid/side
  widening of the normalised sum before the limiter (`widenStereo`), which brought Corr to 0.59;
  and `STEREO_PAN` pans the narrower stems (Guitar −0.7, Brass −0.4, Percussion +0.7, Woodwinds
  +0.5, Other +0.5, constant power), which brought it to 0.54 and moves some upper bands of the
  Stereo Map off centre. Stereo Map Position shows where each band sits, which widening cannot
  move; above 2 kHz the centred Drums dominate, so it stays close to centre there. A larger side
  gain was rejected: at 1.6 the quiet start of the window already reads Corr −0.08. Measured on
  the homepage stereo fixture: Momentary −11.3, Short-term −10.8, Integrated −12.9 LUFS and True
  Peak −0.71 dBTP, so the hero verdicts still hold. The committed stereo bed and its hash change.
- Blank multichannel start. Only Keyboard and Strings play in the first part of the window, and
  they fed L/R (and the front heights) only, so C, LFE, the sides, the backs and the rear heights
  were blank for the first quarter or half of the Waveform. Keyboard and Strings now also feed C
  (Keyboard 0.5), the sides (Strings 0.6), the backs (Strings 0.5) and the rear heights (high-passed
  Keyboard 0.6) of `BED_714_PLACEMENT`; the 5.1 table follows from the fold rules above, so Ls/Rs
  gain Strings 0.6 and high-passed Keyboard 0.6. LFE stays empty until Bass and Drums enter: the
  two early stems carry almost nothing under 120 Hz (about −54 dBFS RMS), and bringing Bass in
  earlier would change the loudness build of every image.

The homepage stereo and 7.1.4 fixtures and every homepage image are therefore regenerated and
republished in the same change.

## Audio out of Git (added at the owner's request)

No WAV stays in the repository. The arranged stereo bed is no longer committed: both fixture
drivers mix it in memory from the stems and refuse it unless its 24-bit WAV bytes match
`arranged.sha256`, so `build-music-beds.mjs` is removed. `discovery-hero.wav` leaves Git too (it
was pushed before, so its history stays); the capture commands still read it from
`assets/marketing/audio/`, where Git now ignores WAVs, after it is copied from the archive. The
song, the stems and Discovery live in the owner's `PLVS_Audio_Archive` (`full-band-crescendo/`,
`full-band-crescendo/stems/`, `discovery/`, with a README); the fixture drivers take
`--archive <dir>` or `PLVS_AUDIO_ARCHIVE` instead of `--stems` / `PLVS_HOMEPAGE_STEMS`, and
without it check only the dialogue fixtures. The rejected candidates (Brass and Sax Together,
Full Band Crescendo v2) and the stem ZIPs were removed from the archive.

## Producer

`src-tauri/src/sharesets_preview_fixture.rs`: the `stereo` and `5.1` layouts change instead of
gaining new ones, because nothing else may use the Discovery layouts.

- `Stereo` and `Surround51` take their window end from the caller (as the homepage layouts do);
  the Discovery constants (`STEREO_SOURCE_SHA256`, `SURROUND_51_SOURCE_SHA256`, the 18–78 s
  window) and the built-in Discovery `derivation` go. Hash verification moves to the driver for
  these two layouts, as for the homepage.
- Fixture ids become `plvs-sharesets-crescendo-stereo-v1` and `plvs-sharesets-crescendo-5-1-v1`,
  so the JSON names its source; file names, titles, artist and licence follow the homepage ones.
- Frame retention keeps the Sharesets behaviour (everything from 0 ms); the source is only 75 s.

`scripts/sharesets-preview-audio.mjs` (the Discovery upmix) and its test are deleted; the 5.1
mix lives beside the 7.1.4 one in `scripts/marketing/music-beds.mjs`.

## Versions

The plan contract, renderer and preview result are unchanged in shape, and each preview result
already pins its exact `fixtureHash`; published revisions in the catalogue already carry five
different fixture hashes. A version bump would signal a contract change that did not happen, so
`SHARESETS_PREVIEW_CONTRACT_VERSION`, `SHARESETS_PREVIEW_RENDERER_VERSION` and
`SHARESETS_PREVIEW_RESULT_VERSION` stay 1, and the module names keep `V1` (they name the slot, not
the audio). The fixture's own `id` carries the change.

## Frequency-bin stride and bundle size

Measured on `main` (214457a4) with `vite build`: the app `dist` is 12 MB, of which the
`sharesetsPreview` chunk is 9.26 MB (all four Sharesets fixtures, about 11.8 MB of JSON before
minification). `sharesets-preview.html` is an app build input only because
`generate-sharesets-previews.mjs` builds the app's `vite.config.js`; the app never loads the page
at runtime, yet Tauri embeds all of `dist` in the binary.

- Stride 4 keeps the new stereo fixture at about today's 4.3 MB (same request set, same 601 rows);
  stride 1 would be roughly four times that, about 17 MB more in the chunk. Sharesets previews are
  1280-px renders whose Spectrum and Spectrogram already read well at stride 4, and the published
  revisions were rendered at stride 4. Stride stays 4. The actual sizes are measured after
  regeneration and recorded in the plan.
- Moving `sharesets-preview.html` out of the app build (the generator passes its own
  `rollupOptions.input`, as `render-homepage-images.mjs` does for `homepage-preview.html`) takes
  about 9 MB out of every installer, independently of this move. It follows as its own commit
  after this change.

## Consequences

- Every fixture hash changes, so every Preset and Theme preview changes: 8 Presets (Default,
  Multichannel Monitoring, Stereo Field Check, Spectral Inspection, Dynamics Headroom, Essential
  Monitoring, Meter Bridge, Dialogue Delivery Review) and 10 Themes. Loudness Profiles have no
  images.
- Each of those 18 Items gets the next `previewRevisions` entry at new paths through
  `npm run sharesets:curate` (dry run, then `--write` into a review directory), following
  `docs/website-and-sharesets.md`. Older revisions and their PNGs stay byte for byte.
- `node scripts/marketing/prepare-homepage-assets.mjs` then refreshes the seven homepage Sharesets
  tiles in `website/assets/homepage/` from the latest revisions.
- The live site changes only when the Sharesets deployment is dispatched with the content commit.
  Committing is local; pushing, deploying and dispatching wait for the user.

## Documentation

- `docs/visual-and-capture-validation.md` (the Sharesets fixture section) describes the arranged
  stereo bed, the 5.1 stem mix and the stem-archive dependency instead of Discovery and its upmix.
- `docs/marketing-screenshots.md` keeps Discovery for the real-app capture commands.
- The homepage spec's "When Sharesets moves later" line is history and stays as written.

## Verification

- Rust unit tests: the `stereo` and `5.1` layouts require a window end and report the new ids;
  the homepage and dialogue layout tests are unchanged.
- Vitest: `BED_51_PLACEMENT` names every stem `BED_714_PLACEMENT` carries and follows the fold
  rules; the fixture tests read the 15–75 s window, 601 rows and the new source fields.
- `npm run sharesets:fixture -- --write --stems <archive>` regenerates all four fixtures; a second
  run in check mode passes.
- `npm run sharesets:preview` for one Theme, the Default Preset, Meter Bridge (stereo and 5.1)
  Multichannel Monitoring and Dialogue Delivery Review (stereo and 5.1), shown to the user before and after, before the full curation.
- `npm run check:changes` once on the final commit.
