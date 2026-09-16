# Settings Panel Polish (#143) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Settings panel by replacing the loudness reference preset dropdown with a custom LUFS number input, reordering settings rows, removing the legacy Reset Layout button, speeding up the exit animation, and making the audio device toolbar icon open a dropdown directly.

**Architecture:** The loudness reference propagates from `useSettings` → `useLoudnessHistory` → `AudioDataContext` → `LoudnessPanel` → `LoudnessHistoryChart`. All links in this chain switch from carrying a `referenceProfile` object to a plain `referenceLufs: number`. The SettingsPanel and App.jsx audio device toolbar are updated independently.

**Tech Stack:** React, Framer Motion, Radix UI (Select/Sheet), shadcn/ui, Vitest + React Testing Library, localStorage for persistence.

---

## File Map

| File | Change |
|---|---|
| `src/config/loudnessReferenceProfiles.js` | Strip to single constant |
| `src/config/loudnessReferenceProfiles.test.js` | **Delete** |
| `src/hooks/useLoudnessHistory.js` | `referenceProfileId` → `referenceLufs` param + return |
| `src/components/panels/LoudnessHistoryChart.jsx` | `referenceProfile` prop → `referenceLufs` prop |
| `src/components/panels/LoudnessPanel.jsx` | `referenceProfile` → `referenceLufs` in destructure + pass-through |
| `src/hooks/useSettings.js` | `referenceProfileId` → `referenceLufs: number` state |
| `src/hooks/useSettings.rtl.test.jsx` | Add referenceLufs persistence tests |
| `src/components/SettingsPanel.jsx` | All 5 UI polish items |
| `src/components/SettingsPanel.test.jsx` | Update BASE_PROPS, update label assertions |
| `src/App.jsx` | Persistence, audio device Select, footer, prop wiring, import cleanup |
| `src/components/CaptureDeviceSelect.jsx` | **Delete** |

---

## Task 1: Strip loudnessReferenceProfiles.js and delete its tests

**Files:**
- Modify: `src/config/loudnessReferenceProfiles.js`
- Delete: `src/config/loudnessReferenceProfiles.test.js`

- [ ] **Step 1: Replace the file contents**

`src/config/loudnessReferenceProfiles.js` becomes:

```js
export const DEFAULT_REFERENCE_LUFS = -23;
```

- [ ] **Step 2: Delete the test file**

```bash
rm src/config/loudnessReferenceProfiles.test.js
```

- [ ] **Step 3: Run the full test suite to confirm nothing else imported from this file**

```bash
npm test
```

Expected: all remaining tests pass. If any test imports `LOUDNESS_REFERENCE_PROFILES`, `getLoudnessReferenceProfileById`, or `normalizeLoudnessReferenceProfileId`, fix that import before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/config/loudnessReferenceProfiles.js
git rm src/config/loudnessReferenceProfiles.test.js
git commit -m "refactor: strip loudnessReferenceProfiles to single DEFAULT_REFERENCE_LUFS constant"
```

---

## Task 2: Migrate useLoudnessHistory to accept referenceLufs directly

**Files:**
- Modify: `src/hooks/useLoudnessHistory.js`

- [ ] **Step 1: Remove the getLoudnessReferenceProfileById import**

Line 10, remove:
```js
import { getLoudnessReferenceProfileById } from "../config/loudnessReferenceProfiles.js";
```

- [ ] **Step 2: Update the function signature and JSDoc**

Change the function signature from:
```js
/**
 * @param {{ histSourceList, hasHistoryData, running, displayAudio, referenceProfileId, selectedOffset }} params
 */
export function useLoudnessHistory({
  histSourceList,
  hasHistoryData,
  running,
  displayAudio,
  referenceProfileId,
  selectedOffset,
}) {
```

To:
```js
/**
 * @param {{ histSourceList, hasHistoryData, running, displayAudio, referenceLufs, selectedOffset }} params
 */
export function useLoudnessHistory({
  histSourceList,
  hasHistoryData,
  running,
  displayAudio,
  referenceLufs,
  selectedOffset,
}) {
```

- [ ] **Step 3: Replace the referenceProfile useMemo + targetLufs derivation**

Remove these lines (~109–115):
```js
const referenceProfile = useMemo(
  () => getLoudnessReferenceProfileById(referenceProfileId),
  [referenceProfileId]
);
const targetLufs = Number.isFinite(referenceProfile?.targetLufs)
  ? referenceProfile.targetLufs
  : -23;
```

Replace with:
```js
const targetLufs = Number.isFinite(referenceLufs) ? referenceLufs : -23;
```

- [ ] **Step 4: Update the return value**

In the return object, remove `referenceProfile,` and add `referenceLufs,`:

```js
return {
  // ... (all existing fields unchanged) ...
  // Metrics
  referenceLufs,       // ← added (was referenceProfile)
  targetLufs,
  historyYAxisTicks,
  primaryMetrics,
  secondaryMetrics,
};
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass. (No tests directly cover this hook; errors at this stage mean a missed import somewhere.)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useLoudnessHistory.js
git commit -m "refactor: useLoudnessHistory accepts referenceLufs number, drops referenceProfile object"
```

---

## Task 3: Update LoudnessHistoryChart and LoudnessPanel prop chain

**Files:**
- Modify: `src/components/panels/LoudnessHistoryChart.jsx`
- Modify: `src/components/panels/LoudnessPanel.jsx`

- [ ] **Step 1: Update LoudnessHistoryChart props**

In `LoudnessHistoryChart`, change line 47 from `referenceProfile,` to `referenceLufs,`:

```jsx
export function LoudnessHistoryChart({
  historyYAxisTicks,
  targetLufs,
  hasHistoryData,
  historyChartInteractive,
  running,
  setSelectedOffset,
  setStatus,
  holdHistoryHud,
  showHistoryHud,
  onHistoryWheel,
  onHistoryPointerDown,
  onHistoryPointerMove,
  onHistoryPointerUp,
  histCurves,
  displayHistoryPathM,
  displayHistoryPathST,
  selectedOffset,
  showSelLine,
  selLineX,
  isHistoryHudVisible,
  clampedWindowSec,
  effectiveOffsetSec,
  historyHover,
  historyTimeTicks,
  historyTickSteps,
  referenceLufs,       // ← was referenceProfile
  onHistoryHoverMove,
  onHistoryHoverLeave,
}) {
```

- [ ] **Step 2: Remove the local referenceLufs derivation (lines ~56–58)**

Remove:
```js
const referenceLufs = Number.isFinite(referenceProfile?.targetLufs)
  ? referenceProfile.targetLufs
  : null;
```

`referenceLufs` is now a direct prop (always a valid number).

- [ ] **Step 3: Update the reference band render condition**

Find `{referenceLufs != null ? (` and change to `{Number.isFinite(referenceLufs) ? (` to match the new prop type.

- [ ] **Step 4: Update the reference band label**

Change line ~252 from:
```jsx
Ref {referenceProfile?.label ?? `${referenceLufs} LUFS`}
```
To:
```jsx
Ref {referenceLufs} LUFS
```

- [ ] **Step 5: Update LoudnessPanel**

In `src/components/panels/LoudnessPanel.jsx`, change `referenceProfile` to `referenceLufs` in two places:

In the destructure from `useAudioData()` (line ~23):
```js
const {
  historyYAxisTicks,
  targetLufs,
  referenceLufs,       // ← was referenceProfile
  hasHistoryData,
  // ... rest unchanged
} = useAudioData();
```

In the `LoudnessHistoryChart` render (line ~88):
```jsx
<LoudnessHistoryChart
  // ... all other props unchanged ...
  referenceLufs={referenceLufs}   // ← was referenceProfile={referenceProfile}
  // ...
/>
```

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/panels/LoudnessHistoryChart.jsx src/components/panels/LoudnessPanel.jsx
git commit -m "refactor: LoudnessHistoryChart/Panel use referenceLufs number prop instead of referenceProfile object"
```

---

## Task 4: Migrate useSettings to referenceLufs state

**Files:**
- Modify: `src/hooks/useSettings.js`
- Modify: `src/hooks/useSettings.rtl.test.jsx`

- [ ] **Step 1: Write failing tests first**

Add to `src/hooks/useSettings.rtl.test.jsx`:

```js
import { UI_PREFERENCES } from "../uiPreferences";

// Add inside describe("useSettings", ...) block:

it("defaults referenceLufs to -23 when localStorage is empty", () => {
  localStorage.clear();
  const { result } = renderHook(() => useSettings());
  expect(result.current.referenceLufs).toBe(-23);
});

it("reads referenceLufs from localStorage", () => {
  localStorage.setItem(
    UI_PREFERENCES.layoutPersistKey,
    JSON.stringify({ referenceLufs: -14 })
  );
  const { result } = renderHook(() => useSettings());
  expect(result.current.referenceLufs).toBe(-14);
});

it("resets referenceLufs to -23 when stored value is out of range", () => {
  localStorage.setItem(
    UI_PREFERENCES.layoutPersistKey,
    JSON.stringify({ referenceLufs: 5 })
  );
  const { result } = renderHook(() => useSettings());
  expect(result.current.referenceLufs).toBe(-23);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --run src/hooks/useSettings.rtl.test.jsx
```

Expected: the three new tests FAIL (property `referenceLufs` is undefined).

- [ ] **Step 3: Update useSettings.js**

Remove these lines near the top of the file:
```js
import {
  getDefaultLoudnessReferenceProfileId,
  normalizeLoudnessReferenceProfileId,
} from "../config/loudnessReferenceProfiles";
```

Add a local normalize helper (before the `useSettings` function):
```js
function normalizeReferenceLufs(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= -70 && n <= 0 ? n : -23;
}
```

Replace the `referenceProfileId` state block:
```js
// Remove:
const [referenceProfileId, setReferenceProfileId] = useState(() => {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES.layoutPersistKey);
    if (!raw) return getDefaultLoudnessReferenceProfileId();
    const s = JSON.parse(raw);
    return normalizeLoudnessReferenceProfileId(s.referenceProfileId);
  } catch (_) {}
  return getDefaultLoudnessReferenceProfileId();
});

// Replace with:
const [referenceLufs, setReferenceLufs] = useState(() => {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES.layoutPersistKey);
    if (!raw) return -23;
    const s = JSON.parse(raw);
    return normalizeReferenceLufs(s.referenceLufs);
  } catch (_) {}
  return -23;
});
```

Update the return object at the bottom of `useSettings`:
```js
// Remove:
referenceProfileId,
setReferenceProfileId,

// Add:
referenceLufs,
setReferenceLufs,
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --run src/hooks/useSettings.rtl.test.jsx
```

Expected: all 5 tests PASS (2 existing + 3 new).

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass. Any failure here means App.jsx or SettingsPanel.jsx still destructures `referenceProfileId` from `useSettings` — fix in the relevant task.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSettings.js src/hooks/useSettings.rtl.test.jsx
git commit -m "feat: useSettings stores referenceLufs number instead of referenceProfileId string"
```

---

## Task 5: Update SettingsPanel UI (all 5 polish items)

**Files:**
- Modify: `src/components/SettingsPanel.jsx`
- Modify: `src/components/SettingsPanel.test.jsx`

- [ ] **Step 1: Update SettingsPanel.test.jsx BASE_PROPS first**

Replace the `BASE_PROPS` object:

```js
// Remove these imports:
import { LOUDNESS_REFERENCE_PROFILES } from "../config/loudnessReferenceProfiles.js";

// BASE_PROPS becomes:
const BASE_PROPS = {
  settingsOpen: true,
  setSettingsOpen: vi.fn(),
  setAppearanceMode: vi.fn(),
  fixedThemeSelectValue: "",
  setFixedThemeIdFromPicker: vi.fn(),
  themeSelectOptions: THEME_SELECT_OPTIONS,
  referenceLufs: -23,
  setReferenceLufs: vi.fn(),
  channelLayout: "auto",
  setChannelLayout: vi.fn(),
  vectorscopePairOptions: [],
  vectorscopePairX: 0,
  vectorscopePairY: 1,
  onVectorscopePairChange: vi.fn(),
};
```

Update the "renders core controls" test to match the new input element:

```js
it("renders core controls when open in system mode", () => {
  render(<SettingsPanel {...BASE_PROPS} appearance="system" />);
  expect(screen.getByLabelText("Loudness reference")).toBeTruthy();
  expect(screen.getByLabelText("Appearance")).toBeTruthy();
  expect(screen.queryByLabelText("Colour theme")).toBeNull();
});
```

(The label text "Loudness reference" stays the same; only the underlying control type changes from Select to input. The `getByLabelText` query works via `htmlFor`/`id` association regardless of element type.)

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --run src/components/SettingsPanel.test.jsx
```

Expected: FAIL because `SettingsPanel` still expects old props.

- [ ] **Step 3: Rewrite SettingsPanel.jsx**

Replace the entire file:

```jsx
import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function SettingsPanel({
  settingsOpen,
  setSettingsOpen,
  appearance,
  setAppearanceMode,
  fixedThemeSelectValue,
  setFixedThemeIdFromPicker,
  themeSelectOptions,
  referenceLufs,
  setReferenceLufs,
  channelLayout,
  setChannelLayout,
  /** @type {{ key: string; label: string; x: number; y: number }[]} */
  vectorscopePairOptions = [],
  vectorscopePairX = 0,
  vectorscopePairY = 1,
  onVectorscopePairChange,
}) {
  const vsKey = `${vectorscopePairX}-${vectorscopePairY}`;
  const reduceMotion = useReducedMotion();
  const [sheetBodyVisible, setSheetBodyVisible] = useState(settingsOpen);
  const closingIntentRef = useRef(false);

  useLayoutEffect(() => {
    if (settingsOpen) {
      closingIntentRef.current = false;
      setSheetBodyVisible(true);
      return;
    }
    if (!closingIntentRef.current) {
      setSheetBodyVisible(false);
    }
  }, [settingsOpen]);

  const handleOpenChange = (open) => {
    if (open) {
      closingIntentRef.current = false;
      setSettingsOpen(true);
      setSheetBodyVisible(true);
      return;
    }
    closingIntentRef.current = true;
    setSheetBodyVisible(false);
  };

  return (
    <Sheet open={settingsOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className={cn(
          "w-full gap-0 overflow-y-auto border-border bg-card/95 p-6 backdrop-blur-md sm:max-w-md",
          "pt-12"
        )}
      >
        <AnimatePresence
          onExitComplete={() => {
            if (closingIntentRef.current) {
              closingIntentRef.current = false;
              setSettingsOpen(false);
            }
          }}
        >
          {sheetBodyVisible ? (
            <motion.div
              key="settings-inner"
              initial={reduceMotion ? false : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: 0, x: 14, transition: { duration: 0.12, ease: "easeIn" } }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 420, damping: 36, mass: 0.35 }
              }
            >
              <SheetHeader className="mb-[var(--ui-modal-header-gap)] space-y-0 p-0 pr-10 text-left">
                <SheetTitle className="text-[length:var(--ui-fs-panel-title)] font-semibold text-muted-foreground">
                  Settings
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-5 text-[length:var(--ui-fs-metric-meta)]">
                <div className="grid gap-2">
                  <Label htmlFor="settings-appearance">Appearance</Label>
                  <Select value={appearance} onValueChange={setAppearanceMode}>
                    <SelectTrigger id="settings-appearance">
                      <SelectValue placeholder="Appearance" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="system">Follow system</SelectItem>
                      <SelectItem value="fixed">Fixed theme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {appearance === "fixed" ? (
                  <div className="grid gap-2">
                    <Label htmlFor="settings-theme-id">Colour theme</Label>
                    <Select value={fixedThemeSelectValue} onValueChange={setFixedThemeIdFromPicker}>
                      <SelectTrigger id="settings-theme-id">
                        <SelectValue placeholder="Theme" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {themeSelectOptions.map((opt) => (
                          <SelectItem key={opt.id} value={opt.id}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-ref-lufs">Loudness reference</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="settings-ref-lufs"
                      type="number"
                      min={-70}
                      max={0}
                      step={1}
                      value={referenceLufs}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= -70 && n <= 0) setReferenceLufs(n);
                      }}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-[length:var(--ui-fs-metric-meta)] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <span className="text-muted-foreground shrink-0">LUFS</span>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-channel-layout">Channel layout (Advanced)</Label>
                  <Select value={channelLayout} onValueChange={setChannelLayout}>
                    <SelectTrigger id="settings-channel-layout">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="stereo">Stereo</SelectItem>
                      <SelectItem value="5.1">5.1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="settings-vs-pair">Vectorscope channels</Label>
                  {vectorscopePairOptions.length > 0 &&
                  typeof onVectorscopePairChange === "function" ? (
                    <Select
                      value={
                        vectorscopePairOptions.some((o) => o.key === vsKey)
                          ? vsKey
                          : vectorscopePairOptions[0]?.key
                      }
                      onValueChange={(key) => {
                        const [xRaw, yRaw] = String(key).split("-");
                        const x = Number.parseInt(xRaw || "0", 10);
                        const y = Number.parseInt(yRaw || "1", 10);
                        onVectorscopePairChange({
                          x: Number.isFinite(x) ? x : 0,
                          y: Number.isFinite(y) ? y : 1,
                        });
                      }}
                    >
                      <SelectTrigger id="settings-vs-pair">
                        <SelectValue placeholder="Pair" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {vectorscopePairOptions.map((o) => (
                          <SelectItem key={o.key} value={o.key}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      At least 2 channels (start monitoring)
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
}
```

Note: `Button` import is no longer needed (Reset Layout removed). Remove it from the import list.

- [ ] **Step 4: Run SettingsPanel tests**

```bash
npm test -- --run src/components/SettingsPanel.test.jsx
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(settings): reorder rows, custom LUFS input, remove Reset Layout, faster exit animation"
```

---

## Task 6: Wire App.jsx — persistence, audio device, footer, cleanup

**Files:**
- Modify: `src/App.jsx`
- Delete: `src/components/CaptureDeviceSelect.jsx`

- [ ] **Step 1: Update imports in App.jsx**

Remove these two lines:
```js
import { LOUDNESS_REFERENCE_PROFILES } from "./config/loudnessReferenceProfiles.js";
import { CaptureDeviceSelect } from "./components/CaptureDeviceSelect";
```

Add Select imports (after the existing `@/components/ui/popover` import):
```js
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
```

- [ ] **Step 2: Update useSettings destructure (lines ~43–54)**

```js
const {
  settingsOpen,
  setSettingsOpen,
  appearance,
  setAppearanceMode,
  fixedThemeSelectValue,
  setFixedThemeIdFromPicker,
  themeSelectOptions,
  resolvedThemeId,
  referenceLufs,        // ← was referenceProfileId
  setReferenceLufs,     // ← was setReferenceProfileId
} = useSettings();
```

- [ ] **Step 3: Add audioOutputs and audioInputs derived values**

After the `useAudioDevices()` destructure block (around line ~62), add:

```js
const audioOutputs = useMemo(
  () => (audioDevices || []).filter((d) => d.isSystemOutputMonitor),
  [audioDevices]
);
const audioInputs = useMemo(
  () => (audioDevices || []).filter((d) => !d.isSystemOutputMonitor),
  [audioDevices]
);
const safeAudioDeviceId = useMemo(() => {
  const allowed = new Set(["default", ...(audioDevices || []).map((d) => d.id)]);
  return allowed.has(captureDeviceId) ? captureDeviceId : "default";
}, [audioDevices, captureDeviceId]);
```

- [ ] **Step 4: Update useLoudnessHistory call (~line 176)**

```js
} = useLoudnessHistory({
  histSourceList,
  hasHistoryData,
  running,
  displayAudio,
  referenceLufs,      // ← was referenceProfileId
  selectedOffset,
});
```

- [ ] **Step 5: Update useLoudnessHistory destructure (~line 153)**

Remove `referenceProfile,` from the destructure list. `referenceLufs` is now returned from the hook (add it to the destructure if it isn't already listed — it needs to flow into `audioData`).

- [ ] **Step 6: Delete the resetLayout function (~lines 378–383)**

Remove:
```js
const resetLayout = () => {
  setMainLeft(UI_PREFERENCES.layout.mainColumn.initialPx);
  setLeftTopRatio(UI_PREFERENCES.layout.leftSplit.initialRatio);
  setRightTopRatio(UI_PREFERENCES.layout.rightSplit.initialRatio);
  setLoudnessHistWidthRatio(UI_PREFERENCES.layout.loudnessHistMetrics.initialRatio);
};
```

- [ ] **Step 7: Update the audioData object (~lines 546–547)**

```js
// Remove:
referenceProfile,

// Add:
referenceLufs,
```

(`targetLufs` line stays unchanged.)

- [ ] **Step 8: Update the localStorage persistence effect (~lines 456–485)**

In the `localStorage.setItem(...)` call, change:
```js
referenceProfileId,     // ← remove
// replace with:
referenceLufs,
```

In the effect dependency array, change:
```js
referenceProfileId,     // ← remove
// replace with:
referenceLufs,
```

- [ ] **Step 9: Replace the audio device Popover with a direct Select (~lines 601–619)**

Remove this block:
```jsx
{isTauri() && (
  <Popover>
    <PopoverTrigger asChild>
      <span>
        <IconButton icon={<Volume2 className="size-3.5" />} tip="Audio device" />
      </span>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={6} className="w-72 p-2">
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Audio Device
      </p>
      <CaptureDeviceSelect
        audioDevices={audioDevices}
        value={captureDeviceId}
        disabled={!audioDevices.length}
        onValueChange={(v) => setCaptureDeviceIdAndPersist(v)}
      />
    </PopoverContent>
  </Popover>
)}
```

Replace with:
```jsx
{isTauri() && (
  <div className="relative group">
    <Select
      value={safeAudioDeviceId}
      onValueChange={(v) => setCaptureDeviceIdAndPersist(v)}
      disabled={!audioDevices.length}
    >
      <SelectTrigger
        className="flex items-center justify-center size-8 rounded-md text-muted-foreground bg-transparent border-0 shadow-none hover:bg-secondary hover:text-foreground transition-colors duration-[120ms] disabled:opacity-40 disabled:cursor-not-allowed [&>svg:last-child]:hidden focus:ring-0 focus:ring-offset-0"
        aria-label="Audio device"
      >
        <Volume2 className="size-3.5" />
      </SelectTrigger>
      <SelectContent align="end" sideOffset={6} className="max-w-[min(22rem,90vw)]">
        <SelectItem value="default">Automatic (default system output)</SelectItem>
        {audioOutputs.length ? (
          <SelectGroup>
            <SelectLabel>Output</SelectLabel>
            {audioOutputs.map((d) => (
              <SelectItem key={d.id} value={d.id} className="min-w-0">
                <span className="truncate">{d.label}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
        {audioInputs.length ? (
          <SelectGroup>
            <SelectLabel>Input</SelectLabel>
            {audioInputs.map((d) => (
              <SelectItem key={d.id} value={d.id} className="min-w-0">
                <span className="truncate">{d.label}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
      </SelectContent>
    </Select>
    <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-100 delay-100 text-[11px] text-foreground bg-popover border border-white/10 rounded px-2 py-1 whitespace-nowrap shadow-md">
      Audio device
    </span>
  </div>
)}
```

- [ ] **Step 10: Update SettingsPanel props (~lines 674–692)**

```jsx
<SettingsPanel
  settingsOpen={settingsOpen}
  setSettingsOpen={setSettingsOpen}
  appearance={appearance}
  setAppearanceMode={setAppearanceMode}
  fixedThemeSelectValue={fixedThemeSelectValue}
  setFixedThemeIdFromPicker={setFixedThemeIdFromPicker}
  themeSelectOptions={themeSelectOptions}
  referenceLufs={referenceLufs}
  setReferenceLufs={setReferenceLufs}
  channelLayout={channelLayout}
  setChannelLayout={setChannelLayout}
  vectorscopePairOptions={vectorscopePairOptions}
  vectorscopePairX={vectorscopePairUi.x}
  vectorscopePairY={vectorscopePairUi.y}
  onVectorscopePairChange={onVectorscopePairChange}
/>
```

- [ ] **Step 11: Update the footer (~line 669)**

```jsx
// Remove:
{referenceProfile.label}

// Replace with:
{referenceLufs} LUFS
```

- [ ] **Step 12: Delete CaptureDeviceSelect.jsx**

```bash
git rm src/components/CaptureDeviceSelect.jsx
```

- [ ] **Step 13: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 14: Commit**

```bash
git add src/App.jsx
git rm src/components/CaptureDeviceSelect.jsx
git commit -m "feat(app): wire referenceLufs, inline audio device Select, update footer and persistence"
```

---

## Self-Review

**Spec coverage:**
- ✅ Item 1 (custom LUFS): Tasks 1–5 migrate the full data chain and replace the Select with a number input
- ✅ Item 2 (reorder): Task 5 — Appearance first, params after
- ✅ Item 3 (remove Reset Layout): Task 5 removes the button; Task 6 removes the `resetLayout` function
- ✅ Item 4 (exit animation): Task 5 — inline `transition` on `exit` target
- ✅ Item 5 (audio device direct): Task 6 — Popover replaced with inline Select

**Type consistency:** `referenceLufs: number` used consistently across all tasks. `setReferenceLufs` naming consistent in useSettings and SettingsPanel/App props.

**No placeholders found.**
