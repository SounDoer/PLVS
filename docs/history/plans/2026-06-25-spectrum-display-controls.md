# Spectrum Display Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-panel Spectrum `Peak hold`, `Smoothing`, and `Tilt` settings where smoothing and tilt are request-keyed Rust display controls.

**Architecture:** Extend existing `panelControls` with `spectrumSmoothingPercent` and `spectrumTiltDbPerOctave`, include those values in Spectrum analysis requests and keys, and apply them on the per-key Rust `SpectrumMeter`. Keep `Peak hold` as a frontend-only display toggle and keep Spectrogram out of scope.

**Tech Stack:** React 19 + Vitest for panel settings and request derivation; Tauri IPC request structs; Rust DSP in `src-tauri/src/dsp/spectrum.rs`; Rust pipeline/request validation in `src-tauri/src/engine` and `src-tauri/src/ipc`.

**Spec:** `docs/superpowers/specs/2026-06-25-spectrum-display-controls-design.md`

**Commit policy:** Do not commit during execution unless the user explicitly asks for a commit.

---

## File Structure

- Modify `src/lib/panelControls.js` and `src/lib/panelControls.test.js`: defaults, clamping, formatting constants if needed.
- Modify `src/analysis/analysisRequests.js`, `src/analysis/analysisRequests.test.js`, and `shared/analysis-request-key-fixtures.json`: request payload and stable key grammar.
- Modify `src/App.jsx` and `src/ipc/commands.js`: forward new request fields to Rust.
- Modify `src/components/PanelSettingsContent.jsx` and `src/components/PanelSettingsContent.test.jsx`: local slider component and Spectrum-only rows.
- Modify `src-tauri/src/ipc/types.rs` and `src-tauri/src/ipc/commands.rs`: request fields and validation.
- Modify `src-tauri/src/engine/meter_pipeline.rs`: apply request controls to each keyed `SpectrumMeter`.
- Modify `src-tauri/src/dsp/spectrum.rs`: smoothing mapping, configurable tilt, tests.

---

## Task 1: Panel Control Defaults

**Files:**
- Modify: `src/lib/panelControls.js`
- Test: `src/lib/panelControls.test.js`

- [ ] **Step 1: Write failing tests**

Add assertions that defaults include `spectrumSmoothingPercent: 50` and
`spectrumTiltDbPerOctave: 4.5`, and that normalization clamps invalid values:

```js
expect(normalizePanelControls({}).spectrumSmoothingPercent).toBe(50);
expect(normalizePanelControls({}).spectrumTiltDbPerOctave).toBe(4.5);
expect(normalizePanelControls({ spectrumSmoothingPercent: -1 }).spectrumSmoothingPercent).toBe(0);
expect(normalizePanelControls({ spectrumSmoothingPercent: 101 }).spectrumSmoothingPercent).toBe(100);
expect(normalizePanelControls({ spectrumTiltDbPerOctave: -1 }).spectrumTiltDbPerOctave).toBe(0);
expect(normalizePanelControls({ spectrumTiltDbPerOctave: 7 }).spectrumTiltDbPerOctave).toBe(6);
```

- [ ] **Step 2: Implement defaults and normalization**

Add defaults to `DEFAULT_PANEL_CONTROLS` and normalize finite numbers into `0..100` and `0..6`.

- [ ] **Step 3: Verify**

Run: `npm run test -- src/lib/panelControls.test.js`

Expected: tests pass.

---

## Task 2: Request Key And IPC Payload

**Files:**
- Modify: `src/analysis/analysisRequests.js`
- Modify: `src/analysis/analysisRequests.test.js`
- Modify: `shared/analysis-request-key-fixtures.json`
- Modify: `src/App.jsx`
- Modify: `src/ipc/commands.js`
- Modify: `src-tauri/src/ipc/types.rs`
- Modify: `src-tauri/src/ipc/commands.rs`

- [ ] **Step 1: Write failing JS tests**

Add tests that `spectrumRequestKeyFromControls()` includes smoothing/tilt and excludes peak hold:

```js
expect(
  spectrumRequestKeyFromControls({
    ...DEFAULT_PANEL_CONTROLS,
    spectrumSmoothingPercent: 50,
    spectrumTiltDbPerOctave: 4.5,
  })
).toBe("spectrum:pair:0:1:combined:sm50:tilt450");

expect(
  spectrumRequestKeyFromControls({ ...DEFAULT_PANEL_CONTROLS, spectrumPeakHold: false })
).toBe(spectrumRequestKeyFromControls({ ...DEFAULT_PANEL_CONTROLS, spectrumPeakHold: true }));
```

- [ ] **Step 2: Implement JS request fields**

Append `:sm<percent>:tilt<centidb>` to Spectrum keys. Include
`smoothingPercent` and `tiltDbPerOctave` in each derived Spectrum request and in
`toBackendAnalysisRequests()`.

- [ ] **Step 3: Update fixture**

Update `shared/analysis-request-key-fixtures.json` examples to the new key grammar.

- [ ] **Step 4: Implement Rust request fields and validation**

Add `smoothing_percent: f64` and `tilt_db_per_octave: f64` to `SpectrumAnalysisRequest`.
Validate ranges and build the same expected key using integer percent and centi-dB tilt.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test -- src/analysis/analysisRequests.test.js src/analysis/analysisRequestKeyFormat.test.js
cargo test -p plvs analysis_requests_validation
```

Expected: JS and Rust request-key tests pass.

---

## Task 3: Rust Spectrum Controls

**Files:**
- Modify: `src-tauri/src/dsp/spectrum.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests in `spectrum.rs` for:

```rust
let (attack, release) = SpectrumMeter::smoothing_times_ms_for_percent(50.0);
assert!((attack - 30.0).abs() < 0.1);
assert!((release - 150.0).abs() < 0.1);
```

and a tilt test proving `0 dB/oct` no longer applies the default slope.

- [ ] **Step 2: Implement settings API**

Add `set_display_controls(smoothing_percent, tilt_db_per_octave)` and
`smoothing_times_ms_for_percent(percent)`. Store clamped values on `SpectrumMeter`.

- [ ] **Step 3: Apply settings in pipeline**

Before `meter.push_pcm(&ctx)` in the keyed Spectrum request loop, call:

```rust
meter.set_display_controls(request.smoothing_percent, request.tilt_db_per_octave);
```

- [ ] **Step 4: Verify**

Run:

```bash
cargo test -p plvs spectrum
cargo test -p plvs keyed_analysis_requests_emit_multiple_live_results
```

Expected: Spectrum DSP and keyed pipeline tests pass.

---

## Task 4: Spectrum Settings UI

**Files:**
- Modify: `src/components/PanelSettingsContent.jsx`
- Modify: `src/components/PanelSettingsContent.test.jsx`

- [ ] **Step 1: Write failing UI tests**

Assert Spectrum settings render in this order and with these labels:

```js
expect(screen.getByText("Peak hold")).toBeTruthy();
expect(screen.getByText("Smoothing")).toBeTruthy();
expect(screen.getByText("50%")).toBeTruthy();
expect(screen.getByText("Tilt")).toBeTruthy();
expect(screen.getByText("4.50 dB/oct")).toBeTruthy();
```

Also assert Spectrogram does not render `Smoothing` or `Tilt`.

- [ ] **Step 2: Add local `SettingsSlider`**

Use a native `input type="range"` and a value chip. Keep it local to
`PanelSettingsContent.jsx` to match the existing local `SettingsSelect`/`SettingsSwitch` pattern.

- [ ] **Step 3: Wire changes to `onPanelControlsChange`**

For `Smoothing`, write normalized controls with `spectrumSmoothingPercent: Number(value)`.
For `Tilt`, write `spectrumTiltDbPerOctave: Number(value)`.

- [ ] **Step 4: Verify**

Run: `npm run test -- src/components/PanelSettingsContent.test.jsx`

Expected: UI tests pass.

---

## Task 5: Full Verification

**Files:**
- All files modified by Tasks 1-4.

- [ ] **Step 1: Run focused tests**

```bash
npm run test -- src/lib/panelControls.test.js src/analysis/analysisRequests.test.js src/analysis/analysisRequestKeyFormat.test.js src/components/PanelSettingsContent.test.jsx
cargo test -p plvs spectrum
cargo test -p plvs analysis_requests_validation
```

- [ ] **Step 2: Run lints for edited files**

Use Cursor diagnostics on edited files and fix introduced warnings/errors.

- [ ] **Step 3: Run broader check if time allows**

Run: `npm run check`

Expected: full repository check passes.
