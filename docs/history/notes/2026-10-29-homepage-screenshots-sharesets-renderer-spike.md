# Homepage screenshots from the Sharesets preview renderer — spike

Date: 2026-10-29. Commit under test: `ec69f6cf`. Nothing under `website/` or `sharesets/` changed.

## Question

Can the homepage images now captured from the real app (`scripts/marketing/`, Agent Control on an
isolated dev PLVS with VB-Cable LIVE audio) be produced instead by the Sharesets preview renderer
(headless Playwright Chromium, `src/sharesets-preview/`, committed fixtures under
`src/transfer/fixtures/`)?

## Method

A throwaway harness under `artifacts/sharesets-homepage-spike/` (ignored):

- `spike.html` / `spike.jsx`: the production harness (`SharesetsPreviewApp`, isolation, render
  barrier, theme publication) plus an Interface Size switch through
  `resolveInterfacePreferences`. Served by a Vite dev server, so no production code changed.
- `spike.mjs`: builds real render plans (`buildSharesetsThemePreviewPlan`,
  `buildSharesetsPreviewPlan` over a Pack built from `DEFAULT_PRESET`) and screenshots them in
  Chromium at `deviceScaleFactor: 1.25`. Recipe layouts and controls were translated into
  portable Preset workspaces and Dock panels; the first-run Dock is rebuilt the way
  `firstRunDockState()` in `src/dock/useDockLayout.js` builds it.
- `compare.mjs`: side-by-side and amplified-difference images plus per-region statistics.
- A fresh real-app hero run, `node scripts/marketing/capture-live-hero.mjs`, on this machine
  (125 %, VB-Cable, VLC, idle): `artifacts/marketing/homepage-hero-1793274894662/`.

Images (all under `artifacts/sharesets-homepage-spike/out/`): `hero.png`, `real-live-78s.png`,
`*-side.png` (renderer left, real right), `*-diff.png`, and `zoom-*.png` (renderer above, real
below).

The stereo fixture is Discovery seconds 18–78 (60 s history, 100 ms frames), the measurement frame
is the 78 s moment, frequency bins are kept 1 in 4 (`FREQUENCY_BIN_STRIDE` in
`src-tauri/src/sharesets_preview_fixture.rs`), and dialogue gating is off for Discovery.

## Hero (1600 × 1000)

The existing theme scene `product-workspace-file` (full `AppShell`, `DEFAULT_WORKSPACE_STATE`,
starter Profile, LIVE transport) rendered first time at 1280 × 800 CSS × 1.25 = 1600 × 1000, with
no page errors. Layout, panel set, axes, titles and colours match the real app.

Data. The fixture's 78 s frame agrees with the real 78 s capture on M −12.3, ST −12.6, I −15.3,
M Max −10.3, ST Max −10.9, PSR 11.8, PLR 14.5 and TP Max −0.8. Instantaneous readings differ
(meter bars and hold values, LRA 9.1 vs 9.2, Corr 0.15 vs 0.34, S/M −1.3 vs −3.1) because LIVE
scheduling never lands on the same frame.

Stats verdicts. Both show I warn and TP Max fail; neither shows ST warn at 78 s. The real run
marked 78 s ineligible for exactly that reason; the published hero is the 74 s candidate. A
renderer hero satisfying `requiredStatuses` needs a measurement frame at another moment.

Visible differences against the real app:

| Area                                      | Renderer                | Real app                       | Cause                                          |
| ----------------------------------------- | ----------------------- | ------------------------------ | ---------------------------------------------- |
| Transport clock                           | 00:01:00                | 00:01:18                       | elapsed = fixture duration (60 s)              |
| Dialogue rows (Dlg Cov, DL, Dlg Rng, LDR) | `-`                     | values                         | fixture generated without dialogue gating      |
| Footer source                             | Preview Audio           | Input · VB-Audio Virtual Cable | harness label                                  |
| Spectrum above ~3 kHz                     | straight segments       | dense detail                   | 1-in-4 bins                                    |
| Vectorscope polar fill                    | spiky polygon           | smooth dome                    | single final frame vs accumulated live display |
| Number glyphs                             | greyscale anti-aliasing | some colour fringing           | Chromium headless vs WebView2                  |

Pixel statistics (changed = any channel differs by more than 16):

| Region                                | Renderer vs real 78 s                | Real 78 s vs published 74 s |
| ------------------------------------- | ------------------------------------ | --------------------------- |
| Whole image                           | 6.7 %                                | 9.9 %                       |
| Spectrum and Stereo Map x-axis labels | 0 %                                  | 0 %                         |
| Panel titles                          | 4.2 %                                | 0 %                         |
| Header icons                          | 9.1 % (1 px offset; 5.2 % aligned)   | 0 %                         |
| Stats labels / units                  | 9.8 % / 8.9 % (2 px vertical offset) | 0 %                         |
| Level axis                            | 2.7 %                                | 0 %                         |

Static chrome is identical between two real captures and within 1–2 device pixels between the
renderer and the real app. Glyph shapes and line weights match (`zoom-title.png`,
`zoom-header.png`); title text has the same colour fringing in both. Only some numeric values
render without colour fringing in Chromium. At website display sizes these are below what a
reader can see; the data differences above are the ones that show.

## Dock pair (2560 × 189)

`DockExample` renders both strips at 2048 × 152 CSS × 1.25, cropped to 189 device rows.

- Default strip: matches the published one once the first-run Dock controls are supplied (M/S
  spectrum with decay, polar Vectorscope with max hold, frequency-coloured waveform, −48…−6
  Loudness, all Stats rows). A Preset with the plain Dock defaults renders a visibly different,
  wrong strip, so production would need the first-run Dock state exported or a
  `homepage` Preset that carries it. Same data gaps as the hero (dialogue rows `-`).
- Custom strip: layout, widths, titles and orientations render correctly. The published strip is a
  Snapshot (Snapshot palette and transport icon); `DockExample` has no Snapshot path, so the
  renderer shows LIVE colours.

## Feature images (Interface Size Large)

All four render with the recipe layouts and controls at the published pixel sizes
(1590 × 880, 1590 × 438, 1590 × 795); panel crops use `data-visual-panel-id`. Panel geometry
and typography match the published originals.

- History: the published image is a 22 s Snapshot (Snapshot palette and cursor, the Spectrum at that
  moment). The renderer can only show the final frame in LIVE colours, with decay max shading the
  Snapshot hides. `WorkspaceExample` passes `snapshot` only for the full-shell theme scene.
- Frequency full: same Snapshot gap; spectrum detail above ~3 kHz coarsened by the bin stride.
- Frequency 20–250 Hz: degrades clearly. The fixture keeps 88 of its 241 bins in that range
  (the app draws about four times as many), about 18 device pixels apart across 1590 pixels, so the
  curve becomes visible straight segments, where the published curve is smooth with distinct
  peaks. Not acceptable as a "detail" feature image.
- Multichannel: the derived 5.1 fixture renders cleanly: 6 meters (L R C LFE Ls Rs), Stats
  verdicts from "My Delivery Profile", 6 waveform lanes. Compared with the published 7.1.4 FILE
  image, it loses the 12 channels and the height layer (Ltf Rtf Ltr Rtr), and it is a stereo
  upmix, so surround lanes look alike. It would show "multichannel", not "immersive". Its licence
  is clean (Discovery, CC BY 4.0) and it is already in Git.

## Feasibility and effort

| Image                   | Feasible                  | Missing pieces                                                                                                                                                                 | Rough effort              |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Hero                    | Yes                       | DSF 1.25 in the generator; elapsed and source label; dialogue in the fixture; a measurement frame where ST warns; full-resolution final-frame spectrum (and vectorscope check) | 1–2 days                  |
| Dock default            | Yes                       | first-run Dock state as renderer input                                                                                                                                         | 0.5 day after the hero    |
| Dock custom             | Partly                    | Snapshot rendering in `DockExample`                                                                                                                                            | 1 day                     |
| History, Frequency full | Partly                    | Snapshot rendering at an earlier moment: per-moment spectrum data, not only the final frame                                                                                    | 2–3 days                  |
| Frequency 20–250 Hz     | Not with this fixture     | full-resolution bins for that moment                                                                                                                                           | with the above            |
| Multichannel            | Yes, as a different image | decision: 5.1 upmix instead of a 7.1.4 bed                                                                                                                                     | 0.5 day plus the decision |

Coupling to note: the hero and Sharesets share `SHARESETS_PREVIEW_STEREO_V1`. Moving its measurement
frame, enabling dialogue or removing the bin stride changes the fixture hash and every Sharesets
preview. A separate homepage fixture from the same generator avoids that, at the cost of another
~4–16 MB JSON in Git (the stereo fixture is 4.3 MB at stride 4).

## Recommendation

Migrate in stages, hero first:

1. Hero and default Dock strip: worth migrating. No capture rig, deterministic output, and the only
   visible differences come from fixture content that the generator controls. Give them their own
   homepage fixture (dialogue on, a frame where ST warns, full-resolution final spectrum), so
   Sharesets previews stay byte-stable.
2. Custom Dock, History, Frequency: keep the real-app recipe until the renderer can show a Snapshot at
   an earlier moment with full-resolution spectrum data. That is a renderer and fixture feature,
   not a configuration change.
3. Multichannel: a product decision. A 5.1 image is ready now; a 7.1.4 image needs a licence-clean
   immersive source either way.

The "grounded in the real Windows desktop app" rule in `docs/marketing-screenshots.md` would need
rewording before step 1 ships: the images would come from the app's React components rendered in
Chromium, not from the running app.
