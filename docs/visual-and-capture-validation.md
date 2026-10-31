# Visual and capture validation

Use this guide for deterministic Theme experiments, desktop screenshot walkthroughs, real capture
smoke and soak runs, and built-in Theme review. These workflows are intentionally outside the
day-to-day contributor path because they require a running app, capture hardware, or human visual
judgment.

## Theme Lab

Theme Lab is the disposable Theme-authoring path for comparing Core, Palette, and Advanced override
ideas without saving them to the Theme Library or adding them to the Sharesets Catalogue. Copy
`scripts/theme-lab.example.json`, choose built-in `plvs-dark` or `plvs-light` as the base, and give
each variant only the values that differ from that base. Status, Frequency, Intensity, and Interface
palettes accept the same literal values or preset IDs as the Theme Editor.
The optional `overrides` object maps an Advanced color role ID to a literal color and is applied
through the same editor draft contract.

```powershell
npm run theme:lab -- --manifest path/to/experiments.json
npm run theme:lab -- --manifest path/to/experiments.json --out-dir artifacts/theme-lab/review-1
```

The command reuses the Sharesets Theme preview renderer and one isolated browser runtime to capture
the real Theme Preview overview plus every publication-owned product scene for every variant. It
writes complete validated portable `theme.json` documents, per-scene PNGs, labelled comparison
sheets, and `report.json` beneath a new output directory. The default output is timestamped under
`artifacts/theme-lab/`; an explicit output directory must not already exist. Theme Lab has no
connection to a running PLVS workbench and cannot Save, Import, select, or otherwise mutate the
Theme Library. Treat all output as review material; promoting one result into Sharesets content is
a separate explicit curation step.

Theme product scenes use the same first-run workspace and Panel Settings that PLVS saves as the
PLVS Default Preset, with the generated PLVS Default Loudness Profile active. The preview constructs both
from the production defaults with a deterministic Profile ID; it never reads a maintainer's local
Library. This keeps the Loudness reference, Stats verdict colours, and Level Meter TP Max verdict
visible while making repeated exports reproducible.

Product previews use a committed 60-second Fixture measured by the production file-analysis
pipeline from the stereo arrangement of the "Full Band Crescendo" stems that the homepage images
also use (`scripts/marketing/music-beds.mjs`). Theme Lab reads
that Fixture; it does not decode audio, so adding variants does not make screenshot capture
slower. The selected window is 15–75 seconds, ending at the last frame of the arrangement, as in
the homepage stereo fixture. Screenshots present those deterministic measurements through the
normal Live history direction, and the Snapshot workspace freezes the measured final frame.
Loudness, waveform, and Spectrogram keep every 100 ms measurement, while the analyzer's frequency
bins use a fixed 1-in-4 stride to keep the committed payload bounded. Every retained value is
still a production measurement.

Multichannel preview review uses a sibling 5.1 Fixture over the same window, measured from a real
5.1 mix of the same arranged stems (`BED_51_PLACEMENT` in `scripts/marketing/music-beds.mjs`, the
7.1.4 homepage placement folded to `L, R, C, LFE, Ls, Rs`). The generator mixes that bed from the
stem archive, which is kept outside the repository and checked against the hashes in
`full-band-crescendo.source.json`, and sends the temporary WAV through the same Rust analysis
pipeline. No bed is ever committed. The stem hashes, recipe identity, layout, and analysed
output are sealed in `src/transfer/fixtures/sharesetsPreviewMultichannelV1.json`.

The Fixtures are maintainer-owned input, not part of a Theme manifest. Regenerate them only after
an intentional source-audio or analysis change, then review the resulting product screenshots:

```powershell
npm run ffmpeg:fetch
npm run sharesets:fixture -- --write --archive <audio-archive>
npm run sharesets:fixture -- --archive <audio-archive>
```

The first Fixture command runs the real Rust analyzer and writes every Sharesets Fixture; the
second repeats the analyses and compares the committed JSON values. Source identity, requests,
structure, timestamps, measurements and loudness history must match exactly. Only explicitly
listed visual floating-point arrays accept small absolute differences; JSON formatting and object
key order do not affect the check. `PLVS_AUDIO_ARCHIVE` can
stand in for `--archive`; the archive is described in `docs/marketing-screenshots.md`. Without it
the stereo and 5.1 Fixtures are reported as "source unavailable" and skipped; the dialogue
Fixtures are still checked. The generator verifies every stem and the stereo bed mixed from them
against their pinned SHA-256 and records explicit
Spectrum, Vectorscope, and Stereo Map requests, so replacing the audio or changing those controls
requires a deliberate Fixture regeneration. Never hand-edit a file under `src/transfer/fixtures/`.
The generator derives its analysis requests from the production `DEFAULT_WORKSPACE_STATE`, records
those requests in each Fixture, and stores every result under its real request key. A PLVS Default
Preset change therefore makes the committed Fixtures stale instead of silently substituting data
measured with different controls.

The homepage and Sharesets commands share `scripts/preview-fixture-producer.mjs`, with comparison
policy in `scripts/preview-fixture-compare.mjs`. Its absolute visual limits are:

| Visual values                    | Maximum absolute difference |
| -------------------------------- | --------------------------- |
| Frequency grids                  | 0.000000001 Hz              |
| Final Spectrum curves and peaks  | 0.0001 dB                   |
| Spectrogram history bins         | 0.002 dB                    |
| Waveform spectral centroid       | 0.002 Hz                    |
| Waveform tonality                | 0.0000002                   |
| Stereo Map power and cross-power | 0.000000001                 |

These are narrowly scoped comparison allowances, not product accuracy claims. All other fields,
including unknown visual fields, remain exact. Invalid JSON or non-finite numbers fail. A successful
check reports the count and largest accepted difference per visual category and leaves the
committed file and its provenance hash unchanged. A failure reports up to five field paths,
expected/actual values and numerical limits where applicable. Investigate failures before using
`--write`; it still writes the full generated precision only when explicitly requested.

The comparison and file-write boundary tests run in the normal repository suite. Run them alone
with `npx vitest run scripts/preview-fixture-compare.test.js scripts/preview-fixture-producer.test.js`.

Generate the current Multichannel Monitoring review surfaces before regenerating the public Theme
gallery and Preset preview:

```powershell
npm run sharesets:multichannel-prototype -- artifacts/multichannel-monitoring-review
```

The destination must not already exist. The command renders PLVS Dark and PLVS Light at the Preset
and full Theme-gallery viewports; its output is review material under `artifacts/`, not Catalogue
content. After changing the canonical Preset, sync its publishable pack before preview generation:

```powershell
npm run sharesets:multichannel-preset:sync
```

The public Theme contract publishes four images in order: first-run Workspace, Multichannel
Monitoring, Snapshot, and Theme Colors. All three application scenes are captured at 1280 x 800.

`sharesets:source:check` validates the detachable Catalogue content manifest. The directory argument
is optional while content lives at `sharesets/catalogue`; external Catalogue checkouts pass their
own root without changing website code.

## UI visual walkthroughs

Visual review uses the running dev app's Agent Control navigation and screenshot commands;
it does not use browser selectors, Playwright, or CDP. Stop every PLVS Dev process before
capturing a code state, then cold-start that exact checkout once. Do not edit or switch the checkout
until the run finishes: Vite hot reload can produce a false crash report and invalidates the image
set.

For ordinary product surfaces, start PLVS Dev, obtain the workbench ID with
`npm run desktop:control -- instances --json`, copy
`scripts/ui-walkthrough/product-surfaces.example.json`, and replace its placeholder ID. Then run:

```powershell
npm run ui:walkthrough -- --manifest <manifest.json> --out-dir artifacts/ui-review/before
```

Use `--plan` first when reviewing a new Manifest. It validates the closed scenario language,
checks the selected workbench and capabilities, and prints the semantic targets and declared
durable fields without changing PLVS:

```powershell
npm run ui:walkthrough -- --manifest <manifest.json> --out-dir artifacts/ui-review/before --plan
```

The manifest generates and analyzes a deterministic stereo WAV so the File workspace and metering
Panels contain data. The runner opens only semantic product surfaces, takes real window screenshots,
uses Close or Cancel on the exact surface it opened, removes the temporary analysis session, restores
the original source lifecycle and every declared setting, and writes `run.json` plus `report.json`.
Each scenario restores and verifies its own Settings/View fields before the next scenario starts.
`run.json` is a private write-ahead recovery journal; do not edit it or commit it.
A scenario with a `draft` closes its editor through the discard decision; an optional
`decisionScreenshot` captures that decision before the runner discards the draft.

If the runner is interrupted, inspect the journal without connecting to PLVS, then recover only the
exact instance and resources recorded by that run:

```powershell
npm run ui:walkthrough -- --status artifacts/ui-review/before/run.json
npm run ui:walkthrough -- --recover artifacts/ui-review/before/run.json
```

Recovery restores a field only when its current value still equals the value applied by the run,
and removes UI, fixture, draft, or Transport resources only by their recorded opaque IDs. A field
changed by a person or another process is preserved and reported; there is deliberately no force
mode. A changed Manifest, replacement workbench instance, uncertain draft generation, or missing
resource ID is also preserved for manual reconciliation.

Use a fresh
absolute `--plvs-test-app-data-root` for each compared code state when identical default window
bounds and settings are required.

Some screenshot states cannot be manufactured by the public CLI. Copy
`scripts/ui-walkthrough/development-fixtures.example.json`, insert the running dev app's workbench
instance ID, and run `ui:walkthrough` as above. The runner uses its dev-identity CLI's private event
fixtures to establish Update, first-run Update Preferences, Import Review, Import Complete, Library
Export, Crash Report, Close Confirmation, and Library Conflict through their production owners. The
two Import fixtures use a fixed sample Preset with a bundled Loudness Profile and write nothing to
the library. It then returns to the public `ui inspect`, `visual screenshot`, and exact `ui cancel`
/ `ui close` contracts for review and dismissal. Library Conflict has no product dismissal action,
and cancelling the real Update Preferences choice saves it as skipped, so the runner uses the exact
fixture reset token for both.

These fixture commands are absent from public capabilities, help, completion, schema, and packaged
CLIs. The `status.layout`, `status.summary`, `status.details`, `status.capture-failed`,
`status.update`, `status.update-ready` and `status.update-failed` fixtures preview fixed inputs in
the shared status presentation owner. They neither disconnect capture nor stage real updates.
`status.details` opens the normal status popover or Dock's existing read-only accessory. Use reset
for every status scene; the opaque fixture ID restores the real status inputs and closes its list.

The checked-in `development-fixtures.example.json` includes all seven status states and an
Extra Large status-list case for normal mode. For Dock, copy
`scripts/ui-walkthrough/dock-status.example.json` (nine scenes) or
`scripts/ui-walkthrough/dock-bottom-status.example.json` (four scenes), replace the workbench ID,
and run the same command. Before starting, enter Dock at the top or bottom edge respectively;
these manifests inspect the existing Dock configuration and do not change its edge or layout.
Keep the toolbar collapsed initially to check the status icon and automatic toolbar opening on
capture failure. Review the clean scene for complete Stats rows, aligned columns, and unwanted
scrollbars. The details scenes capture the native `dock-editor` window, and capture failure captures
`dock-header`. Each scenario resets its status inputs and restores declared Interface Size changes.
These are repeatable screenshot reviews; a successful run verifies capture and restoration, while
clipping, alignment, and window placement still require visual review of the images.

These commands remain restricted to development
CLIs. They never invoke Save, Send, Confirm, Update, Restart, Apply, Delete, or mutate arbitrary
React state. If a screenshot or token check fails after establishment, the runner leaves the scene
open for diagnosis instead of silently cleaning it up.

Repeat the same cold-start workflow for the second code state, writing to `after`, then compare the
two complete image sets exactly:

```powershell
npm run ui:compare -- --before artifacts/ui-review/before --after artifacts/ui-review/after --out-dir artifacts/ui-review/diff
```

The comparison fails on a missing image, changed dimensions, or any changed pixel. It writes
magenta difference images plus a machine-readable `report.json`; review those artifacts before
accepting an intentional visual change.

Installable test packages use a third identity rather than either of those two. `npm run desktop:preview-nsis` combines `tauri.preview.conf.json` with `preview-identity`, producing **PLVS Preview** (`com.soundoer.plvs.preview`) with its own settings, installer registration and Agent Control discovery. The Preview feature also compiles out updater registration. `scripts/generate-agent-discovery.mjs` owns both the stable and Preview manifests and NSIS hooks; do not edit those generated files by hand.

Preview builds per platform (matching CI `preview-build.yml`; `npm run preview:dispatch` publishes
all three from the pushed HEAD, or one with `-- windows|macos|linux`):

```bash
npm run desktop:preview-nsis
npm run desktop:verify-preview-nsis
npm run desktop:preview-dmg
npm run desktop:verify-preview-dmg
npm run desktop:preview-deb
```

The macOS Preview DMG is signed and notarized with the same Developer ID secrets as the stable
release (below); `scripts/verify-macos-dmg.sh preview` checks the Preview bundle identifier,
discovery manifest and CLI identity and that no updater payload was produced.

The stable macOS release workflow imports Developer ID credentials into an ephemeral runner
keychain, lets Tauri sign and notarize the app, then separately notarizes and staples the final DMG
before smoke testing it. It requires these repository Actions secrets:

- `APPLE_CERTIFICATE` — base64-encoded Developer ID Application `.p12`;
- `APPLE_CERTIFICATE_PASSWORD` — the `.p12` export password;
- `APPLE_API_PRIVATE_KEY_BASE64` — base64-encoded App Store Connect API `.p8`;
- `APPLE_API_ISSUER` and `APPLE_API_KEY` — the API issuer and key identifiers.

The Tauri updater signing secrets remain separate. Never commit Apple certificate or API private-key
files. A local signed build can use the installed Keychain identity plus Tauri's documented
`APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, and `APPLE_API_KEY_PATH` variables.

Windows stable build (matching CI `release.yml`: NSIS installer + Portable ZIP):

```bash
npm run build
npm run desktop:stable-nsis
```

Raw outputs: the installer under `src-tauri/target/release/bundle/nsis/`, plus
`src-tauri/target/release/plvs.exe` and `plvs-cli.exe`. The tag release workflow packages the latter
two under their original names as `PLVS-v<version>-x64-portable.zip`; like the installer, the
portable build needs WebView2 installed on the machine. `scripts/build-plvs-cli.mjs` is the single
build entry point for CLI debug/release, dev/preview/stable identity and Tauri staging; the Tauri
input files carry the target triple, while the public names in the installation and Portable do not.

macOS stable build (DMG):

```bash
npm run desktop:stable-dmg
```

Rust (inside `src-tauri`):

```bash
cd src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

From the root, `npm run rust:check` runs all three (`npm run check` includes it).

One command from the root checks **frontend + version numbers + Rust format/lint/tests**:

```bash
npm run check
```

The frontend half includes `npm run typecheck`. The source is plain JavaScript checked by
TypeScript (`jsconfig.json`, `checkJs` on, strict mode off), so a type is a JSDoc comment. The
count is kept at zero by fixing what the checker reports: do not add `@ts-nocheck`, a blanket
`@ts-ignore` / `@ts-expect-error`, or a list of known offenders.

Real-machine verification outside `check`, run manually as needed:

```bash
npm run smoke:file-analysis   # File mode analysis smoke test
npm run smoke:capture         # real capture smoke; VLC + VB-Cable (Windows) or BlackHole 2ch (macOS)
npm run soak:capture          # long capture run, 4 hours by default; the only check that finds leaks and metric drift
npm run verify:ui-backpressure # optimized desktop normal/stalled/recovered acceptance
npm run soak:desktop -- --scenario heavy # desktop UI/audio/resource soak; 30 minutes by default
npm run verify:loudness-reference  # loudness meters against FFmpeg ebur128; needs a full FFmpeg (PLVS_REFERENCE_FFMPEG or PATH)
```

The capture rig exists once per machine, so `smoke:capture`, `soak:capture` and the multi-instance
runs take an exclusive lease, `plvs-capture-rig.lock` in one shared directory per machine
(`%ProgramData%\PLVS`, `/Users/Shared/PLVS` or `/var/tmp/plvs`), before starting the test tone.
Every clone and worktree on the machine, including a self-hosted runner's, sees it. While another
run holds it, a run fails with exit 2 and names the holder; add `--wait` to queue instead. A lease
left by a killed run is removed automatically once its process is gone; a holder whose start time
or PID cannot be read counts as alive and is cleared by hand only when it really is dead. On
Windows, a lease file another user created can only be deleted by that user or an administrator.
There is no way to take a live lease
([ADR 0028](adr/0028-parallel-worktree-dev-apps.md),
[ADR 0039](adr/0039-capture-rig-lease-is-machine-wide.md)). The rig routes VLC directly to the
virtual device and never changes the system default output. Install and reboot after the platform
driver setup before running it; PLVS does not install or manage that driver.

The desktop-performance commands use that same leased signal route and the optimized dev identity.
Windows keeps its WebView2/CDP and PowerShell process observations. macOS launches the exact bundled
dev executable with isolated application data, activates that PID, and uses private fixed-shape dev
controls for UI-frame diagnostics and a bounded renderer stall. Close other PLVS Dev processes
first; the macOS runner refuses ambiguous process attribution. WKWebView does not expose the
Windows JavaScript-heap or long-task metrics, and its shared GPU/WebContent processes cannot always
be attributed safely, so unavailable fields remain `null` instead of being reported as zero.

`verify:ui-backpressure` is the short pass/fail check. `soak:desktop` writes periodic JSONL and a
summary under `artifacts/soak/`; its hard verdict is zero UI-frame and audio-chunk drops. Resource
slopes are diagnostic because retained history grows during its configured window. Use
`--seconds 14400` for the four-hour run and keep the Mac awake, foregrounded and otherwise idle.
The soak exits as a rig failure if the renderer becomes hidden or animation frames stop for more
than five seconds, rather than treating background-throttled time as valid visible evidence.

Update, Dock, capture, Agent Control and desktop-performance acceptance results can be indexed in
one local report without rerunning their scenarios:

```bash
npm run acceptance:report -- \
  --target HEAD \
  --evidence artifacts/update-acceptance/<sha>/runs/<run>/result.json \
  --evidence artifacts/macos-dock-reservation/<run>/result.json \
  --evidence artifacts/capture-smoke/<sha>/<run>/result.json \
  --evidence artifacts/agent-control-smoke/<run>/result.json \
  --evidence artifacts/desktop-performance/<sha>/<run>/result.json
```

Evidence selection is explicit; the command never guesses which run is latest. It writes JSON and
Markdown under ignored `artifacts/acceptance-report/`. Missing, stale and incomplete cells are
reported as advisory gaps and do not return a failure exit code. A failure recorded against the
target SHA does. This report organizes evidence; it does not approve a stable release or replace
the domain-specific update verifier.

The capture soak writes one continuous temporary WAV for the run plus 32 seconds of headroom,
then plays it once. A four-hour run needs about 2.77 GB of temporary disk space; synthesis uses
bounded memory and the file is removed on normal teardown. Durations exceeding the PCM RIFF
4 GiB limit are rejected. Do not replace this with looping a short file: VLC's restart can insert
silence and create real intersample peaks, invalidating the constant-signal drift check. The
0.01 dB drift limit and historical warmup windows remain unchanged.

For an unexplained late True Peak jump, use `npm run soak:capture -- --evidence --wait`.
The opt-in capture harness keeps the exact Float32 PCM passed to its summary meter,
with approximately three seconds before and after a new maximum greater than 0.01 dB
above its post-120-second baseline. Up to four clips are saved beside the JSONL in a
fresh `.evidence` directory, as Float32 WAV plus frame offsets and peak metadata.
The PCM ring runs on the existing consumer thread; a separate bounded writer handles
disk I/O. No callback-thread I/O is added. A pending clip is saved with incomplete
post-roll marked on shutdown, and evidence write failures fail the capture command.
The `PLVS_CAPTURE_EVIDENCE_DIR` environment variable is private to harness builds;
the soak wrapper sets it only when `--evidence` is requested. Evidence stays local.
To validate the complete recording path, run
`npm run soak:capture -- --seconds 150 --every 1 --evidence --evidence-self-test --wait`.
This explicitly marked diagnostic inserts a 10 ms interruption at 130 seconds in
the source file. Expect exit 1 and an evidence clip that reproduces the peak on
replay; exit 0 or a missing clip does not validate the recorder. This intentional
failure is not a normal soak baseline. Never pass this flag to a four-hour baseline run.

## Theme design review

Capture a baseline before changing built-in colours or renderer composition:

```bash
npm run theme:gallery:semantic -- --out-dir artifacts/theme-gallery/before-semantic
npm run desktop:dev
# In a second terminal, with a stopped, empty Live workbench containing all eight modules:
npm run theme:gallery:product -- --out-dir artifacts/theme-gallery/before-product
```

Repeat into separate `after-*` directories. Keep the same window bounds, interface size, display
scale, and panel settings. The product runner analyzes a deterministic stereo file, captures both
themes at 100% Surface Opacity, and restores selection, source, axes, and every panel control it
changes. Each theme starts from the same panel controls and axes. The manifest includes classic
Waveform fill and Stereo Map Position/M/S fill examples in addition to the ordinary panel scenes.
The semantic report and the editor share final-role visual checks; warnings are review aids, not
publication gates. Semantic borders retain their compiled alpha.

The report's `focusedMatrix` entries start as `notCaptured`, with no evidence. They are a checklist,
not proof that those conditions were tested. Record screenshot paths and observations separately
for the conditions relevant to the design:

| Surface                  | Conditions                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Theme Preview            | Overview controls, hover, disabled/selected controls, Panels fills, Visual Review links |
| Actual menus and editors | Popover, Settings, Theme Editor, modal surface and text hierarchy                       |
| Workspace                | Narrow/wide panels, Live/Snapshot distinction, mono/stereo/high channel counts          |
| Dock                     | Live source, 56/82/160 CSS px; capture `main` after each acknowledged Dock transition   |
| Native composition       | Supported OS/display scales, Glass and Surface Opacity, hide-chrome/fullscreen          |

Use Agent Control for desktop captures and compare pixel values for changed renderers. The Theme
Preview is illustrative and cannot replace real panel screenshots. Dock cannot enter from File
mode: restore Live first, preserve the existing capture state, and restore the original Dock height
and enabled state when finished. Do not claim a platform or data mode was tested from a different
one's screenshot.

Current default-theme output lives in `builtinThemesV2.test.js` snapshots. Update those snapshots
only after reviewing an intentional design change. Frozen V1 fixtures and migration tests are a
separate compatibility contract and must not be rewritten to match the new defaults. Built-in
themes still author no Advanced overrides; a shared recipe change also affects custom themes
using Auto and needs corresponding compatibility review.
