# Homepage images from the preview renderer — design

Date: 2026-10-29. Status: draft for review. Background and measurements:
`docs/history/notes/2026-10-29-homepage-screenshots-sharesets-renderer-spike.md`.

## Goal

Every homepage image that shows PLVS is produced by one deterministic pipeline: the app's own React
panels, fed by committed fixtures that the real Rust meter pipeline measured offline, rendered in
headless Chromium. No capture rig (VB-Cable, VLC, 125 % display, idle machine, 2560-pixel
display) is needed, and the same command reproduces the same pixels on any supported machine.

## Decisions already made

| #   | Decision                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Feature images and the custom Dock strip keep their Snapshot look (Snapshot palette, cursor).                 |
| 2   | The multichannel image changes from FILE to LIVE.                                                             |
| 3   | The hero keeps its required Stats verdicts: Integrated warn, Short-term warn, True Peak fail.                 |
| 4   | The footer Source label is chosen here (see Hero).                                                            |
| 5   | Sharesets previews and their fixtures stay byte-identical; they move later, separately.                       |
| 6   | The real-app capture commands stay until one release cross-checks the rendered images, then they are removed. |
| 7   | Work happens in the `feat/homepage-renderer` worktree; this spec and its plan come first.                     |
| 8   | One music source for every stereo and multichannel fixture: an arrangement of "Full Band Crescendo" stems.    |
| 9   | The dialogue fixtures (LibriSpeech speech) stay; music cannot exercise dialogue detection.                    |

## Scope

In scope, all under `website/assets/` and its `raw/` originals:

| Image                                   | Published size       | Today                                    |
| --------------------------------------- | -------------------- | ---------------------------------------- |
| `landing-hero`                          | 1600 × 1000          | real app, LIVE                           |
| `landing-dock`, `landing-dock-custom`   | 2560 × 189           | real app, LIVE and 0 s Snapshot          |
| `homepage/history`                      | 1590 × 880           | real app, 22 s Snapshot                  |
| `homepage/frequency` (full + 20–250 Hz) | 1590 × 892 composite | real app, 5 s Snapshot                   |
| `homepage/multichannel`                 | 1590 × 795           | real app, 7.1.4 FILE                     |
| `homepage/rules`                        | 560 × 500 crop       | real app 0.20.0, Loudness Profile editor |

Out of scope: the Sharesets tiles (`spectral`, `stereo`, `meter-bridge`, `amber`, `night`,
`graphite`, `paper`). `prepare-homepage-assets.mjs` already takes them from the Sharesets catalogue.

## Output geometry

Published pixel sizes do not change, so `website/index.html` keeps its `width`/`height`
attributes. The renderer uses `deviceScaleFactor: 1.25` and the CSS viewports that produced those
sizes in the app: 1280 × 800 for the hero, 2048 × 151.2 for the Dock (152 CSS rendered, cropped
to 189 rows), and a 1272 × 704 workspace for the feature scenes. Measured display widths
(1440 px homepage) are 667 CSS px for the hero, 1180 for the Dock and 578–740 for the features.
Every image is therefore already shown at 2.2–2.75 device pixels per CSS pixel, and a higher scale
would add bytes without visible gain.

Feature scenes keep Interface Size Large. They are shown at about 1/2.75 of their pixel width, and
Large keeps axis labels and titles readable at that reduction. The hero and Dock keep Default.

## Music source

Today the stereo images use Discovery (Scott Buckley, CC BY 4.0), the Sharesets 5.1 fixture is an
upmix of it, and the multichannel image uses a 24-second 7.1.4 cut of a promo bed. They are
replaced by one source: an arrangement of the stems of **"Full Band Crescendo"**, an instrumental
nu-disco track the author generated with Suno for these fixtures. The song and its stems are kept
by the author outside the repository (`PLVS_Music_Fixture/`) and identified by hash.

How it got here. A first track, "Brass and Sax Together", was measured and used, but its master
moves only about 6 LU; every 60 s window that ended at the hero verdicts gave a nearly flat
Loudness curve and solid Waveform and Spectrogram, which the author rejected beside the Discovery
images. A second generation asking for a crescendo moved about 10 LU at best and still had no
gradual rise. Suno masters every generation dense, so the build is made from the stems instead.

What the material is (measured, Full Band Crescendo v1):

- Song: stereo, 48 kHz, 16-bit WAV, 252.5 s, about 113 BPM, LRA about 6.7 LU, content to 20 kHz.
- Twelve stems from Suno's split (WAV, "Follow tempo changes"), each the song's 12,120,960 frames
  from offset 0. Lead Vocals and Backing Vocals are separation residue of an instrumental and are
  not used; ten stems carry the music: Drums, Bass, Guitar, Keyboard, Percussion, Strings, Synth,
  Other, Brass, Woodwinds. Drums, Percussion and Other reach 20 kHz.
- **The stems do not sum to the song** (as with the first track): below 250 Hz they agree, above
  1 kHz coherence falls to 0.2–0.5 and the best-gain residual is about −7.5 dB. Suno regenerates
  each part rather than splitting the mix, so the stems are a re-performance, not a decomposition.
  Nothing here compares a stem mix with the song.

The arrangement (`HOMEPAGE_ARRANGEMENT` in `scripts/marketing/music-beds.mjs`): song time
113–188 s, 75 s, of which the first 15 s are pre-roll and the last 60 s are the fixture window.
Instruments enter in groups, each over a 2 s linear fade: keyboard and strings from the start,
synth, percussion and guitar at 30 s, bass and drums at 45 s, brass, woodwinds and Other at 60 s.
The second group lands in the song's own breakdown. Across the window Short-term rises from about
−27 to −10 LUFS.

Layouts, both from the same arranged stems, so the stereo and 7.1.4 images show the same music:

- Stereo: every stem on its own side at unity, scaled to a −1 dBFS sample peak, then mastered with
  a deterministic linked lookahead peak limiter (+3 dB make-up, −1 dBFS ceiling, 5 ms lookahead,
  80 ms release). The stem sum's drum transients sit far above its body; without the limiter,
  Short-term could only reach the hero's warning by taking True Peak past 0 dBTP.
- 7.1.4: the ten stems placed per channel after the promo film's `capture/make_mc.py` (drums and
  keys front, bass in C and low-passed LFE, guitar and synth on the sides, percussion, Other and
  some synth on the backs, brass, strings, woodwinds and high-passed keys and percussion in the
  heights), one gain to a −1 dBFS sample peak, no limiter. In the window the channels visibly
  enter group by group.

What is committed, under `assets/marketing/audio/full-band-crescendo/`:

- `full-band-crescendo-arranged.wav`, the mastered stereo bed (24-bit, 75 s, 21.6 MB), with
  `full-band-crescendo.source.json` (SHA-256 of the song, every stem and the bed, and the
  arrangement) and `ATTRIBUTION.txt` (generated by SounDoer with Suno on a paid subscription,
  owned by SounDoer). The stereo fixture is reproducible from Git alone.
- `scripts/marketing/build-music-beds.mjs` rebuilds the stereo bed from the stems; its check mode
  compares byte for byte. The stems (about 485 MB as WAV) are not committed; their pinned hashes
  are checked on read. Regenerating the 7.1.4 fixture needs the stem archive; without it the
  fixture driver reports "source unavailable" for 7.1.4.

Discovery and its master stay in Git until the real-app capture commands and the Sharesets
fixtures no longer use them.

## Fixtures

New committed fixtures, generated by the existing Rust producer
(`src-tauri/src/sharesets_preview_fixture.rs`) through a new layout parameter set. The existing
Sharesets fixtures and their hashes stay unchanged until Sharesets moves (decision 5).

`homepageStereoV1` (the arranged stereo bed: hero, Dock and feature images):

- Window end at the end of the bed (75 s, the full band), where the starter Profile reads
  Short-term −11.1 warn, Integrated −13.2 warn and True Peak −0.70 fail; the history covers the
  build before it. Every stereo scene renders from this one frame and window.
- Dialogue analysis is on, as in the app's LIVE default, so the Stats dialogue rows show real
  values instead of `-` (the detector reads about 9 % coverage in this music; it is shown as
  measured). Today `dialogue_gating()` also selects the frame with
  active speech; the two concerns are split so the frame stays at the window end.
- Frequency bins are not decimated (stride 1).
- Every visual row keeps both Spectrum curves (`db` and `dbB`) for each requested key, so a
  Snapshot in M/S view resolves both curves at any moment of the window.
- Analysis requests cover every Spectrum key the scenes use (combined and M/S, speed 25 %, no
  octave smoothing). A scene whose key the fixture lacks fails generation instead of rendering an
  empty panel.

`homepageMultichannel714V1` (7.1.4 bed: the multichannel image):

- Channel labels L R C LFE Lb Rb Ls Rs Ltf Rtf Ltr Rtr; loudness layout 7.1.4.
- The same 60 s window of the same arrangement.
- Meters-only analysis requests (spectral waveform, no Spectrum, Vectorscope or Stereo Map): the
  scene shows Level Meter, Stats and Waveform, and the producer accepts a request set without a
  frequency grid.

Measured size: about 24 MB for the stereo fixture without decimation and under 1 MB for 7.1.4.

When Sharesets moves later, a 5.1 bed from the same arrangement replaces the Discovery upmix,
and the stereo Sharesets fixture moves to the arranged stereo bed.

## Renderer

The Sharesets harness is reused, not forked. `src/sharesets-preview/SharesetsPreviewApp.jsx` and
`fixture.js` gain optional inputs whose defaults reproduce today's output exactly:

- `snapshotOffsetSec` (default none). It sets `historyData.selectedOffset`, so each panel draws its
  own Snapshot cursor through `usePanelHistoryData`. The keyed resolvers (`resolveSpectrumSnapshotForKey`
  and the Spectrogram snapshot view) read the visual row at `durationMs − offset`, following
  `useSnapshot.js`. At offset 0 they behave as today's theme Snapshot scene.
- Scalar readings (level meters, Stats, Vectorscope, Stereo Map) exist only for the final frame.
  The generator refuses a scene with a non-zero offset that contains one of those panels.
- Snapshot in `DockExample` (the custom Dock), passing the Snapshot transport state and `snapshot`
  through `FixedProviders`, as `FullWorkspaceExample` already does.
- Shell inputs for the hero: elapsed time (the window end in the track), the footer Source label
  and the device list label.
- Interface Size, applied with `resolveInterfacePreferences` before mount.
- The first-run Dock state: `firstRunDockState()` moved to `src/dock/firstRunDock.js`, free of
  persistence and React, so the app and the Node generator share one definition.

A new entry, `homepage-preview.html` with `src/homepage-preview/main.jsx`, exposes
`render({ plan, assetId, scene, interfaceSize })` beside the Sharesets entry. It reuses isolation,
theme publication and the render barrier. It is not one of the app's Vite build inputs: the
generator builds it alone and passes each plan, fixture included, from Node, so the app bundle
never carries the homepage fixtures. The Sharesets entry and contract (`sharesetsContract.js`,
preview result versions) are untouched.

Footer Source label: `Output · Speakers`. It reads like a system-output capture, the most common
LIVE setup, without naming hardware.

## Generator and recipe

`scripts/marketing/recipes/homepage-images.json` replaces the three capture recipes for rendering.
Each image entry names its scene (`workspace-shell`, `workspace`, `dock`, `rules-editor`), fixture,
portable Preset or Dock panels, panel controls and axes, Loudness Profile, Interface Size,
`snapshotOffsetSec`, crop (`viewport`, `panel` by `data-visual-panel-id`, or fixed rows) and
output size.

`scripts/marketing/render-homepage-images.mjs`:

1. Validates the recipe (sizes, offset rule, known fixture keys), and for the hero computes the
   Stats verdicts from the fixture frame and the starter Profile, refusing unless they match the
   required ones.
2. Builds plans with the existing Pack and Preset compilers, renders every image in one Chromium
   context (`deviceScaleFactor` 1.25, dark, en-US, reduced motion, network blocked), and writes the
   PNGs, a `comparison.html` against the published originals, and a report into a new
   `artifacts/marketing/homepage-render-*` directory.
3. With `--publish`, it replaces the raw PNGs and provenance JSON and runs
   `prepare-homepage-assets.mjs` (hero and Dock WebP export included), refusing if a published
   original changed since the render.

Provenance JSON records the commit, recipe hash, fixture hash, renderer entry and Chromium version
instead of the capture measurements.

## Rules editor

The Loudness Profile editor with "My Delivery Profile" is rendered through the same entry,
mounting the editor with a preview Loudness Profile API (as `previewLibrary` does) and cropping to
the editor. This needs a check that the editor renders without the app's settings stores. If it
does not, the image stays a real-app capture and is listed as the only exception.

## Accepted differences from the app

- Chromium headless anti-aliases some numerals in greyscale where WebView2 shows colour fringes,
  and static chrome sits within 1–2 device pixels of the app. Neither is visible at display size.
- Readings are those of the fixture frame, not a LIVE sample. That makes the images reproducible;
  composition no longer depends on scheduling.
- The hero Vectorscope fill is a single analysis frame; the app's accumulated display is smoother.
  The plan includes checking whether the fixture history can feed the same display path; if not, it
  is accepted.

## Verification

- Sharesets: preview generation for every built-in Theme and the default Preset produces
  byte-identical PNGs before and after the change, and the Sharesets fixtures keep their hashes.
- Unit tests for the fixture offset resolution, the offset guard, the recipe validator and the
  hero verdict check.
- One cross-check: the same commit captured with the old real-app commands and rendered with the new
  generator, compared side by side (`compare.mjs` statistics in the provenance review).
- Website: `npm run website:verify`, responsive screenshots of the homepage at 1440, 820 and
  390 px, and `review-dock-pair.mjs`.
- `npm run check:changes` before merging.

## Documentation

`docs/marketing-screenshots.md` is rewritten for the rendered pipeline: what the images are (app
panels with measured data, not screenshots of the running app), the recipe, fixtures, the render
and publish commands, and how to review. The rule that the hero must come from the real Windows app
is replaced. Removal of the capture commands is a later, separate change after the release
cross-check.

## Open items

1. Every homepage image changes content, because the music changes; the review compares
   composition and readability, not curves, with the published Discovery images.
2. The first track's 29 MB FLAC is in this branch's history (committed, then replaced). Before
   merging, the author decides whether to squash the branch so it never reaches `main`.

Settled after review: `ATTRIBUTION.txt` names the track as generated by SounDoer with Suno on a
paid subscription, owned by SounDoer. The stem archive stays in the author's
`Desktop/PLVS_Music_Fixture/` for now and later moves to the author's NAS; `.source.json` records
it by hash, not by path. The 7.1.4 bed gets no listening check; it is accepted on measured
per-channel levels, peaks and waveform shape.
