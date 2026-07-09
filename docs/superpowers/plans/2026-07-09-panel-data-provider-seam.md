# Panel Data Provider Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current large `audioData` context shape with explicit panel data seams so
panel modules read only the data class they need, without changing panel behavior or visuals.

**Architecture:** Keep the existing `AudioDataContext` path working while introducing explicit
interfaces for shared frame data, history interaction data, panel instance data, and panel chrome
data. Migrate panel consumers one group at a time, then split providers by update frequency after
the consumer contract is clear.

**Tech Stack:** React 19 context/hooks, Vitest, existing workspace providers, existing runtime and
panel tests.

---

## Investigation Summary

Current flow:

```text
App.jsx
  builds audioData (large shared object)
  builds panelChromeData (low-frequency header/menu data)
    ↓
AppShell
  <AudioDataContext.Provider value={audioData}>
    <PanelChromeProvider value={panelChromeData}>
      <SplitLayout />
    </PanelChromeProvider>
  </AudioDataContext.Provider>
    ↓
LeafView / SplitLayout fullscreen
  <PanelInstanceProvider value={{ panelControls, onPanelControlsChange, analysisStatus, panelVisible }}>
    <ActivePanel />
  </PanelInstanceProvider>
    ↓
useAudioData()
  returns { ...audioData, ...panelInstance }
```

The risky part is `useAudioData()` merging global shared data and per-panel instance data. The
merge makes `panelControls`, `onPanelControlsChange`, `analysisStatus`, and `panelVisible` look as
if they are global `audioData` fields, even though production behavior depends on the active panel
instance overriding them.

Panel consumers fall into these groups:

- `LevelMeterPanel`: frame data + peak labels + per-panel controls.
- `StatsPanel`: stats metrics + dialogue activity + per-panel controls.
- `LoudnessPanel` and `WaveformPanel`: history/timeline interaction + per-panel controls.
- `SpectrumPanel`, `SpectrogramPanel`, and `VectorscopePanel`: request-keyed live/snapshot data +
  history state + per-panel controls.
- `LeafView` and fullscreen header: panel chrome data + per-panel controls, not the full frame data.

Known cleanup candidates after the seam exists:

- Chrome duplicates currently still present in `audioData`.
- Unused or redundant fields such as `visualWaveformSnap`, some precomputed loudness paths, and
  older first-panel control fallbacks.
- The `{ ...audioData, ...panelInstance }` compatibility layer.

## Non-Goals

- Do not change panel visuals, copy, controls, or layout.
- Do not change request-key derivation for Spectrum, Spectrogram, or Vectorscope.
- Do not change audio engine IPC or runtime lifecycle.
- Do not remove `useAudioData()` until all panel consumers have migrated.
- Do not treat `useMemo(audioData)` as the architecture fix. It may be a later optimization, but it
  does not solve the mixed-interface problem.

## Task 1: Document and Test the Existing Seam Contract

**Files:**

- Modify: `src/workspace/AudioDataContext.jsx`
- Modify: `src/workspace/AudioDataContext.test.jsx`
- Test: `src/workspace/AudioDataContext.test.jsx`

- [ ] **Step 1: Add named compatibility hooks**

Keep `useAudioData()` unchanged, but add explicit hooks that initially read from the same existing
contexts:

- `useSharedPanelData()` reads `AudioDataContext`.
- `usePanelInstanceData()` reads `PanelInstanceContext`.
- `usePanelChromeData()` remains unchanged.

These hooks do not split providers yet; they give callers a clearer vocabulary before migration.

- [ ] **Step 2: Extend seam tests**

Add tests for:

- `useSharedPanelData()` returning the shared object without instance fields.
- `usePanelInstanceData()` returning only per-panel fields.
- `useAudioData()` preserving the current compatibility merge.
- `PanelChromeProvider` remaining independent.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- src/workspace/AudioDataContext.test.jsx
```

Expected: existing behavior remains unchanged.

## Task 2: Stabilize Panel Instance Values at the Workspace Seam

**Files:**

- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/workspace/SplitLayout.jsx`
- Test: `src/workspace/AudioDataContext.test.jsx`
- Test: `src/components/PanelSettingsContent.test.jsx`
- Test: `src/components/panels/WaveformPanel.test.jsx`

- [ ] **Step 1: Memoize leaf panel instance value**

In `LeafView`, wrap the `PanelInstanceProvider` value in `useMemo`:

- `panelControls`
- `onPanelControlsChange`
- `analysisStatus`
- `panelVisible`

Keep `onPanelControlsChange` behavior byte-for-byte equivalent.

- [ ] **Step 2: Memoize fullscreen panel instance value**

In `SplitLayout` fullscreen overlay, do the same for the fullscreen `PanelInstanceProvider` value.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- src/workspace/AudioDataContext.test.jsx src/components/PanelSettingsContent.test.jsx src/components/panels/WaveformPanel.test.jsx
```

Expected: panel controls, fullscreen panel controls, and `panelVisible` behavior stay unchanged.

## Task 3: Migrate Low-Risk Panels to Explicit Shared + Instance Hooks

**Files:**

- Modify: `src/components/panels/LevelMeterPanel.jsx`
- Modify: `src/components/panels/StatsPanel.jsx`
- Test: `src/components/panels/LevelMeterPanel.test.jsx`
- Test: `src/components/panels/StatsPanel.test.jsx`
- Test: `src/workspace/AudioDataContext.test.jsx`

- [ ] **Step 1: Update `LevelMeterPanel`**

Read frame/label fields from `useSharedPanelData()` and controls from `usePanelInstanceData()`.
Do not change the rendered output or control update logic.

- [ ] **Step 2: Update `StatsPanel`**

Read `statsMetrics` and `dialogueActiveNow` from shared data, and `panelControls` from instance
data.

- [ ] **Step 3: Update tests only as needed**

Prefer wrapping tests with both `AudioDataContext.Provider` and `PanelInstanceProvider` where they
assert per-panel controls. Avoid weakening assertions.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/components/panels/LevelMeterPanel.test.jsx src/components/panels/StatsPanel.test.jsx src/workspace/AudioDataContext.test.jsx
```

Expected: low-risk panels no longer rely on the compatibility merge.

## Task 4: Migrate History Panels

**Files:**

- Modify: `src/components/panels/LoudnessPanel.jsx`
- Modify: `src/components/panels/WaveformPanel.jsx`
- Test: `src/components/panels/LoudnessPanel.test.jsx`
- Test: `src/components/panels/WaveformPanel.test.jsx`
- Test: `src/App.smoke.test.jsx`

- [ ] **Step 1: Update `LoudnessPanel`**

Read timeline/history fields from shared data and controls from instance data. Preserve local path
rebuilding from `histSourceList`; do not reintroduce App-precomputed path fields.

- [ ] **Step 2: Update `WaveformPanel`**

Read `panelVisible` from instance data before rendering content. Read history and channel fields
from shared data.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- src/components/panels/LoudnessPanel.test.jsx src/components/panels/WaveformPanel.test.jsx src/App.smoke.test.jsx
```

Expected: history scrub, snapshot line, waveform hidden-tab optimization, and Clear behavior stay
unchanged.

## Task 5: Migrate Request-Keyed Panels

**Files:**

- Modify: `src/components/panels/SpectrumPanel.jsx`
- Modify: `src/components/panels/SpectrogramPanel.jsx`
- Modify: `src/components/panels/VectorscopePanel.jsx`
- Test: `src/components/panels/SpectrumPanel.test.jsx`
- Test: `src/components/panels/SpectrogramPanel.test.jsx`
- Test: `src/components/panels/VectorscopePanel.test.jsx`
- Test: `src/runtime/appRuntimeDerivations.test.js`

- [ ] **Step 1: Update `SpectrumPanel`**

Read `panelControls` and `analysisStatus` from instance data. Read `displayAudio`,
`resolveSpectrumSnapshotForKey`, history state, and snapshot actions from shared data.

- [ ] **Step 2: Update `SpectrogramPanel`**

Read `panelControls`, `analysisStatus`, and `onPanelControlsChange` from instance data. Read
request-keyed spectrogram resolvers, timeline state, theme id, and channel metadata from shared
data.

- [ ] **Step 3: Update `VectorscopePanel`**

Read `panelControls` and `analysisStatus` from instance data. Read frame, snapshot resolver,
channel labels, and fallback correlation from shared data.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/components/panels/SpectrumPanel.test.jsx src/components/panels/SpectrogramPanel.test.jsx src/components/panels/VectorscopePanel.test.jsx src/runtime/appRuntimeDerivations.test.js
```

Expected: request-keyed live results, request-keyed snapshots, over-cap states, and per-panel
controls stay unchanged.

## Task 6: Remove Chrome Duplicates From Shared Panel Data

**Files:**

- Modify: `src/App.jsx`
- Modify: `src/components/AppShell.jsx` only if provider placement needs a small adjustment
- Test: `src/components/PanelSettingsContent.test.jsx`
- Test: `src/components/PanelSettingsMenu.test.jsx`
- Test: `src/workspace/AudioDataContext.test.jsx`

- [ ] **Step 1: Remove chrome-only fields from `audioData`**

Remove fields that are already supplied through `panelChromeData` or component props, such as:

- `compactPanels`
- spectrum/vectorscope selector UI fields used by panel header menus
- `analysisStatusByPanelId`

Do not remove fields still consumed by panel bodies.

- [ ] **Step 2: Verify header/menu behavior**

Run:

```bash
npm test -- src/components/PanelSettingsContent.test.jsx src/components/PanelSettingsMenu.test.jsx src/workspace/AudioDataContext.test.jsx
```

Expected: panel settings menus still render and update per-panel controls.

## Task 7: Split Providers by Data Class

**Files:**

- Create: `src/workspace/PanelDataProviders.jsx`
- Modify: `src/workspace/AudioDataContext.jsx`
- Modify: `src/components/AppShell.jsx`
- Modify: `src/App.jsx`
- Test: `src/workspace/AudioDataContext.test.jsx`
- Test: `src/App.smoke.test.jsx`

- [ ] **Step 1: Introduce dedicated providers**

Create providers for:

- shared frame/display data
- history/timeline interaction data
- panel instance data
- panel chrome data

At first, these providers may still receive values assembled in `App.jsx`. The key goal is that
consumers no longer rely on one merged object.

- [ ] **Step 2: Move provider composition into `AppShell` or a narrow panel data wrapper**

Keep the rendered tree behavior equivalent. Do not move `MeterRuntimeEngines`.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- src/workspace/AudioDataContext.test.jsx src/App.smoke.test.jsx
```

Expected: all migrated panels read from explicit providers.

## Task 8: Delete Compatibility Merge and Dead Fields

**Files:**

- Modify: `src/workspace/AudioDataContext.jsx`
- Modify: `src/App.jsx`
- Modify tests that still construct old merged context values
- Test: all panel tests
- Test: `src/App.smoke.test.jsx`

- [ ] **Step 1: Remove or deprecate `useAudioData()`**

Only do this after every production panel has migrated. If tests still need a helper, create local
test wrappers instead of keeping production compatibility forever.

- [ ] **Step 2: Remove dead fields from `App.jsx`**

Candidates to remove after confirming no consumers remain:

- `visualWaveformSnap`
- unused peak formatting helpers from `audioData`
- loudness precomputed path fields no longer read by panels
- first-panel `panelControls` fallback in `audioData`

- [ ] **Step 3: Verify full suite**

Run:

```bash
npm test
npm run check
```

Expected: no behavior-only test coverage is lost, and full project check passes.

## Manual Sanity

After the final task, manually check:

- Live START/STOP and Clear.
- Loudness History scrub and snapshot line.
- Spectrum/Spectrogram/Vectorscope per-panel controls, including duplicated panels with different
  channel selections.
- File mode open/drop/analyze/reanalyze and request-keyed panel results.
- Fullscreen panel controls.
- Hidden tab/panel visibility behavior for Waveform.
- Presets restoring layouts and per-panel controls.
