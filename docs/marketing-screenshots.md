# Marketing screenshots

The homepage and README share `landing/assets/landing-hero.webp`. Keep the hero grounded in the
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
- `landing/assets/raw/landing-hero.png` and `.json`: the published original and its provenance.
- `landing/assets/raw/landing-channel-*.png` and `landing-channel-group.json`: the LIVE 7.1.4
  Level Meter and Waveform originals, including the deterministic routing from the approved stereo
  master.
- `landing/assets/raw/landing-frequency-*.png` and `landing-frequency-group.json`: the LIVE stereo
  Spectrum, Spectrogram and Stereo Map originals captured at the same elapsed time.
- `landing/assets/raw/landing-stats.png` and `.json`: the LIVE Stats panel with the default profile's
  warning and failure colors recorded in its provenance.
- `landing/assets/raw/landing-history-*-hud*.png` and `landing-history-hud-pair.json`: focused LIVE
  Loudness and Spectrogram originals in wide and narrow layouts, with hover HUDs pinned to the same
  historical moment.
- `landing/assets/raw/landing-workspace-*-compact.png` and `landing-workspace-compact-group.json`:
  three task-focused LIVE workspace layouts with Compact Panels enabled and application chrome
  excluded by the Agent Control workspace target.
- `landing/assets/raw/landing-dock.png` and `.json`: the expanded LIVE Dock strip captured from the
  complete main WebView in Dock form, without native window chrome or another application's UI.
- Matching lossless WebP files under `landing/assets/`: the website exports. Verify decoded pixels
  against each PNG before publication.

Temporary profiles, screenshots, comparisons and reports stay under ignored `artifacts/marketing/`.
The recipe follows the defaults in application code; it does not preserve an obsolete layout.
When defaults or threshold rules change, review the new result rather than restoring old settings.

## Prepare the machine

Install dependencies and build the current development app with `npm run desktop`. The scripts use
`src-tauri/target/dev-identity/debug/plvs.exe` and its matching CLI. Windows, VB-Cable and VLC are required.
After the development build finishes, close that development session to free port 1420. The capture
script starts its own frontend server with hot reload disabled and a separate WebView data folder.
Use Windows display scaling **125%** and text scaling **100%**; the default 1280 × 800 logical
window produces a 1600 × 1000 screenshot. The script checks dimensions and the actual window DPI.
Keep the checkout unchanged during capture, including in another release session.

The capture script starts a separate workbench with a fresh app-data directory. It selects the
recipe's dark theme and CABLE Output input through Agent Control. It validates default layout,
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
