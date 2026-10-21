# Marketing screenshots

The homepage and README share `website/assets/landing-hero.webp`. Keep the hero grounded in the
real Windows desktop app, its current first-run layout and panel controls, and LIVE audio. Never use
FILE mode. Feature-panel screenshots may use a deliberate workspace layout when the composition is
documented in the adjacent provenance JSON; they must not replace or reshape the published hero.

## Files maintained in Git

- `assets/marketing/audio/discovery-hero.wav`: the approved 90-second, stereo 48 kHz PCM24 master.
  WAV preserves the approved samples without a conversion step. Its SHA-256 is pinned in the recipe.
- The adjacent `.source.json` and `ATTRIBUTION.txt`: source URL, source hash, license, excerpt and gain.
  The recording is Scott Buckley's **Discovery**, licensed under CC BY 4.0, separately from PLVS.
- `scripts/marketing/recipes/homepage-hero.json`: audio identity, environment, LIVE device,
  capture times and required Stats warning/failure states.
- `scripts/marketing/capture-live-hero.mjs`: capture and validation.
- `scripts/marketing/select-hero.mjs`: explicit selection, lossless export and optional publication.
- `scripts/marketing/recipes/homepage-dock.json` with `capture-dock-pair.mjs`,
  `export-dock-pair.mjs` and `review-dock-pair.mjs`: the homepage Dock pair.
- `scripts/marketing/recipes/homepage-features.json` with `capture-homepage-features.mjs` and
  `export-homepage-features.mjs`: the History, Frequency and multichannel feature originals.
- `scripts/marketing/workbench.mjs` and `homepage-lib.mjs`: the disposable workbench and the
  tested safeguards shared by the hero, Dock and feature commands.
- `website/assets/raw/landing-hero.png` and `.json`: the published original and its provenance.
- `website/assets/raw/landing-dock.png`, `landing-dock-custom.png` and their `.json`: the default
  and custom LIVE Dock strips captured from the complete main WebView in Dock form, without native
  window chrome or another application's UI.
- `website/assets/raw/homepage-YYYYMMDD/`: originals and provenance for the feature images under
  `website/assets/homepage/`, exported by `scripts/marketing/prepare-homepage-assets.mjs` from the
  directory named in the feature recipe.
- Matching lossless WebP files under `website/assets/`: the website exports. Verify decoded pixels
  against each PNG before publication.

`website/assets/raw/` stays in Git but is not published. `npm run website:check` fails when the
assembled site contains an image that no page, stylesheet or script names; when an image leaves the
website, delete its export and its original together.

Temporary profiles, screenshots, comparisons and reports stay under ignored `artifacts/marketing/`.
The recipe follows the defaults in application code; it does not preserve an obsolete layout.
When defaults or threshold rules change, review the new result rather than restoring old settings.

## Prepare the machine

Install dependencies and build the current dev app with `npm run desktop:dev`. The scripts use
`src-tauri/target/dev-identity/debug/plvs.exe` and its matching CLI. Windows, VB-Cable and VLC are required.
After the dev app build finishes, close that dev app session to free port 1420. The capture
script starts its own frontend server with hot reload disabled and a separate WebView data folder.
Use Windows display scaling **125%** and text scaling **100%**; the default 1280 × 800 logical
window produces a 1600 × 1000 screenshot. The script checks dimensions and the actual window DPI.
Keep the checkout unchanged during capture, including in another release session.

The capture script starts a separate workbench with a fresh app-data directory. It cancels the
first-run Update Preferences dialog, then selects the recipe's dark theme and CABLE Output input
through Agent Control. It validates default layout,
panel controls, axes, starter loudness profile and View settings without rewriting them.
VLC plays the master into CABLE Input. Keep that route free of other playback and leave the
Windows/VLC output volume at unity, with no audio enhancements. The measured threshold checks
catch common routing/volume failures; they cannot prove that no other source was mixed in.

## Capture and review

From the repository root:

```sh
node scripts/marketing/capture-live-hero.mjs
```

The command prints its new run directory. It waits for real signal, fills the 60-second history,
then captures candidates at 62, 66, 70, 74, 78 and 82 seconds. Each image is checked for LIVE,
fresh signal, full history, geometry, default settings and the required Stats colors. Measurements
before and after capture bracket the screenshot's measurement identity. Registered UI surfaces
and blocking editors must be closed. Only processes started by the run are stopped during cleanup.

Read `capture-report.json`, then open `comparison.html` or `contact-sheet.png` in that run directory.
Only candidates marked eligible can be selected. Inspect the full-size images for natural and
varied curves, readable text, hover probes, tooltips and overlays. Compare with the published image.
Existing title ellipses caused by the default layout are not a reason to resize its panels.
UI inspection cannot detect every tooltip or OS overlay, so human visual review remains required.

The fixed audio, defaults and capture windows make composition repeatable. LIVE scheduling means
individual curve pixels and instantaneous values can vary; this is not a pixel-identical snapshot test.
If capture fails, fix the reported prerequisite and start a new run. Do not reuse an old profile,
relax the default-layout checks, lower thresholds, or switch to FILE mode to pass.

## Select, then publish

After visual review, substitute the actual run directory and selected filename:

```sh
node scripts/marketing/select-hero.mjs artifacts/marketing/homepage-hero-TIMESTAMP live-78s.png --reviewed
```

This writes `selected.webp` and `selected.json` inside the run. It verifies image and audio hashes,
candidate eligibility, dimensions and exact decoded pixel equality after lossless WebP export.
The published image is unchanged. To deliberately update the three shared hero files, repeat the
command with `--publish`. Publication refuses if the existing hero changed since capture.
Review that diff and keep the PNG, WebP and provenance together in one commit.

## Rebuild the audio only when needed

Normal captures use the tracked master and need no download. To audit its preparation:

```sh
node scripts/marketing/prepare-live-hero-audio.mjs
```

This downloads the pinned source (or uses its verified cache), decodes it with the bundled FFmpeg,
takes seconds 80–170 and applies linear gain 1.07. There is no compression, EQ or synthetic audio.
It writes only under `artifacts/marketing/audio-rebuild` and requires byte equality with the master.
A decoder or source mismatch is an investigation, not permission to replace the approved audio.
Keep the source metadata and attribution with any deliberately revised master.

## Homepage Dock pair

The homepage shows two Dock strips: `landing-dock.webp` (the current first-run Dock) and
`landing-dock-custom.webp` (a custom layout). `recipes/homepage-dock.json` records how both are
made. Prepare the machine as for the hero; the Dock spans the display it opens on, so the 2560 × 225
output needs a 2560-pixel-wide display at 125% scaling (a 180 px Dock at 120 DPI).

```sh
node scripts/marketing/capture-dock-pair.mjs
```

The command starts a fresh workbench and first cancels the **Update Preferences** dialog that a
fresh profile opens (`ui cancel`); until it is dismissed the dialog blocks Dock operations. It
then selects the dark theme and CABLE Output, starts LIVE capture, enters the Dock at the top edge
without reserving space, plays the master into CABLE Input and waits for 65 seconds of history.

- `dock-default` is captured LIVE at the live edge. The run fails if a Snapshot is active or
  `transport.live.atLiveEdge` is false, before and after the screenshot. Never capture it as a
  Snapshot: a paused strip reads as a still image, not a live meter.
- `dock-custom` is captured after `transport snapshot select --offset-sec 0`, so the custom layout
  shows the same moment of audio. The recipe lists its panels (Peak and RMS meters, downward
  Loudness, a wide Spectrum and the Vectorscope), applied through `dock layout apply`.

Keep the machine otherwise idle during the run. Under heavy CPU load (a parallel `npm test`, for
example) the strip showed only about 45 of its 65 seconds of history, and the workbench can miss
its 45-second start deadline. Each screenshot must be 2560 × 225 from a window at 120 DPI with 100% text scaling. Review
`comparison.html` in the run directory, which places each new strip under the published one.
Add `--wait` to queue for the capture rig when another run holds it.

```sh
node scripts/marketing/export-dock-pair.mjs artifacts/marketing/homepage-dock-TIMESTAMP --reviewed
```

This verifies the run and writes a lossless WebP and metadata for each strip inside the run.
Repeat with `--publish` to replace the PNG originals, WebP exports and metadata, and update the image
dimensions in `website/index.html`; it refuses if a published strip changed since capture. Then,
with `npm run website:dev` running in another terminal (wait until it prints the Website URL;
it answers before the first build finishes):

```sh
node scripts/marketing/review-dock-pair.mjs
```

It loads the homepage at 1440, 820 and 390 px. It checks that both strips decode at 2560 × 225 and the
page has no horizontal overflow, and that the strips scroll sideways at 390 px. Its section
screenshots go to a new `artifacts/marketing/homepage-dock-review-*` directory.

## Homepage feature images

`recipes/homepage-features.json` records the History, Frequency (full range and 20–250 Hz detail)
and multichannel originals under `website/assets/raw/homepage-YYYYMMDD/`. The rules-editor
image and the Sharesets tiles are not part of this capture.

```sh
node scripts/marketing/capture-homepage-features.mjs
```

After the same first-run dismissal, the command sets the large interface size and the 7.1.4
channel roles. It applies the multichannel layout and controls and creates the recipe's delivery
Loudness Profile. Then it analyzes the 7.1.4 bed in FILE mode and captures `multichannel` at an
8-second Snapshot. The command then applies the PLVS Default preset, switches to LIVE CABLE Output with
the master and waits 65 seconds. It captures `history` at a 22-second Snapshot, then
`frequency-full` and `frequency-detail` at 5 seconds. Each image has its own recipe layout, controls
and pixel size.

The 7.1.4 bed is a demonstration mix assembled from promo music stems. It stays out of Git because
its licence is not recorded and it is 42 MB. The recipe pins its SHA-256 and records its origin in
the promo production archive (`PLVS_Promo_v10_Archive_2026-10-09/capture/mixes/future-funk-714.wav`).
By default the command reads it from `artifacts/homepage-proposal/monitor-714.wav`; pass
`--multichannel-audio <file>` to use the archive copy where it is. If the file is missing or its
checksum differs, the command stops before launching the workbench and prints the archive path and
the expected checksum.

Compare each PNG with the published original, then:

```sh
node scripts/marketing/export-homepage-features.mjs artifacts/marketing/homepage-features-TIMESTAMP --reviewed
```

With `--publish`, the originals and their capture JSON replace those in the recipe's raw directory,
and `provenance.json` records the new capture. Run `node scripts/marketing/prepare-homepage-assets.mjs`
to encode `website/assets/homepage/`, then review the homepage. For a capture on a new date,
point `publication.rawDirectory` at a new dated directory and remove the old one with its exports.
