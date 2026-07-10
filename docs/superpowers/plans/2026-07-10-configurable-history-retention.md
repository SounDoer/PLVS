# Configurable History Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 2-hour history cap with a user-configurable System Settings option (30min / 1h default / 2h / 4h) that controls both the scalar loudness-history ring and the visual (waveform/spectrum/vectorscope) history ring.

**Architecture:** A new `historyRetentionSec` setting lives in the existing `settingsStore` persistence domain, exposed via a new hook mirroring `useCloseActionSetting.js`. `App.jsx` derives `histMaxSamples`/`visualMaxSamples` from this value (replacing the `HIST_MAX_SAMPLES`/`VISUAL_MAX_SAMPLES` constants) and passes them through the existing prop chain unchanged. `FrameIntake` gains capacity-change detection for the scalar rings (the visual rings already rebuild on capacity mismatch), so changing the setting mid-session clears and restarts history collection consistently across both ring types. A new `Select` row in `SettingsPanel.jsx` exposes the four presets.

**Tech Stack:** JavaScript/React, Vitest. No Rust/IPC changes.

**Reference spec:** `docs/superpowers/specs/2026-07-10-configurable-history-retention-design.md`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/settings/defaults.js` | `DEFAULT_HISTORY_RETENTION_SEC`, `HISTORY_RETENTION_OPTIONS_SEC`, `normalizeHistoryRetentionSec` |
| Modify | `src/settings/defaults.test.js` | Tests for the new default/normalizer |
| Create | `src/hooks/useHistoryRetentionSetting.js` | Setting state + persistence, mirrors `useCloseActionSetting.js` |
| Modify | `src/hooks/useSettings.js` | Wire the new hook into the aggregate settings object |
| Modify | `src/lib/FrameIntake.js` | Rebuild scalar rings (`_loudnessHist`, `_audioSnap`, `_corrSnap`, `_frequencyChannelMarkers`, `_channelMetadataSnap`) when `histMaxSamples` changes |
| Modify | `src/lib/FrameIntake.test.js` | Test for the scalar-ring rebuild behavior |
| Modify | `src/App.jsx` | Derive `histMaxSamples`/`visualMaxSamples` from `settings.historyRetentionSec` instead of fixed constants |
| Modify | `src/components/SettingsPanel.jsx` | New "History Length" `Select` row between Theme and Channels sections |
| Modify | `src/components/SettingsPanel.test.jsx` | Test for the new row |
| Modify | `src/components/AppSettingsOverlays.jsx` | Pass `historyRetentionSec`/`setHistoryRetentionSec` through to `SettingsPanel` |

---

## Task 1: Setting default and normalizer

**Files:**
- Modify: `src/settings/defaults.js`
- Modify: `src/settings/defaults.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `src/settings/defaults.test.js` (extend the existing import list and add a new `it` block):

```js
import {
  DEFAULT_CLOSE_ACTION,
  DEFAULT_GLASS_ENABLED,
  DEFAULT_HISTORY_RETENTION_SEC,
  DEFAULT_PANEL_OPACITY,
  DEFAULT_REFERENCE_LUFS,
  DEFAULT_THEME_EDITOR_POS,
  HISTORY_RETENTION_OPTIONS_SEC,
  normalizeCloseAction,
  normalizeGlassEnabled,
  normalizeHistoryRetentionSec,
  normalizePanelOpacity,
  normalizeReferenceLufs,
  normalizeThemeEditorPos,
  normalizeSettingsFocusView,
} from "./defaults.js";
```

```js
  it("normalizes history retention seconds", () => {
    expect(DEFAULT_HISTORY_RETENTION_SEC).toBe(3600);
    expect(HISTORY_RETENTION_OPTIONS_SEC).toEqual([1800, 3600, 7200, 14400]);
    expect(normalizeHistoryRetentionSec(1800)).toBe(1800);
    expect(normalizeHistoryRetentionSec(7200)).toBe(7200);
    expect(normalizeHistoryRetentionSec(14400)).toBe(14400);
    expect(normalizeHistoryRetentionSec(999)).toBe(DEFAULT_HISTORY_RETENTION_SEC);
    expect(normalizeHistoryRetentionSec(null)).toBe(DEFAULT_HISTORY_RETENTION_SEC);
    expect(normalizeHistoryRetentionSec(undefined)).toBe(DEFAULT_HISTORY_RETENTION_SEC);
    expect(normalizeHistoryRetentionSec("7200")).toBe(DEFAULT_HISTORY_RETENTION_SEC);
  });
```

Note: the last assertion is intentional — `normalizeHistoryRetentionSec` only accepts values that are strictly members of `HISTORY_RETENTION_OPTIONS_SEC` (all numbers), so the string `"7200"` is rejected and falls back to the default, same as an invalid value.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/settings/defaults.test.js`
Expected: FAIL — `DEFAULT_HISTORY_RETENTION_SEC`, `HISTORY_RETENTION_OPTIONS_SEC`, `normalizeHistoryRetentionSec` are not exported.

- [ ] **Step 3: Implement**

Add to `src/settings/defaults.js` (after the existing `DEFAULT_GLASS_ENABLED` export):

```js
export const DEFAULT_HISTORY_RETENTION_SEC = 3600;
export const HISTORY_RETENTION_OPTIONS_SEC = [1800, 3600, 7200, 14400];
```

Add after `normalizeGlassEnabled`:

```js
export function normalizeHistoryRetentionSec(raw) {
  return HISTORY_RETENTION_OPTIONS_SEC.includes(raw) ? raw : DEFAULT_HISTORY_RETENTION_SEC;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/settings/defaults.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/settings/defaults.js src/settings/defaults.test.js
git commit -m "feat(settings): add history retention default and normalizer"
```

---

## Task 2: `useHistoryRetentionSetting` hook

**Files:**
- Create: `src/hooks/useHistoryRetentionSetting.js`
- Modify: `src/hooks/useSettings.js`

This hook has no dedicated test file — `useCloseActionSetting.js`, the pattern it mirrors, has none either; its behavior is covered indirectly through `SettingsPanel.test.jsx` in Task 5.

- [ ] **Step 1: Implement the hook**

Create `src/hooks/useHistoryRetentionSetting.js`:

```js
import { useState } from "react";
import { settingsStore } from "../persistence/index.js";
import {
  DEFAULT_HISTORY_RETENTION_SEC,
  normalizeHistoryRetentionSec,
} from "../settings/defaults.js";

export function useHistoryRetentionSetting() {
  const [historyRetentionSec, setHistoryRetentionSecState] = useState(() =>
    normalizeHistoryRetentionSec(settingsStore.read().historyRetentionSec)
  );

  function setHistoryRetentionSec(value) {
    const next = normalizeHistoryRetentionSec(value);
    if (next === DEFAULT_HISTORY_RETENTION_SEC) {
      const { historyRetentionSec: _drop, ...rest } = settingsStore.read();
      settingsStore.reset();
      settingsStore.patch(rest);
    } else {
      settingsStore.patch({ historyRetentionSec: next });
    }
    setHistoryRetentionSecState(next);
  }

  return {
    historyRetentionSec,
    setHistoryRetentionSec,
  };
}
```

This mirrors `src/hooks/useCloseActionSetting.js:1-26` exactly, substituting the field name and normalizer.

- [ ] **Step 2: Wire into `useSettings.js`**

In `src/hooks/useSettings.js`, add the import next to the other setting hooks:

```js
import { useCloseActionSetting } from "./useCloseActionSetting.js";
import { useHistoryRetentionSetting } from "./useHistoryRetentionSetting.js";
```

Instantiate it next to `closeActionSetting`:

```js
  const closeActionSetting = useCloseActionSetting();
  const historyRetentionSetting = useHistoryRetentionSetting();
  const meterSettings = useMeterSettings();
```

Spread it into the returned object next to `...closeActionSetting`:

```js
    ...meterSettings,
    ...closeActionSetting,
    ...historyRetentionSetting,
    ...viewSettings,
```

- [ ] **Step 3: Run the full settings-related test suite to confirm no regression**

Run: `npx vitest run src/hooks`
Expected: PASS (existing tests still pass; no new test added in this task since coverage lands in Task 5)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useHistoryRetentionSetting.js src/hooks/useSettings.js
git commit -m "feat(settings): add useHistoryRetentionSetting hook"
```

---

## Task 3: Scalar-ring rebuild on capacity change

**Files:**
- Modify: `src/lib/FrameIntake.js:154-262`
- Modify: `src/lib/FrameIntake.test.js`

The visual rings (`pushVisualHistRow`) already rebuild when `visualMaxSamples` changes (`src/lib/FrameIntake.js:266-272`). The scalar rings (`pushHistRow`) currently have no such check — they'd drain one element per push until they shrink to a new smaller cap, which takes many minutes. This task adds the same immediate-rebuild behavior to the scalar side.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/FrameIntake.test.js`, near the existing `"pushHistRow clamps ring to histMaxSamples"` test (around line 174):

```js
  it("pushHistRow rebuilds scalar rings when histMaxSamples changes", () => {
    const intake = new FrameIntake();
    for (let i = 0; i < 3; i++) {
      intake.pushHistRow(makeRow(), HIST_MAX, SR);
    }
    expect(intake.getLoudnessHistory()).toHaveLength(3);
    expect(intake.getAudioSnap()).toHaveLength(3);
    expect(intake.getCorrSnap()).toHaveLength(3);

    intake.pushHistRow(makeRow(), HIST_MAX + 2, SR);

    expect(intake.getLoudnessHistory()).toHaveLength(1);
    expect(intake.getAudioSnap()).toHaveLength(1);
    expect(intake.getCorrSnap()).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/FrameIntake.test.js -t "rebuilds scalar rings"`
Expected: FAIL — lengths stay at 4 (3 old + 1 new) instead of resetting to 1.

- [ ] **Step 3: Implement**

In `src/lib/FrameIntake.js`, add a capacity tracker to the constructor (after `this._loudnessHist = [];` at line 156):

```js
  constructor() {
    this._loudnessHist = [];
    this._histCapacity = 0;
    this._audioSnap = [];
```

In `pushHistRow` (`src/lib/FrameIntake.js:236`), add the rebuild check as the first statement in the method body:

```js
  pushHistRow(row, histMaxSamples) {
    if (histMaxSamples !== this._histCapacity) {
      this._loudnessHist = [];
      this._audioSnap = [];
      this._corrSnap = [];
      this._frequencyChannelMarkers = [];
      this._channelMetadataSnap = [];
      this._histCapacity = histMaxSamples;
    }
    const timestampMs = this._normalizeTimestampMs(row.timestampMs, this._histTimestamp);
```

(leave the rest of the method body unchanged)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: PASS (all tests in the file, including the new one and the existing `"clamps ring to histMaxSamples"` test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/FrameIntake.js src/lib/FrameIntake.test.js
git commit -m "fix(engine): rebuild scalar history rings immediately on capacity change"
```

---

## Task 4: Wire the setting into `App.jsx`

**Files:**
- Modify: `src/App.jsx:15-60`, `src/App.jsx:749-757`

- [ ] **Step 1: Import `VISUAL_HIST_SAMPLE_SEC`**

In `src/App.jsx`, line 17 currently reads:

```js
import { useLoudnessHistory, HIST_SAMPLE_SEC } from "./hooks/useLoudnessHistory.js";
```

Change to:

```js
import {
  useLoudnessHistory,
  HIST_SAMPLE_SEC,
  VISUAL_HIST_SAMPLE_SEC,
} from "./hooks/useLoudnessHistory.js";
```

- [ ] **Step 2: Remove the fixed constants**

Delete lines 57-60:

```js
// Live and file sessions share bounded display history. File-mode summary metrics are authoritative
// for the whole file; panel history is an inspectable downsampled/session view, not unlimited storage.
const HIST_MAX_SAMPLES = 72000;
const VISUAL_MAX_SAMPLES = 180_000; // 25 Hz × 2 h
```

- [ ] **Step 3: Derive the sample counts from the setting**

In `AppContent`, immediately before the existing `const runtimeEnginesProps = {` block (`src/App.jsx:749`), add:

```js
  // Live and file sessions share bounded display history, sized from the user's History Length
  // setting. File-mode summary metrics are authoritative for the whole file; panel history is an
  // inspectable downsampled/session view, not unlimited storage.
  const histMaxSamples = Math.round(settings.historyRetentionSec / HIST_SAMPLE_SEC);
  const visualMaxSamples = Math.round(settings.historyRetentionSec / VISUAL_HIST_SAMPLE_SEC);
  const runtimeEnginesProps = {
    captureDeviceId,
    captureFormatSignature,
    histMaxSamples,
    visualMaxSamples,
    loudnessWeightsRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
  };
```

(replacing the old `histMaxSamples: HIST_MAX_SAMPLES` / `visualMaxSamples: VISUAL_MAX_SAMPLES` lines)

- [ ] **Step 4: Run the frontend test suite**

Run: `npm test`
Expected: PASS. `src/hooks/useAudioEngine.test.js`, `src/lib/tauriFrameApply.test.js`, and `src/hooks/useFileAnalysisEngine.test.jsx` pass their own explicit `histMaxSamples`/`visualMaxSamples` values directly and don't depend on `App.jsx`, so they're unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): derive history ring capacity from the history retention setting"
```

---

## Task 5: Settings UI row

**Files:**
- Modify: `src/components/SettingsPanel.jsx:110-421`
- Modify: `src/components/SettingsPanel.test.jsx`
- Modify: `src/components/AppSettingsOverlays.jsx:26-79`

- [ ] **Step 1: Write the failing test**

Add to `src/components/SettingsPanel.test.jsx`, near the existing `SYSTEM_PROPS` block and its close-behavior test (around line 344-376):

```js
  const HISTORY_PROPS = {
    historyRetentionSec: 3600,
    setHistoryRetentionSec: vi.fn(),
  };

  it("renders History Length select with current value", () => {
    render(<SettingsPanel {...BASE_PROPS} {...HISTORY_PROPS} historyRetentionSec={7200} />);
    expect(screen.getByLabelText("History Length")).toBeTruthy();
  });

  it("calls setHistoryRetentionSec when a new option is chosen", () => {
    const setHistoryRetentionSec = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        {...HISTORY_PROPS}
        setHistoryRetentionSec={setHistoryRetentionSec}
      />
    );
    fireEvent.click(screen.getByLabelText("History Length"));
    fireEvent.click(screen.getByText("2 h"));
    expect(setHistoryRetentionSec).toHaveBeenCalledWith("7200");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/SettingsPanel.test.jsx -t "History Length"`
Expected: FAIL — `getByLabelText("History Length")` finds nothing.

- [ ] **Step 3: Add the props to `SettingsPanel`**

In `src/components/SettingsPanel.jsx`, add to the destructured props (near `closeAction`/`setCloseAction`, `src/components/SettingsPanel.jsx:131-132`):

```js
  closeAction = "ask",
  setCloseAction = () => {},
  historyRetentionSec = 3600,
  setHistoryRetentionSec = () => {},
```

- [ ] **Step 4: Add the UI row**

In `src/components/SettingsPanel.jsx`, insert a new section between the Theme section's closing divider and the Channels section (`src/components/SettingsPanel.jsx:419-424`):

```jsx
                </SettingsSection>

                <SettingsDivider />

                {/* History retention */}
                <SettingsSection>
                  <SettingsRow label="History Length">
                    <Select
                      value={String(historyRetentionSec)}
                      onValueChange={setHistoryRetentionSec}
                    >
                      <SelectTrigger aria-label="History Length" className={SELECT_TRIGGER_CLASS}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                        <SelectItem value="1800">30 min</SelectItem>
                        <SelectItem value="3600">1 h</SelectItem>
                        <SelectItem value="7200">2 h</SelectItem>
                        <SelectItem value="14400">4 h</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingsRow>
                </SettingsSection>

                <SettingsDivider />

                {/* Channel labels */}
```

Note `onValueChange` receives a string from the `Select` component (matching the `closeAction` pattern at `src/components/SettingsPanel.jsx:249`); `normalizeHistoryRetentionSec` expects a number, so the numeric conversion happens where `setHistoryRetentionSec` is defined in the hook's caller — to keep the hook's contract simple, convert in `useHistoryRetentionSetting.js` instead. Update Task 2's `setHistoryRetentionSec` to coerce:

```js
  function setHistoryRetentionSec(value) {
    const next = normalizeHistoryRetentionSec(Number(value));
```

(This is a one-line correction to the Task 2 implementation — apply it now if not already done.)

- [ ] **Step 5: Wire props through `AppSettingsOverlays.jsx`**

In `src/components/AppSettingsOverlays.jsx`, add next to `closeAction`/`setCloseAction` (`src/components/AppSettingsOverlays.jsx:52-53`):

```jsx
        closeAction={settings.closeAction}
        setCloseAction={settings.setCloseAction}
        historyRetentionSec={settings.historyRetentionSec}
        setHistoryRetentionSec={settings.setHistoryRetentionSec}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx src/components/AppSettingsOverlays.jsx src/hooks/useHistoryRetentionSetting.js
git commit -m "feat(settings): add History Length control to System Settings"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full check suite**

Run: `npm run check`
Expected: PASS — format, lint, full Vitest suite, build, version check, and Rust fmt/clippy/test all succeed. This change touches no Rust files, so the Rust checks should be no-ops relative to this plan's changes (any Rust diffs must come from unrelated pre-existing working-tree changes, not this plan).

- [ ] **Step 2: Manual smoke check (optional but recommended)**

Run: `npm run tauri dev`
In the running app: open System Settings, confirm "History Length" appears between Theme and Channels, defaults to "1 h", and switching to "30 min" then back to "2 h" doesn't throw console errors. Start live capture, let it run a few seconds, switch the History Length option, and confirm the loudness history chart clears and resumes drawing rather than freezing or erroring.

---

## Self-Review Notes

- **Spec coverage:** setting + normalizer (Task 1), hook + persistence (Task 2), immediate rebuild for both ring types — visual already existed, scalar added (Task 3), `App.jsx` wiring (Task 4), UI placement between Theme and Channels with 1h default (Task 5), full verification (Task 6). All spec sections are covered.
- **Type consistency:** `setHistoryRetentionSec` is defined once (Task 2, corrected in Task 5 Step 4) accepting a string-or-number and normalizing via `Number(value)` before `normalizeHistoryRetentionSec`; every call site (`SettingsPanel`'s `onValueChange`, `AppSettingsOverlays` passthrough) uses this same name and contract.
- **No placeholders:** every step has literal code, exact file paths, and exact run commands with expected results.
