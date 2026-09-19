# PLVS Release Readiness Audit

**Date:** 2026-09-19  
**Repository baseline:** `main` at `01272360`, after public release `v0.16.0`  
**Scope:** Product readiness, documentation, frontend quality, native/Tauri risks, security,
dependencies, packaging, updates, testing, and release operations  
**Method:** Read-only repository review, public website and release inspection, local frontend test
and coverage runs, npm dependency audit, and review of recent GitHub Actions results

## Executive summary

PLVS already has a strong engineering foundation for a mature public beta. Its automated tests,
frontend/Rust boundaries, release workflow, installer smoke tests, signed updater artifacts,
crash-reporting design, documentation structure, and performance tooling are unusually complete for
a project at this stage.

The remaining work is not primarily another feature cycle. A formal launch should instead focus on
distribution trust, real-machine capture validation, privacy and licence delivery, update recovery,
and durable persistence.

No code-level P0 defect or known JavaScript production-dependency vulnerability was found. This
audit nevertheless identifies six launch-readiness gates that should be closed before promoting
PLVS as a stable product to a broad audience.

## Evidence snapshot

- `npm test`: **363 test files and 4,295 tests passed**.
- Frontend coverage:
  - Statements: **85.74%** (`19,316 / 22,527`)
  - Branches: **80.21%** (`13,856 / 17,274`)
  - Functions: **85.33%** (`3,981 / 4,665`)
  - Lines: **88.18%** (`17,593 / 19,950`)
- `npm audit --omit=dev`: **0 known production JavaScript vulnerabilities**.
- Full `npm audit`: 12 findings in development/build tooling only: 4 high, 6 moderate, and 2 low.
- The coverage command failed once because a Vitest temporary coverage file disappeared, then
  succeeded on an immediate rerun. This is a tooling-stability signal, not a failed product test.
- Recent `main` CI runs were generally green; `v0.16.0` release and release-candidate workflows
  completed successfully.
- GitHub Issues are enabled, but `main` has no branch protection and the repository has no issue
  templates or `SECURITY.md`.

## Existing strengths

### Release engineering

- `.github/workflows/release.yml` gates tag builds through frontend and Rust verification, builds
  Windows NSIS and Portable packages plus a macOS DMG, runs installer/package smoke checks, publishes
  signed updater metadata, and dispatches the website deployment.
- `npm run release:preflight` combines release-state validation, the full repository gate, and a
  conditional real capture smoke when capture-related code changed.
- The release skill requires exact-SHA CI and untagged cross-platform release-candidate builds
  before a tag is created.
- Version consistency is enforced across `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json`.

### Architecture and security

- Audio callbacks hand data to bounded queues and dedicated workers; repository tests guard the
  callback-reachable path against locks and allocation.
- Agent Control is off by default in release builds and uses current-user OS permissions,
  per-launch authentication tokens, constant-time token comparison, request limits, and private
  local transports.
- Tauri capabilities are window-scoped, opener URLs are allowlisted, and the application has a
  restrictive production CSP.
- Crash reports are local-first, bounded, atomically written, home-path redacted, previewed before
  sending, and uploaded only after explicit user action.
- Updater artifacts are cryptographically signed even though the application binaries are not yet
  OS-signed.

### Documentation and product boundaries

- `docs/user/` is a real user guide rather than a developer README substitute.
- Architecture, PRD, ADRs, pitfalls, release history, and generated Agent Control documentation have
  clear ownership rules.
- The product is honest about unsupported platforms, unsigned installation, monitoring-only
  behaviour, non-certified measurements, and privacy defaults.
- User-visible documentation is checked against code-owned facts by automated tests.

## Launch-readiness gates

These are product-launch gates, not claims that the current public builds must be removed.

### G1. Establish trusted OS distribution

**Evidence**

- `README.md` and `docs/user/getting-started.md` state that Windows builds are not code-signed and
  macOS builds are not notarized.
- The release workflow signs Tauri updater payloads but has no Authenticode, Apple Developer ID, or
  notarization step.

**Why it matters**

Updater signing protects update integrity, but it does not establish publisher identity to
SmartScreen or Gatekeeper. Requiring users to bypass warnings is acceptable for an early public
beta, but it materially reduces trust and conversion in a formal launch.

**Recommended completion criteria**

- Sign Windows executables and the installer with Authenticode.
- Sign the macOS application with Developer ID, enable the required hardened runtime settings, and
  notarize/staple the DMG or application.
- Verify fresh installation, update, and uninstall on clean machines after signing.

### G2. Close the real capture validation gap

**Evidence**

- The capture layer cannot be exercised by ordinary CI because hosted runners have no suitable
  audio rig.
- `scripts/smoke-capture.mjs` and `scripts/soak-capture.mjs` are Windows-oriented and use VB-Cable,
  VLC, and PowerShell process metrics.
- The macOS Core Audio Tap path has no equivalent automated real-machine gate.
- The GitHub Release workflow runs file-analysis and installer smoke checks, but not
  `smoke:capture`; real capture validation depends on the local preflight discipline.

**Why it matters**

A capture or DSP regression can ship with green hosted CI. The application may launch correctly
while producing silence, dropped frames, or incorrect measurements.

**Recommended completion criteria**

- Run and retain the conditional Windows capture smoke before every affected release.
- Run a four-hour soak after capture, DSP, or engine changes and compare drift against historical
  artifact spread, not only the absolute limit.
- Create a manual macOS acceptance matrix for system output, physical input, application capture,
  default-output switching, application restart, sleep/wake, and long-running capture.
- Require evidence of the relevant real-machine run before an affected release tag, or introduce a
  self-hosted capture runner.

### G3. Publish a complete privacy policy

**Evidence**

- PLVS automatically checks for updates.
- Newsletter subscription, Feedback, optional Feedback diagnostics, and opt-in crash reports send
  data to `list.plvs.soundoer.com`.
- Privacy statements exist in the PRD, FAQ, and dialogs, but there is no standalone privacy page or
  policy linked from the website and application.

**Why it matters**

The current behaviour is privacy-conscious, but a formal public product needs one discoverable
document explaining what is sent, why, where it is processed, how long it is retained, and how a
user can request deletion or contact the maintainer.

**Recommended completion criteria**

- Publish a stable Privacy Policy covering update checks, newsletter email, Feedback, diagnostics,
  crash reports, log contents, retention, deletion requests, and contact details.
- Link it from the website footer and subscription form, and from Feedback/crash-report surfaces.
- Keep the statement explicit that audio samples and metering data are not uploaded.

This recommendation is an engineering and product-readiness observation, not legal advice.

### G4. Deliver third-party notices with the binary distribution

**Evidence**

- PLVS bundles separate FFmpeg and ffprobe executables built under LGPL-2.1.
- `THIRD-PARTY-NOTICES.md` documents FFmpeg and bundled VAD models in the repository.
- `src-tauri/tauri.conf.json` does not include that notice in bundle resources.
- The Portable ZIP contains only `plvs.exe`, `plvs-cli.exe`, `ffmpeg.exe`, and `ffprobe.exe`.
- Installer verification does not assert the presence of licence or notice material.

**Why it matters**

Repository-hosted attribution is not the same as delivering licence material with redistributed
binaries. This is both a compliance risk and a trust/discoverability gap.

**Recommended completion criteria**

- Include PLVS's MIT licence, the LGPL-2.1 text, and third-party notices in NSIS, Portable, DMG, and
  application resources.
- Add an in-app or website route to the third-party notices.
- Make installer/package smoke tests fail when required licence material is absent.

### G5. Exercise real upgrades and recovery

**Evidence**

- The repository thoroughly tests update checks, confirmation UI, manifest generation, package
  creation, and updater signatures.
- No automated or documented end-to-end matrix was found that installs an earlier public build,
  updates it to the release candidate, and verifies persisted data and runtime components.

**Why it matters**

An installer can be valid and an updater manifest can be correctly signed while a real upgrade
still loses settings, leaves stale sidecars, breaks the CLI, or fails to recover after an
interrupted install.

**Recommended completion criteria**

- Test at least `N-1 -> RC` and one older supported version to RC on both platforms.
- Verify settings, workspace, presets, themes, window geometry, CLI discovery, FFmpeg sidecars, and
  launch identity after the update.
- Simulate failed or interrupted update download/installation and document recovery.
- Define the operational response for a bad release: next-patch hotfix, updater-manifest handling,
  and user communication.

### G6. Guarantee durable settings on exit and surface persistence failure

**Evidence**

- `createDomainStore.js` coalesces continuous updates for 250 ms.
- `pluginStoreBackend.js` adds a 200 ms asynchronous write batch and stores background save errors
  until a later explicit flush.
- `pagehide` flushes domain state into the backend but cannot await the asynchronous disk save.
- `useCloseConfirm.js` exits or hides the application without calling `flushPersistence()`.
- Agent Control explicitly reports `persistenceFailed`, while ordinary GUI state updates generally
  do not surface the same failure.

**Why it matters**

A user can change a setting or layout and immediately quit while the final write is still pending.
Disk-full, permission, or locked-file failures can also leave the UI showing a value that will not
survive restart.

**Recommended completion criteria**

- Await `flushPersistence()` before intentional process exit and before any hide path that tears
  down the writing surface.
- Surface durable-save failures to GUI users. For high-impact operations, either roll the UI back or
  state clearly that the change was applied but not saved.
- Add an integration test that changes workspace/settings state, immediately closes, restarts, and
  verifies `plvs-settings.json`.

## First-launch improvements

### Fix public download and documentation defects

- `landing/index.html` looks for a Portable asset whose name contains `portable` and ends in
  `.exe`; the actual release asset is `PLVS-v<version>-x64-portable.zip`. The direct Portable
  download therefore falls back to the general Releases page.
- `docs/user/getting-started.md` uses `<version>` inside package names. In the generated HTML this is
  parsed as an HTML element, leaving blank version text on the live documentation page.
- `package.json` contains `"plvs": "file:../../.."`, producing a self-referential local dependency
  linked to an unrelated older parent manifest in the current development environment. It is unused
  by the product and makes dependency metadata environment-dependent.

Recommended action: fix all three and add generated-site/release-asset contract assertions that
check the rendered output rather than only the Markdown source.

### Establish support and vulnerability-reporting entry points

- Add `SECURITY.md` with a private vulnerability-reporting path.
- Add issue templates that collect PLVS version, OS build, source type, device/application, channel
  layout, reproduction steps, and diagnostics consent.
- Link support from the README and user guide. Keep in-app Feedback as the low-friction path.
- Document whether Intel macOS is unsupported; the current package is Apple Silicon only.

### Protect the release path

- Protect `main` and release tags where repository permissions allow it.
- Require exact-SHA CI and cross-platform release-candidate success.
- Preserve the existing rule that released tags are never moved.
- Consider a machine-readable proof/check for required local capture validation when capture paths
  changed.

### Add crash containment to Dock accessory surfaces

The main React root is wrapped in `AppCrashBoundary`, but Dock header/editor roots are not. A render
failure in an accessory can leave that surface blank while the main application continues.

Recommended action: add a dependency-light accessory-compatible error boundary and ensure failures
are written to local diagnostics.

### Make runtime notices accessible

Transport, capture, device, and scene-operation notices are visual elements without an ARIA live
region. Add appropriate `role="status"` / `aria-live` semantics, using assertive behaviour only for
states that require immediate attention.

## Post-launch improvements

### Improve difficult-path coverage

Overall frontend coverage is strong, but the following paths are substantially below the project
average:

- `src/hooks/spectrogram3dGlRenderer.js`: approximately 4.7% line coverage
- `src/hooks/useSpectrogram3dCanvas.js`: approximately 27%
- `src/workspace/DragContext.jsx`: approximately 44%
- `src/hooks/useHistoryInteraction.js`: approximately 42%
- `src/App.jsx`: approximately 59%

The WebGL gap deserves real Windows WebView2 and macOS WKWebView smoke coverage for context
creation/loss, shader failure, resource cleanup, mode switching, and graceful fallback. Coverage
percentage alone should not be used as a proxy for GPU compatibility.

### Establish a minimum accessibility baseline

PLVS already includes many labels, keyboard controls, focus management details, reduced-motion
handling, and text-scaling work. Remaining high-value areas include:

- ARIA tab semantics and keyboard equivalents for workspace tab/layout operations
- live announcement of errors and capture health
- screen-reader access to meaningful meter summaries
- keyboard-only end-to-end smoke
- high-contrast, reduced-motion, and OS text-scaling acceptance

This need not become a full accessibility programme before the first stable release, but a stated
minimum baseline reduces avoidable exclusion and support ambiguity.

### Automate dependency and licence policy

- Upgrade the affected development tools, especially Vitest/coverage and Sharp, then repeat the
  full gate.
- Add an appropriate production-focused npm audit policy to CI.
- Add Rust advisory scanning with `cargo-audit` or `cargo-deny`.
- Add a licence allow/deny policy so a future GPL/AGPL or unknown dependency cannot silently enter
  a release.

The 12 current npm findings are in development/build tooling. They should be fixed, but they are not
equivalent to 12 vulnerabilities in the installed PLVS application.

### Harden local file IPC

The Rust profile/file commands accept frontend-provided paths for reads and writes. Current risk is
reduced by the strict CSP, trusted local frontend, and use of native file dialogs, but the Rust
boundary itself does not constrain those paths.

Recommended action: bind operations to paths granted by native dialogs or introduce a narrowly
defined allowlist/capability model. This is defence in depth rather than evidence of a currently
exploitable remote path.

### Continue decomposing orchestration hotspots

`App.jsx` and `useAgentControlBridge.js` are large orchestration surfaces. Their current test
coverage and comments make them manageable, so a launch-blocking rewrite would add risk. Continue
extracting lifecycle controllers and domain hooks only when making related changes after launch.

## Suggested four-week closeout

### Week 1: correctness and policy

- Fix durable persistence on exit and failure reporting.
- Fix Portable download resolution, rendered version placeholders, and the accidental npm
  self-dependency.
- Publish Privacy, Support, Security, and third-party notice surfaces.
- Package and verify all required licence material.

### Week 2: trusted distribution

- Integrate Windows signing and macOS signing/notarization.
- Run clean-machine install, uninstall, and `N-1 -> RC` updater tests.
- Verify updater failure and recovery behaviour.

### Week 3: external beta

- Freeze new features.
- Test with target sound designers and mix engineers across the supported OS/device/DAW matrix.
- Include system output, physical input, application capture, ASIO limitation messaging,
  multichannel layouts, display scaling, Dock, File Mode, and 3D Spectrogram.

### Week 4: release candidate

- Fix only launch-blocking defects.
- Run the full local preflight and exact-SHA remote gates.
- Run the required capture smoke and soak evidence.
- Hold the release candidate for at least one week of observation before the coordinated launch.

## Go / no-go criteria

Proceed with a formal launch when all of the following are true:

1. Signed installation works without bypass instructions on both supported platforms.
2. Windows and macOS real capture acceptance matrices pass for the release candidate.
3. Required capture smoke and soak evidence exists for affected code.
4. An actual previous public build updates successfully to the release candidate without losing
   user configuration.
5. Privacy and third-party licence information are publicly discoverable and shipped where
   required.
6. Intentional exit waits for persistence, and durable-save failure is visible.
7. Direct website downloads resolve to the correct release assets.
8. There are no open P0/P1 defects accepted only because the release date is near.
9. The release candidate has completed a defined observation period with external users.
10. The exact commit to be tagged has passed normal CI and the cross-platform release-candidate
    workflow.

## Dimension assessment

| Dimension | Assessment | Summary |
| --- | --- | --- |
| Security | Good with hardening work | Strong CSP, capabilities, local Agent Control security, and opt-in diagnostics; add advisory CI and file-path defence in depth. |
| Project structure | Good | Domain-oriented frontend and Rust modules, explicit IPC and persistence boundaries. |
| Naming and style | Good | Consistent conventions, English source/docs policy, enforced formatting and linting. |
| Configuration | Good | Version/config contracts are tested; remove the accidental npm self-dependency. |
| Dependencies | Good runtime / needs tooling cleanup | No known production JS vulnerabilities; development advisories and Rust advisory automation remain. |
| Documentation | Very good / launch policy gaps | Extensive user and maintainer docs; Privacy, Support, Security, and packaged notices are missing. |
| Testing | Very good / hardware gap | High frontend coverage and broad contracts; real capture and GPU paths need stronger acceptance. |
| Git and release | Good / governance gap | Mature release procedure, but no branch protection and important local gates are not server-enforced. |
| Performance | Good | Purpose-built benchmarks, packed histories, backpressure, smoke and soak tooling. |
| Operations and support | Fair | Crash/feedback paths exist; formal support, incident, rollback, and launch-health procedures need definition. |

## Final assessment

PLVS does not need a broad feature push before launch. It needs a controlled hardening phase.

The recommended sequence is:

1. close persistence, privacy, licence, and public-download defects;
2. establish trusted signed distribution;
3. prove capture and upgrades on real machines;
4. run a feature-frozen external beta;
5. ship a monitored release candidate through the existing exact-SHA release process.

Once those gates are closed, the remaining items are normal post-launch improvement work rather
than reasons to delay release indefinitely.
