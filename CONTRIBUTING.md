# Contributing

Thanks for your interest in PLVS. This covers local development and CI conventions; product scope and promises are in [`docs/prd.md`](docs/prd.md), and the technical architecture is in [`docs/architecture.md`](docs/architecture.md).

## Environment

- **Node.js**: `.nvmrc` is the single version source, and CI's `setup-node` reads it too; `engines` in `package.json` only declares the lower bound.
- **Rust**: stable (matching `rust-version` in `src-tauri/Cargo.toml`)
- **FFmpeg sidecar**: `npm run ffmpeg:fetch`. `src-tauri/binaries/` is not committed (sidecars ship as Release assets), so every fresh clone and worktree starts empty, and the Rust build fails without it — with an error pointing at an unrelated third-party crate such as a `serde_derive` compile failure, while the real cause is buried in the build script output. The build process is in [`docs/ffmpeg-sidecar-build.md`](docs/ffmpeg-sidecar-build.md).

## Common commands

```bash
npm ci
npm run ffmpeg:fetch     # once per clone/worktree: downloads the gitignored FFmpeg sidecars
npm run theme:generate   # optional: regenerates src/generated/theme-fallbacks.css (also runs via prebuild)
npm run lint
npm run typecheck        # tsc over src/ (checkJs); types live in JSDoc, there is no baseline
npm test
npm run build
npm run website:dev
npm run website:check
npm run sharesets:validate -- path/to/item.plvspreset
npm run sharesets:metadata -- path/to/item.plvspreset
npx playwright install chromium # once per clone/worktree when generating Sharesets previews
npm run sharesets:preview -- path/to/item.plvspreset path/to/new-preview-directory
npm run sharesets:source:check -- path/to/catalogue
npm run sharesets:curate -- path/to/published path/to/candidate path/to/new-review-output
npm run sharesets:curate -- --write path/to/published path/to/candidate path/to/new-review-output
```

`sharesets:validate` is the repository/CI intake boundary for one immutable Sharesets artifact. It
accepts `.plvsloudness`, `.plvspreset`, or `.plvstheme`, requires canonical Pack V2 bytes and one
primary Item, and prints a JSON report containing the exact byte length, SHA-256, versions, and
derived compatibility facts.

`sharesets:metadata` runs the same validation boundary and emits only Pack-derived static Catalogue
input: content identity and summary, dependency hashes, compatibility facets, and the versioned
preview plan. Author, description, tags, licence, and release notes are submission metadata and are
therefore never invented from the artifact.

`sharesets:preview` validates one canonical artifact, builds the isolated browser harness, and uses
the Chromium revision pinned by Playwright to generate the exact contract-owned PNG set plus
`preview-result.json`. The output path is explicit and must not already exist; the command never
edits Catalogue records or deploys content. Run `npx playwright install chromium` once after
installing dependencies on a machine that generates previews.

Loudness Profiles deliberately have an empty PNG set: Catalogue cards and detail pages render their
structured rules directly. Their preview result therefore records the validated empty set without
starting Chromium. Presets and Themes still require every PNG in their preview plan.

### Theme Lab

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
Default Preset, with the generated Default Loudness Profile active. The preview constructs both
from the production defaults with a deterministic Profile ID; it never reads a maintainer's local
Library. This keeps the Loudness reference, Stats verdict colours, and Level Meter TP Max verdict
visible while making repeated exports reproducible.

Product previews use a committed 60-second Fixture measured from
`assets/marketing/audio/discovery-hero.wav` by the production file-analysis pipeline. Theme Lab
reads that Fixture; it does not decode audio, so adding variants does not make screenshot capture
slower. The selected window is 18–78 seconds, ending at the same 78-second frame used by the
website hero recipe. Screenshots present those deterministic measurements through the normal Live
history direction, and the Snapshot workspace freezes the measured final frame. Loudness,
waveform, and Spectrogram keep every 100 ms measurement, while the analyzer's frequency bins use a
fixed 1-in-4 stride to keep the committed payload bounded. Every retained value is still a
production measurement.

Multichannel preview review uses a sibling 5.1 Fixture derived deterministically from the same
attributed stereo source. The generator decodes with PLVS's bundled FFmpeg sidecar, constructs the
standard `L, R, C, LFE, Ls, Rs` PCM channels with the versioned repository recipe, and sends the
temporary WAV through the same Rust analysis pipeline. The derived audio is never committed. Its
source hash, recipe identity, derived hash, layout, and analysed output are sealed in
`src/transfer/fixtures/sharesetsPreviewMultichannelV1.json`.

The Fixture is maintainer-owned input, not part of a Theme manifest. Regenerate it only after an
intentional source-audio or analysis change, then review the resulting product screenshots:

```powershell
npm run ffmpeg:fetch
npm run sharesets:fixture -- --write
npm run sharesets:fixture
```

The first Fixture command runs the real Rust analyzer and writes both versioned JSON files; the
second repeats both analyses and fails if either committed JSON differs. The generator pins the
reference WAV SHA-256, 5.1 derivation hash, and explicit Spectrum, Vectorscope, and Stereo Map
requests, so replacing the audio or changing those controls requires a deliberate Fixture
regeneration. Never hand-edit either file under `src/transfer/fixtures/`. The generator derives its
analysis requests from the production `DEFAULT_WORKSPACE_STATE`, records those requests in each
Fixture, and stores every result under its real request key. A Default Preset change therefore
makes the committed Fixtures stale instead of silently substituting data measured with different
controls.

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

### Website checks and independent publication

After reviewing refreshed Sharesets previews, run `node scripts/marketing/prepare-homepage-assets.mjs`
to refresh the homepage's derived WebP images. The six Preset and Theme tiles resolve the latest
published resource and its latest preview revision from the validated Catalogue; they do not read
fixed `v1` screenshot paths. This is an explicit preparation step, not part of every website build.
The script also exports the dated raw feature screenshots named in
`scripts/marketing/recipes/homepage-features.json`. Refresh those with
`scripts/marketing/capture-homepage-features.mjs` when their UI changes (see
`docs/marketing-screenshots.md`), retain their capture metadata, and review the resulting homepage.
The shared homepage/README hero uses `scripts/marketing/capture-live-hero.mjs` and
`scripts/marketing/select-hero.mjs`; its local `--publish` flag updates tracked image files, not the
deployed website.

Use `npm run check:changes` before committing or pushing. It refreshes `origin/main`, checks all
pending commits plus staged, unstaged and untracked changes, and runs `website:verify` only when
every changed path belongs to the explicit website allowlist. Reverted changes within the pending
range still count. Shared code, dependencies, workflow configuration, unknown paths, empty ranges,
and missing or divergent baselines use the full `npm run check`. After a rebase or further edits,
check again. For an explicit range, use `-- --base <base-sha> --head <head-sha>`; only CI should
normally add `--committed-only`. Do not narrow the base to skip earlier pending commits.

`website:verify` assembles and validates the complete site and runs website, guide, and deployment
contract tests. CSS/layout changes also need browser screenshots at desktop, tablet, and mobile
widths; unit tests cannot verify alignment. CI uses the same classifier for the complete push/PR:
the website job always runs, while website-only changes skip desktop frontend and Rust jobs.
Desktop releases retain the full local preflight and exact-SHA CI gate.

Website publication does not bump the desktop version or create a GitHub Release. After checking
and committing the intended changes:

```powershell
$siteSha = git rev-parse HEAD
npm run website:review -- $siteSha
git push origin main
gh run list --workflow ci.yml --commit $siteSha --event push
# Wait for the matching CI run to finish successfully before dispatching.
gh workflow run deploy-website.yml --ref main -f ref=$siteSha
```

The review command reads `/publication.json`, reports every changed file from the exact live
website SHA, and separately lists guide differences from the latest stable desktop release. Read
the actual diff, including website generator/shared inputs and generated guide output. Text
corrections may ship independently; descriptions of unshipped app features must not silently go
live. Resolve such differences before dispatch, or discuss a narrowly scoped hotfix checkout with
the user (the normal rule requiring approval to move work off `main` still applies).

The deployment workflow resolves the requested ref once, requires successful push CI for that
exact SHA, then passes that SHA to the shared publication workflow. The existing live Sharesets
history validation remains mandatory. Wait for the deployment conclusion, then verify the live
`/publication.json` website SHA and the affected page in a browser. A dispatched run is not a
completed publication. The root marker records `websiteSha` and `contentSha` separately; the
existing `/sharesets/publication.json` continues to own immutable Catalogue history.

On the first deployment of this workflow, the root marker will not yet exist. Recover the exact
website SHA from the previous successful deployment's artifact and resolved checkout, then pass
it explicitly: `npm run website:review -- <candidate-sha> <verified-live-website-sha>`. This bootstrap
is accepted only for a missing (404) root marker, never for a malformed or unreadable marker, and
never overrides an existing one. Do not substitute the Sharesets content SHA or assume the previous
workflow's `headSha` is the deployed website ref. Later missing markers require the same evidence-
based recovery rather than guessing a baseline. Re-run review if another deployment changes the
live website while preparing a publication.

### Curating Sharesets content

The detail-page compatibility line is generated by `scripts/sharesets-app-compatibility.mjs`.
Tracked saved-content features use their first supported stable version, independently of resource
Release numbers. During development an unassigned minimum displays `Requires upcoming PLVS`.
Both the local release-state check and the stable Release workflow reject unassigned, invalid,
or future minimum versions. Register the first supporting release before publishing; later releases
retain that minimum. The published site changes only after its website deployment succeeds.

`sharesets:curate` is the maintainer path from a candidate content tree to a local review. The first
form above is always a dry run: it validates the candidate records and new canonical artifacts,
compares all existing Release records and bytes with the published baseline, and prints a concise
JSON summary of additions, preview revisions, one-way withdrawals, and Listing copy edits. It writes nothing.

The complete local website has one ordinary entry point: `npm run website:dev`. It assembles the
homepage, generated user guide, Privacy Policy, and current Sharesets Catalogue in versioned
directories under ignored `artifacts/website-dev/`, then serves the current successful build at
`http://127.0.0.1:4173/`. The server owns that exact IPv4 port, watches all three inputs, keeps the
last successful site after a build error, and reloads the browser after a successful rebuild. Use
`npm run website:build` for a one-shot assembly under `artifacts/website/` and
`npm run website:check` for assembly plus complete local-link and asset validation. `docs:site` and
`sharesets:site` remain focused generator commands, not standalone complete-site previews.

After reading that summary, repeat the same command with `--write`. This generates previews only for
new Releases and preview revisions, validates the now-complete candidate and its immutable history, then creates a new
review directory containing `site/`, `report.json`, and `report.md`. Preview IDs and paths belong in
the new Release or preview revision record; dimensions, hashes, Pack-derived metadata, and site copies are generated.
The command refuses an existing review directory or existing new preview target, and it
does not commit or deploy. Serve the review directory's `site/` as a static website when browser
review is useful; for example, `npx vite preview --outDir path/to/review/site`.

The baseline must be the exact content commit currently named by the deployed
`/sharesets/publication.json`, not an arbitrary old checkout. Keep both checkouts unchanged while
curating so the byte comparison remains meaningful.

To publish after review, commit the candidate content, wait for the normal merge gate, then dispatch
`.github/workflows/deploy-sharesets.yml` with that exact commit SHA as `content_ref`. The workflow
repeats source and immutable-history validation against the deployed marker before GitHub Pages is
changed.

Both deployment entry points call `publish-site.yml`, which holds the shared Pages lock from live
baseline discovery through deployment, validates the complete immutable history, and writes the
candidate's exact content commit into the same Pages artifact as the website. A desktop release
whose content is older than an independent Sharesets update is rejected: synchronize those content
changes into the release tree, then retry. Never bypass validation by deleting the marker.

An unreadable, malformed, foreign-repository, or missing marker stops publication. Recover a lost
marker from the last successful Pages artifact and its exact content commit before trying again.
Website tags older than v0.20.0, the first Sharesets publication, cannot be deployed through this
workflow.

Before publishing a new Release, confirm its date and regenerate any previews affected by UI changes
made since they were generated. Once published, the date and preview bytes are immutable.

Create a new resource Release only when its downloadable content changes. For screenshot-only
updates, append `previewRevisions` to its existing Release (or `included` source), with an increasing
`number`, a `publishedAt` date, and the complete required `previews` set at new paths. Keep all older
records and PNGs unchanged. These revisions update the gallery without changing downloads or the
displayed Release number. Catalogue tooling and the selected site renderer must support this field;
publish the supporting website code before using it with a content-only deployment.

To withdraw a bad Release, leave its artifact, previews, paths, notes, and date untouched; change
only `status` to `withdrawn` and add `withdrawalReason`, then run the dry run and `--write` review
again. Never delete, restore, renumber, or replace a published Release. Before deployment, recovery
means fixing the candidate and creating a fresh review directory—the live Pages artifact is
unchanged. After deployment, publish a withdrawal or a higher-numbered corrective Release; do not
redeploy an older tree as though the newer history never existed.

Desktop (Tauri):

```bash
npm run desktop:dev
```

`npm run desktop:dev` and `npm run desktop:dev-optimized` both pass `--config src-tauri/tauri.dev.conf.json --features dev-identity`, which changes the app identifier to `com.soundoer.plvs.dev`. The dev app therefore has its own `%APPDATA%\com.soundoer.plvs.dev\plvs-settings.json` and its own webview data, and never overwrites the settings, window position or dock state of an installed stable PLVS. The build script first builds the standalone `src-tauri/plvs-cli` workspace package with the same identity, then stages it as a Tauri external binary; host and CLI must always come as a pair. Dev-identity debug builds go to `src-tauri/target/dev-identity`, apart from the directory `cargo test` writes to, so `npm run check` can run while the dev app is open ([ADR 0024](docs/adr/0024-development-identity-target-directory.md)).

In a linked worktree (for example under `.claude/worktrees/`), `npm run desktop:dev` runs a dev app that can sit beside the main checkout's and other worktrees' ([ADR 0028](docs/adr/0028-parallel-worktree-dev-apps.md)). It picks a Vite port in 1430–1499 instead of 1420 and keeps its app data in the worktree's ignored `.dev-data/`, which starts as a first run; delete the directory to start over. `desktop:control`, `smoke:agent-control`, `ui:walkthrough` and `theme:gallery` run from that worktree reach only that worktree's app. An optimized build from `npm run desktop:dev-optimized` in a worktree is launched by hand with `src-tauri/target/release/plvs --plvs-test-app-data-root <worktree>/.dev-data` to get the same isolation. The main checkout is unchanged.

The three app identities are named `stable` (`com.soundoer.plvs`), `dev` (`com.soundoer.plvs.dev`) and `preview` (`com.soundoer.plvs.preview`). "Release" names only the Cargo profile and the act of publishing a version, never an identity. ADRs written before this naming keep the earlier names:

| Earlier name                                                   | Current name                                              |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run desktop`                                              | `npm run desktop:dev`                                     |
| `desktop:build`                                                | `desktop:dev-optimized`                                   |
| `desktop:release-nsis`, `desktop:release-dmg`                  | `desktop:stable-nsis`, `desktop:stable-dmg`               |
| `desktop:verify-windows-installer`, `desktop:verify-macos-dmg` | `desktop:verify-stable-nsis`, `desktop:verify-stable-dmg` |
| `desktop:verify-windows-preview-installer`                     | `desktop:verify-preview-nsis`                             |
| `--identity development`, `--identity release`                 | `--identity dev`, `--identity stable`                     |
| `DEVELOPMENT_TARGET_DIRECTORY`                                 | `DEV_IDENTITY_TARGET_DIRECTORY`                           |
| Earlier stable/dev identity wording                            | stable identity, dev identity, dev app                    |

#### Identities and build profiles

Two independent choices describe every build. The identity decides which app it is; the Cargo profile decides how it is compiled.

| Identity  | Window title | Identifier                  | Used for                              |
| --------- | ------------ | --------------------------- | ------------------------------------- |
| `stable`  | PLVS         | `com.soundoer.plvs`         | What users install                    |
| `dev`     | PLVS Dev     | `com.soundoer.plvs.dev`     | Local development                     |
| `preview` | PLVS Preview | `com.soundoer.plvs.preview` | Installable test packages; no updater |

Each identity has its own settings, webview data and Agent Control discovery, so all three can be installed side by side.

| Cargo profile | Trade-off                                | Used for                                |
| ------------- | ---------------------------------------- | --------------------------------------- |
| `debug`       | Fast to compile, slow to run             | Daily development and tests             |
| `release`     | Slow to compile, fast to run             | Packages and performance work           |
| `harness`     | `release` plus the capture test commands | `smoke:capture` and `soak:capture` only |

| Command                                             | Identity  | Profile   | Output under `src-tauri/target/` |
| --------------------------------------------------- | --------- | --------- | -------------------------------- |
| `npm run desktop:dev`                               | `dev`     | `debug`   | `dev-identity/debug/`            |
| `npm run desktop:dev-optimized`                     | `dev`     | `release` | `release/`                       |
| `npm run desktop:preview-nsis`                      | `preview` | `release` | `release/`                       |
| `npm run desktop:stable-nsis`, `desktop:stable-dmg` | `stable`  | `release` | `release/`                       |
| `npm run rust:test` (part of `npm run check`)       | `stable`  | `debug`   | `debug/`                         |
| Capture harness build                               | `stable`  | `harness` | `harness/`                       |

`release/plvs` is whichever of the three `release`-profile commands ran last. The dev `debug` build has its own directory because `cargo test` and a running dev app would otherwise fight over `debug/plvs`; see [ADR 0024](docs/adr/0024-development-identity-target-directory.md). `plvs-cli` forwards to the `plvs` beside it, so the two are always built as a pair with the same identity.

`src-tauri/target/` is ignored by Git and can be deleted at any time. Everything in it is rebuilt on demand; the first dev build afterwards takes a few minutes.

To let an agent inspect or adjust the Workspace of the running dev app, open a second terminal:

```bash
npm run desktop:control -- inspect --json
npm run desktop:control -- workspace apply layout.json --json
npm run smoke:agent-control
```

Use `npm run cli:build` to build only the CLI package without starting the GUI. With no arguments it builds the stable-identity debug CLI; `desktop:control` is what builds the dev CLI.

`desktop:control` quietly builds the standalone CLI package incrementally, always with the same `dev-identity`, then forwards the arguments directly to the flat `plvs-cli` commands; the dev app must already be running. It does not depend on Agent Control / PATH in Settings, and it never discovers or changes an installed stable PLVS. The stable CLI uses the same flat commands but talks to the installed app through the stable identity. Windows uses a current-user named pipe; macOS and Linux use a private Unix socket. Linux requires a private `$XDG_RUNTIME_DIR` and verifies peer ownership with `SO_PEERCRED`. Visual Capture screenshots and recording work on all three desktop platforms; Linux supports measured-source audio but advertises only pointer-free recording. `smoke:agent-control` requires the current dev app in a visible normal window with no open surfaces or blocking editors. It verifies capabilities, inspect, Settings navigation, a screenshot and a 3-second silent recording, and writes artifacts plus the selected instance ID to `artifacts/agent-control-smoke/`. A successful run keeps the compatibility `smoke-report.json`; success or a caught product/cleanup failure writes the shared `result.json`. Formal evidence requires a clean worktree so its source SHA identifies the code that ran. Use `npm run smoke:agent-control -- --instance <id>` or `PLVS_INSTANCE_ID` with multiple workbenches. Without either, it discovers and pins the sole instance for the whole run, including cleanup.

`release:preflight` requires this real-desktop smoke whenever frontend, native, shared-contract,
build dependency or smoke tooling paths changed since the last stable release tag. A missing
GUI, ambiguous instance, unsafe initial UI, discovery failure or smoke failure blocks the gate;
there is no skip flag. Restart the dev app from the current source before preflight.
Ordinary hosted CI runs the protocol and orchestration tests; it does not certify native GUI
capture or replace this local desktop gate. Native capture still needs validation on each desktop
platform; Linux validation must use an unlocked real GNOME Wayland session with the window visible.

### UI visual walkthroughs

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
`scripts/ui-walkthrough/development-fixtures.example.json`, insert the running dev app's
workbench instance ID, and run `ui:walkthrough` as above. The runner uses its dev-identity
CLI's private event fixtures to establish Update, Crash Report, Close Confirmation, and Library
Conflict through their production owners. It then returns to the public `ui inspect`,
`visual screenshot`, and exact `ui cancel` / `ui close` contracts for review and dismissal. Library
Conflict has no product dismissal action, so the runner uses the exact fixture reset token.

These fixture commands are absent from public capabilities, help, completion, schema, and packaged
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

Windows Preview build (matching CI `preview-build.yml`):

```bash
npm run desktop:preview-nsis
npm run desktop:verify-preview-nsis
```

The stable macOS release and private upgrade-candidate workflows import Developer ID credentials into
an ephemeral runner keychain, let Tauri sign and notarize the app, then separately notarize and
staple the final DMG before smoke testing it. They require these repository Actions secrets:

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
([ADR 0028](docs/adr/0028-parallel-worktree-dev-apps.md),
[ADR 0034](docs/adr/0034-capture-rig-lease-is-machine-wide.md)). The rig routes VLC directly to the
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

## Release public-content review

Every stable desktop release requires `docs/release-content-review.json`. This is the latest
review record; git retains previous records. Ordinary development CI does not require a fresh
record. Both `release:preflight` and the remote Release validation job enforce it before builds.

1. Fetch full history and tags. Review the complete range from the latest reachable stable
   `vX.Y.Z` tag to the candidate, including implementation changes, not just documentation diffs.
   Reconcile `docs/user/`, README highlights, website copy and screenshots. Inspect the current
   images against the shipping UI and retake affected screenshots when appearance changes.
2. Finish the version bump, CHANGELOG and content changes, run the required pre-commit checks,
   and commit the candidate. Run `npm run release:content:snapshot`. This read-only command prints
   a template with pending decisions; it never approves anything or overwrites an existing review.
3. Save the template as `docs/release-content-review.json`. For each of `userGuide`, `readme`,
   `website` and `screenshots`, set `status` to `updated` or `unchanged`, explain `rationale`, and
   supply a nonempty `evidence` array identifying the paths, comparisons or screenshots inspected.
   An unchanged surface still needs a concrete reason. Do not merely replace a stale fingerprint.
4. Run `npm run release:content:check`, then the required pre-commit checks and commit the record.
   Run the full `npm run release:preflight` before pushing and dispatching the exact final SHA.

The record binds the version, baseline tag and commit, reviewed candidate commit and a fingerprint
of the entire tracked candidate tree, including file modes and asset bytes. Only the review record
itself is excluded to avoid a circular fingerprint when committing it. Any other tracked change
requires renewed review; this deliberately includes implementation changes that can make unchanged
screenshots or prose obsolete. Uncommitted candidate changes, shallow history and missing stable
baselines fail closed. The remote checkout fetches full history and tags.

This gate ensures review decisions are present and current; it cannot prove prose is accurate or
that someone actually inspected an image. It does not replace the privacy review below, real-device
smoke tests, or verification that the subsequent website deployment succeeded.

## Privacy policy review

`website/privacy/index.html` is the policy source. `docs/privacy-review.json` is the latest
review record; git preserves earlier records. Its fingerprint covers normalized text inside
`main` and link destinations, excluding the Effective date (checked separately), comments,
scripts, styles and surrounding navigation/footer. Cosmetic classes, inline emphasis and
formatting whitespace do not require a new review. Keep the date in the marked `time` element;
its displayed text, ISO `datetime`, and the review's `effectiveDate` must agree.

For every desktop release and independent website publication, inspect the complete change range
since the previous corresponding publication for changes to collection, upload triggers and
consent, payloads, recipients/providers, storage, retention and deletion. Check the actual code
and relevant service configuration, not only the policy diff. Record the release-specific outcome
and baseline/candidate SHAs in the release or publication review report, including a no-impact
conclusion when appropriate. A release with no policy change does not need a new JSON record.

When policy wording, links or dates change:

1. Review the diff and the affected implementation or service configuration. Update the policy
   to describe behavior that is actually shipping. Resolve relevant unknowns before publication;
   do not assert that a source checkout proves live configuration or mailbox retention.
2. Set `dateDecision` to `updated` for a material policy/data-handling change and choose the actual
   effective date. Set it to `retained` for a correction or clarification that does not change the
   policy's effective date. Copy the prior record's `effectiveDate` into `previousEffectiveDate`.
   Explain the decision in `dateRationale`; do not use today's build/deployment date automatically.
3. Run `node scripts/privacy-review.mjs snapshot`. After review, copy its `contentSha256` and
   `effectiveDate` into the JSON record. Update `reviewedOn`, `changeSummary`, `scope`, `evidence`
   (source paths, inspected revision/configuration reference and findings), and `limitations`
   (use an explicit statement if none). This read-only command never writes an approval or date.
4. Run `node scripts/privacy-review.mjs check` and `npm run website:verify`. Commit the policy and
   its review record together. For initial adoption only, the existing effective date is also
   the previous date; the initial record documents the source-review scope and its limits.

`website/privacy/index.test.js` runs this gate in both `npm test` and the existing website CI job.
It rejects a stale fingerprint, missing review details, inconsistent dates and invalid date
decisions. It does not judge whether prose is true, a change is material, or the declared previous
date is historically correct. Reviewers must check the git diff and supporting evidence; editing
the fingerprint alone is not review. Unchanged policy text cannot detect a newly added data flow,
which is why the release-level semantic check above remains required. This is an omission guard,
not legal certification or an automatic audit of deployed systems.

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

| Surface                  | Conditions                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Theme Preview            | Overview controls, hover, disabled/selected controls, Modules fills, Visual Review links |
| Actual menus and editors | Popover, Settings, Theme Editor, modal surface and text hierarchy                        |
| Workspace                | Narrow/wide panels, Live/Snapshot distinction, mono/stereo/high channel counts           |
| Dock                     | Live source, 56/82/160 CSS px; capture `main` after each acknowledged Dock transition    |
| Native composition       | Supported OS/display scales, Glass and Surface Opacity, hide-chrome/fullscreen           |

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

## Version numbers

When releasing or bumping the version, change all of these together (and keep them identical):

- `version` in the root `package.json`
- `version` under `[workspace.package]` in `src-tauri/Cargo.toml` (inherited by both `plvs` and `plvs-cli`)
- `version` in `src-tauri/tauri.conf.json`

`npm run version:check` verifies the three match, and CI runs it too. If you change dependencies in `Cargo.toml`, run `cargo check` under `src-tauri` and commit `Cargo.lock` as appropriate.

## Code comments

All **comments and docstrings in source code** (`*.rs`, `*.js`, `*.jsx`, `*.css`, etc.) must be **English** (line/block/JSDoc, Rust `///` / `//!`). **String literals** that must match localized OS or UI text (e.g. Windows device name heuristics) are exempt.

## Git commits and PRs

Use **English only** for commit messages, PR titles/descriptions, and any text that accompanies `git push` (no Chinese in those strings).

**Changelist (CL) descriptions**—the full narrative in a pull request body (or any equivalent review “description” field)—must also be **English** (what changed, why, risks or follow-ups in clear technical prose).

## Packaged update acceptance

Packaged update acceptance builds two real versions from one clean commit under an isolated test
identity. It never uses the stable, dev, or Preview identity, data directory, updater key, or feed.

```bash
npm run update:acceptance:build
npm run update:acceptance:serve -- artifacts/update-acceptance/<short-sha>
npm run update:acceptance:run -- artifacts/update-acceptance/<short-sha>
npm run update:acceptance:verify -- artifacts/update-acceptance/<short-sha>
```

The macOS runner stages the older app in a writable path containing spaces and launches that exact
bundle executable as a background child of the long-lived runner. This keeps the update helper's
process session alive while preventing duplicate copies with the same test identity from
redirecting launch to an older path. It first mounts the older DMG read-only, opens About settings,
captures the visible move-to-Applications guidance, proves that no ready package was staged, quits
the isolated app, and unmounts the image. If the cold WebKit snapshot does not settle, the runner
repeats that complete isolated DMG scenario once; a second failure remains a failed scenario.
Before staging the valid package, the runner serves a
stale signature and a truncated package in turn, waits for a real Update retry and visible error,
records screenshots, and proves that neither rejection left a ready package. It then stops the
loopback feed after the valid signed package is cached and records the offline replacement and
restored Dock. Before the successful replacement, the isolated debug identity pauses its helper
before any files change; the runner terminates that exact helper process, relaunches the old app,
captures the visible interrupted-install error, verifies that the cached package remains ready,
and retries through the normal UI. Release builds and non-acceptance identities ignore this fault
injection. It prints checkpoints for actions that must remain visible in the real product UI.
Do not grant Accessibility, administrator access, or other system permissions merely to make an
acceptance row green; the result must record that boundary explicitly.

On Windows the same runner silently installs the older isolated NSIS package into a path containing
spaces, launches the exact installed executable, verifies the installer PID recorded by the helper,
and uninstalls only that isolated registration after evidence capture. On both platforms,
`update:acceptance:verify` checks package and evidence hashes, the exact source SHA and identity,
all routine scenario verdicts, cleanup, and explicit manual/release-only gaps. A platform claim is
valid only after this runner produces real evidence on that platform; contract tests on another OS
do not substitute for it.

Stable release preflight reports both platforms. It accepts only evidence for the exact release
commit, marks evidence older than 14 days as stale, and says plainly when a platform is missing,
invalid, incomplete, or stale. When updater, installer, signing, packaging or acceptance
dependencies changed since the latest stable tag, missing Windows or macOS evidence stops the
release. Other releases keep the report advisory. `scripts/update-acceptance-code-changed.mjs` owns
that deliberately narrow dependency list; update it when a new path can affect the installed update
chain, rather than broadening the gate to ordinary version or interface-only changes.

The shared acceptance report treats Linux as a base platform alongside Windows and macOS: every
report has a Linux column across update, Dock, capture, Agent Control and performance, and a Linux
cell without real Linux evidence stays visibly `missing`. Producers are connected one domain at a
time, keeping the common envelope and scenario semantics unchanged. Packaged update acceptance and
its release gate remain Windows/macOS until a Linux producer exists, although installed stable Linux
packages can install signed updates. Contract tests on macOS or Windows are not Linux acceptance
evidence.

## Home capture runners

Hosted runners have no sound card, so every stable release also runs `smoke:capture` for the exact
release commit on three self-hosted runners: [`capture-acceptance.yml`](.github/workflows/capture-acceptance.yml),
called by `release.yml` before the draft is assembled. Each runner carries the label `plvs-rig`
plus its platform. The draft waits for all three. A runner that is off or logged out makes the
release wait in the queue and then fail; there is no input that skips a platform.

The repository is public and every runner runs as the maintainer's own account, so a job on one
can do anything that account can on that machine. A fork pull request runs the workflow files it
brings itself, which the workflows on `main` cannot restrict. **The boundary is the repository
setting that requires approval before workflows from any external contributor run**
(`all_external_contributors`). `release:preflight` refuses to continue when it is weaker
(`scripts/check-fork-pr-approval.mjs`). Never approve a pull request's workflow run when the pull
request touches `.github/`.

On `main` itself, self-hosted jobs may only live in workflows triggered by `workflow_dispatch`,
`workflow_call` or `schedule`, and never receive secrets. `scripts/selfHostedWorkflowContract.test.js`
enforces this, including through reusable-workflow calls. It parses the workflows and treats any
`runs-on` other than a single hosted image label as self-hosted. It catches mistakes on `main`; it
is not a defence against a pull request.

Check a runner without a release:

```bash
gh workflow run capture-acceptance.yml -f commit_sha=$(git rev-parse HEAD)
```

Each job verifies its own `result.json` names the commit and platform and is `complete`, then
uploads it as `capture-evidence-<platform>`. The runner workspace is reused and cleaned by later
checkouts; the uploaded artifact is the record.

Setting up a runner (register with a short-lived token from
`gh api -X POST repos/SounDoer/PLVS/actions/runners/registration-token`, kept in memory only;
verify the runner archive against the SHA-256 in its GitHub release before extracting):

| Platform | Account and launch                                                                                                        | Rig                                                           | Traps                                                                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows  | Maintainer's logged-in account. Not a service: a logon launcher in the Startup folder runs `run.cmd` in the user session. | VB-Cable, VLC, Git for Windows                                | The first `bash.exe` on a Windows desktop's PATH is usually WSL's. The launcher must put `C:\Program Files\Git\bin` first on PATH; the runner cannot take a quoted shell path. Started from an agent inside the Claude desktop app, launch it through `explorer.exe` so it leaves the app's container. |
| macOS    | Maintainer's login account, `./run.sh` in a Terminal window that holds microphone permission.                             | BlackHole 2ch, VLC                                            | A LaunchAgent (`./svc.sh install`) captures silence: TCC attributes the request to the runner's Node, which has no audio entitlement. The runner does not return after a logout, reboot or closing that Terminal. The screen may stay locked; capture passes while locked.                             |
| Linux    | Desktop user's `systemd --user` unit running `runsvc.sh`, with `loginctl enable-linger`.                                  | `pactl`/`paplay` on PipeWire or PulseAudio, `/usr/bin/ffmpeg` | Copy `bin/runsvc.sh` to the runner root first, or the unit fails with `203/EXEC`. Put `~/.cargo/bin` on the unit's PATH and order it after the PipeWire user services. A dedicated user cannot reach the desktop user's audio session.                                                                 |

Every clone and runner on one machine shares the rig lease (ADR 0034), so a manual `smoke:capture`
and a runner job queue behind each other instead of summing tones. Each runner keeps its own Rust
target directory, several GB. Before dispatching a release, check that all three runners are
`online` and idle:

```bash
gh api repos/SounDoer/PLVS/actions/runners --jq '.runners[] | "\(.name) \(.status) busy=\(.busy)"'
```

## Bad release response

Use this when a published stable release is broken badly enough that nobody else should install
it. Published Releases are immutable: the tag and assets cannot be replaced, and the version
number is consumed for good. The title, notes, prerelease flag and the **Latest** mark can still
change, and the response works through those.

How users reach a version:

- Installed apps read `https://github.com/SounDoer/PLVS/releases/latest/download/latest.json`
  (`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`). GitHub resolves `releases/latest`
  to the release carrying the Latest mark, so moving the mark changes the manifest every installed
  app sees on its next check.
- PLVS sets no version comparator, so the vendored updater (`src-tauri/vendor/tauri-plugin-updater`)
  offers a release only when its version is greater than the running one. There is no downgrade.
- The homepage resolves its version label and download buttons in the visitor's browser from the
  GitHub API `releases/latest` (`website/index.html`), so it follows the Latest mark without a
  redeploy. The rest of the website (user guide, privacy policy) is static and was deployed from
  the bad tag by `release.yml`'s `deploy-website` job.

Steps, with `<bad>` the broken version and `<previous>` the last good stable version:

1. Stop new installs and updates by moving the Latest mark back:

   ```bash
   gh release edit v<previous> --latest
   gh release view --json tagName --jq .tagName
   curl -sL https://github.com/SounDoer/PLVS/releases/latest/download/latest.json
   ```

   The second command must print `v<previous>` and the manifest must carry `<previous>`. Apps older
   than `<previous>` are now offered `<previous>`; apps on `<previous>` or `<bad>` are offered nothing.

2. Warn in the bad release's notes. Put a short notice at the top of the existing body: what is
   broken, "do not install", and a link to `https://github.com/SounDoer/PLVS/releases/tag/v<previous>`
   for the previous version. Keep the rest of the body.

   ```bash
   gh release view v<bad> --json body --jq .body > notes.md
   # Edit notes.md, then:
   gh release edit v<bad> --notes-file notes.md
   ```

3. Ship a higher fixed version through the normal `plvs-release` flow. Never retag `<bad>`. The
   fixed release's `publish-release` job marks it Latest, and its `deploy-website` job redeploys the
   website from the new tag, which ends the response.

4. Check that the website does not point at `<bad>` while the fix is pending. Open the homepage and
   confirm the version label shows `v<previous>`. Then read
   `git diff v<previous> v<bad> -- docs/user website`: if the live guide or pages describe
   behaviour only `<bad>` has, or send users to it, redeploy the website from the previous tag:

   ```bash
   npm run website:review -- v<previous>
   gh workflow run deploy-website.yml --ref main -f ref=v<previous>
   ```

   The deployment gate accepts a stable tag whose commit passed push CI, and the live Sharesets
   history check still applies. Redeploying an older tag also reverts any independent website
   publication made since `<bad>`; the review output lists those files. Confirm the live
   `/publication.json` `websiteSha` equals `git rev-parse v<previous>^{commit}`.

What this cannot do:

- Users already running `<bad>` stay on it until the fixed version ships; the updater never
  downgrades, and nothing here reaches them. If the defect breaks the update path itself, they must
  download the fixed version manually.
- An app that already downloaded `<bad>` and shows it as ready still installs it: installation uses
  the cached signed manifest, which is still newer than the running version.
- `<bad>`'s assets remain downloadable from its release page; the tag and assets cannot be removed
  or replaced.

## Signing secrets inventory

These are every repository Actions secret that `release.yml` and `upgrade-candidate.yml` read.
`GH_TOKEN` there is the automatic per-run `github.token`, not a stored secret. Never commit or paste
secret values anywhere, including this file; the backup column says where a value is kept, not
what it is.

| Secret                               | Used by                                                                                         | What it signs                                                                                                   | If lost                                                                                                                                                                                                                                                   | Backup location                                 | Expiry / renewal                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | `release.yml` Windows, macOS and Linux builds; `upgrade-candidate.yml` Windows and macOS builds | Updater signatures for every platform's package in `latest.json`, including the Linux version-notice descriptor | **Not recoverable.** Every installed app trusts only the public key embedded at build time (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`). A new key reaches users only through a manual reinstall of a build that carries the new public key. | The maintainer's Bitwarden vault.               | Does not expire.                                                                                    |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Same jobs as the key                                                                            | Unlocks the updater private key                                                                                 | **Not recoverable.** The key is unusable without it, with the same consequence as losing the key.                                                                                                                                                         | The maintainer's Bitwarden vault, with the key. | Does not expire.                                                                                    |
| `APPLE_CERTIFICATE`                  | `build-macos` in both workflows                                                                 | Base64 Developer ID Application `.p12`: code signature of the `.app` and DMG                                    | Recoverable: issue a new Developer ID Application certificate under the same Apple team and export a new `.p12`. The updater does not depend on it.                                                                                                       | The maintainer's NAS.                           | Expires 2031-09-17. Renew in the Apple Developer account before that date, then replace the secret. |
| `APPLE_CERTIFICATE_PASSWORD`         | `build-macos` in both workflows                                                                 | Export password of the `.p12`                                                                                   | Recoverable: re-export the `.p12` with a new password from the keychain that holds its private key, or issue a new certificate.                                                                                                                           | The maintainer's NAS.                           | Follows the certificate.                                                                            |
| `APPLE_API_PRIVATE_KEY_BASE64`       | `build-macos` in both workflows                                                                 | Base64 App Store Connect API `.p8`: authenticates notarization of the app and DMG                               | Recoverable: Apple allows one download only, so revoke the key, generate a new one, and update `APPLE_API_KEY` with it.                                                                                                                                   | The maintainer's NAS.                           | No expiry date; revocable in App Store Connect.                                                     |
| `APPLE_API_KEY`                      | `build-macos` in both workflows                                                                 | Key ID of the App Store Connect API key (identifier, not key material)                                          | Recoverable: shown in App Store Connect next to the key.                                                                                                                                                                                                  | App Store Connect                               | Follows the API key.                                                                                |
| `APPLE_API_ISSUER`                   | `build-macos` in both workflows                                                                 | Issuer ID of the App Store Connect team (identifier, not key material)                                          | Recoverable: shown in App Store Connect.                                                                                                                                                                                                                  | App Store Connect                               | Does not expire.                                                                                    |

## CI

- **Pull requests / pushes to `main`**: see [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (frontend + Rust on Ubuntu; Rust `fmt` / `clippy` / `test` on Windows).
- **Publishing a release**: after the release commit's `ci.yml` push run succeeds, dispatch
  [`.github/workflows/release.yml`](.github/workflows/release.yml) with its version and full commit
  SHA. The workflow builds each platform once, smoke-tests those exact files, assembles a draft
  release, and publishes it only after the complete asset set is verified. Enable immutable
  releases in the repository settings and confirm that dispatch input before starting; tag pushes
  do not start the release workflow.

## Dependency updates

[Dependabot](.github/dependabot.yml) is enabled (npm and cargo, weekly). Run `npm run check` locally before merging.

## Line endings and encoding

The repository uses **LF** (see [`.editorconfig`](.editorconfig) and [`.gitattributes`](.gitattributes)). If Git on Windows still reports CRLF, run `git add --renormalize .` once to normalise.

## Dependency license review

`npm run licenses:check` checks the current lockfiles against reviewed component notices and native
inputs. It runs in CI and in the full repository gate. It is an engineering control, not an automatic
legal opinion. Do not accept a changed license merely to make the check green.

When updating dependencies:

1. Run `node scripts/generate-component-notices.mjs --candidate` and inspect the proposed record.
   This command only prints a candidate; it never accepts a review or changes the committed policy.
2. Review every added/changed component's original license, copyright statements, nested notices,
   and any source-distribution obligations. Preserve `AND` requirements; an `OR` permits a choice.
   The candidate's `noticeSha256: null` means upstream materials are missing, not approved.
3. Record reviewed entries in `licenses/component-sources.json`. For missing upstream files,
   retrieve the exact package's VCS revision (Cargo `.cargo_vcs_info.json` or npm `gitHead`), retain
   the bytes under `licenses/upstream/`, and record URL and SHA-256. Some packages declare their
   license only in metadata or source headers: preserve those verbatim via `localFiles`, explain
   the exception, and include the standard terms. Never invent an upstream copyright statement.
4. Review `licenses/native-components.json` whenever a native binding, model, feature set, sidecar,
   toolchain, or registered input changes. Inspect embedded native code and downloads performed by
   build scripts, not just Cargo/npm license fields. New execution providers need a fresh review.
5. Run `npm run licenses:generate`, then `npm run licenses:check` and the scope-appropriate tests.
   Generation cannot automatically approve new versions or changed license contents.
6. Before publishing, run `npm run licenses:sources`. It downloads the offered corresponding-source
   archives and verifies their hashes; an unavailable or replaced source archive blocks publication.
   Final package checks compare the entire license payload with the reviewed repository bytes.

Development tools used only to build/test are not automatically redistributed with their outputs.
Review generated or embedded code separately: Tailwind CSS is explicitly included in the shipped
notice collection; ONNX Runtime is separately recorded despite being fetched by a build script.
Changing a tool's license, redistributing a development environment, or adding generated runtime
code requires review of that use. Source-code license compliance does not settle codec patents.

Do not infer a model's license from its Rust wrapper. In particular, historical `ten-vad-rs`
metadata says Apache-2.0 while the upstream TEN VAD model adds usage restrictions. It is recorded
in `restrictedPackages`; generation cannot approve its reintroduction. Any future use needs an
explicit review of the actual model terms, not just a refreshed package record.

For historical releases, prepare supplements against each release's exact lockfiles and binary
provenance. Never apply today's dependency list to an old installer, overwrite an existing binary,
or claim unavailable historical provenance has been verified. Additional release attachments must
identify their scope and remaining limitations.

## Experimental Linux capture verification

Use `npm run desktop:linux` to launch the dev app with its dev identity. This
entry point requires system FFmpeg/FFprobe in `/usr/bin` (or an absolute `PLVS_FFMPEG_DIR` override)
and stages only the CLI as a sidecar. It does not produce a redistributable Linux package. In WSL,
keep a separate Linux dependency/build directory; do not share Windows `node_modules` or `target`.
The dev identity enables Agent Control by default. Verify the live Linux transport with
`npm run desktop:control -- capabilities --json` and
`npm run desktop:control -- inspect --json`. The endpoint is a mode-`0600` Unix socket under the
private `$XDG_RUNTIME_DIR`. Linux Visual Capture uses WebKitGTK snapshots for PNG screenshots and
H.264 MP4 recording with optional measured-source AAC audio; keep the real display session
unlocked and the PLVS window visible.

On a Linux development desktop with PulseAudio or `pipewire-pulse`, install `pactl`, `paplay`,
and FFmpeg/FFprobe, then build the current capture harness and run:

```sh
cargo build --manifest-path src-tauri/Cargo.toml --profile harness --bin plvs --features capture-harness,dev-identity
PLVS_FFMPEG_DIR=/usr/bin npm run smoke:capture:linux
```

The Linux smoke creates a temporary null sink, plays the asymmetric stereo fixture into it, and
compares live monitor capture with file analysis using the existing tolerances. It checks sample
rate, channel count, and dropped chunks, removes its sink afterward, and does not change the
default output. Missing tools, unsupported module loading, or stale harness binaries are rig
errors (exit 2); metric disagreement is exit 1. Passing in WSLg verifies the protocol path only;
native Linux desktop, device-switching, multichannel, and long-running soak checks are still needed.

## Experimental Ubuntu Preview package

On Ubuntu 24.04 x86_64, run `npm run desktop:preview-deb`. It builds the optimized application and
CLI with `preview-identity`, packages embedded frontend assets, and writes a `.deb` under
`src-tauri/target/release/bundle/deb/`. It does not publish anything. The Preview updater is disabled;
do not add the capture-harness or dev identity features to the package.

The builder clears the inherited resource map before loading the complete Preview resource map.
Without that reset, recursive config merging maps both the stable and Preview manifests to
`plvs-agent.json`, making the installed identity depend on copy order. Keep the config order intact.

The deb fetches checksum-pinned FFmpeg/FFprobe and installs them below
`/usr/lib/plvs-preview/sidecars`; it never owns, replaces, or depends on Ubuntu's
`/usr/bin/ffmpeg`. Stable packages use `/usr/lib/plvs/sidecars`. See
[ADR 0033](docs/adr/0033-linux-deb-bundles-private-ffmpeg-sidecars.md). Build on the stated baseline;
building on a newer distribution can silently raise the required glibc version.

`scripts/verify-linux-deb.sh <package.deb> <output-directory> <fixture-directory>` installs,
checks, and removes the package. It requires root **inside a disposable Ubuntu 24.04 system** with the marker file
`/etc/plvs-disposable-package-rig`; never run it against a personal desktop. Provision the test
tools `python3`, `xvfb`, `xauth`, `dbus-x11`, `pulseaudio`, and `desktop-file-utils` there first.
The script refuses an existing PLVS installation and any system FFmpeg executable. It checks the
private package-owned sidecars and identity, decodes representative codecs, starts the installed GUI as an unprivileged
user under Xvfb with a private PulseAudio null sink, and checks CLI instance discovery. Its logs,
package inventory, checksum, and JSON diagnostics go to the output directory. Uninstallation must
remove PLVS binaries, desktop integration, and private sidecars while preserving user data.

This package smoke does not validate the GUI file-picker interaction, physical devices, accelerated
rendering, or native Wayland/X11 desktop integration. Run `npm run smoke:file-analysis` against the
fetched sidecars separately and retain the native desktop/soak milestones.

For an automated fresh-system check, install `debootstrap` on the Ubuntu build host and run
`sudo bash scripts/verify-linux-deb-clean.sh <package.deb> <output-directory> <fixture-directory>`.
It bootstraps a
temporary Ubuntu userspace, runs the package verifier in private mount/PID namespaces, preserves
the logs, and removes the temporary root. Pass the fixture directory generated by
`scripts/generate-sidecar-fixtures.mjs` as the third argument. It never installs the package on the
build host.

The manually dispatched `preview-build.yml` accepts `platform=linux` or `platform=windows`
(default). Supply an explicit full commit SHA and unique request ID. It runs the full repository
gate, builds only the selected platform, runs real file-analysis and package tests, and promotes
the exact tested artifacts through a Draft Pre-release. Linux publishes one commit-labelled deb;
Windows publishes its installer and Portable ZIP. Official versions, updater metadata, and website
deployment are separate. Follow `.agents/skills/plvs-preview-build/SKILL.md` for dispatch and verification.
