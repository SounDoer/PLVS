# Optional Linked Frequency Viewport Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Let eligible Workspace frequency panels optionally share one persisted logarithmic frequency range without changing DSP, history, snapshots, hover synchronization, or Dock controls.

**Architecture:** Workspace state owns one dormant-or-active `frequencyViewport` and each eligible panel owns a `linkFrequencyRange` membership flag plus its dormant local range. Semantic reducer actions perform join, leave, and shared-range updates atomically. Spectrum X, Spectrogram frequency Y, and Stereo Map X consume one effective-range adapter; Dock remains screened out.

**Tech Stack:** React 19, Workspace reducer/context, existing persistence and preset hooks, Vitest/Testing Library, existing logarithmic axis interaction helpers.

**Depends on:** `docs/superpowers/plans/2026-07-25-stereo-map-implementation.md`

**Design:** `docs/superpowers/specs/2026-07-25-linked-frequency-viewport-design.md`

## Preconditions and invariants

- Stereo Map must already exist with its own local X-range controls.
- Linking is Workspace-only and defaults off for new and migrated panels.
- Do not add `frequencyViewport` to session runtime, backend requests, history keys, snapshot selection, or Dock state.
- Do not persist a separate global enabled flag; derive participation from eligible panel instances.
- While linked, preserve dormant local ranges unchanged.
- Join, leave, and preset apply must be atomic reducer operations.
- Render-only source/Nyquist clamping must never mutate the persisted local/shared range.
- Hover markers stay panel-local.
- Each task defines a focused commit checkpoint. Run its commit step only when the user has explicitly authorized commits; otherwise leave the verified changes uncommitted.

---

### Task 1: Centralize frequency-range normalization

**Files:**

- Create: `src/workspace/frequencyViewport.js`
- Create: `src/workspace/frequencyViewport.test.js`
- Modify: `src/lib/panelControls.js`
- Modify: `src/lib/panelControls.test.js`

**Step 1: Write failing pure-function tests**

Specify one authoritative persisted-range normalization:

- absolute range 20 Hz–20 kHz;
- finite ascending values;
- logarithmic minimum span of one octave;
- invalid legacy values normalize without altering valid custom ranges.

Specify render-only source clamping:

```text
effectiveMax = min(persistedMax, supportedMax)
supportedMax >= 40  -> lower min as needed so min <= max / 2
20 < supportedMax < 40 -> [20, supportedMax]
supportedMax <= 20 -> no-frequency-data
```

Include the design example where a persisted 10–20 kHz view on an 8 kHz source renders as 4–8 kHz.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/workspace/frequencyViewport.test.js
```

Expected: module missing.

**Step 3: Implement pure helpers**

Export:

```js
normalizeFrequencyViewport(raw)
clampFrequencyRangeForRender(range, supportedMaxHz)
getLocalFrequencyRangeKeys(moduleId)
isFrequencyLinkEligible(moduleId)
countLinkedParticipants(state, excludingPanelId?)
resolveEffectiveFrequencyRange(state, panelId)
```

Move or delegate the existing Workspace log-range normalization from `panelControls.js` so local and shared ranges cannot drift. Preserve Dock's existing independent normalization behavior.

**Step 4: Add the migrated control default**

Add `linkFrequencyRange: false` to normalized eligible Workspace panel controls. For ineligible modules, ignore/remove legacy link values.

**Step 5: Verify**

Run:

```powershell
npm test -- src/workspace/frequencyViewport.test.js src/lib/panelControls.test.js
```

Expected: all pass.

**Step 6: Commit**

```powershell
git add src/workspace/frequencyViewport.js src/workspace/frequencyViewport.test.js src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "feat: normalize linked frequency ranges"
```

---

### Task 2: Add persisted Workspace state and migration

**Files:**

- Modify: `src/workspace/types.js`
- Modify: `src/workspace/constants.js`
- Modify: `src/workspace/WorkspaceContext.jsx`
- Modify: `src/workspace/WorkspaceContext.test.jsx`

**Step 1: Write failing migration and persistence tests**

Cover:

- new Workspace default has `{ minHz: 20, maxHz: 20000 }`;
- legacy Workspace without the field normalizes to that default;
- existing valid local Spectrum/Spectrogram/Stereo Map ranges stay unchanged;
- link flags default false;
- shared viewport survives localStorage round trip;
- unknown/removed panels do not count as participants.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/workspace/WorkspaceContext.test.jsx
```

Expected: `frequencyViewport` absent from owned state.

**Step 3: Implement state ownership**

Extend `WorkspaceState`, `DEFAULT_WORKSPACE_STATE`, `ownedWorkspaceState`, and `initState` normalization.

Persist:

```js
frequencyViewport: {
  (minHz, maxHz);
}
```

Do not create a separate persistence domain or schema version unless existing migration tests prove one is required; `workspaceStore` already owns the whole Workspace state.

**Step 4: Verify**

Run:

```powershell
npm test -- src/workspace/WorkspaceContext.test.jsx src/workspace/constants.test.js
```

Expected: all pass and legacy workspaces remain visually unchanged.

**Step 5: Commit**

```powershell
git add src/workspace/types.js src/workspace/constants.js src/workspace/WorkspaceContext.jsx src/workspace/WorkspaceContext.test.jsx
git commit -m "feat: persist workspace frequency viewport"
```

---

### Task 3: Implement atomic reducer actions

**Files:**

- Modify: `src/workspace/reducer.js`
- Modify: `src/workspace/reducer.test.js`
- Modify: `src/workspace/reducer-tree.test.js`
- Modify: `src/workspace/WorkspaceContext.jsx`

**Step 1: Write failing reducer tests**

Define semantic actions:

```text
SET_FREQUENCY_VIEWPORT
JOIN_LINKED_FREQUENCY_VIEWPORT
LEAVE_LINKED_FREQUENCY_VIEWPORT
```

Test:

- first join initializes shared viewport from normalized local range and sets membership in one state transition;
- later join keeps shared viewport and only enables membership;
- leave copies current shared range to the panel's local fields and disables membership atomically;
- unlinking/deleting the final member leaves dormant shared state;
- a later first join ignores dormant shared state and reinitializes from its local range;
- removing one of several participants leaves the others unchanged;
- adding an eligible panel starts unlinked;
- ineligible/unknown panels cannot join;
- `SET_VIEW` and reset normalize/replace the complete viewport atomically.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/workspace/reducer.test.js src/workspace/reducer-tree.test.js
```

Expected: actions absent.

**Step 3: Implement reducer semantics**

Normalize all input inside the reducer helper. Use `getLocalFrequencyRangeKeys(moduleId)` so the three panel types do not duplicate field mapping.

Expose bound Workspace actions and wrap them with the same preset-dirty behavior as existing panel-control mutations.

Do not coordinate join/leave through multiple component callbacks.

**Step 4: Verify**

Run:

```powershell
npm test -- src/workspace/reducer.test.js src/workspace/reducer-tree.test.js src/workspace/WorkspaceContext.test.jsx
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/workspace/reducer.js src/workspace/reducer.test.js src/workspace/reducer-tree.test.js src/workspace/WorkspaceContext.jsx
git commit -m "feat: add atomic frequency-link actions"
```

---

### Task 4: Add one panel-facing effective-range adapter

**Files:**

- Create: `src/hooks/useLinkedFrequencyRange.js`
- Create: `src/hooks/useLinkedFrequencyRange.test.js`
- Create: `src/workspace/LeafView.test.jsx`
- Create: `src/workspace/SplitLayout.test.jsx`
- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/workspace/SplitLayout.jsx`

**Step 1: Write failing hook tests**

For eligible modules, assert the adapter returns:

```js
{
  minHz,
  maxHz,
  isLinked,
  supportedRange,
  updateRange,
  resetRange,
  join,
  leave,
}
```

Test:

- unlinked reads/writes local fields;
- linked reads/writes shared viewport;
- reset writes 20–20 kHz to the correct owner;
- source clamp affects returned render range only;
- persisted state remains unchanged by lower source support;
- fullscreen/focus/layout changes do not affect membership.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/hooks/useLinkedFrequencyRange.test.js
```

Expected: hook absent.

**Step 3: Implement the adapter and wiring**

Pass resolved range/link callbacks through the existing panel instance data path for normal and fullscreen rendering.

Keep panel components unaware of persistence and reducer details.

**Step 4: Verify**

Run:

```powershell
npm test -- src/hooks/useLinkedFrequencyRange.test.js src/workspace/LeafView.test.jsx src/workspace/SplitLayout.test.jsx
```

Expected: all existing layout behavior passes.

**Step 5: Commit**

```powershell
git add src/hooks/useLinkedFrequencyRange.js src/hooks/useLinkedFrequencyRange.test.js src/workspace/LeafView.jsx src/workspace/LeafView.test.jsx src/workspace/SplitLayout.jsx src/workspace/SplitLayout.test.jsx
git commit -m "feat: resolve effective panel frequency ranges"
```

---

### Task 5: Link Spectrum X-axis interactions

**Files:**

- Modify: `src/components/panels/SpectrumPanel.jsx`
- Modify: `src/components/panels/SpectrumPanel.test.jsx`

**Step 1: Write failing panel tests**

Assert that, when linked:

- wheel zoom updates only `workspace.frequencyViewport`;
- drag pan and axis-track interaction update shared state;
- settings/reset callback updates shared state;
- dormant `spectrumXMinFreq`/`spectrumXMaxFreq` remain unchanged;
- source clamp renders a usable one-octave span where possible without dispatching a write;
- changing viewport does not change the Spectrum Analysis Key or pending state.

Repeat key interactions unlinked and assert only local fields change.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/components/panels/SpectrumPanel.test.jsx
```

Expected: linked callbacks are not consumed.

**Step 3: Route Spectrum through the adapter**

Replace direct local-range reads/writes with the effective range and update/reset callbacks. Keep all non-frequency controls and hover state local.

**Step 4: Verify**

Run:

```powershell
npm test -- src/components/panels/SpectrumPanel.test.jsx src/analysis/analysisRequestKeyFormat.test.js
```

Expected: interaction tests and request-key regressions pass.

**Step 5: Commit**

```powershell
git add src/components/panels/SpectrumPanel.jsx src/components/panels/SpectrumPanel.test.jsx
git commit -m "feat: link spectrum frequency navigation"
```

---

### Task 6: Link Spectrogram frequency-Y interactions

**Files:**

- Modify: `src/components/panels/SpectrogramPanel.jsx`
- Modify: `src/components/panels/SpectrogramPanel.test.jsx`

**Step 1: Write failing panel tests**

Cover every frequency-Y mutation path:

- chart wheel;
- drag pan;
- axis-track interaction;
- settings update;
- axis reset.

When linked, each updates the same numeric `{ minHz, maxHz }` shared viewport used by Spectrum despite the vertical orientation. Time X-axis state remains untouched.

Assert hover uses the render-clamped range but remains panel-local.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/components/panels/SpectrogramPanel.test.jsx
```

Expected: direct local Y-range writes fail linked assertions.

**Step 3: Route Spectrogram through the adapter**

Use the effective numeric range for ticks, band mapping, wheel, pan, and hover. Do not invert the persisted min/max meaning for a vertical axis.

**Step 4: Verify**

Run:

```powershell
npm test -- src/components/panels/SpectrogramPanel.test.jsx src/math/spectrogramMath.test.js
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/components/panels/SpectrogramPanel.jsx src/components/panels/SpectrogramPanel.test.jsx
git commit -m "feat: link spectrogram frequency navigation"
```

---

### Task 7: Link Stereo Map X-axis interactions

**Files:**

- Modify: `src/components/panels/StereoMapPanel.jsx`
- Modify: `src/components/panels/StereoMapPanel.test.jsx`

**Step 1: Write failing panel tests**

Mirror Spectrum interaction coverage and additionally assert:

- linking affects X only;
- Mono Loss and M/S Ratio Y ranges remain panel-local;
- Energy gate still evaluates the complete primitive grid, not the visible viewport;
- Mode/Hold changes do not touch shared viewport;
- viewport updates do not alter the Stereo Map Analysis Key.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/components/panels/StereoMapPanel.test.jsx
```

Expected: Stereo Map still reads/writes its local X range.

**Step 3: Route Stereo Map through the adapter**

Use the shared effective X range only for rendering/navigation. Leave derivation, gate, Hold, Y ranges, and requests unchanged.

**Step 4: Verify**

Run:

```powershell
npm test -- src/components/panels/StereoMapPanel.test.jsx src/analysis/analysisRequestKeyFormat.test.js
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/components/panels/StereoMapPanel.jsx src/components/panels/StereoMapPanel.test.jsx
git commit -m "feat: link stereo map frequency navigation"
```

---

### Task 8: Add the common Workspace settings toggle

**Files:**

- Modify: `src/components/PanelSettingsContent.jsx`
- Modify: `src/components/PanelSettingsContent.test.jsx`

**Step 1: Write failing settings tests**

For Spectrum, Spectrogram, and Stereo Map, assert:

- identical `Link frequency range` wording and switch primitive;
- default off;
- first join preserves the visible range;
- later join atomically adopts the current group range;
- leave preserves the visible range by copying shared to local;
- linked range inputs display/effect the shared range;
- help text says only the frequency range is shared;
- no global toolbar toggle appears.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/components/PanelSettingsContent.test.jsx
```

Expected: toggle absent.

**Step 3: Implement settings integration**

Render the same settings row for only the three eligible Workspace panels. Call semantic join/leave actions; do not emit a generic panel-control patch for membership transitions.

**Step 4: Verify**

Run:

```powershell
npm test -- src/components/PanelSettingsContent.test.jsx
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/components/PanelSettingsContent.jsx src/components/PanelSettingsContent.test.jsx
git commit -m "feat: expose frequency-link panel setting"
```

---

### Task 9: Persist and atomically restore presets

**Files:**

- Modify: `src/hooks/usePresets.js`
- Modify: `src/hooks/usePresets.test.jsx`
- Modify: `src/workspace/WorkspaceContext.jsx`

**Step 1: Write failing preset tests**

Cover:

- snapshot captures shared viewport, link flags, and dormant local ranges;
- apply publishes one normalized Workspace state;
- linked members render the saved shared range on the first post-apply frame;
- no-linked-member preset retains its local ranges;
- legacy preset supplies default viewport and false link flags;
- applying a preset marks/clears dirty state according to existing semantics.

**Step 2: Verify RED**

Run:

```powershell
npm test -- src/hooks/usePresets.test.jsx
```

Expected: preset snapshot omits the viewport.

**Step 3: Implement preset capture/apply**

Add `frequencyViewport` to the explicit snapshot shape. Normalize viewport and all panel controls before one `setView` publication.

Do not apply viewport and link flags through separate effects.

**Step 4: Verify**

Run:

```powershell
npm test -- src/hooks/usePresets.test.jsx src/workspace/WorkspaceContext.test.jsx
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src/hooks/usePresets.js src/hooks/usePresets.test.jsx src/workspace/WorkspaceContext.jsx
git commit -m "feat: include linked frequency range in presets"
```

---

### Task 10: Lock the DSP/history/snapshot boundary

**Files:**

- Modify: `src/analysis/analysisRequests.test.js`
- Modify: `src/analysis/analysisRequestKeyFormat.test.js`
- Modify: `src/runtime/appRuntimeDerivations.test.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/hooks/useSnapshot.test.jsx`

**Step 1: Add regression tests**

Starting from otherwise identical state, change:

- shared viewport;
- local viewport;
- link membership.

Assert:

- Spectrum request keys unchanged;
- Stereo Map request keys unchanged;
- backend request payload unchanged;
- no pending/reset action;
- existing history row counts unchanged;
- snapshot row/key selection unchanged;
- Energy gate input remains the complete Stereo Map grid;
- hover state remains local.

**Step 2: Run the tests**

Run:

```powershell
npm test -- src/analysis/analysisRequests.test.js src/analysis/analysisRequestKeyFormat.test.js src/runtime/appRuntimeDerivations.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx
```

Expected: all pass without production changes. If a test fails, fix only the leaked coupling.

**Step 3: Commit tests**

```powershell
git add src/analysis/analysisRequests.test.js src/analysis/analysisRequestKeyFormat.test.js src/runtime/appRuntimeDerivations.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx
git commit -m "test: keep frequency linking display-only"
```

---

### Task 11: Lock the Dock boundary

**Files:**

- Modify: `src/dock/dockModuleControls.test.js`
- Modify: `src/dock/dockAnalysisRequest.test.js`
- Modify: `src/dock/editors/DockModuleSettings.test.jsx`
- Modify: `src/dock/modules/DockSpectrum.test.jsx`
- Modify: `src/dock/modules/DockSpectrogram.test.jsx`
- Modify: `src/dock/modules/DockStereoMap.test.jsx`

**Step 1: Add Dock isolation tests**

Assert:

- no Dock control schema contains `linkFrequencyRange`;
- Dock Editor never renders the toggle;
- Workspace shared updates never mutate Dock frequency ranges;
- Dock range changes never mutate Workspace state;
- Dock request keys exclude Workspace viewport/membership;
- all three Dock modules continue using their own local ranges.

**Step 2: Run tests**

Run:

```powershell
npm test -- src/dock/dockModuleControls.test.js src/dock/dockAnalysisRequest.test.js src/dock/editors/DockModuleSettings.test.jsx src/dock/modules/DockSpectrum.test.jsx src/dock/modules/DockSpectrogram.test.jsx src/dock/modules/DockStereoMap.test.jsx
```

Expected: all pass. Production Dock code should need no feature change.

**Step 3: Commit tests**

```powershell
git add src/dock/dockModuleControls.test.js src/dock/dockAnalysisRequest.test.js src/dock/editors/DockModuleSettings.test.jsx src/dock/modules/DockSpectrum.test.jsx src/dock/modules/DockSpectrogram.test.jsx src/dock/modules/DockStereoMap.test.jsx
git commit -m "test: isolate dock from frequency linking"
```

---

### Task 12: Final verification

**Files:**

- Modify only if verification exposes a defect directly caused by this feature.

**Step 1: Run focused tests**

Run:

```powershell
npm test -- src/workspace/frequencyViewport.test.js src/workspace/reducer.test.js src/workspace/WorkspaceContext.test.jsx src/hooks/useLinkedFrequencyRange.test.js src/components/panels/SpectrumPanel.test.jsx src/components/panels/SpectrogramPanel.test.jsx src/components/panels/StereoMapPanel.test.jsx src/components/PanelSettingsContent.test.jsx src/hooks/usePresets.test.jsx
```

Expected: all pass.

**Step 2: Run the merge gate**

Run:

```powershell
npm run check
```

Expected: exit code 0.

**Step 3: Inspect forbidden-scope changes**

Run:

```powershell
git diff -- src-tauri src/ipc src/dock/dockModuleControls.js src/dock/editors/DockModuleSettings.jsx
```

Expected:

- no Rust/DSP changes;
- no IPC payload changes;
- no Dock link field or toggle.

**Step 4: Perform desktop interaction checks**

Run:

```powershell
npm run desktop
```

Verify:

- first join, later join, leave, and final-member leave;
- mixed linked/unlinked duplicate panels;
- Spectrum X, Spectrogram Y, and Stereo Map X synchronized motion;
- independent dB/Y and hover behavior;
- lower-sample-rate render clamp without persisted mutation;
- restart and preset round trip;
- Dock remains independent.

No capture smoke/soak is required solely for this display-only phase because it must not touch `src-tauri/src/audio`, `dsp`, or `engine`.

## Completion checklist

- Linking is opt-in and defaults off after new state and migration.
- One normalized shared range drives all linked eligible Workspace panels.
- First join and leave preserve visible range; later join atomically adopts the group.
- Dormant local ranges remain usable after unlink.
- Shared viewport, membership, and local ranges survive restart and presets.
- Lower source support clamps only rendering, never persisted state.
- Request keys, backend payloads, history rows, snapshot selection, and Energy gate are unchanged.
- Hover remains panel-local.
- Dock has no link field, UI, or shared-state coupling.
- `npm run check` passes.
