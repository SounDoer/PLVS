# Stereo Map Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add a frequency-domain Stereo Map Workspace panel and Dock module whose four modes are reconstructed from one retained `PL`/`PR`/real-`C` primitive history per Analysis Key.

**Architecture:** A Rust request-keyed pair consumer reads aligned complex frames from the completed Shared Spectral Engine and publishes finite smoothed primitives. The frontend owns the only metric derivation path, chunked typed-array history, live/historical Hold indexes, snapshot reconstruction, controls, and rendering. Analysis identity is `Pair + Speed + Smoothing`; Mode, Hold, and ranges are display-only.

**Tech Stack:** Rust, Tauri IPC, React 19, Vitest/Testing Library, typed arrays, existing Workspace/Dock registries and persistence.

**Depends on:** `docs/superpowers/plans/2026-07-25-shared-spectral-engine-implementation.md`

**Design:** `docs/superpowers/specs/2026-07-25-stereo-map-design.md`

## Preconditions and invariants

- Complete the Shared Spectral Engine plan first; do not add a second independent FFT path.
- Use one independent Stereo Map request family capped at four unique keys.
- The key contains Pair, Speed, and Smoothing only.
- IPC/history contains finite `bandCentersHz`, `pl`, `pr`, and real `c` arrays only.
- Never serialize derived values, validity, opacity, `NaN`, or `Infinity`.
- Mode changes never call Rust, create a key, reset analysis, or create a history gap.
- Hold toggling changes visibility only; all four modes accumulate while the key is active.
- Preserve every emitted Float32 primitive row at the existing source cadence.
- Keep inactive keys until Global Clear or retention reset; do not add silent eviction.
- The 240-minute cost of roughly 3.9 GiB per full key is intentional and must remain explicit in benchmarks.
- Each task defines a focused commit checkpoint. Run its commit step only when the user has explicitly authorized commits; otherwise leave the verified changes uncommitted.

---

### Task 1: Define the shared request-key contract

**Files:**

- Create: `shared/stereo-map-request-key-fixtures.json`
- Modify: `src/analysis/analysisRequests.js`
- Modify: `src/analysis/analysisRequests.test.js`
- Modify: `src/analysis/analysisRequestKeyFormat.test.js`
- Modify: `src-tauri/src/ipc/types.rs`
- Modify: `src-tauri/src/ipc/commands.rs`

**Step 1: Add failing JS and Rust fixture tests**

Define fixture cases for normal pairs, fallback-clamped pairs, all Speed values, and each smoothing token.

Use one canonical format:

```text
stereoMap:pair:<first>:<second>:sp<speedPercent>:sm<smoothingToken>
```

Assert explicitly that changing Mode, Hold, X range, or either Y range leaves the key unchanged.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/analysis/analysisRequestKeyFormat.test.js src/analysis/analysisRequests.test.js
cargo test --manifest-path src-tauri/Cargo.toml ipc::commands stereo_map
```

Expected: key builder, request type, and Rust validation are absent.

**Step 3: Implement the request contract**

Add:

```js
export const MAX_STEREO_MAP_REQUESTS = 4;
export function stereoMapRequestKeyFromControls(controls) {
  /* Pair + Speed + Smoothing */
}
```

Extend `AnalysisRequests` with a `stereo_map` array and add Rust request/pair types that mirror the JS wire object. Add `MAX_STEREO_MAP_ANALYSIS_REQUESTS = 4`, canonical-key validation, duplicate-key rejection, and channel-index validation following existing Spectrum/Vectorscope patterns.

Do not share the cap counter with Spectrum.

**Step 4: Verify**

Run:

```powershell
npm test -- src/analysis/analysisRequestKeyFormat.test.js src/analysis/analysisRequests.test.js
cargo test --manifest-path src-tauri/Cargo.toml ipc::commands
```

Expected: fixtures pass on both sides.

**Step 5: Commit**

```powershell
git add shared/stereo-map-request-key-fixtures.json src/analysis/analysisRequests.js src/analysis/analysisRequests.test.js src/analysis/analysisRequestKeyFormat.test.js src-tauri/src/ipc/types.rs src-tauri/src/ipc/commands.rs
git commit -m "feat: define stereo map analysis requests"
```

---

### Task 2: Derive, deduplicate, and cap Workspace requests

**Files:**

- Modify: `src/analysis/analysisRequests.js`
- Modify: `src/analysis/analysisRequests.test.js`
- Modify: `src/runtime/appRuntimeDerivations.js`
- Modify: `src/runtime/appRuntimeDerivations.test.js`
- Modify: `src/ipc/commands.js`
- Modify: `src/ipc/types.js`

**Step 1: Write failing derivation tests**

Cover:

- matching Workspace instances deduplicate;
- matching Workspace and future Dock instances deduplicate after merge;
- four unique Stereo Map keys are admitted and the fifth is over cap;
- four Spectrum plus four Stereo Map requests are both admitted;
- mono input or unavailable pair emits no request;
- Mode/Hold/range-only changes produce byte-equivalent backend requests.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/analysis/analysisRequests.test.js src/runtime/appRuntimeDerivations.test.js
```

Expected: tests fail because the third request family is absent.

**Step 3: Implement request derivation**

Extend `deriveAnalysisRequests` and `deriveBackendAnalysisRequests` with `stereoMap`. Preserve deterministic panel-order selection and current per-panel over-cap status behavior.

Update JSDoc wire types and `setAnalysisRequests` annotations so the frontend always sends all request-family arrays required by Rust deserialization.

**Step 4: Verify**

Run:

```powershell
npm test -- src/analysis/analysisRequests.test.js src/runtime/appRuntimeDerivations.test.js
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/analysis/analysisRequests.js src/analysis/analysisRequests.test.js src/runtime/appRuntimeDerivations.js src/runtime/appRuntimeDerivations.test.js src/ipc/commands.js src/ipc/types.js
git commit -m "feat: derive capped stereo map requests"
```

---

### Task 3: Produce pair primitives in Rust

**Files:**

- Create: `src-tauri/src/dsp/stereo_map.rs`
- Modify: `src-tauri/src/dsp/mod.rs`
- Modify: `src-tauri/src/engine/spectral_plan.rs`
- Modify: `src-tauri/src/dsp/shared_spectral_engine.rs`

**Step 1: Write failing DSP reference tests**

For aligned complex bins, test:

```text
PL = E[|XL|²]
PR = E[|XR|²]
C  = E[XL * conj(XR)]
```

Cover equal-energy in-phase, anti-phase, 90-degree, deterministic independent noise, unequal in-phase amplitudes, and single-sided input.

Also test:

- Speed EMA independence per request key;
- smoothing applies to linear `PL`, `PR`, and complex `C` before publishing;
- all published values are finite;
- any non-finite point canonicalizes the complete triplet to `(0, 0, 0)`;
- the consumer retains complex `C` internally but publishes real `C`.

**Step 2: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml dsp::stereo_map
```

Expected: module/type missing.

**Step 3: Implement the pair consumer**

Create one request-keyed consumer that owns three-resolution Speed-dependent accumulators and smoothing state, but no FFT ownership.

Extend the existing spectral planner so a Stereo Map pair requests aligned physical streams and reuses them with Spectrum consumers.

Return one row shaped like:

```rust
pub struct StereoMapPrimitiveRow {
    pub band_centers_hz: Vec<f32>,
    pub pl: Vec<f32>,
    pub pr: Vec<f32>,
    pub c: Vec<f32>,
}
```

Use the existing complete log grid and Float32 output.

**Step 4: Verify**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml dsp::stereo_map
cargo test --manifest-path src-tauri/Cargo.toml shared_spectral_engine
cargo test --manifest-path src-tauri/Cargo.toml spectral_plan
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src-tauri/src/dsp/stereo_map.rs src-tauri/src/dsp/mod.rs src-tauri/src/engine/spectral_plan.rs src-tauri/src/dsp/shared_spectral_engine.rs
git commit -m "feat: compute stereo map spectral primitives"
```

---

### Task 4: Publish live and visual-history primitives

**Files:**

- Modify: `src-tauri/src/ipc/types.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src-tauri/src/file_analysis/session.rs`
- Modify: `src-tauri/src/state.rs`

**Step 1: Write failing pipeline tests**

Assert:

- one live result per active Stereo Map key;
- exact equal lengths for centers/`pl`/`pr`/`c`;
- every serialized primitive is finite;
- duplicate frontend instances do not duplicate Rust consumers;
- removed keys stop accumulating immediately;
- unchanged inactive historical keys are a frontend concern and are not backfilled;
- visual rows emit at existing live 40 ms semantics;
- file visual rows retain existing roughly 100 ms media-time chunk cadence;
- Global Clear resets pair accumulators.

**Step 2: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline stereo_map
```

Expected: result maps and pipeline consumer ownership are absent.

**Step 3: Add IPC payloads and pipeline ownership**

Add Rust wire types:

- `StereoMapFrameResult`;
- `StereoMapVisualEntry`;
- `AudioFramePayload.stereo_map_results_by_key`;
- `VisualHistEntry.stereo_map_by_key`.

In `MeterPipeline`, retain/prune `StereoMap` consumers by request key, feed them from shared aligned frames, and publish primitives at the same live/file points used by existing visual histories.

Do not add Mode, Energy, gate, validity, opacity, or Hold fields.

**Step 4: Verify**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline
cargo test --manifest-path src-tauri/Cargo.toml file_analysis::session
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src-tauri/src/ipc/types.rs src-tauri/src/engine/meter_pipeline.rs src-tauri/src/file_analysis/session.rs src-tauri/src/state.rs
git commit -m "feat: publish stereo map primitive frames"
```

---

### Task 5: Implement the single frontend derivation path

**Files:**

- Create: `src/math/stereoMapMath.js`
- Create: `src/math/stereoMapMath.test.js`

**Step 1: Write failing formula and boundary tests**

Use one fixture table to cover all four modes:

```text
Position    = (PL - PR) / (PL + PR)
Correlation = C / sqrt(PL * PR)
MonoLossDb  = 10log10((PL + PR + 2C) / (PL + PR + 2sqrt(PL*PR)))
MSRatioDb   = 10log10((PL + PR - 2C) / (PL + PR + 2C))
```

Test:

- finite powers clamp to zero;
- `C` clamps to `[-sqrt(PL*PR), +sqrt(PL*PR)]`;
- non-finite primitive input returns `invalid`;
- energy uses the complete `PL + PR` row and existing `CAL_OFFSET_DB`;
- `gateDb = max(-96, fullGridPeak - 60)`;
- fade opacity spans gate to gate + 12 dB;
- invalid denominators break the point instead of returning zero;
- valid infinities become `belowRange`/`aboveRange`;
- exact reference values from the design, including one-sided Mono Loss = 0 dB and hard-pan M/S Ratio = 0 dB.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/math/stereoMapMath.test.js
```

Expected: module missing.

**Step 3: Implement pure derivation**

Expose pure row-level and point-level functions. Return explicit states:

```js
{ state: "invalid" }
{ state: "finite", value, opacity }
{ state: "belowRange", value: lowerBound, opacity }
{ state: "aboveRange", value: upperBound, opacity }
```

Do not duplicate formulas later in panel, history, snapshot, or Dock code.

**Step 4: Verify**

Run:

```powershell
npm test -- src/math/stereoMapMath.test.js
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/math/stereoMapMath.js src/math/stereoMapMath.test.js
git commit -m "feat: derive stereo map display metrics"
```

---

### Task 6: Add typed-array primitive history

**Files:**

- Create: `src/lib/StereoMapHistorySlab.js`
- Create: `src/lib/StereoMapHistorySlab.test.js`
- Modify: `src/lib/historyChunkConfig.js`

**Step 1: Write failing slab tests**

Specify the existing visual-history contract:

```js
length;
timestampAt(index);
rowAt(index);
freeze();
```

Test:

- Float64 timestamps;
- Float32 centers/`pl`/`pr`/`c`;
- exact row preservation;
- sealed chunk immutability;
- `freeze()` shares sealed chunks and copies only active tail;
- logical prefix eviction at retention;
- grid/sample-rate incompatibility starts fresh compatible storage;
- no per-row object/JS-array primary storage.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/lib/StereoMapHistorySlab.test.js
```

Expected: module missing.

**Step 3: Implement the slab**

Follow `SpectrumHistorySlab` chunk/freeze patterns, but store three primitive planes once per row. Reuse the existing visual-history chunk-row configuration unless benchmark evidence requires a Stereo Map-specific value.

Do not store Mode, Energy, opacity, validity, or Hold source rows.

**Step 4: Verify**

Run:

```powershell
npm test -- src/lib/StereoMapHistorySlab.test.js src/lib/SpectrumHistorySlab.test.js
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/lib/StereoMapHistorySlab.js src/lib/StereoMapHistorySlab.test.js src/lib/historyChunkConfig.js
git commit -m "feat: store stereo map primitive history"
```

---

### Task 7: Add live and historical Hold indexes

**Files:**

- Create: `src/math/stereoMapHold.js`
- Create: `src/math/stereoMapHold.test.js`
- Modify: `src/lib/StereoMapHistorySlab.js`
- Modify: `src/lib/StereoMapHistorySlab.test.js`

**Step 1: Write failing Hold tests**

For fully valid derived points only, assert:

- Position retains minimum and maximum;
- Correlation retains minimum;
- Mono Loss retains most negative;
- M/S Ratio retains maximum;
- gate-invalid points do not update Hold;
- all modes accumulate even while unselected and while Hold is hidden;
- valid infinities may be retained;
- Global Clear starts a new epoch.

For historical queries, assert:

- sealed chunks retain exact per-band summaries for all modes;
- complete chunks before the target merge summaries;
- the target partial chunk scans only through the selected row;
- no future row contributes;
- an evicted prefix of the oldest partial chunk does not contribute;
- Clear epochs never mix.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/math/stereoMapHold.test.js src/lib/StereoMapHistorySlab.test.js
```

Expected: Hold implementation/index absent.

**Step 3: Implement Hold**

Use `stereoMapMath.js` for every derivation. Store derived summaries only as indexes; primitive arrays remain the source history.

Keep toggle state out of accumulation APIs. Visibility is handled later by rendering.

**Step 4: Verify**

Run:

```powershell
npm test -- src/math/stereoMapHold.test.js src/lib/StereoMapHistorySlab.test.js
```

Expected: all pass without full-history scans for complete chunks.

**Step 5: Commit**

```powershell
git add src/math/stereoMapHold.js src/math/stereoMapHold.test.js src/lib/StereoMapHistorySlab.js src/lib/StereoMapHistorySlab.test.js
git commit -m "feat: index stereo map hold extrema"
```

---

### Task 8: Wire frame intake, snapshots, and no-backfill semantics

**Files:**

- Modify: `src/ipc/types.js`
- Modify: `src/lib/tauriFrameApply.js`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`
- Modify: `src/lib/snapshotResolve.js`
- Modify: `src/runtime/MeterRuntimeContext.jsx`
- Modify: `src/App.jsx`

**Step 1: Write failing intake/snapshot tests**

Cover:

- live result map merges by key;
- visual rows append to one slab per key;
- inactive key slabs remain retained;
- a reactivated key has an interior gap and snapshot resolves that gap to Missing;
- Mode switches reconstruct the same complete retained key without changing rows;
- file timestamps remain media-time timestamps;
- snapshot freeze remains immutable while live intake continues;
- retention change clears/rebuilds Stereo Map history with other histories;
- Global Clear resets slab epochs and live holds.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx
```

Expected: Stereo Map intake and resolver fields are absent.

**Step 3: Implement intake and snapshot resolution**

Add per-key `StereoMapHistorySlab` ownership to `FrameIntake`, typed frame merging, freeze support, and a `resolveStereoMapSnapshotForKey` path that selects primitive rows using existing keyed visual-index semantics before deriving the selected Mode.

Never choose a nearest row across an interior key gap.

**Step 4: Verify**

Run:

```powershell
npm test -- src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/lib/snapshotResolve.test.js
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/ipc/types.js src/lib/tauriFrameApply.js src/lib/FrameIntake.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx src/lib/snapshotResolve.js src/runtime/MeterRuntimeContext.jsx src/App.jsx
git commit -m "feat: integrate stereo map history and snapshots"
```

---

### Task 9: Add normalized Workspace controls and persistence

**Files:**

- Modify: `src/lib/panelControls.js`
- Modify: `src/lib/panelControls.test.js`
- Modify: `src/workspace/types.js`
- Modify: `src/workspace/clampPanelControls.js`
- Modify: `src/workspace/clampPanelControls.test.js`
- Modify: `src/hooks/usePresets.test.jsx`

**Step 1: Write failing control tests**

Add defaults and normalization for:

- Mode = Position;
- pair = existing Vectorscope fallback;
- Hold = off;
- Speed = current Spectrum semantic default;
- Smoothing = 1/12 octave;
- X = 20–20 kHz;
- Mono Loss lower bound = -24 dB with top fixed at 0;
- M/S Ratio = -48 to +24 dB, constrained to include 0.

Test all four modes, valid/invalid legacy values, pair fallback, and preset round trip.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/lib/panelControls.test.js src/workspace/clampPanelControls.test.js src/hooks/usePresets.test.jsx
```

Expected: Stereo Map controls absent.

**Step 3: Implement normalization**

Reuse Vectorscope pair grouping/clamping and existing range-input normalization conventions. Keep Workspace controls independent per panel.

Do not add linked-frequency state in this phase.

**Step 4: Verify**

Run:

```powershell
npm test -- src/lib/panelControls.test.js src/workspace/clampPanelControls.test.js src/hooks/usePresets.test.jsx
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/lib/panelControls.js src/lib/panelControls.test.js src/workspace/types.js src/workspace/clampPanelControls.js src/workspace/clampPanelControls.test.js src/hooks/usePresets.test.jsx
git commit -m "feat: persist stereo map panel controls"
```

---

### Task 10: Build the Workspace panel

**Files:**

- Create: `src/components/panels/StereoMapPanel.jsx`
- Create: `src/components/panels/StereoMapPanel.test.jsx`
- Create: `src/components/panels/StereoMapPlot.jsx`
- Modify: `src/components/PanelSettingsContent.jsx`
- Modify: `src/components/PanelSettingsContent.test.jsx`
- Modify: `src/components/panels/chartHelp.js`
- Modify: `src/math/hoverMath.js`
- Modify: `src/theme/buildThemeTokens.js`
- Modify: `src/index.css`

**Step 1: Write failing component tests**

Test:

- one mode rendered at a time;
- Position labels use selected channel names and `0%`, never `Center`;
- Correlation/Mono Loss/M/S Ratio axis contracts;
- low-energy opacity fade and curve breaks;
- Hold outlines display only when toggled, while hidden accumulation continues;
- frequency hover shows current value, energy, and optional Hold;
- clipped infinities format as `<= bound` or `>= bound`;
- mono, pending, over-cap, stopped, and engine-error states;
- pair/request changes never flash old-key data;
- Mode changes keep the same request key and immediately reuse current/history primitives;
- X and mode-specific Y interactions/reset behavior.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/components/panels/StereoMapPanel.test.jsx src/components/PanelSettingsContent.test.jsx
```

Expected: components/settings absent.

**Step 3: Implement the panel**

Reuse Spectrum frequency-axis interaction, Vectorscope pair semantics/correlation colors, existing signal tokens, and existing panel status patterns.

Keep all metric calculations in `stereoMapMath.js`. The plot receives derived display rows and Hold rows; it does not derive DSP values itself.

Add only required theme tokens. Do not introduce a new typography scale.

**Step 4: Verify**

Run:

```powershell
npm test -- src/components/panels/StereoMapPanel.test.jsx src/components/PanelSettingsContent.test.jsx src/math/hoverMath.test.js
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/components/panels/StereoMapPanel.jsx src/components/panels/StereoMapPanel.test.jsx src/components/panels/StereoMapPlot.jsx src/components/PanelSettingsContent.jsx src/components/PanelSettingsContent.test.jsx src/components/panels/chartHelp.js src/math/hoverMath.js src/theme/buildThemeTokens.js src/index.css
git commit -m "feat: add stereo map workspace panel"
```

---

### Task 11: Register the Workspace panel without changing defaults

**Files:**

- Modify: `src/workspace/registry.jsx`
- Modify: `src/workspace/constants.js`
- Modify: `src/workspace/constants.test.js`
- Modify: `src/workspace/panelInstances.test.js`
- Modify: `src/workspace/reducer-tree.test.js`
- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/App.smoke.test.jsx`

**Step 1: Write failing registration tests**

Assert:

- Add Panel lists Stereo Map immediately after Waveform;
- adding it creates an independent panel instance;
- duplicate instances have independent controls;
- default/reset Workspace remains unchanged and does not include Stereo Map;
- persisted Stereo Map instances survive normalization.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/workspace/constants.test.js src/workspace/panelInstances.test.js src/workspace/reducer-tree.test.js src/App.smoke.test.jsx
```

Expected: module absent.

**Step 3: Register the panel**

Add the registry entry in the required insertion order. Add the module to the set of known/addable module IDs while leaving default tree/panel/order constants unchanged.

Wire panel data/status through the existing `LeafView` registry path.

**Step 4: Verify**

Run:

```powershell
npm test -- src/workspace/constants.test.js src/workspace/panelInstances.test.js src/workspace/reducer-tree.test.js src/App.smoke.test.jsx
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/workspace/registry.jsx src/workspace/constants.js src/workspace/constants.test.js src/workspace/panelInstances.test.js src/workspace/reducer-tree.test.js src/workspace/LeafView.jsx src/App.smoke.test.jsx
git commit -m "feat: register stereo map workspace module"
```

---

### Task 12: Add the Dock module and request merge

**Files:**

- Create: `src/dock/modules/DockStereoMap.jsx`
- Create: `src/dock/modules/DockStereoMap.test.jsx`
- Modify: `src/dock/registry.jsx`
- Modify: `src/dock/dockLayout.js`
- Modify: `src/dock/dockPanelSizing.js`
- Modify: `src/dock/dockModuleControls.js`
- Modify: `src/dock/dockModuleControls.test.js`
- Modify: `src/dock/dockAnalysisRequest.js`
- Modify: `src/dock/dockAnalysisRequest.test.js`
- Modify: `src/dock/editors/DockModuleSettings.jsx`
- Modify: `src/App.jsx`

**Step 1: Write failing Dock tests**

Assert:

- module appears after Waveform but is disabled by default;
- size policy is min 180/default 360/flexible;
- compact output has curve/baseline/fill/Hold only;
- no full axes, hover, wheel, pan, or snapshot interaction;
- Dock controls persist independently from Workspace controls;
- matching Pair + Speed + Smoothing deduplicates with Workspace;
- Dock ranges do not enter the key;
- mono/pending placeholders render compactly.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/dock/modules/DockStereoMap.test.jsx src/dock/dockModuleControls.test.js src/dock/dockAnalysisRequest.test.js
```

Expected: Dock module and merge path absent.

**Step 3: Implement Dock integration**

Add a compact renderer using the same derived metric/hold helpers. Add Dock Editor controls in the approved order and merge Dock requests before applying the independent Stereo Map cap.

Do not add linked frequency controls.

**Step 4: Verify**

Run:

```powershell
npm test -- src/dock/modules/DockStereoMap.test.jsx src/dock/dockModuleControls.test.js src/dock/dockAnalysisRequest.test.js
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/dock/modules/DockStereoMap.jsx src/dock/modules/DockStereoMap.test.jsx src/dock/registry.jsx src/dock/dockLayout.js src/dock/dockPanelSizing.js src/dock/dockModuleControls.js src/dock/dockModuleControls.test.js src/dock/dockAnalysisRequest.js src/dock/dockAnalysisRequest.test.js src/dock/editors/DockModuleSettings.jsx src/App.jsx
git commit -m "feat: add stereo map dock module"
```

---

### Task 13: Extend deterministic history and mixed-load benchmarks

**Files:**

- Modify: `scripts/history-perf-benchmark.mjs`
- Modify: `src/dev/historyPerformanceHarness.js`
- Modify: `src/dev/historyPerformanceHarness.test.js`

**Step 1: Add failing structural benchmark tests**

Cover:

- one and four Stereo Map keys;
- 30/60/120/240-minute retention;
- exact retained-byte projection for three Float32 primitive planes plus Float64 timestamps;
- Mode switching over retained live/file rows without new allocations proportional to full history;
- snapshot freeze/lookup;
- historical Hold query using chunk summaries;
- mixed four Spectrum plus four Stereo Map keys;
- frame-intake call counts and no per-tick JS-array/object primary storage.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/dev/historyPerformanceHarness.test.js
```

Expected: Stereo Map benchmark cases absent.

**Step 3: Implement benchmark support**

Report retained bytes, freeze cost, lookup cost, Hold query cost, and intake work. Keep automated pass/fail checks structural and count-based; print timing for manual comparison only.

Do not reduce cadence, grid size, or precision to make the benchmark smaller.

**Step 4: Verify**

Run:

```powershell
npm test -- src/dev/historyPerformanceHarness.test.js
npm run benchmark:history
npm run benchmark:history:full
```

Expected: structural assertions pass and the deliberate memory cost is reported.

**Step 5: Commit**

```powershell
git add scripts/history-perf-benchmark.mjs src/dev/historyPerformanceHarness.js src/dev/historyPerformanceHarness.test.js
git commit -m "perf: benchmark stereo map history workloads"
```

---

### Task 14: Final repository and desktop verification

**Files:**

- Modify only if verification exposes a defect directly caused by Stereo Map.

**Step 1: Run targeted frontend and Rust suites**

Run:

```powershell
npm test -- src/math/stereoMapMath.test.js src/math/stereoMapHold.test.js src/lib/StereoMapHistorySlab.test.js src/lib/FrameIntake.test.js src/components/panels/StereoMapPanel.test.jsx src/dock/modules/DockStereoMap.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml stereo_map
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline
```

Expected: all pass.

**Step 2: Run the merge gate**

Run:

```powershell
npm run check
```

Expected: exit code 0.

**Step 3: Run file and real-capture validation**

Run:

```powershell
npm run smoke:file-analysis
npm run smoke:capture
```

Expected: both pass. Do not bypass a red capture smoke.

**Step 4: Perform desktop behavior checks**

Run:

```powershell
npm run desktop
```

Verify on Windows and, before integration, macOS:

- all four modes and reference cases;
- pair changes and mono input;
- Workspace/Dock dedupe and independent controls;
- Mode changes with no pending flash or history gap;
- Hold hidden/visible behavior and Global Clear;
- live/file/snapshot transitions;
- multiple high-load panel instances.

**Step 5: Run/record the soak**

Run:

```powershell
npm run soak:capture
```

Expected: four-hour capture completes or any leak/metric-drift lead is recorded.

**Step 6: Inspect scope**

Run:

```powershell
git status --short
git diff --stat
```

Expected: no linked-frequency implementation has leaked into this phase.

## Completion checklist

- Four approved modes match all reference vectors and boundary states.
- Rust publishes finite `PL`/`PR`/real-`C` primitives only.
- Mode, Hold, and ranges do not affect request keys or restart DSP.
- Live and file history preserve every emitted Float32 primitive row.
- Any mode reconstructs the retained interval without reanalysis.
- Historical Hold excludes future, evicted-prefix, and pre-Clear rows.
- Workspace and Dock share matching analysis keys but keep controls independent.
- Four-request cap and mixed four-plus-four workload pass structural/performance gates.
- `npm run check`, file smoke, capture smoke, and soak follow-up are complete.
