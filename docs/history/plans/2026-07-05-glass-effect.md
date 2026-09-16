# Glass Effect (System-Level Frosted Glass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Glass" toggle to the Views popover that turns the transparent area created by the existing `panelOpacity` slider into a true OS-blurred frosted-glass window (Windows Acrylic, macOS `NSVisualEffectView` vibrancy), instead of a sharp see-through window.

**Architecture:** A new boolean `glassEnabled` setting flows through the same pipeline as `panelOpacity` (`settingsStore` → `useSettings` → `App.jsx`), independent of and layered on top of it. A new Rust Tauri command `set_glass_effect(enabled, dark)` (backed by the `window-vibrancy` crate) applies/clears the OS blur effect; a new frontend hook `useGlassEffect` invokes it whenever the toggle or resolved theme (dark/light) changes. The value is saved in presets alongside `panelOpacity`.

**Tech Stack:** React 19, Tauri 2 (Rust), `window-vibrancy` crate, native HTML `Switch` component (existing `FocusSwitch`), Vitest, `cargo test`/`clippy`

**Reference spec:** `docs/superpowers/specs/2026-07-05-glass-effect-design.md`

---

### Task 1: Add `window-vibrancy` dependency and the `set_glass_effect` Rust command

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/glass_effect.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, add this line to the `[dependencies]` section (after the `tauri-plugin-dialog` line):

```toml
window-vibrancy = "0.7"
```

- [ ] **Step 2: Create the command module**

Create `src-tauri/src/glass_effect.rs`:

```rust
#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, clear_acrylic};
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

/// Applies (or clears) an OS-level frosted-glass effect on the transparent area created by
/// `panelOpacity`. `dark` selects a tint/material matching the app's currently resolved theme.
/// Failures (unsupported OS version) are returned as an error string; callers are expected to
/// swallow them silently, same as other best-effort window-chrome calls (decorations, autostart).
#[tauri::command]
pub fn set_glass_effect<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  enabled: bool,
  dark: bool,
) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    if enabled {
      let tint = if dark { (18, 18, 18, 125) } else { (240, 240, 240, 125) };
      apply_acrylic(&window, Some(tint)).map_err(|e| format!("apply_acrylic: {e}"))?;
    } else {
      clear_acrylic(&window).map_err(|e| format!("clear_acrylic: {e}"))?;
    }
  }
  #[cfg(target_os = "macos")]
  {
    if enabled {
      let material = if dark {
        NSVisualEffectMaterial::HudWindow
      } else {
        NSVisualEffectMaterial::Sidebar
      };
      apply_vibrancy(&window, material, Some(NSVisualEffectState::Active), None)
        .map_err(|e| format!("apply_vibrancy: {e}"))?;
    } else {
      clear_vibrancy(&window).map_err(|e| format!("clear_vibrancy: {e}"))?;
    }
  }
  #[cfg(not(any(target_os = "windows", target_os = "macos")))]
  {
    let _ = (window, enabled, dark);
  }
  Ok(())
}
```

- [ ] **Step 3: Register the module and command**

In `src-tauri/src/lib.rs`, add the module declaration after `mod file_analysis;` (line 4):

```rust
mod glass_effect;
```

In the `invoke_handler` list (around line 34-58), add the new command after `window_state::apply_window_bounds,`:

```rust
      window_state::current_window_bounds,
      window_state::apply_window_bounds,
      glass_effect::set_glass_effect,
    ])
```

- [ ] **Step 4: Verify Rust compiles and lints clean**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: No warnings (the `dark` parameter is read on both platform branches — tint color on Windows, material choice on macOS — so no unused-variable warnings).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/glass_effect.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add set_glass_effect command backed by window-vibrancy" -m "" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Add `glassEnabled` to settings defaults and normalization

**Files:**
- Modify: `src/settings/defaults.js`
- Modify: `src/settings/defaults.test.js`

- [ ] **Step 1: Write the failing test**

In `src/settings/defaults.test.js`, add `DEFAULT_GLASS_ENABLED` and `normalizeGlassEnabled` to the existing import block at the top of the file:

```js
import {
  DEFAULT_CLOSE_ACTION,
  DEFAULT_GLASS_ENABLED,
  DEFAULT_PANEL_OPACITY,
  DEFAULT_REFERENCE_LUFS,
  DEFAULT_THEME_EDITOR_POS,
  normalizeCloseAction,
  normalizeGlassEnabled,
  normalizePanelOpacity,
  normalizeReferenceLufs,
  normalizeThemeEditorPos,
  normalizeSettingsFocusView,
} from "./defaults.js";
```

Add a new test case at the end of the `describe("settings defaults", ...)` block, after the `"normalizes panel opacity"` test:

```js
  it("normalizes glass enabled", () => {
    expect(DEFAULT_GLASS_ENABLED).toBe(false);
    expect(normalizeGlassEnabled(true)).toBe(true);
    expect(normalizeGlassEnabled(false)).toBe(false);
    expect(normalizeGlassEnabled(null)).toBe(false);
    expect(normalizeGlassEnabled(undefined)).toBe(false);
    expect(normalizeGlassEnabled("true")).toBe(false);
    expect(normalizeGlassEnabled(1)).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/settings/defaults.test.js`
Expected: FAIL — `DEFAULT_GLASS_ENABLED`/`normalizeGlassEnabled` are not exported.

- [ ] **Step 3: Write the implementation**

In `src/settings/defaults.js`, add after `export const DEFAULT_PANEL_OPACITY = 100;`:

```js
export const DEFAULT_GLASS_ENABLED = false;
```

Add after `normalizePanelOpacity`:

```js
export function normalizeGlassEnabled(raw) {
  return raw === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/settings/defaults.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/defaults.js src/settings/defaults.test.js
git commit -m "feat(settings): add glassEnabled default and normalization" -m "" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire `glassEnabled` through `useSettings`

**Files:**
- Modify: `src/hooks/useSettings.js`

- [ ] **Step 1: Add the import**

In `src/hooks/useSettings.js`, update the import from `../settings/defaults.js` (lines 23-30) to include the new names:

```js
import {
  DEFAULT_CLOSE_ACTION,
  DEFAULT_GLASS_ENABLED,
  normalizeCloseAction,
  normalizeGlassEnabled,
  normalizePanelOpacity,
  normalizeReferenceLufs,
  normalizeSettingsFocusView,
  normalizeThemeEditorPos,
} from "../settings/defaults.js";
```

- [ ] **Step 2: Add state**

After the `panelOpacity` state declaration (lines 51-53), add:

```js
  const [glassEnabled, setGlassEnabledState] = useState(() =>
    normalizeGlassEnabled(settingsStore.read().glassEnabled)
  );
```

- [ ] **Step 3: Add the setter**

After the `setPanelOpacity` function (lines 148-153), add:

```js
  function setGlassEnabled(value) {
    const next = normalizeGlassEnabled(value);
    settingsStore.patch({ glassEnabled: next });
    markPresetDirty();
    setGlassEnabledState(next);
  }
```

- [ ] **Step 4: Add to the persistence effect**

Update the `useEffect` that patches `settingsStore` (lines 168-176) to include `glassEnabled` in both the patch object and the dependency array:

```js
  useEffect(() => {
    settingsStore.patch({
      referenceLufs,
      appearance,
      themeId: appearance === "system" ? null : fixedThemeSelectValue,
      channelLabelOverrides,
      panelOpacity,
      glassEnabled,
    });
  }, [
    referenceLufs,
    appearance,
    fixedThemeSelectValue,
    channelLabelOverrides,
    panelOpacity,
    glassEnabled,
  ]);
```

- [ ] **Step 5: Add to the `settingsStore.subscribe` effect**

In the subscriber effect (lines 178-192), add after the `panelOpacity` line:

```js
        setPanelOpacityState(normalizePanelOpacity(settingsStore.read().panelOpacity));
        setGlassEnabledState(normalizeGlassEnabled(settingsStore.read().glassEnabled));
```

- [ ] **Step 6: Add to the return object**

In the return object (around line 256-257), add after `setPanelOpacity`:

```js
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
```

- [ ] **Step 7: Run the existing test suite for this hook**

Run: `npx vitest run src/hooks/useSettings.rtl.test.jsx src/hooks/useSettings.clear.test.jsx`
Expected: All PASS (no behavior change to existing settings, purely additive).

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useSettings.js
git commit -m "feat(settings): wire glassEnabled through useSettings" -m "" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Add the `useGlassEffect` hook

**Files:**
- Create: `src/hooks/useGlassEffect.js`
- Create: `src/hooks/useGlassEffect.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useGlassEffect.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const invokeMock = vi.fn().mockResolvedValue(undefined);
const isTauriMock = vi.fn().mockReturnValue(true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeMock(...args),
}));
vi.mock("../ipc/env.js", () => ({
  isTauri: () => isTauriMock(),
}));

const { useGlassEffect } = await import("./useGlassEffect.js");

describe("useGlassEffect", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    isTauriMock.mockReturnValue(true);
  });

  it("invokes set_glass_effect with enabled and dark flags", () => {
    renderHook(() => useGlassEffect(true, false));
    expect(invokeMock).toHaveBeenCalledWith("set_glass_effect", { enabled: true, dark: false });
  });

  it("re-invokes when enabled or dark changes", () => {
    const { rerender } = renderHook(({ enabled, dark }) => useGlassEffect(enabled, dark), {
      initialProps: { enabled: false, dark: false },
    });
    invokeMock.mockClear();
    rerender({ enabled: true, dark: true });
    expect(invokeMock).toHaveBeenCalledWith("set_glass_effect", { enabled: true, dark: true });
  });

  it("does nothing outside Tauri", () => {
    isTauriMock.mockReturnValue(false);
    renderHook(() => useGlassEffect(true, false));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useGlassEffect.test.js`
Expected: FAIL — `./useGlassEffect.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useGlassEffect.js`:

```js
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";

export function useGlassEffect(enabled, dark) {
  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_glass_effect", {
      enabled: enabled === true,
      dark: dark === true,
    }).catch(() => {});
  }, [enabled, dark]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useGlassEffect.test.js`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGlassEffect.js src/hooks/useGlassEffect.test.js
git commit -m "feat(views): add useGlassEffect hook" -m "" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Add the "Glass" switch to the Views popover

**Files:**
- Modify: `src/components/FocusViewPopover.jsx`
- Modify: `src/components/FocusViewPopover.test.jsx`

- [ ] **Step 1: Update existing tests for the new switch**

In `src/components/FocusViewPopover.test.jsx`, update the imports and existing tests to account for the new "Glass" switch. Replace the whole file with:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FocusViewPopoverContent } from "./FocusViewPopover.jsx";

describe("FocusViewPopoverContent", () => {
  it("renders Views switches", () => {
    render(<FocusViewPopoverContent />);

    expect(screen.getByText("Views")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Always on Top" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Auto-hide Controls" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Compact Panels" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Hide Chrome" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Glass" })).toBeTruthy();
  });

  it("orders Views switches from window behaviour to content density", () => {
    render(<FocusViewPopoverContent />);

    expect(screen.getAllByRole("switch").map((node) => node.id)).toEqual([
      "focus-view-always-on-top",
      "focus-view-compact-panels",
      "focus-view-borderless",
      "focus-view-auto-hide-controls",
      "focus-view-glass",
    ]);
  });

  it("reflects current switch state", () => {
    render(
      <FocusViewPopoverContent
        focusView={{ autoHideControls: true, compactPanels: false, borderless: false }}
        glassEnabled={true}
      />
    );

    expect(screen.getByRole("switch", { name: "Always on Top" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
    expect(
      screen.getByRole("switch", { name: "Auto-hide Controls" }).getAttribute("data-state")
    ).toBe("checked");
    expect(screen.getByRole("switch", { name: "Compact Panels" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
    expect(screen.getByRole("switch", { name: "Hide Chrome" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
    expect(screen.getByRole("switch", { name: "Glass" }).getAttribute("data-state")).toBe(
      "checked"
    );
  });

  it("routes switch changes to callers", () => {
    const setPinned = vi.fn();
    const setAutoHideControls = vi.fn();
    const setCompactPanels = vi.fn();
    const setBorderless = vi.fn();
    const setGlassEnabled = vi.fn();
    render(
      <FocusViewPopoverContent
        pinned={false}
        setPinned={setPinned}
        focusView={{ autoHideControls: false, compactPanels: false, borderless: false }}
        setAutoHideControls={setAutoHideControls}
        setCompactPanels={setCompactPanels}
        setBorderless={setBorderless}
        glassEnabled={false}
        setGlassEnabled={setGlassEnabled}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: "Always on Top" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto-hide Controls" }));
    fireEvent.click(screen.getByRole("switch", { name: "Compact Panels" }));
    fireEvent.click(screen.getByRole("switch", { name: "Hide Chrome" }));
    fireEvent.click(screen.getByRole("switch", { name: "Glass" }));

    expect(setPinned).toHaveBeenCalledWith(true);
    expect(setAutoHideControls).toHaveBeenCalledWith(true);
    expect(setCompactPanels).toHaveBeenCalledWith(true);
    expect(setBorderless).toHaveBeenCalledWith(true);
    expect(setGlassEnabled).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/FocusViewPopover.test.jsx`
Expected: FAIL — no switch named "Glass" is rendered yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/components/FocusViewPopover.jsx` with:

```jsx
import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "@/lib/focusView.js";
import { DEFAULT_PANEL_OPACITY, DEFAULT_GLASS_ENABLED } from "@/settings/defaults.js";
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
  setBorderless = () => {},
  panelOpacity = DEFAULT_PANEL_OPACITY,
  setPanelOpacity = () => {},
  glassEnabled = DEFAULT_GLASS_ENABLED,
  setGlassEnabled = () => {},
}) {
  const normalized = normalizeFocusView(focusView);

  return (
    <div className="grid gap-1">
      <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
        Views
      </p>
      <FocusSwitch
        id="focus-view-always-on-top"
        label="Always on Top"
        checked={pinned === true}
        onCheckedChange={setPinned}
      />
      <FocusSwitch
        id="focus-view-compact-panels"
        label="Compact Panels"
        checked={normalized.compactPanels}
        onCheckedChange={setCompactPanels}
      />
      <FocusSwitch
        id="focus-view-borderless"
        label="Hide Chrome"
        checked={normalized.borderless}
        onCheckedChange={setBorderless}
      />
      <FocusSwitch
        id="focus-view-auto-hide-controls"
        label="Auto-hide Controls"
        checked={normalized.autoHideControls}
        onCheckedChange={setAutoHideControls}
      />
      <FocusSwitch
        id="focus-view-glass"
        label="Glass"
        checked={glassEnabled === true}
        onCheckedChange={setGlassEnabled}
      />
      <div className="flex items-center justify-between gap-3 rounded px-2 py-1.5">
        <Label htmlFor="panel-opacity" className="min-w-0 text-xs font-normal text-foreground">
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
          className="h-4 w-20 accent-primary"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/FocusViewPopover.test.jsx`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FocusViewPopover.jsx src/components/FocusViewPopover.test.jsx
git commit -m "feat(views): add Glass switch to Views popover" -m "" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Thread `glassEnabled` through `AppHeader.jsx`

**Files:**
- Modify: `src/components/AppHeader.jsx`

- [ ] **Step 1: Accept the new props**

In `src/components/AppHeader.jsx`, add `glassEnabled` and `setGlassEnabled` to the `AppHeader` component's prop list (after `setPanelOpacity`, around line 80):

```jsx
  panelOpacity,
  setPanelOpacity,
  glassEnabled,
  setGlassEnabled,
```

- [ ] **Step 2: Pass them to `FocusViewPopoverContent`**

Update the `<FocusViewPopoverContent>` call (around lines 208-217) to pass the new props:

```jsx
            <FocusViewPopoverContent
              pinned={pinned}
              setPinned={setPinned}
              focusView={focusView}
              setAutoHideControls={setAutoHideControls}
              setCompactPanels={setCompactPanels}
              setBorderless={setBorderless}
              panelOpacity={panelOpacity}
              setPanelOpacity={setPanelOpacity}
              glassEnabled={glassEnabled}
              setGlassEnabled={setGlassEnabled}
            />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/AppHeader.jsx
git commit -m "feat(views): thread glassEnabled through AppHeader" -m "" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire `glassEnabled` into `App.jsx` and activate `useGlassEffect`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Import `useGlassEffect`**

Add near the existing `useFocusViewWindow` import (line 100):

```js
import { useGlassEffect } from "./hooks/useGlassEffect.js";
```

- [ ] **Step 2: Destructure `glassEnabled`/`setGlassEnabled` from `useSettings`**

In the `useSettings({ onClearRef })` destructuring (lines 151-189), add after `panelOpacity, setPanelOpacity,`:

```js
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
  } = useSettings({ onClearRef });
```

- [ ] **Step 3: Call `useGlassEffect`**

`resolvedTheme` must be in scope, and it is only declared at line 344 (`const resolvedTheme = useMemo(() => getBuiltinTheme(resolvedThemeId), [resolvedThemeId]);`) — later than `useFocusViewWindow`'s call site at line 206. Add the `useGlassEffect` call immediately after that `resolvedTheme` declaration instead:

```js
  const resolvedTheme = useMemo(() => getBuiltinTheme(resolvedThemeId), [resolvedThemeId]);
  useGlassEffect(glassEnabled, resolvedTheme.colorScheme === "dark");
```

- [ ] **Step 4: Pass `glassEnabled`/`setGlassEnabled` to `usePresets`**

Update the `usePresets({...})` call (lines 197-205) to include:

```js
  const presets = usePresets({
    windowPinned: pinned,
    setWindowPinned: setPinned,
    focusView,
    setFocusView,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
    suppressPresetDivergence,
  });
```

- [ ] **Step 5: Pass `glassEnabled`/`setGlassEnabled` to `<AppHeader>`**

Update the `<AppHeader>` JSX call (around lines 1552-1563) to include:

```jsx
              panelOpacity={panelOpacity}
              setPanelOpacity={setPanelOpacity}
              glassEnabled={glassEnabled}
              setGlassEnabled={setGlassEnabled}
```

- [ ] **Step 6: Run the app's existing test suites touching these files**

Run: `npx vitest run src/App.toolbar.test.js`
Expected: PASS (no assertions target `glassEnabled`, so this only verifies no regression).

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "feat(views): wire glassEnabled and activate useGlassEffect in App" -m "" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Include `glassEnabled` in presets

**Files:**
- Modify: `src/hooks/usePresets.js`
- Modify: `src/hooks/usePresets.test.jsx`

- [ ] **Step 1: Write the failing test**

In `src/hooks/usePresets.test.jsx`, add these two tests immediately after the existing `"does not call setPanelOpacity when applying an older preset without panelOpacity"` test:

```js
  it("captures and restores glassEnabled in presets", async () => {
    const setGlassEnabled = vi.fn();
    const { result } = renderPresetHook({ glassEnabled: true, setGlassEnabled });
    await act(async () => {
      await result.current.presets.save("WithGlass");
    });
    const saved = presetsStore.read().list[0];
    expect(saved.glassEnabled).toBe(true);

    await act(async () => {
      await result.current.presets.apply(saved.id);
    });
    expect(setGlassEnabled).toHaveBeenCalledWith(true);
  });

  it("does not call setGlassEnabled when applying an older preset without glassEnabled", async () => {
    const setGlassEnabled = vi.fn();
    presetsStore.patch({
      list: [
        {
          id: "p-old-glass",
          name: "OldGlass",
          tree: { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
        },
      ],
      activeId: null,
      dirty: false,
    });
    const { result } = renderPresetHook({ setGlassEnabled });
    await act(async () => {
      await result.current.presets.apply("p-old-glass");
    });
    expect(setGlassEnabled).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/usePresets.test.jsx`
Expected: FAIL — saved preset has no `glassEnabled` field; `setGlassEnabled` never called.

- [ ] **Step 3: Write the implementation**

In `src/hooks/usePresets.js`, add `glassEnabled`/`setGlassEnabled` to the `usePresets` options (lines 54-62):

```js
export function usePresets({
  windowPinned = false,
  setWindowPinned = () => {},
  focusView = DEFAULT_FOCUS_VIEW,
  setFocusView = () => {},
  panelOpacity = 100,
  setPanelOpacity = () => {},
  glassEnabled = false,
  setGlassEnabled = () => {},
  suppressPresetDivergence = () => {},
} = {}) {
```

In `captureSnapshot` (lines 87-115), add `glassEnabled` to the snapshot object and the dependency array:

```js
  const captureSnapshot = useCallback(async () => {
    const windowBounds = await readWindowBounds();
    const snapshot = {
      tree: clone(workspaceState.tree),
      panelsById: clone(workspaceState.panelsById),
      panelOrder: [...workspaceState.panelOrder],
      panelControlsById: normalizePanelControlsById(
        workspaceState.panelsById,
        workspaceState.panelControlsById
      ),
      pinnedPanelsById: normalizePinnedPanelsById(
        workspaceState.panelsById,
        workspaceState.pinnedPanelsById
      ),
      windowPinned: windowPinned === true,
      focusView: normalizeFocusView(focusView),
      panelOpacity,
      glassEnabled,
    };
    return windowBounds ? { ...snapshot, windowBounds } : snapshot;
  }, [
    windowPinned,
    focusView,
    panelOpacity,
    glassEnabled,
    workspaceState.panelControlsById,
    workspaceState.panelOrder,
    workspaceState.panelsById,
    workspaceState.pinnedPanelsById,
    workspaceState.tree,
  ]);
```

In `apply` (lines 134-178), add restore logic after the `panelOpacity` restore and `setGlassEnabled` to the dependency array:

```js
      if (typeof preset.panelOpacity === "number") {
        setPanelOpacity(preset.panelOpacity);
      }
      if (typeof preset.glassEnabled === "boolean") {
        setGlassEnabled(preset.glassEnabled);
      }
      write({ activeId: id, dirty: false });
      return true;
    },
    [
      setView,
      setWindowPinned,
      setFocusView,
      setPanelOpacity,
      setGlassEnabled,
      suppressPresetDivergence,
      workspaceState,
      write,
    ]
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/usePresets.test.jsx`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePresets.js src/hooks/usePresets.test.jsx
git commit -m "feat(presets): include glassEnabled in preset capture/apply" -m "" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Final integration check and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full check suite**

Run: `npm run check`
Expected: All checks pass (format, lint, test, build, version, Rust fmt/clippy/test).

- [ ] **Step 2: Manual verification on Windows**

Run: `cargo tauri dev`

Verify:
1. Open the Views popover — a "Glass" switch appears between "Auto-hide Controls" and the "Opacity" slider.
2. With `panelOpacity` at 100%, toggling Glass has no visible effect (no transparent area to blur) — expected, not a bug.
3. Lower `panelOpacity` below 100%, then toggle Glass on — the transparent region shows a blurred/tinted view of whatever is behind the window (desktop, other apps) instead of a sharp view.
4. Toggle Glass off — the transparent region returns to sharp passthrough.
5. Switch the app theme between light/dark while Glass is on — the tint updates to match.
6. Save a preset with Glass on, turn it off, apply the preset — Glass restores to on.
7. Restart the app — the Glass toggle state persists.

- [ ] **Step 3: Manual verification on macOS**

Repeat the same 7 checks as Step 2 on a Mac, additionally confirming:
8. `macOSPrivateApi` (already enabled by the prior transparent-window work) is sufficient — no additional entitlement changes were needed for vibrancy.

- [ ] **Step 4: Fix any issues found**

Address any visual or functional issues discovered during manual verification.

- [ ] **Step 5: Final commit if fixes were needed**

```bash
git add -u
git commit -m "fix(views): address integration issues from glass effect" -m "" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
