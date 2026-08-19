# Spectral Waveform Implementation Plan

**Goal:** Add REAPER-inspired Frequency Color and an independent spectral-centroid overlay to
Workspace and Dock Waveform panels with shared per-channel Rust analysis and retained visual
history.

**Design:** `docs/superpowers/specs/2026-08-18-spectral-waveform-design.md`

**Architecture:** One boolean request activates a request-independent per-channel consumer over the
Shared Spectral Engine. Rust publishes only dominant Hz, centroid Hz, and tonality in visual
history. Display splits, palette mapping, and Canvas rendering stay in the frontend, so every panel
instance can recolor the same history independently.

**Tech stack:** Rust, Tauri IPC, React 19, Canvas 2D, Vitest/Testing Library, existing Workspace/Dock
settings and persistence.

## Invariants

- No direct Tauri API use outside `src/ipc/`.
- No FFT, allocation, lock, or syscall on the audio callback.
- Do not add a second FFT path when Shared Spectral Engine frames are available.
- Split values are display-only and never enter backend analysis identity.
- Both toggles Off preserves classic Waveform output and adds no spectral-waveform analysis.
- Workspace and Dock may have different split values while sharing the same retained metrics.
- Each task starts with focused failing tests and ends with focused verification.
- Do not edit `src/generated/` by hand.

---

## Task 1: Add normalized Workspace and Dock control contracts

**Files:**

- Modify: `src/lib/panelControls.js`
- Modify: `src/lib/panelControls.test.js`
- Modify: `src/dock/dockModuleControls.js`
- Modify: `src/dock/dockModuleControls.test.js`
- Modify relevant workspace/dock preset tests

**Steps:**

1. Add failing tests for defaults, boolean normalization, integer split normalization, invalid
   ordering fallback, per-instance persistence, and reset comparison.
2. Add Workspace defaults:
   `waveformFrequencyColor=false`, `waveformLowMidSplitHz=200`,
   `waveformMidHighSplitHz=2000`, `waveformCentroid=false`.
3. Add equivalent Dock Waveform defaults and normalization.
4. Preserve unknown/legacy persisted states by filling defaults without mutating unrelated controls.
5. Run focused JS tests.

## Task 2: Add matching Workspace and Dock settings UI

**Files:**

- Modify: `src/components/PanelSettingsContent.jsx`
- Modify: `src/components/PanelSettingsContent.test.jsx`
- Modify: `src/dock/registry.jsx`
- Modify: `src/dock/editors/DockModuleSettings.jsx`
- Modify: `src/dock/editors/DockModuleSettings.test.jsx`
- Reuse/refine numeric input primitives in `PanelSettingsContent.jsx`

**Steps:**

1. Add failing component tests for both toggles, conditional split rows, direct number entry,
   Enter/blur commit, Escape/invalid restore, and no legend.
2. Add a reusable single-number settings input styled and behaved consistently with
   `SettingsRangeInput`.
3. Add shared Waveform settings rows used by Workspace and Dock adapters.
4. Set Dock Waveform `settingsFamily` to `waveform`.
5. Verify the existing title Reset resets all controls for only the active Workspace/Dock panel and
   that no row-level reset icon is rendered.
6. Run focused component tests.

## Task 3: Add the spectral-waveform activation wire contract

**Files:**

- Modify: `src/analysis/analysisRequests.js`
- Modify: `src/analysis/analysisRequests.test.js`
- Modify: `src/dock/dockAnalysisRequest.js`
- Modify: `src/dock/dockAnalysisRequest.test.js`
- Modify: `src/runtime/appRuntimeDerivations.js`
- Modify: `src/runtime/appRuntimeDerivations.test.js`
- Modify: `src/ipc/types.js`
- Modify: `src-tauri/src/ipc/types.rs`
- Modify: `src-tauri/src/ipc/commands.rs`

**Steps:**

1. Add failing tests proving any enabled Workspace/Dock Waveform activates one boolean; duplicates
   and both toggles do not duplicate it; split-only changes leave the wire payload unchanged.
2. Extend the required backend payload with `spectralWaveform: boolean` and update shared wire
   contract fixtures/tests.
3. Validate only the boolean shape in Rust; no request key or cap applies.
4. Confirm file analysis snapshots the boolean through the existing AnalysisRequests path.
5. Run focused JS and Rust IPC tests.

## Task 4: Implement per-channel spectral metrics over shared frames

**Files:**

- Create: `src-tauri/src/dsp/spectral_waveform.rs`
- Modify: `src-tauri/src/dsp/mod.rs`
- Modify: `src-tauri/src/engine/spectral_plan.rs`
- Modify: `src-tauri/src/dsp/shared_spectral_engine.rs`
- Add/update relevant benches under `src-tauri/benches/`

**Steps:**

1. Add failing Rust reference tests for silence, aligned/non-aligned tones, two tones, deterministic
   broadband noise, impulse, per-channel independence, finite bounds, and tonality ordering.
2. Implement a consumer that derives neutral spectral density before display shaping and returns
   finite dominant Hz, centroid Hz, and `[0,1]` tonality.
3. Extend planning so enabled spectral Waveform requests each displayed physical channel and reuses
   transforms already needed by Spectrum/Stereo Map.
4. Keep the consumer request-independent and share it between Frequency Color and Centroid.
5. Add transform-count and allocation assertions; benchmark 2/8/16 channels. If all-resolution
   stream cost is excessive, add resolution-need planning rather than channel sharing or a separate
   FFT implementation.
6. Run focused DSP, planner, shared-engine tests and benches.

## Task 5: Publish and retain visual-history metrics

**Files:**

- Modify: `src-tauri/src/ipc/types.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src-tauri/src/file_analysis/session.rs`
- Modify: `src/ipc/types.js`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/hooks/useSnapshot.js` and tests if the existing visual-history freeze needs extension

**Steps:**

1. Add failing pipeline tests for live 40 ms rows, file checkpoints, channel-array shape, finite
   serialization, warm-up, Clear, removal, and sample-rate changes.
2. Extend `VisualHistEntry` with dominant Hz, centroid Hz, and tonality arrays.
3. Publish empty arrays while inactive/unavailable and complete equal-length arrays when ready.
4. Store copied numeric arrays in the existing visual Waveform ring with timestamps.
5. Verify capacity changes, reset, freeze/snapshot, and file histories retain the metrics without
   aliasing mutable payload arrays.
6. Run focused Rust pipeline/file tests and FrameIntake/useSnapshot tests.

## Task 6: Add pure timestamp alignment and color mapping

**Files:**

- Create: `src/math/spectralWaveformMath.js`
- Create: `src/math/spectralWaveformMath.test.js`
- Modify theme token sources/tests and `docs/design-tokens.md`

**Steps:**

1. Add failing tests for log-frequency anchor mapping, split boundaries, continuous interpolation,
   tonality-to-Neutral mixing, silence/invalid fallback, light/dark token availability, centroid Y
   mapping, and timestamp gaps.
2. Add the five semantic tokens through `buildThemeTokens`; do not use signal, selection, snapshot,
   Spectrum, or Spectrogram roles.
3. Implement deterministic mapping from Hz/splits/tonality to render colors using a perceptual color
   interpolation path.
4. Implement timestamp lookup with an explicit tolerance and no stale stretching across gaps.
5. Implement log-frequency centroid projection over 20 Hz to the active Nyquist-clamped maximum.
6. Run focused math/theme tests and regenerate generated theme fallbacks through the repository
   generator, never by hand.

## Task 7: Render Workspace Waveform Frequency Color and Centroid

**Files:**

- Modify: `src/components/panels/WaveformPanel.jsx`
- Modify: `src/components/panels/WaveformPanel.test.jsx`
- Modify: `src/components/panels/chartHelp.js`
- Modify relevant AudioDataContext/provider wiring and tests

**Steps:**

1. Add failing renderer/component tests for classic compatibility, Neutral fallback, per-channel
   color differences, Centroid-only mode, combined mode, invalid gaps, split recoloring without
   history mutation, scrub, and snapshot.
2. Feed visual Waveform spectral history through the existing context/provider seam.
3. Preserve the current polygon renderer verbatim when both features are Off.
4. Add bounded per-column spectral painting inside each envelope and draw the one-pixel centroid
   trace afterward.
5. Extend hover data with centroid Hz when a valid aligned row exists; do not add a legend.
6. Update chart help and run focused tests.

## Task 8: Render Dock Waveform with the same retained analysis

**Files:**

- Modify: `src/dock/modules/DockWaveform.jsx`
- Modify: `src/dock/modules/DockWaveform.test.jsx`
- Modify Dock data/accessory payload wiring and tests as required

**Steps:**

1. Add failing tests for settings-controlled classic/color/centroid modes, per-channel output,
   long-window aggregation, theme changes, and missing history.
2. Reuse the pure color/timestamp/centroid helpers and retained visual history.
3. Keep Dock's latest-locked viewport and aggregation-stride optimization.
4. Do not add a Dock hover HUD or duplicate spectral analysis request.
5. Run focused Dock tests.

## Task 9: Integration, performance, and documentation gate

**Files:**

- Update: `docs/architecture.md`
- Update tests/fixtures affected by the required AnalysisRequests wire field
- Update performance harnesses with spectral Waveform data

**Steps:**

1. Run all focused JS suites touched above.
2. Run focused Rust DSP, shared-engine, pipeline, IPC, and file-analysis tests.
3. Run spectral transform-count/performance benches and record 2/8/16-channel results in the design
   or an adjacent benchmark note.
4. Run formatting and linting during iteration.
5. Run `npm run check` as the merge gate.
6. Run `npm run smoke:capture` on the configured real capture rig. If the rig is red and cannot be
   repaired, stop and ask before proceeding; never bypass it.
7. Run or explicitly hand off `npm run soak:capture` (four hours by default) because DSP/engine code
   changed. Treat its current drift threshold as diagnostic.
8. Inspect `git diff --check`, final status, and the complete diff for unrelated changes.
