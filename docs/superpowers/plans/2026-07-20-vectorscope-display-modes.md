# Vectorscope Display Modes Implementation Plan

> **For agentic workers:** Execute task-by-task with red/green verification. Do not branch unless
> the user asks; PLVS work lands on `main`. Run `npm run check` before merging.

**Goal:** Add independently persisted Lissajous, Polar Sample, and Polar Level modes to full-panel
and Dock Vectorscopes using the existing request-keyed sample history, including stable automatic
magnification and optional indefinite Polar Level Peak hold.

**Architecture:** Preserve the existing Rust-generated Lissajous SVG path. Add a pure frontend
Polar math module and one reusable Canvas renderer fed by `VectorscopeHistorySlab` rows. Mode and
Peak hold stay per-instance display controls and are excluded from analysis request identity.

**Tech stack:** React 19, Canvas 2D, existing workspace/Dock persistence, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-20-vectorscope-display-modes-design.md`

---

## File Structure

Expected new files:

- `src/math/vectorscopePolarMath.js` — pure projection, window, auto-extent, bin, envelope, and
  Peak hold functions.
- `src/math/vectorscopePolarMath.test.js` — deterministic math tests.
- `src/components/panels/VectorscopePolarPlot.jsx` — reusable Canvas Polar renderer for full panel
  and Dock.
- `src/components/panels/VectorscopePolarPlot.test.jsx` — renderer structure and reset tests with a
  mocked Canvas context.

Expected modified files:

- `src/lib/panelControls.js`
- `src/lib/panelControls.test.js`
- `src/workspace/types.js`
- `src/analysis/analysisRequests.test.js`
- `src/components/PanelSettingsContent.jsx`
- `src/components/PanelSettingsContent.test.jsx`
- `src/components/panels/VectorscopePanel.jsx`
- `src/components/panels/VectorscopePanel.test.jsx`
- `src/hooks/useSnapshot.js`
- `src/hooks/useSnapshot.test.jsx`
- `src/App.jsx`
- `src/hooks/useSourceTransportActions.js`
- `src/hooks/useSourceTransportActions.test.jsx`
- `src/dock/dockModuleControls.js`
- `src/dock/dockModuleControls.test.js`
- `src/dock/editors/DockModuleSettings.jsx`
- `src/dock/editors/DockModuleSettings.test.jsx`
- `src/dock/modules/DockVectorscope.jsx`
- `src/dock/modules/DockVectorscope.test.jsx`

Do not edit `src/generated/`. Do not modify Rust, IPC payloads, the audio callback, or request caps.

---

## Task 1: Add and persist full-panel display controls

**Files:**

- Modify: `src/lib/panelControls.js`
- Modify: `src/lib/panelControls.test.js`
- Modify: `src/workspace/types.js`
- Test: existing workspace reducer/persistence tests as selected by failures

- [ ] Add failing tests for defaults:
  - `vectorscopeMode === "lissajous"`;
  - `vectorscopePolarLevelPeakHold === false`.
- [ ] Add failing normalization tests:
  - accept `lissajous`, `polarSample`, and `polarLevel`;
  - invalid/missing mode falls back to `lissajous`;
  - Peak hold accepts booleans only and otherwise falls back to false;
  - normalization returns the new fields for legacy controls that omit them.
- [ ] Run:

  ```powershell
  npx vitest run src/lib/panelControls.test.js
  ```

  Expected: new assertions fail.

- [ ] Add constants/set membership and normalize both fields in `normalizePanelControls`.
- [ ] Extend the `PanelControls` typedef in `src/workspace/types.js`.
- [ ] Re-run the focused test and any workspace persistence tests affected by fixture equality.
- [ ] Confirm old fixture data restores to Lissajous without a migration script.

## Task 2: Keep display controls out of analysis identity

**Files:**

- Modify: `src/analysis/analysisRequests.test.js`
- Verify: `src/analysis/analysisRequests.js`

- [ ] Add a test with two Vectorscope panels using the same channel pair but different modes and
      Peak hold values.
- [ ] Assert derivation produces one deduplicated request:

  ```txt
  vectorscope:pair:0:1
  ```

  with both panel ids.

- [ ] Run:

  ```powershell
  npx vitest run src/analysis/analysisRequests.test.js
  ```

- [ ] If the test already passes, make no production change. Do not add mode to request payloads,
      Rust request structs, keys, or request caps.

## Task 3: Add the full-panel settings UI

**Files:**

- Modify: `src/components/PanelSettingsContent.jsx`
- Modify: `src/components/PanelSettingsContent.test.jsx`

- [ ] Add failing UI tests for this exact order:

  ```txt
  Mode
  Channel pair
  Peak hold (Polar Level only)
  ```

- [ ] Assert the Mode select contains labels only:
  - `Lissajous`
  - `Polar Sample`
  - `Polar Level`
- [ ] Assert selecting a mode calls `onPanelControlsChange` with normalized per-instance controls.
- [ ] Assert `Peak hold` is absent for Lissajous and Polar Sample, present for Polar Level, defaults
      off, and updates only `vectorscopePolarLevelPeakHold`.
- [ ] Run the focused test and verify failures.
- [ ] Implement the selector and conditional toggle using existing settings primitives.
- [ ] Re-run until green.

## Task 4: Build pure Polar projection and window math

**Files:**

- Create: `src/math/vectorscopePolarMath.js`
- Create: `src/math/vectorscopePolarMath.test.js`
- Reuse constants where appropriate from: `src/math/vectorscopeMath.js`

- [ ] Write failing tests for `projectPairToPolar(l, r)`:
  - `(1, 1)` and `(-1, -1)` both map to top center;
  - left-only and right-only map symmetrically;
  - `(1, -1)` maps to a semicircle end;
  - output angle stays in `[-π/2, +π/2]`;
  - inputs clamp to `[-1, 1]`.
- [ ] Write failing tests for `selectPolarWindow(slab, 400)`:
  - ages are relative to newest slab timestamp;
  - rows older than 400 ms are excluded;
  - returned rows are oldest-first;
  - pair arrays remain subarray views and are not copied.
- [ ] Implement only the projection and selection functions.
- [ ] Run:

  ```powershell
  npx vitest run src/math/vectorscopePolarMath.test.js
  ```

- [ ] Refactor shared extent constants out of `vectorscopeMath.js` only if doing so reduces
      duplication without changing existing Lissajous results.

## Task 5: Implement stable time-based automatic magnification

**Files:**

- Modify: `src/math/vectorscopePolarMath.js`
- Modify: `src/math/vectorscopePolarMath.test.js`

- [ ] Specify constants in the test before implementation:
  - same extent floor and safe inset as current Vectorscope;
  - an implementation release time constant chosen for a visibly stable first pass;
  - no user-facing control.
- [ ] Add failing tests for a pure update function such as
      `updatePolarExtent(previous, target, elapsedMs, hasSignal)`:
  - larger target extent is accepted immediately (drawing shrinks immediately);
  - smaller target extent releases gradually (drawing expands slowly);
  - equal target is stable;
  - no signal freezes the previous valid extent;
  - first valid signal initializes immediately;
  - behavior is equivalent for the same elapsed time split across different frame cadences.
- [ ] Add a window-extent test that scans all selected real samples.
- [ ] Implement the time-based function without timers or React dependencies.
- [ ] Run focused math tests until green.

## Task 6: Implement Polar Sample geometry and Canvas drawing

**Files:**

- Modify: `src/math/vectorscopePolarMath.js`
- Modify: `src/math/vectorscopePolarMath.test.js`
- Create: `src/components/panels/VectorscopePolarPlot.jsx`
- Create: `src/components/panels/VectorscopePolarPlot.test.jsx`

- [ ] Add math tests for age opacity:
  - newest row uses high opacity;
  - 400 ms row reaches zero;
  - values clamp outside the window.
- [ ] Implement Polar Sample geometry from selected rows with one shared extent.
- [ ] Create the reusable Canvas plot with props for mode, rows/snapshot pairs, signal state, pair
      labels, reset epoch, Peak hold toggle, and compact sizing.
- [ ] Handle DPR correctly: CSS size for layout, pixel size for backing buffer, scaled point radius
      and line width.
- [ ] Resolve `--ui-vectorscope-trace` and existing opacity/stroke tokens from computed style; add
      no mode-specific colors.
- [ ] Draw a subtle semicircle arc/baseline and endpoint labels; draw no ±45° lines and no Center
      label.
- [ ] Draw real points only, no lines and no temporal interpolation.
- [ ] Add renderer tests with a minimal mocked 2D context:
  - Polar Sample selects the 400 ms window;
  - draw calls contain points, not connecting polylines;
  - endpoint labels are present above the compact-size cutoff and hidden below it;
  - no safety-guide test hooks are rendered.
- [ ] Run focused math and renderer tests.

## Task 7: Implement Polar Level bins and envelope

**Files:**

- Modify: `src/math/vectorscopePolarMath.js`
- Modify: `src/math/vectorscopePolarMath.test.js`
- Modify: `src/components/panels/VectorscopePolarPlot.jsx`
- Modify: `src/components/panels/VectorscopePolarPlot.test.jsx`

- [ ] Add failing tests for 64-bin aggregation:
  - centered mono concentrates at the center bin;
  - left/right inputs produce mirrored bins;
  - opposite-polarity input reaches an end bin;
  - bin amplitude uses `sqrt(sum(radius²) / totalSampleCount)`;
  - neighboring-bin smoothing is symmetric and energy shape remains bounded.
- [ ] Add failing tests for the time-based envelope update:
  - rising energy uses the fast attack coefficient;
  - falling energy uses the slower release coefficient;
  - silence releases toward zero;
  - snapshot/settled mode bypasses temporal smoothing;
  - results are cadence-independent for equal elapsed time.
- [ ] Implement aggregation and envelope functions as pure functions over fixed-size arrays.
- [ ] Render a closed filled envelope and its outline in Canvas.
- [ ] Confirm steady identical input produces stable identical target bins and does not jitter.
- [ ] Run focused tests until green.

## Task 8: Implement indefinite Peak hold and Clear reset epoch

**Files:**

- Modify: `src/math/vectorscopePolarMath.js`
- Modify: `src/math/vectorscopePolarMath.test.js`
- Modify: `src/components/panels/VectorscopePolarPlot.jsx`
- Modify: `src/App.jsx`
- Modify: `src/hooks/useSourceTransportActions.js`
- Modify/create focused tests for the clear action and context data

- [ ] Add pure tests for Peak hold:
  - per-bin maxima only increase;
  - disabling discards held bins;
  - enabling starts from the current envelope;
  - reset returns an empty hold.
- [ ] Add a frontend `vectorscopeResetEpoch` (or appropriately general meter reset epoch) that
      increments only after `clearActiveSource()` reports success.
- [ ] Expose the epoch through the existing shared data context available to full panel and Dock.
- [ ] Add tests that failed Clear does not increment the epoch and successful Clear increments it
      once.
- [ ] Reset envelope, auto-extent initialization, and held bins on epoch change.
- [ ] Reset held bins when mode or channel pair changes.
- [ ] Render Peak hold as a thin unfilled same-token outline only when:
  - mode is Polar Level;
  - toggle is on;
  - live mode is active.
- [ ] Add renderer tests for toggle-off, toggle-on, indefinite accumulation, Clear reset, pair/mode
      reset, and snapshot hiding.

## Task 9: Integrate the full-panel renderer and snapshots

**Files:**

- Modify: `src/components/panels/VectorscopePanel.jsx`
- Modify: `src/components/panels/VectorscopePanel.test.jsx`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`

- [ ] Extend snapshot resolution to return `pairs` without removing the existing `path` or metrics.
- [ ] Add snapshot tests for returned pair identity/data and missing-history behavior.
- [ ] In `VectorscopePanel`, select rendering by normalized per-instance mode:
  - Lissajous: current SVG grid/path and current hold-to-slow behavior;
  - Polar Sample: reusable Polar Canvas plot;
  - Polar Level: reusable Polar Canvas plot.
- [ ] Read live Polar rows from the existing request-key history slab accessor.
- [ ] Keep Correlation rail/readout unchanged and visible in every mode.
- [ ] Pass current pair labels, signal gate, snapshot pairs, reset epoch, and Peak hold control to the
      Polar renderer.
- [ ] Gate hold-to-slow pointer activation on `vectorscopeMode === "lissajous"`.
- [ ] Add panel tests:
  - legacy/default controls render unchanged Lissajous;
  - each mode renders the correct plot immediately;
  - Polar modes do not render the diagonal Lissajous grid;
  - Correlation remains present;
  - snapshot uses the selected mode;
  - hold-to-slow is ignored in both Polar modes;
  - silence passes the correct fade/release/freeze state.
- [ ] Run:

  ```powershell
  npx vitest run src/hooks/useSnapshot.test.jsx src/components/panels/VectorscopePanel.test.jsx
  ```

## Task 10: Add and persist Dock controls

**Files:**

- Modify: `src/dock/dockModuleControls.js`
- Modify: `src/dock/dockModuleControls.test.js`
- Modify: `src/dock/editors/DockModuleSettings.jsx`
- Modify: `src/dock/editors/DockModuleSettings.test.jsx`

- [ ] Add Dock default/normalization tests for `mode` and `polarLevelPeakHold`.
- [ ] Add serialization/default-comparison tests so legacy Dock state restores to Lissajous.
- [ ] Add settings tests for order and conditional Peak hold visibility.
- [ ] Implement Mode and Peak hold controls for the existing `correlation` Dock module.
- [ ] Confirm Dock control edits remain independent of full-panel controls.
- [ ] Run focused Dock control/settings tests until green.

## Task 11: Integrate all modes into Dock Vectorscope

**Files:**

- Modify: `src/dock/modules/DockVectorscope.jsx`
- Modify: `src/dock/modules/DockVectorscope.test.jsx`

- [ ] Read the request-key history slab and reset epoch from the shared context.
- [ ] Preserve existing standard/expanded sizing and correlation rail/readout.
- [ ] Render existing SVG Lissajous for default mode and reusable Polar Canvas for Polar modes.
- [ ] Pass compact sizing so endpoint labels hide at the specified cutoff.
- [ ] Add tests for:
  - default Lissajous compatibility;
  - both Polar modes in standard and expanded layouts;
  - correlation visibility in every mode;
  - endpoint labels hidden for very small plot size;
  - Peak hold reset through shared epoch;
  - independent persisted Dock controls.
- [ ] Run:

  ```powershell
  npx vitest run src/dock/modules/DockVectorscope.test.jsx src/dock/editors/DockModuleSettings.test.jsx src/dock/dockModuleControls.test.js
  ```

## Task 12: Performance and visual verification

**Files:** adjust only files already in scope if verification finds a defect.

- [ ] Add/verify render guards so Polar geometry recomputes only for slab version, snapshot row,
      plot dimensions, relevant controls, reset epoch, or theme-token changes.
- [ ] Confirm Canvas reads slab subarrays without copying them.
- [ ] Confirm Polar Sample never reads more than the 400 ms bounded window.
- [ ] Confirm Polar Level uses fixed-size arrays and no unbounded accumulation.
- [ ] Run the desktop app with real audio:

  ```powershell
  npm run desktop
  ```

- [ ] Manually verify at minimum:
  - centered mono;
  - left-only and right-only;
  - polarity-inverted stereo;
  - quiet-to-loud and loud-to-quiet transitions;
  - silence after program audio;
  - steady tone/music for visible auto-scale breathing;
  - two full panels in different modes;
  - snapshot scrubbing in all modes;
  - Polar Level Peak hold and Clear;
  - Dock standard and expanded sizes;
  - multiple themes and Windows text scaling.
- [ ] Tune only implementation constants (extent release, point size, attack/release, fill alpha)
      if needed; do not add new user controls without revising the spec.

## Task 13: Full verification and documentation consistency

- [ ] Run focused vectorscope suites together:

  ```powershell
  npx vitest run src/math/vectorscopeMath.test.js src/math/vectorscopePersistence.test.js src/math/vectorscopePolarMath.test.js src/components/panels/VectorscopePolarPlot.test.jsx src/components/panels/VectorscopePanel.test.jsx src/dock/modules/DockVectorscope.test.jsx
  ```

- [ ] Run the mandatory merge gate:

  ```powershell
  npm run check
  ```

- [ ] Expected: version, format, lint, all JS tests/build, Rust fmt/clippy/tests pass.
- [ ] Confirm `git diff --check` is clean and no generated file was edited manually.
- [ ] Review `docs/architecture.md` terminology. If it calls the current display “trace,” update the
      prose to name the three Vectorscope display modes without adding implementation-file details.
- [ ] Because this plan intentionally makes no `src-tauri/src/audio`, `dsp`, or `engine` changes,
      capture smoke/soak is not required. If implementation deviates and touches those paths, run the
      appropriate real capture smoke and remind the user to run:

  ```powershell
  npm run soak:capture
  ```

  Treat soak drift failures as leads, not verdicts, per `AGENTS.md`.
