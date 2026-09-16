# Panel Opacity (Window Transparency) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slider in the Views popover (renamed from "Focus View") that controls window + panel background opacity (0–100%), enabling transparent overlay for video recording.

**Architecture:** A single `panelOpacity` value (0–100, default 100) flows from `settingsStore` → `useSettings` → App.jsx → CSS custom property `--panel-opacity`. LeafView and body background use this variable for their alpha. Tauri window is configured with `transparent: true` so the OS composites through. The value is saved in presets alongside `focusView`. Slider uses native `<input type="range">`, consistent with existing `SettingsSlider` in `PanelSettingsContent.jsx` and `ColorControl.jsx`.

**Tech Stack:** React 19, Tailwind CSS 4, native HTML range input, Tauri 2 (Rust), Vitest

---

### Task 1: Add `panelOpacity` to settings defaults and normalization

**Files:**
- Modify: `src/settings/defaults.js`
- Modify: `src/settings/defaults.test.js`

- [ ] **Step 1: Write the failing test**

Add to `src/settings/defaults.test.js`:

```js
import {
  DEFAULT_PANEL_OPACITY,
  normalizePanelOpacity,
} from "./defaults.js";

describe("normalizePanelOpacity", () => {
  it("returns default for null/undefined", () => {
    expect(normalizePanelOpacity(null)).toBe(DEFAULT_PANEL_OPACITY);
    expect(normalizePanelOpacity(undefined)).toBe(DEFAULT_PANEL_OPACITY);
  });
  it("clamps to 0–100", () => {
    expect(normalizePanelOpacity(-10)).toBe(0);
    expect(normalizePanelOpacity(150)).toBe(100);
  });
  it("rounds to integer", () => {
    expect(normalizePanelOpacity(55.7)).toBe(56);
  });
  it("passes through valid values", () => {
    expect(normalizePanelOpacity(0)).toBe(0);
    expect(normalizePanelOpacity(50)).toBe(50);
    expect(normalizePanelOpacity(100)).toBe(100);
  });
  it("returns default for non-numeric strings", () => {
    expect(normalizePanelOpacity("abc")).toBe(DEFAULT_PANEL_OPACITY);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/settings/defaults.test.js`
Expected: FAIL — `normalizePanelOpacity` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/settings/defaults.js`:

```js
export const DEFAULT_PANEL_OPACITY = 100;

export function normalizePanelOpacity(raw) {
  if (raw == null) return DEFAULT_PANEL_OPACITY;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PANEL_OPACITY;
  return Math.round(Math.max(0, Math.min(100, n)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/settings/defaults.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/defaults.js src/settings/defaults.test.js
git commit -m "feat(settings): add panelOpacity default and normalization" -m "" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Wire `panelOpacity` through `useSettings`

**Files:**
- Modify: `src/hooks/useSettings.js`

The pattern follows how `focusView` is wired: state initialized from `settingsStore.read()`, setter patches `settingsStore` and clears active preset, subscriber syncs state.

- [ ] **Step 1: Add panelOpacity state and setter**

In `src/hooks/useSettings.js`, add the import:

```js
import {
  DEFAULT_CLOSE_ACTION,
  DEFAULT_PANEL_OPACITY,
  normalizeCloseAction,
  normalizePanelOpacity,
  normalizeReferenceLufs,
  normalizeSettingsFocusView,
  normalizeThemeEditorPos,
} from "../settings/defaults.js";
```

Add state after `channelLabelOverrides`:

```js
const [panelOpacity, setPanelOpacityState] = useState(() =>
  normalizePanelOpacity(settingsStore.read().panelOpacity)
);
```

Add setter function (after `setCompactPanels`):

```js
function setPanelOpacity(value) {
  const next = normalizePanelOpacity(value);
  settingsStore.patch({ panelOpacity: next });
  presetsStore.patch({ activeId: null });
  setPanelOpacityState(next);
}
```

- [ ] **Step 2: Add to settingsStore subscriber**

In the `settingsStore.subscribe` effect (around line 159), add:

```js
setPanelOpacityState(normalizePanelOpacity(settingsStore.read().panelOpacity));
```

- [ ] **Step 3: Add to persistence effect**

In the `useEffect` that patches `settingsStore` with `referenceLufs`, `appearance`, etc. (around line 150), add `panelOpacity` to the patch object:

```js
settingsStore.patch({
  referenceLufs,
  appearance,
  themeId: appearance === "system" ? null : fixedThemeSelectValue,
  channelLabelOverrides,
  panelOpacity,
});
```

- [ ] **Step 4: Add to return object**

Add `panelOpacity` and `setPanelOpacity` to the return object.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSettings.js
git commit -m "feat(settings): wire panelOpacity through useSettings" -m "" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Rename "Focus View" to "Views" in the popover and add opacity slider

**Files:**
- Modify: `src/components/FocusViewPopover.jsx`

- [ ] **Step 1: Rename the heading and add slider**

Update `src/components/FocusViewPopover.jsx`. Use native `<input type="range">` consistent with `ColorControl.jsx` and `PanelSettingsContent.jsx`:

```jsx
import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "@/lib/focusView.js";
import { DEFAULT_PANEL_OPACITY } from "@/settings/defaults.js";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

function FocusSwitch({ id, label, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded px-2 py-1.5">
      <Label htmlFor={id} className="min-w-0 text-xs font-normal text-foreground">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function FocusViewPopoverContent({
  pinned = false,
  setPinned = () => {},
  focusView = DEFAULT_FOCUS_VIEW,
  setAutoHideControls = () => {},
  setCompactPanels = () => {},
  panelOpacity = DEFAULT_PANEL_OPACITY,
  setPanelOpacity = () => {},
}) {
  const normalized = normalizeFocusView(focusView);

  return (
    <div className="grid gap-1">
      <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
        Views
      </p>
      <FocusSwitch
        id="focus-view-always-on-top"
        label="Always on top"
        checked={pinned === true}
        onCheckedChange={setPinned}
      />
      <FocusSwitch
        id="focus-view-compact-panels"
        label="Compact panels"
        checked={normalized.compactPanels}
        onCheckedChange={setCompactPanels}
      />
      <FocusSwitch
        id="focus-view-auto-hide-controls"
        label="Auto-hide controls"
        checked={normalized.autoHideControls}
        onCheckedChange={setAutoHideControls}
      />
      <div className="flex items-center gap-3 rounded px-2 py-1.5">
        <Label htmlFor="panel-opacity" className="min-w-0 shrink-0 text-xs font-normal text-foreground">
          Opacity
        </Label>
        <input
          id="panel-opacity"
          aria-label="Panel opacity"
          type="range"
          min={0}
          max={100}
          step={1}
          value={panelOpacity}
          onInput={(e) => setPanelOpacity(Number(e.target.value))}
          className="h-4 flex-1 accent-primary"
        />
        <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
          {panelOpacity}%
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the tooltip text in AppHeader.jsx**

In `src/components/AppHeader.jsx`, change the Focus icon's `tip` prop from `"Focus View"` to `"Views"` (line 199):

```jsx
<IconButton
  icon={<Focus className="size-3.5" />}
  tip="Views"
  className={focusViewActive ? "text-foreground" : undefined}
/>
```

- [ ] **Step 3: Update `focusViewActive` to include panelOpacity**

In `src/App.jsx` (line 621), update to include opacity as a "view active" signal:

```js
const focusViewActive = pinned || focusView.autoHideControls || focusView.compactPanels || panelOpacity < 100;
```

- [ ] **Step 4: Pass panelOpacity props through AppHeader → FocusViewPopoverContent**

In `src/components/AppHeader.jsx`, add `panelOpacity` and `setPanelOpacity` to the component props and pass them to `FocusViewPopoverContent`:

```jsx
<FocusViewPopoverContent
  pinned={pinned}
  setPinned={setPinned}
  focusView={focusView}
  setAutoHideControls={setAutoHideControls}
  setCompactPanels={setCompactPanels}
  panelOpacity={panelOpacity}
  setPanelOpacity={setPanelOpacity}
/>
```

In `src/App.jsx`, pass `panelOpacity` and `setPanelOpacity` to `<AppHeader>`.

- [ ] **Step 5: Update existing tests**

Search for any test referencing "Focus View" as text content and update to "Views". Check:
- `src/components/FocusViewPopover.test.jsx` (if it exists)
- `src/App.toolbar.test.js`

- [ ] **Step 6: Commit**

```bash
git add src/components/FocusViewPopover.jsx src/components/AppHeader.jsx src/App.jsx
git add -u  # catch any test files
git commit -m "feat(views): rename Focus View to Views, add opacity slider" -m "" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Apply `--panel-opacity` CSS variable to document and use it in LeafView + body

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/index.css`

- [ ] **Step 1: Set the CSS variable on panelOpacity change**

In `src/App.jsx`, add an effect that sets the CSS custom property whenever `panelOpacity` changes:

```js
useEffect(() => {
  document.documentElement.style.setProperty("--panel-opacity", String(panelOpacity / 100));
}, [panelOpacity]);
```

- [ ] **Step 2: Update body background in `src/index.css`**

Replace the solid `background-color` on `body` (line 67) with one that respects `--panel-opacity`. Since `--background` is a hex/oklch color, use `color-mix` to add alpha:

```css
body {
  background-color: color-mix(in srgb, var(--background) calc(var(--panel-opacity, 1) * 100%), transparent);
}
```

- [ ] **Step 3: Update LeafView panel background**

In `src/workspace/LeafView.jsx` (line 110), replace the hardcoded `bg-card/55` with a dynamic opacity. Use an inline style for the background since the opacity value is dynamic:

```jsx
className={cn(
  "relative flex min-h-0 flex-col overflow-hidden rounded-[10px] border shadow-sm backdrop-blur-md transition-[border-color,box-shadow] duration-150",
  "border-border/80 hover:border-border",
  // ... other conditional classes
)}
style={{
  ...style,
  backgroundColor: `color-mix(in srgb, var(--card) calc(var(--panel-opacity, 1) * 55%), transparent)`,
}}
```

Note: The original `bg-card/55` means 55% of the card color. When `--panel-opacity` is 1 (100%), this gives the same 55%. When the user lowers opacity, it scales proportionally.

- [ ] **Step 4: Verify visually**

Run: `npm run dev` (or `cargo tauri dev`)
Expected: With slider at 100%, appearance is identical to before. Moving slider lower makes panels and body background increasingly transparent.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/workspace/LeafView.jsx src/index.css
git commit -m "feat(views): apply --panel-opacity CSS variable to body and panels" -m "" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Enable Tauri window transparency

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add transparent to the window builder**

In `src-tauri/src/lib.rs` (line 82), add `.transparent(true)` to the window builder:

```rust
let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
    .title("PLVS")
    .resizable(true)
    .visible(false)
    .transparent(true)
    .inner_size(1280.0, 860.0)
    .initialization_script(&init_script)
    .build()
    .map_err(|e| format!("window build: {e}"))?;
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 3: Platform note**

On Windows, transparent windows with decorations (title bar) will show a title bar that is NOT transparent. This is expected — the user can switch to Focus View (which hides decorations) for full transparency. Document this in a code comment if needed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): enable window transparency" -m "" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Include `panelOpacity` in presets

**Files:**
- Modify: `src/hooks/usePresets.js`
- Modify: `src/hooks/usePresets.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `src/hooks/usePresets.test.jsx` (find the existing test structure and add a case):

```js
it("captures and restores panelOpacity in presets", async () => {
  // Setup: render with panelOpacity=75
  // Save preset
  // Change panelOpacity to 50
  // Apply saved preset
  // Assert panelOpacity is restored to 75
});
```

The exact test shape depends on the existing test harness — follow the pattern used for `focusView` and `windowPinned` in the existing tests.

- [ ] **Step 2: Update `captureSnapshot` to include panelOpacity**

In `src/hooks/usePresets.js`, the `captureSnapshot` callback (line 56) needs `panelOpacity` added to its snapshot object and dependency array. The `usePresets` hook needs a new `panelOpacity` prop:

```js
export function usePresets({
  windowPinned = false,
  setWindowPinned = () => {},
  focusView = DEFAULT_FOCUS_VIEW,
  setFocusView = () => {},
  panelOpacity = 100,
  setPanelOpacity = () => {},
} = {}) {
```

In `captureSnapshot`:

```js
const snapshot = {
  tree: clone(workspaceState.tree),
  panelsById: clone(workspaceState.panelsById),
  panelOrder: [...workspaceState.panelOrder],
  panelControlsById: normalizePanelControlsById(
    workspaceState.panelsById,
    workspaceState.panelControlsById
  ),
  windowPinned: windowPinned === true,
  focusView: normalizeFocusView(focusView),
  panelOpacity,
};
```

Add `panelOpacity` to the `captureSnapshot` dependency array.

- [ ] **Step 3: Update `apply` to restore panelOpacity**

In the `apply` callback (around line 115-119), after the `focusView` restore:

```js
if (typeof preset.panelOpacity === "number") {
  setPanelOpacity(preset.panelOpacity);
}
```

Add `setPanelOpacity` to the `apply` dependency array.

- [ ] **Step 4: Pass panelOpacity to usePresets in App.jsx**

Find where `usePresets` is called in `src/App.jsx` and add the `panelOpacity` and `setPanelOpacity` props.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/hooks/usePresets.test.jsx`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/usePresets.js src/hooks/usePresets.test.jsx src/App.jsx
git commit -m "feat(presets): include panelOpacity in preset capture/apply" -m "" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Final integration test and cleanup

**Files:**
- Various — verify all pieces work together

- [ ] **Step 1: Run the full check suite**

Run: `npm run check`
Expected: All checks pass (format, lint, test, build, version, Rust fmt/clippy/test).

- [ ] **Step 2: Visual verification**

Run: `cargo tauri dev`

Verify:
1. Open Views popover — heading says "Views", slider shows at bottom with "Opacity" label and percentage
2. Slider defaults to 100% — app looks identical to before
3. Move slider to 50% — panels and body become semi-transparent
4. Move slider to 0% — everything fully transparent (only meter content visible)
5. Enable Focus View (hide decorations) — window frame disappears, transparency works fully
6. Save a preset with opacity at 60%, change opacity to 100%, apply the preset — opacity restores to 60%
7. Restart app — opacity value persists

- [ ] **Step 3: Fix any issues found**

Address any visual or functional issues discovered during verification.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -u
git commit -m "fix(views): address integration issues from panel opacity" -m "" -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
