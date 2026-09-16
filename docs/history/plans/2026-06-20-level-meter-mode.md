# Level Meter Mode Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. Keep each task independently reviewable.

**Goal:** Evolve the existing Peak panel into a user-facing Level Meter with a
header chip for `Peak`, `M`, and `ST`.

**Architecture:** Keep the current `peak` module id and `PeakPanel` component in
v1. Add a persisted `panelControls.levelMeterMode` field and route it through the
existing `PanelHeaderControls` pattern.

**Tech Stack:** React/JSX, existing workspace `panelControls`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-level-meter-mode-design.md`

---

## File Structure

- Modify `src/lib/panelControls.js`
- Modify `src/lib/panelControls.test.js`
- Modify `src/components/PanelHeaderControls.jsx`
- Modify `src/components/PanelHeaderControls.test.jsx`
- Modify `src/workspace/registry.jsx`
- Modify `src/components/panels/PeakPanel.jsx`
- Modify `src/components/panels/PeakPanel.test.jsx`
- Modify `src/App.jsx` only if loudness values are not already available through
  `AudioDataContext`
- Modify `src/hooks/usePresets.test.jsx` if preset coverage needs explicit
  `levelMeterMode` assertions

---

## Task 1: Add `levelMeterMode` to panel controls

**Files:**
- Modify: `src/lib/panelControls.js`
- Modify: `src/lib/panelControls.test.js`

- [ ] **Step 1: Add mode constants**

Add stable options:

```js
export const LEVEL_METER_MODE_OPTIONS = [
  { id: "peak", label: "Peak" },
  { id: "momentary", label: "M" },
  { id: "shortTerm", label: "ST" },
];
```

- [ ] **Step 2: Add default control**

Extend `DEFAULT_PANEL_CONTROLS`:

```js
levelMeterMode: "peak",
```

- [ ] **Step 3: Normalize old and invalid values**

`normalizePanelControls()` should return `"peak"` when the field is missing,
unknown, or malformed.

- [ ] **Step 4: Test**

Cover:

- defaults include `levelMeterMode: "peak"`;
- valid values survive normalization;
- invalid values normalize to `"peak"`;
- older persisted control objects normalize cleanly.

---

## Task 2: Add the Level Meter header chip

**Files:**
- Modify: `src/components/PanelHeaderControls.jsx`
- Modify: `src/components/PanelHeaderControls.test.jsx`

- [ ] **Step 1: Render chip for `activeTab === "peak"`**

Use the existing chip/select style. The label should show the active mode label:

- `Peak`
- `M`
- `ST`

- [ ] **Step 2: Update panel controls on selection**

When the user selects a mode:

```js
onPanelControlsChange(
  normalizePanelControls({
    ...normalizedPanelControls,
    levelMeterMode: nextMode,
  })
);
```

- [ ] **Step 3: Test**

Cover:

- Peak tab renders the chip;
- default label is `Peak`;
- selecting `M` calls `onPanelControlsChange` with `levelMeterMode:
  "momentary"`;
- selecting `ST` calls with `levelMeterMode: "shortTerm"`.

---

## Task 3: Rename the user-facing panel title

**Files:**
- Modify: `src/workspace/registry.jsx`
- Modify relevant title/source tests if present

- [ ] **Step 1: Change registry title**

Change the `peak` registry title from:

```txt
Peak
```

to:

```txt
Level Meter
```

Do not rename the module id.

- [ ] **Step 2: Test**

Update or add tests that assert the registry title is `Level Meter` while the id
remains `peak`.

---

## Task 4: Render Peak, Momentary, and Short-term modes

**Files:**
- Modify: `src/components/panels/PeakPanel.jsx`
- Modify: `src/components/panels/PeakPanel.test.jsx`
- Modify: `src/App.jsx` only if needed

- [ ] **Step 1: Read mode from audio data**

`LeafView` already passes `panelControls` through `AudioDataContext` for header
controls. `PeakPanel` should read:

```js
const mode = audioData?.panelControls?.levelMeterMode ?? "peak";
```

- [ ] **Step 2: Keep existing Peak rendering for `peak`**

No behavior change for the default mode.

- [ ] **Step 3: Add loudness value rendering for `momentary` and `shortTerm`**

Use existing display/live loudness values available in `AudioDataContext`.

If the current data shape only exposes program-level loudness, render a single
program-level meter/value in LUFS. Do not invent per-channel loudness.

- [ ] **Step 4: Switch units**

Render:

- `dBFS` for Peak;
- `LUFS` for M/ST.

- [ ] **Step 5: Test**

Cover:

- default mode still renders Peak behavior;
- Momentary mode renders LUFS and momentary value;
- Short-term mode renders LUFS and short-term value.

---

## Task 5: Preset and persistence verification

**Files:**
- Modify tests only if existing coverage is not enough

- [ ] **Step 1: Verify persistence coverage**

Because `levelMeterMode` lives inside `panelControls`, existing persistence and
preset code should save/restore it automatically after Task 1 normalization.

- [ ] **Step 2: Add explicit tests if needed**

Add targeted assertions to `usePresets.test.jsx` or panel controls tests:

- saving a preset includes `levelMeterMode`;
- applying a preset restores `levelMeterMode`;
- old presets without the field restore as `peak`.

---

## Task 6: Verification

- [ ] **Step 1: Run targeted tests**

```bash
npm test -- src/lib/panelControls.test.js src/components/PanelHeaderControls.test.jsx src/components/panels/PeakPanel.test.jsx
```

- [ ] **Step 2: Run related tests**

```bash
npm test -- src/hooks/usePresets.test.jsx src/workspace/reducer-tree.test.js
```

- [ ] **Step 3: Run full frontend tests**

```bash
npm test
```

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Manual desktop QA**

Verify:

- Modules shows `Level Meter`;
- the panel title is `Level Meter`;
- chip defaults to `Peak`;
- switching to `M` shows Momentary LUFS;
- switching to `ST` shows Short-term LUFS;
- switching back to `Peak` restores the old peak meter behavior;
- restart preserves the selected mode;
- saving/applying a preset preserves the selected mode.

---

## Self-review notes

- **Do not rename the `peak` module id in this slice.** That would create
  unnecessary workspace/preset migration risk.
- **Do not implement multi-instance workspace here.** This v1 only changes what
  the existing panel can display.
- **Keep the title stable.** `Level Meter` is the panel type; the chip is the
  metric selector.
