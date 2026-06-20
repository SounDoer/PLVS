# Per-instance Panel Controls and Analysis Requests Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. Keep each task independently reviewable.

**Goal:** Make every panel instance own its header chip state, persist that state
in the workspace and presets, and make backend analysis support multiple
simultaneous Spectrum/Vectorscope-style requests through deduplicated request
keys.

**Architecture:** Replace global workspace `panelControls` with
`panelControlsById`. Derive a deterministic active analysis request set from
visible panel instances and their controls. Backend computes at most one result
per unique request key and returns result maps keyed by request key. History for
Spectrum/Spectrogram and Vectorscope is also keyed by request key.

**Tech Stack:** React/JSX, workspace reducer/tree utilities, domain stores,
Tauri IPC, Rust DSP pipeline, Vitest, Rust tests.

**Spec:** `docs/superpowers/specs/2026-06-20-per-instance-panel-controls-and-analysis-requests-design.md`

---

## File Structure

Likely new files:

- `src/workspace/panelControlInstances.js`
- `src/workspace/panelControlInstances.test.js`
- `src/analysis/analysisRequests.js`
- `src/analysis/analysisRequests.test.js`
- Rust request model module, likely `src-tauri/src/engine/analysis_requests.rs`

Likely modified frontend files:

- `src/workspace/types.js`
- `src/workspace/constants.js`
- `src/workspace/reducer.js`
- `src/workspace/WorkspaceContext.jsx`
- `src/workspace/LeafView.jsx`
- `src/workspace/SplitLayout.jsx`
- `src/hooks/usePresets.js`
- `src/hooks/useAudioEngine.js` or equivalent backend sync owner
- `src/lib/panelControls.js`
- `src/lib/FrameIntake.js`
- `src/hooks/useSnapshot.js`
- `src/workspace/AudioDataContext.jsx`
- `src/components/PanelHeaderControls.jsx`
- `src/components/panels/SpectrumPanel.jsx`
- `src/components/panels/SpectrogramPanel.jsx`
- `src/components/panels/VectorscopePanel.jsx`
- `src/components/panels/PeakPanel.jsx`
- `src/components/panels/LoudnessPanel.jsx`
- `src/components/panels/LoudnessStatsPanel.jsx`

Likely modified Rust files:

- `src-tauri/src/state.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/ipc/commands.rs`
- `src-tauri/src/ipc/types.rs`
- `src-tauri/src/engine/meter_pipeline.rs`
- `src-tauri/src/audio/capture.rs`
- `src-tauri/src/audio/cpal_backend.rs`
- `src-tauri/src/audio/platform_backend.rs`
- platform-specific capture files that pass global spectrum/vectorscope state

---

## Task 1: Add per-instance panel controls to workspace state

**Files:**
- Modify: `src/workspace/types.js`
- Modify: `src/workspace/constants.js`
- Modify: `src/workspace/reducer.js`
- Modify: `src/workspace/WorkspaceContext.jsx`
- Add: `src/workspace/panelControlInstances.js`
- Add: `src/workspace/panelControlInstances.test.js`
- Modify tests:
  - `src/workspace/constants.test.js`
  - `src/workspace/reducer-tree.test.js`
  - `src/workspace/WorkspaceContext.test.jsx`

- [ ] **Step 1: Define the new workspace shape**

Replace workspace-level live controls:

```js
panelControls
```

with:

```js
panelControlsById: Record<PanelId, PanelControls>
```

`DEFAULT_PANEL_CONTROLS` remains the normalization/default template, not live
global state.

- [ ] **Step 2: Add helpers**

Create helpers:

```js
export function createDefaultPanelControls()
export function normalizePanelControlsById(panelsById, panelControlsById)
export function getPanelControls(state, panelId)
export function setPanelControlsForId(state, panelId, panelControls)
export function removePanelControlsForId(state, panelId)
```

Rules:

- missing controls normalize to `DEFAULT_PANEL_CONTROLS`;
- controls exist only for existing panel ids;
- old global `panelControls` is ignored;
- no migration from old state is required.

- [ ] **Step 3: Initialize controls on add**

`ADD_PANEL` creates:

```js
panelControlsById[id] = normalizePanelControls({})
```

Do not copy controls from an existing sibling instance.

- [ ] **Step 4: Delete controls on remove**

`REMOVE_PANEL` deletes:

```js
panelControlsById[id]
```

- [ ] **Step 5: Replace `SET_PANEL_CONTROLS`**

Replace global update with per-panel action:

```js
SET_PANEL_CONTROLS_FOR_PANEL { id, panelControls }
```

Manual per-instance control changes must clear `presetsStore.activeId`.

- [ ] **Step 6: Update `SET_VIEW`**

Preset/apply view state must restore:

```js
tree
panelsById
panelOrder
panelControlsById
fullscreenId: null
```

Malformed/missing `panelControlsById` resets or defaults by panel id. No old
`panelControls` migration.

- [ ] **Step 7: Test**

Cover:

- defaults include `panelControlsById`;
- adding a duplicate panel creates independent default controls;
- updating one panel's controls does not change sibling controls;
- removing a panel removes its controls;
- `SET_VIEW` restores `panelControlsById`;
- old global-only shape resets to defaults or initializes defaults.

---

## Task 2: Wire per-instance controls through rendering

**Files:**
- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/workspace/SplitLayout.jsx`
- Modify: `src/workspace/AudioDataContext.jsx`
- Modify: `src/components/PanelHeaderControls.jsx`
- Modify panel tests and header-control tests

- [ ] **Step 1: Pass panel id to panel/header surfaces**

`LeafView` already knows the active panel id. Use it to resolve:

```js
panelControls = getPanelControls(state, activePanelId)
onPanelControlsChange = (next) => setPanelControlsForPanel(activePanelId, next)
```

`PanelHeaderControls.activeTab` still receives the module id for routing.

- [ ] **Step 2: Pass panel controls to panel bodies**

Each panel body should receive or read the controls for its own panel id.

Avoid relying on a global `audioData.panelControls`.

- [ ] **Step 3: Update pure frontend controls**

These should work immediately after this task without backend changes:

- Level Meter `levelMeterMode`;
- Loudness History layer visibility;
- Loudness Stats visible/order;
- Spectrum `spectrumPeakHold` display toggle if current payload still contains
  peak data.

- [ ] **Step 4: Keep backend-affecting chips visually independent**

Spectrum/Spectrogram channel, Spectrum view, and Vectorscope pair can be stored
per instance now, but until backend request maps land they may still read the
legacy global frame result. Mark tests accordingly so this is an intermediate
implementation state, not final behavior.

- [ ] **Step 5: Test**

Cover:

- two Level Meter panels can show different `Peak/M/ST` modes;
- two Loudness panels can show different layer sets;
- two Loudness Stats panels can show different order/visibility;
- changing one panel's header chip does not update sibling controls;
- custom presets clear active status on per-instance control change.

---

## Task 3: Save and restore per-instance controls in presets

**Files:**
- Modify: `src/hooks/usePresets.js`
- Modify: `src/hooks/usePresets.test.jsx`
- Modify docs if needed

- [ ] **Step 1: Capture `panelControlsById`**

Preset snapshots include:

```js
tree
panelsById
panelOrder
panelControlsById
windowBounds?
windowPinned?
focusView?
```

Do not capture global `panelControls`.

- [ ] **Step 2: Apply `panelControlsById`**

Preset apply restores per-instance controls exactly, then workspace rendering
uses those controls to derive chips and analysis requests.

- [ ] **Step 3: Test**

Cover:

- save captures distinct Level Meter modes for duplicate panels;
- apply restores distinct controls;
- save/apply does not require old `panelControls`;
- applying old/malformed preset without `panelControlsById` defaults or resets
  according to the no-migration rule.

---

## Task 4: Derive frontend analysis request keys

**Files:**
- Add: `src/analysis/analysisRequests.js`
- Add: `src/analysis/analysisRequests.test.js`
- Modify: `src/workspace/LeafView.jsx` or backend sync owner
- Modify: `src/lib/panelControls.js` if helper normalization is needed

- [ ] **Step 1: Define request key builders**

Create pure functions:

```js
export function spectrumRequestKeyFromControls(panelControls)
export function vectorscopeRequestKeyFromControls(panelControls)
export function deriveAnalysisRequests(workspaceState)
```

Key forms:

```txt
spectrum:pair:<x>:<y>:combined
spectrum:pair:<x>:<y>:lr
spectrum:pair:<x>:<y>:ms
spectrum:single:<ch>:combined
vectorscope:pair:<x>:<y>
```

- [ ] **Step 2: Derive only from visible/current panels**

Requests should be derived from panels currently present in the workspace tree,
not from stale `panelsById` entries alone.

Spectrum and Spectrogram both produce spectrum-like requests. Level Meter,
Loudness, Loudness Stats, and Waveform do not produce backend requests in this
slice.

- [ ] **Step 3: Deduplicate requests**

Output:

```js
{
  spectrumRequests: [{ key, channel, view, panelIds }],
  vectorscopeRequests: [{ key, pair, panelIds }],
  inactivePanelRequestsById?: ...
}
```

The same key appears once even if multiple panels use it.

- [ ] **Step 4: Apply caps deterministically**

Initial caps:

```txt
max spectrum-like requests: 4
max vectorscope requests: 4
```

Ordering is deterministic by `panelOrder`. Over-cap panels retain controls but
are marked with:

```txt
Too many active analysis views
```

- [ ] **Step 5: Test**

Cover:

- duplicate Spectrum panels with same controls produce one request;
- different Spectrum controls produce multiple requests;
- Spectrogram participates in spectrum-like requests;
- peak hold does not change the request key;
- vectorscope pair produces a vectorscope key;
- over-cap requests are deterministic and panel-specific.

---

## Task 5: Sync active request set to backend

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/ipc/commands.rs`
- Modify frontend backend-command owner
- Add/modify IPC tests

- [ ] **Step 1: Add Rust request structs**

Define Rust-side request types:

```rust
SpectrumAnalysisRequest { key, channel, view }
VectorscopeAnalysisRequest { key, x, y }
AnalysisRequests { spectrum, vectorscope }
```

Requests should be normalized/clamped against channel count later in the
pipeline, but malformed IPC input should still be rejected early.

- [ ] **Step 2: Add aggregate IPC command**

Add:

```rust
set_analysis_requests(requests, state)
```

The command replaces active request state atomically.

- [ ] **Step 3: Store request set in `AppState`**

Replace or supplement:

```rust
vectorscope_pair
spectrum_channel
spectrum_view
```

with:

```rust
analysis_requests: Arc<Mutex<AnalysisRequests>>
```

Keep old global commands temporarily if needed for compatibility, but new UI
should call the aggregate command.

- [ ] **Step 4: Frontend sync effect**

Derive active requests from workspace state and send the aggregate request set
while capture is running, and also when controls/layout/preset state changes.

Avoid sending duplicate IPC calls for identical request sets.

- [ ] **Step 5: Test**

Cover:

- IPC accepts valid spectrum/vectorscope requests;
- IPC rejects malformed key/channel/view payloads;
- frontend sync sends deduped requests;
- frontend sync sends empty arrays when no Spectrum/Spectrogram/Vectorscope
  panels are active.

---

## Task 6: Compute multiple request results in `MeterPipeline`

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src-tauri/src/dsp/spectrum.rs` if helper APIs are needed
- Modify: `src-tauri/src/dsp/vectorscope.rs` if helper APIs are needed
- Modify capture backends that pass request state into the pipeline
- Add Rust tests

- [ ] **Step 1: Replace single Spectrum/Vectorscope state**

Current pipeline owns:

```rust
spectrum: SpectrumMeter
vectorscope: VectorscopeMeter
last_spectrum_channel
```

Target:

```rust
spectrum_meters_by_key: HashMap<String, SpectrumMeter>
vectorscope_meters_by_key: HashMap<String, VectorscopeMeter>
```

- [ ] **Step 2: Reconcile active requests each push**

On each `push_pcm`, compare active request keys to existing meter maps:

- create meters for new keys;
- retain meters for active keys;
- stop pushing inactive keys;
- do not immediately delete inactive history at this stage unless memory caps
  require it.

- [ ] **Step 3: Push PCM once per active unique request**

For each active Spectrum request, push selected PCM into that request's
`SpectrumMeter`.

For each active Vectorscope request, push selected pair into that request's
`VectorscopeMeter`.

Shared peak/loudness pipeline remains global.

- [ ] **Step 4: Keep request-level resets correct**

Changing a request key creates a new meter. Existing meters for other keys do
not reset.

Clear resets all active and retained request meters.

- [ ] **Step 5: Test**

Cover:

- two distinct Spectrum requests produce two distinct outputs in one frame;
- two panels sharing one key do not create duplicate meters;
- changing one Spectrum request does not reset another request;
- vectorscope pair requests are independent;
- empty request set avoids Spectrum/Vectorscope work.

---

## Task 7: Change realtime payload to result maps

**Files:**
- Modify: `src-tauri/src/ipc/types.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/workspace/AudioDataContext.jsx`
- Modify Spectrum/Vectorscope/Spectrogram panels
- Modify tests

- [ ] **Step 1: Add result map fields**

Add fields conceptually like:

```rust
spectrum_results_by_key: HashMap<String, SpectrumFrameResult>
vectorscope_results_by_key: HashMap<String, VectorscopeFrameResult>
```

Result structs contain the fields currently used by single global payloads.

- [ ] **Step 2: Keep legacy fields temporarily if practical**

During transition, keep existing single-result fields populated from the first
active request to reduce blast radius. Remove them only after all frontend reads
are migrated.

- [ ] **Step 3: Frontend intake stores maps**

`FrameIntake` should retain result maps for live snapshots. Avoid duplicating
large arrays per panel id; store by request key.

- [ ] **Step 4: Panels read by request key**

Spectrum/Spectrogram/Vectorscope panels derive their request key from their own
controls and read:

```js
displayAudio.spectrumResultsByKey[key]
displayAudio.vectorscopeResultsByKey[key]
```

If the panel is over-cap, show `Too many active analysis views`.

If the panel is live and the request has no result yet, show pending/no-data
treatment.

- [ ] **Step 5: Test**

Cover:

- frontend maps frame results by key;
- Spectrum panel uses its panel's key;
- two Spectrum panels can render different request results;
- Vectorscope panel uses its panel's key;
- over-cap panel does not accidentally show another request's result.

---

## Task 8: Add request-keyed history and snapshot behavior

**Files:**
- Modify: `src-tauri/src/ipc/types.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/lib/snapshotResolve.js`
- Modify Spectrum/Spectrogram/Vectorscope panels
- Modify tests

- [ ] **Step 1: Extend visual history entries**

Current history entries contain one spectrum/vectorscope result. Add request-key
dimensions:

```js
spectrumHistoryByKey
vectorscopeHistoryByKey
```

or equivalent compact serialized shape.

- [ ] **Step 2: Store history only for active request keys**

When a request first appears at `t=10:05`, its history starts at `10:05`. Do not
backfill.

- [ ] **Step 3: Retain inactive request history temporarily**

When a chip switch makes a request inactive:

- stop realtime calculation if no panel uses it;
- keep its existing history in the in-memory history window;
- allow snapshot to show that history if a panel switches back.

Clear removes active and inactive request history.

- [ ] **Step 4: Snapshot lookup by current panel key**

In snapshot mode, derive the panel's current request key and look up the nearest
history entry for that key.

If the selected timestamp predates that request history, show:

```txt
No data for this view at selected time
```

- [ ] **Step 5: Test**

Cover:

- new request has no history before its creation time;
- switching back to an old request can show retained old history;
- clear removes retained inactive request history;
- snapshot empty state appears for missing request history;
- Spectrogram history does not show another request's history.

---

## Task 9: Apply request caps and empty states in UI

**Files:**
- Modify: `src/analysis/analysisRequests.js`
- Modify: relevant panels
- Modify: `src/components/PanelHeaderControls.jsx` if chip state needs status
- Add/modify tests

- [ ] **Step 1: Surface over-cap status per panel**

Request derivation should expose:

```js
analysisStatusByPanelId[panelId] = "active" | "overCap" | "none"
```

- [ ] **Step 2: Render over-cap state**

Panels with over-cap backend requests show:

```txt
Too many active analysis views
```

Do not mutate their controls.

- [ ] **Step 3: Render missing snapshot history state**

Panels whose current request has no history at the selected snapshot timestamp
show:

```txt
No data for this view at selected time
```

- [ ] **Step 4: Test**

Cover:

- cap applies to unique request keys, not panel count;
- panels sharing a request do not count multiple times;
- preset restore can leave panels over cap without changing controls;
- over-cap panel does not send additional backend work;
- snapshot missing-history state is distinct from over-cap state.

---

## Task 10: Remove legacy global backend control dependencies

**Files:**
- Modify frontend backend command code
- Modify Rust command registrations if ready
- Modify tests

- [ ] **Step 1: Stop calling global spectrum/vectorscope commands**

Remove UI usage of:

```txt
set_spectrum_channel
set_spectrum_view
set_vectorscope_pair
```

New panel header chip changes update workspace `panelControlsById`; request sync
effect sends the aggregate active request set.

- [ ] **Step 2: Decide whether old IPC commands remain**

For v1, old IPC commands may stay registered but unused. Removing them is a
cleanup task only if tests and platform code make it low risk.

- [ ] **Step 3: Test no accidental global coupling**

Cover:

- changing Spectrum 1 does not change Spectrum 2 request key;
- changing Vectorscope 1 does not change Vectorscope 2 request key;
- backend state receives both requests simultaneously.

---

## Task 11: Verification

- [ ] **Step 1: Run targeted frontend tests**

```bash
npm test -- src/workspace src/analysis src/hooks/usePresets.test.jsx src/components/PanelHeaderControls.test.jsx
```

- [ ] **Step 2: Run targeted Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml analysis_requests
cargo test --manifest-path src-tauri/Cargo.toml meter_pipeline
```

- [ ] **Step 3: Run full test gates**

```bash
npm test
npm run lint
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

- [ ] **Step 4: Desktop manual QA**

Run desktop app and verify:

- two Level Meter panels hold different `Peak/M/ST` modes;
- two Loudness panels hold different layer visibility;
- two Loudness Stats panels hold different metric order/visibility;
- two Spectrum panels show different channel/view results live;
- two Vectorscope panels show different pair results live;
- two panels with the same Spectrum request share result without duplicate work;
- deleting a panel removes its request when no other panel uses it;
- switching chip starts new history only from switch time;
- switching back to a recent old request can show retained old history;
- snapshot before request creation shows `No data for this view at selected time`;
- more than four unique Spectrum-like requests shows over-cap state for extras;
- preset save/apply restores per-instance controls and over-cap states;
- Clear clears active and inactive request history.

---

## Self-review notes

- **Highest-risk area:** request-keyed history. Realtime result maps are
  straightforward compared with snapshot behavior and memory caps.
- **Do not key DSP by panel id.** Key by normalized request key so identical
  panels share computation and history.
- **Do not backfill.** New requests collect history only from the moment they
  become active.
- **Do not mutate controls on over-cap.** The user/preset state remains intact;
  only analysis availability changes.
- **Keep intermediate commits reviewable.** Frontend per-instance controls can
  land before backend request maps, but the final feature is not complete until
  Spectrum/Vectorscope realtime and history are request-keyed.
