# Focus View Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. Keep each task independently reviewable.

**Goal:** Add Focus View, a toolbar popover with two independent options:
`Auto-hide controls` and `Compact panels`. Both options persist and are captured
by presets.

**Architecture:** `Auto-hide controls` is shell/window behaviour owned by
`App.jsx` plus a small window-decoration bridge. `Compact panels` is workspace
rendering behaviour owned by `LeafView`. The state lives in the settings domain
and is captured/restored by `usePresets`.

**Tech Stack:** React/JSX, Tauri v2 window APIs or a small Rust command fallback,
Vitest, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-18-focus-view-design.md`

---

## File Structure

- Add `src/components/FocusViewPopover.jsx`
- Add `src/components/FocusViewPopover.test.jsx`
- Add `src/hooks/useFocusViewWindow.js` or `src/lib/focusViewWindow.js`
- Modify `src/hooks/useSettings.js`
- Modify `src/hooks/usePresets.js`
- Modify `src/App.jsx`
- Modify `src/lib/shellLayout.js`
- Modify `src/workspace/LeafView.jsx`
- Modify relevant tests:
  - `src/App.toolbar.test.js`
  - `src/hooks/useSettings*.test.*`
  - `src/hooks/usePresets.test.jsx`
  - `src/workspace/SplitLayout.test.js` or `src/workspace/LeafView` coverage if
    present
- Optional fallback if JS window API cannot toggle decorations:
  - Modify `src-tauri/src/window_state.rs`
  - Modify `src-tauri/src/lib.rs`
  - Add/extend Rust tests where practical

---

## Task 1: Add Focus View settings state

**Files:**
- Modify: `src/hooks/useSettings.js`
- Modify: settings tests

- [ ] **Step 1: Add normalizer helpers**

Create helpers in `useSettings.js` or a small settings helper module:

```js
const DEFAULT_FOCUS_VIEW = {
  autoHideControls: false,
  compactPanels: false,
};

function normalizeFocusView(raw) {
  return {
    autoHideControls: raw?.autoHideControls === true,
    compactPanels: raw?.compactPanels === true,
  };
}
```

- [ ] **Step 2: Add state and setters to `useSettings`**

Read from `settingsStore.read().focusView`, expose:

- `focusView`
- `setFocusView`
- `setAutoHideControls`
- `setCompactPanels`

Setters patch `settingsStore` with:

```js
settingsStore.patch({
  focusView: { ...currentFocusView, autoHideControls: next },
});
```

Manual toggles should also clear `presetsStore.activeId` because presets now own
Focus View state. This can live in the setter layer.

- [ ] **Step 3: Subscribe to external settings changes**

Extend the existing `settingsStore.subscribe()` callback so external patches
update the Focus View React state.

- [ ] **Step 4: Test settings behaviour**

Cover:

- Missing/malformed `focusView` normalizes to both options off.
- Toggling each option patches settings.
- Toggling each option clears `presetsStore.activeId`.
- External settings patch updates the hook state.

Run targeted tests.

---

## Task 2: Capture and restore Focus View in presets

**Files:**
- Modify: `src/hooks/usePresets.js`
- Modify: `src/hooks/usePresets.test.jsx`

- [ ] **Step 1: Pass Focus View into `usePresets`**

Extend the hook signature:

```js
export function usePresets({
  windowPinned = false,
  setWindowPinned = () => {},
  focusView,
  setFocusView = () => {},
} = {}) {
```

Callsite in `App.jsx` passes the settings values.

- [ ] **Step 2: Save Focus View in snapshots**

Add to `captureSnapshot()`:

```js
focusView: normalizeFocusView(focusView),
```

Use the same normalizer as settings, or a local copy exported from a shared
module if tests need direct access.

- [ ] **Step 3: Restore Focus View on apply**

After `setView(...)`, window bounds, and pin restoration:

```js
if (preset.focusView) setFocusView(normalizeFocusView(preset.focusView));
```

If `preset.focusView` is missing, leave the current Focus View settings
unchanged.

- [ ] **Step 4: Test preset behaviour**

Cover:

- `save()` includes `focusView`.
- `update()` replaces the saved `focusView`.
- `apply()` restores `focusView` when present.
- `apply()` leaves current Focus View unchanged for older presets with no
  `focusView`.

Run targeted preset tests.

---

## Task 3: Add `FocusViewPopoverContent`

**Files:**
- Add: `src/components/FocusViewPopover.jsx`
- Add: `src/components/FocusViewPopover.test.jsx`

- [ ] **Step 1: Write component tests**

Render with props:

```js
{
  focusView: { autoHideControls: false, compactPanels: false },
  setAutoHideControls: vi.fn(),
  setCompactPanels: vi.fn(),
}
```

Cover:

- Header label `Focus View` renders.
- `Auto-hide controls` switch reflects and toggles its value.
- `Compact panels` switch reflects and toggles its value.

- [ ] **Step 2: Implement component**

Use the existing UI switch component (`src/components/ui/switch.jsx`) and label
patterns from `SettingsPanel`.

Suggested body:

```jsx
export function FocusViewPopoverContent({
  focusView = DEFAULT_FOCUS_VIEW,
  setAutoHideControls = () => {},
  setCompactPanels = () => {},
}) {
  return (
    <div className="grid gap-2">
      <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
        Focus View
      </p>
      ...
    </div>
  );
}
```

Keep visible copy minimal; do not add explanatory text in the app UI.

- [ ] **Step 3: Run tests**

```bash
npm test -- src/components/FocusViewPopover.test.jsx
```

---

## Task 4: Wire toolbar entry

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.toolbar.test.js`

- [ ] **Step 1: Add toolbar tests**

Assert source contains:

- `Focus` import from `lucide-react`.
- `tip="Focus View"`.
- `FocusViewPopoverContent`.

Assert active highlight logic exists for either Focus View option.

- [ ] **Step 2: Import and render trigger**

Add `Focus` to the lucide import and import `FocusViewPopoverContent`.

Insert the popover between Presets and Settings:

```jsx
<Popover>
  <PopoverTrigger asChild>
    <span>
      <IconButton
        icon={<Focus className="size-3.5" />}
        tip="Focus View"
        className={
          focusView.autoHideControls || focusView.compactPanels
            ? "text-foreground"
            : undefined
        }
      />
    </span>
  </PopoverTrigger>
  <PopoverContent align="end" sideOffset={6} className="w-56 p-1">
    <FocusViewPopoverContent
      focusView={focusView}
      setAutoHideControls={setAutoHideControls}
      setCompactPanels={setCompactPanels}
    />
  </PopoverContent>
</Popover>
```

- [ ] **Step 3: Pass Focus View into presets**

Change `usePresets({ windowPinned: pinned, setWindowPinned: setPinned })` to
also pass `focusView` and `setFocusView`.

- [ ] **Step 4: Run toolbar tests**

```bash
npm test -- src/App.toolbar.test.js
```

---

## Task 5: Implement shell auto-hide layout

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/lib/shellLayout.js`
- Add/modify shell tests if present

- [ ] **Step 1: Add shell layout constants**

Add class constants for:

- Normal shell inner layout (existing behaviour).
- Focus shell inner layout with no header/footer gap.
- Overlay header/footer.
- Top and bottom reveal hot zones.

Keep dimensions token-friendly and stable. Use explicit hot-zone height
(`h-3` or equivalent) so the reveal target does not shift.

- [ ] **Step 2: Track control visibility**

In `AppContent`, add state such as:

```js
const [focusControlsVisible, setFocusControlsVisible] = useState(false);
```

When `autoHideControls` is false, controls are always in normal layout.

When true:

- Top hot zone `onPointerEnter` shows header.
- Bottom hot zone `onPointerEnter` shows footer.
- Overlay wrapper `onPointerLeave` hides after a short delay.
- Opening a toolbar popover should keep controls visible. If that is too much
  for the first slice, rely on pointer presence and add a TODO in the plan's
  self-review.

- [ ] **Step 3: Render normal vs overlay shell**

Normal mode keeps:

```jsx
<header className={SHELL_HEADER}>...</header>
<SplitLayout />
<footer className={SHELL_FOOTER}>...</footer>
```

Auto-hide mode renders:

```jsx
<div className={TOP_REVEAL_HOT_ZONE} ... />
{focusControlsVisible && <header className={SHELL_HEADER_OVERLAY}>...</header>}
<SplitLayout />
{focusControlsVisible && <footer className={SHELL_FOOTER_OVERLAY}>...</footer>}
<div className={BOTTOM_REVEAL_HOT_ZONE} ... />
```

Extract header/footer JSX into small local render helpers inside `AppContent` to
avoid duplicating toolbar markup.

- [ ] **Step 4: Add `Esc` reveal behaviour**

Extend the existing keydown handler:

- If `Escape` and `focusView.autoHideControls` is true, show controls.
- Do not interfere with rename/input Escape handling when an input or textarea
  is focused.

- [ ] **Step 5: Test layout behaviour**

Cover with source or component tests:

- Auto-hide mode uses overlay classes/hot zones.
- Normal mode preserves in-flow header/footer.
- `Esc` reveal handler exists.

Run targeted tests.

---

## Task 6: Toggle frameless / decorations

**Files:**
- Add: `src/hooks/useFocusViewWindow.js` or `src/lib/focusViewWindow.js`
- Possibly modify: `src-tauri/src/window_state.rs`, `src-tauri/src/lib.rs`
- Add/modify tests where practical

- [ ] **Step 1: Try the Tauri JS window API first**

Create a small wrapper:

```js
export async function setWindowDecorations(enabled) {
  if (!isTauri()) return false;
  const win = getCurrentWindow();
  if (typeof win.setDecorations === "function") {
    await win.setDecorations(enabled);
    return true;
  }
  return false;
}
```

Use it from a hook:

```js
useEffect(() => {
  void setWindowDecorations(!focusView.autoHideControls);
}, [focusView.autoHideControls]);
```

- [ ] **Step 2: Add Rust fallback only if needed**

If the installed Tauri version does not expose a runtime decorations setter in
JS, add a command such as:

```rust
#[tauri::command]
fn set_window_decorations(window: tauri::Window, decorations: bool) -> Result<(), String> {
  window.set_decorations(decorations).map_err(|e| e.to_string())
}
```

Register it in `src-tauri/src/lib.rs` and call it from the JS wrapper.

- [ ] **Step 3: Add drag affordance**

In Auto-hide controls mode:

- Make the revealed header drag-capable on non-interactive empty/background
  areas.
- Make the top 8-12 px hot zone drag-capable if Tauri supports drag regions
  without swallowing child controls.
- Do not mark `data-leaf-body` or chart panels as drag regions.

- [ ] **Step 4: Verify manually**

Run the desktop app and verify:

- Toggle on removes system frame.
- Toggle off restores system frame.
- Window can move via top hot zone / header.
- Chart interactions still work.
- Resize still works.
- Maximized and restored states behave sensibly.

---

## Task 7: Implement Compact panels

**Files:**
- Modify: `src/workspace/LeafView.jsx`
- Modify/add tests for workspace leaf rendering

- [ ] **Step 1: Pass compact state to workspace rendering**

Simplest path: include `compactPanels` in `AudioDataContext` from `App.jsx`:

```js
compactPanels: focusView.compactPanels,
```

`LeafView` already reads `useAudioData()`, so it can use
`audioData?.compactPanels`.

Alternative: create a dedicated view settings context if this starts feeling
awkward. Avoid broad refactors in v1.

- [ ] **Step 2: Conditionally hide the slot header**

In `LeafView`, wrap the `data-leaf-tabs` block:

```jsx
{!compactPanels && (
  <div data-leaf-tabs ...>
    ...
  </div>
)}
```

Keep `data-leaf-body` as `flex min-h-0 flex-1 overflow-hidden` so it fills the
released space.

- [ ] **Step 3: Guard drag/drop behaviour**

Because tab targets are hidden:

- Dragging tabs is impossible from the UI in compact mode.
- Drop hints that depend on tab zones should not appear from stale drag state.
  If necessary, ensure compact mode suppresses tab-zone rendering.

- [ ] **Step 4: Test Compact panels**

Cover:

- Normal mode renders `data-leaf-tabs`.
- Compact mode does not render `data-leaf-tabs`.
- Active panel content still renders.
- Fullscreen and close buttons are absent in compact mode.

Run targeted workspace tests.

---

## Task 8: Verification

- [ ] **Step 1: Run targeted tests**

```bash
npm test -- src/components/FocusViewPopover.test.jsx src/App.toolbar.test.js src/hooks/usePresets.test.jsx
```

Add any settings/workspace test files touched by implementation.

- [ ] **Step 2: Run full frontend test suite**

```bash
npm test
```

- [ ] **Step 3: Run Rust tests if a Rust fallback command was added**

```bash
cargo test --manifest-path src-tauri/Cargo.toml window_state
```

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Manual desktop QA**

Run the desktop app and verify:

- Focus View button appears between Presets and Settings.
- Button highlights when either option is enabled.
- Both switches persist across restart.
- Saving a preset captures both switches.
- Applying a preset restores both switches.
- Toggling either switch manually clears the active preset footer label.
- Auto-hide controls removes the system frame and reveals controls from the top
  and bottom edges.
- `Esc` reveals hidden controls.
- Compact panels hides panel headers and expands chart bodies.
- Both options together produce the clean capture layout.
- Existing Start/Clear/device/pin/modules/presets/settings controls still work.

---

## Self-review notes

- **Highest-risk area:** runtime frameless behaviour on Windows. Keep the bridge
  tiny and verify manually in the real desktop app.
- **Do not make chart areas draggable:** history, waveform, spectrogram, split
  rails, and future chart gestures need their pointer events.
- **Preset semantics changed:** Focus View is now preset-owned state. Manual
  toggles must clear the active preset, and preset apply must restore the saved
  Focus View values.
- **Compact mode v1 is intentionally bare:** no hover labels, no temporary panel
  controls. The chart body gets the space.
