# Presets Toolbar Popover Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Keep commits small enough that each task can be reviewed and reverted independently.

**Goal:** Move preset management out of `SettingsPanel` into a new toolbar popover (between the Modules popover and Settings). The popover is the single CRUD surface for presets. Also rename the Modules popover tooltip from "Layout & Modules" to "Modules".

**Architecture:** UI relocation only. `presetsStore`, `usePresets`, preset shape, footer active-preset label, and `WorkspaceContext` divergence clearing are all unchanged. A new `PresetsPopoverContent` component encapsulates the popover body; `App.jsx` wraps it in a `Popover` like the existing `VisibilityPopoverContent`.

**Tech Stack:** JavaScript/JSX (React), Vitest (jsdom/globals), `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-06-18-presets-toolbar-design.md`
**Revises:** `docs/superpowers/specs/2026-06-18-presets-redesign-design.md` (implements its deferred "toolbar quick-switch" item; moves UI ownership from Settings to toolbar).

---

## File Structure

- Add `src/components/PresetsPopover.jsx`: `PresetsPopoverContent` component (popover body).
- Add `src/components/PresetsPopover.test.jsx`: behaviour tests.
- Modify `src/App.jsx`: wire the toolbar `Popover` + trigger; pass `presets` from `usePresets()`; rename Modules tip to `"Modules"`; stop passing `presets` to `SettingsPanel`.
- Modify `src/components/SettingsPanel.jsx`: remove the Presets block, related state, handlers, the `presets` prop, and the `DEFAULT_PRESETS` constant.
- Modify `src/components/SettingsPanel.test.jsx`: remove all preset test cases.
- Modify `src/App.toolbar.test.js`: assert the new Presets popover trigger and the renamed Modules tip.

---

## Task 1: Create `PresetsPopoverContent` component

**Files:**
- Add: `src/components/PresetsPopover.jsx`
- Add: `src/components/PresetsPopover.test.jsx`

- [ ] **Step 1: Write the tests first**

Create `src/components/PresetsPopover.test.jsx`. Render `PresetsPopoverContent` with a mock `presets` object. Cover:

- **Empty state:** when `list` is empty, the hint `"No presets yet. Save the current view to start."` is present and the create row (input + Save) is present.
- **Create:** typing a name and clicking `Save` calls `presets.save(name)` with the trimmed name; the input is cleared afterwards (assert the save mock was called, then re-render with a resolved list).
- **Create disabled:** the Save button is disabled when the input is empty; Enter key submits when non-empty.
- **List render:** each preset name renders; the active preset row exposes an `aria-label` like `Active preset <name>` (matching the Settings pattern) or a visible active dot marker.
- **Apply (whole-row click):** clicking the preset's row calls `presets.apply(id)`.
- **Update:** clicking the Update icon button calls `presets.update(id)`.
- **Rename:** clicking the Rename icon enters edit mode (input pre-filled with current name); `Check`/Enter calls `presets.rename(id, newName)`; `X`/Escape cancels without calling `rename`.
- **Delete:** clicking the Delete icon calls `presets.remove(id)` and does **not** call `apply` (verify the apply mock was not called for that click - this guards `stopPropagation`).
- **Row-tail icons hidden by default:** assert the icon buttons are not visible when the row is not hovered (e.g. via an `opacity-0 group-hover:opacity-100` class assertion, since jsdom does not fire `:hover`). The icons should be present in the DOM but visually hidden.

Use the same `BASE_PROPS` / `render` patterns as `SettingsPanel.test.jsx`. Provide a default no-op `presets`:

```js
const NOOP_PRESETS = {
  list: [],
  activeId: null,
  save: () => {},
  apply: () => {},
  update: () => {},
  rename: () => {},
  remove: () => {},
};
```

- [ ] **Step 2: Implement `PresetsPopoverContent`**

Create `src/components/PresetsPopover.jsx`. Structure:

```jsx
import { useState } from "react";
import { Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NOOP_PRESETS = {
  list: [],
  activeId: null,
  save: () => {},
  apply: () => {},
  update: () => {},
  rename: () => {},
  remove: () => {},
};

/**
 * Popover body for preset management. Receives the `presets` controller
 * from usePresets(). Whole-row click applies; row-tail icons do
 * Update / Rename / Delete. Rename is inline.
 */
export function PresetsPopoverContent({ presets = NOOP_PRESETS }) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [drafts, setDrafts] = useState({});

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const result = presets.save(trimmed);
    if (result && typeof result.then === "function") {
      result.then((v) => { if (v !== false) setName(""); });
      return;
    }
    if (result !== false) setName("");
  };

  const startRename = (preset) => {
    setEditingId(preset.id);
    setDrafts((c) => ({ ...c, [preset.id]: preset.name ?? "" }));
  };

  const cancelRename = () => setEditingId(null);

  const commitRename = (id) => {
    const trimmed = (drafts[id] ?? "").trim();
    if (!trimmed) return;
    presets.rename(id, trimmed);
    setEditingId(null);
  };

  return (
    <>
      <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
        Presets
      </p>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          placeholder="New preset name"
          className="flex h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button type="button" variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={handleSave} disabled={!name.trim()}>
          Save
        </Button>
      </div>
      {presets.list.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">No presets yet. Save the current view to start.</p>
      ) : (
        <div className="grid gap-0.5 p-1">
          {presets.list.map((preset) => {
            const isActive = preset.id === presets.activeId;
            const isEditing = preset.id === editingId;
            return (
              <div key={preset.id} className="group">
                {isEditing ? (
                  <div className="flex items-center gap-1.5 rounded px-1.5 py-1">
                    <input
                      type="text"
                      value={drafts[preset.id] ?? preset.name ?? ""}
                      aria-label={`Rename preset ${preset.name}`}
                      onChange={(e) => setDrafts((c) => ({ ...c, [preset.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(preset.id);
                        if (e.key === "Escape") cancelRename();
                      }}
                      className="flex h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <button type="button" aria-label="Save rename" onClick={() => commitRename(preset.id)} disabled={!(drafts[preset.id] ?? "").trim()} className="text-muted-foreground hover:text-foreground">
                      <Check className="size-3.5" />
                    </button>
                    <button type="button" aria-label="Cancel rename" onClick={cancelRename} className="text-muted-foreground hover:text-foreground">
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => presets.apply(preset.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); presets.apply(preset.id); } }}
                    className="flex items-center gap-2 rounded px-1.5 py-1.5 text-xs transition-colors hover:bg-muted/50 cursor-pointer"
                  >
                    <span
                      aria-label={isActive ? `Active preset ${preset.name}` : undefined}
                      className={cn("size-1.5 shrink-0 rounded-full", isActive ? "bg-primary" : "bg-muted-foreground/20")}
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">{preset.name}</span>
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" aria-label={`Update preset ${preset.name}`} onClick={(e) => { e.stopPropagation(); presets.update(preset.id); }} className="text-muted-foreground hover:text-foreground">
                        <RefreshCw className="size-3.5" />
                      </button>
                      <button type="button" aria-label={`Rename preset ${preset.name}`} onClick={(e) => { e.stopPropagation(); startRename(preset); }} className="text-muted-foreground hover:text-foreground">
                        <Pencil className="size-3.5" />
                      </button>
                      <button type="button" aria-label={`Delete preset ${preset.name}`} onClick={(e) => { e.stopPropagation(); presets.remove(preset.id); }} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
```

Notes:
- Row-tail icons use `opacity-0 group-hover:opacity-100` so they are hidden until hover (jsdom cannot hover, so tests assert the class rather than visual state).
- Each icon button calls `e.stopPropagation()` to prevent the row's `onClick` (Apply) from also firing.
- Rename edit state replaces the whole row content (no Apply, no tail icons) so Apply is suppressed while editing.

- [ ] **Step 3: Run the tests**

```bash
npm test -- src/components/PresetsPopover.test.jsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/PresetsPopover.jsx src/components/PresetsPopover.test.jsx
git commit -m "feat(ui): add PresetsPopoverContent component for toolbar preset management"
```

---

## Task 2: Wire the toolbar Presets popover in App.jsx and rename Modules tip

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.toolbar.test.js`

- [ ] **Step 1: Add toolbar assertions to `App.toolbar.test.js`**

Add source-string assertions to the existing `describe("App toolbar", ...)` block:

- `appSource` contains `Bookmark` in the `lucide-react` import line.
- `appSource` contains `tip="Presets"`.
- `appSource` contains `tip="Modules"` (the renamed Modules popover).
- `appSource` does **not** contain `tip="Layout & Modules"`.

- [ ] **Step 2: Update the `lucide-react` import in App.jsx**

Add `Bookmark` to the import on the line that currently reads:

```js
import { LayoutGrid, Pin, PinOff, Settings, Trash2, Volume2 } from "lucide-react";
```

becomes:

```js
import { Bookmark, LayoutGrid, Pin, PinOff, Settings, Trash2, Volume2 } from "lucide-react";
```

- [ ] **Step 3: Import `PresetsPopoverContent`**

Add alongside the existing `VisibilityPopoverContent` import:

```js
import { PresetsPopoverContent } from "./components/PresetsPopover.jsx";
```

- [ ] **Step 4: Insert the Presets popover between the Modules popover and Settings**

In the right-side toolbar JSX, the Modules `Popover` ends with `</Popover>` immediately before the Settings `IconButton`. Insert a new `Popover` block between them:

```jsx
<Popover>
  <PopoverTrigger asChild>
    <span>
      <IconButton
        icon={<Bookmark className="size-3.5" />}
        tip="Presets"
        className={presets.activeId ? "text-foreground" : undefined}
      />
    </span>
  </PopoverTrigger>
  <PopoverContent align="end" sideOffset={6} className="w-60 p-1">
    <PresetsPopoverContent presets={presets} />
  </PopoverContent>
</Popover>
```

The resulting toolbar order is:

```
[Clear] [AudioDevice] [Pin] [Modules] [Presets] [Settings]
```

- [ ] **Step 5: Rename the Modules tip**

In the Modules popover trigger, change:

```jsx
<IconButton icon={<LayoutGrid className="size-3.5" />} tip="Layout & Modules" />
```

to:

```jsx
<IconButton icon={<LayoutGrid className="size-3.5" />} tip="Modules" />
```

- [ ] **Step 6: Stop passing `presets` to `SettingsPanel`**

In the `<SettingsPanel ... />` JSX in `App.jsx`, delete the `presets={presets}` prop line. Leave the `usePresets()` call intact (its result is now consumed by the popover and the footer).

- [ ] **Step 7: Run the toolbar tests**

```bash
npm test -- src/App.toolbar.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/App.toolbar.test.js
git commit -m "feat(ui): add Presets toolbar popover and rename Modules tooltip"
```

---

## Task 3: Remove the Presets block from SettingsPanel

**Files:**
- Modify: `src/components/SettingsPanel.jsx`
- Modify: `src/components/SettingsPanel.test.jsx`

- [ ] **Step 1: Remove preset test cases from `SettingsPanel.test.jsx`**

Delete every test that exercises the presets UI:
- saving a new preset calls `presets.save(name)`
- Apply calls `presets.apply(id)`
- Update calls `presets.update(id)`
- Rename changes name via `presets.rename(id, name)`
- cancel a preset rename draft without saving
- Delete calls `presets.remove(id)`
- marks the active preset

Also remove `presets` from any shared `BASE_PROPS` / render fixtures in that file. If `BASE_PROPS` no longer references `presets`, ensure the remaining tests still render cleanly without it.

- [ ] **Step 2: Remove the `presets` prop and `DEFAULT_PRESETS` from `SettingsPanel.jsx`**

- Delete the `DEFAULT_PRESETS` constant (top of file).
- Delete the `presets = DEFAULT_PRESETS` parameter from the `SettingsPanel` function signature.

- [ ] **Step 3: Remove preset state and handlers**

Delete:
- `const [presetName, setPresetName] = useState("");`
- `const [editingPresetId, setEditingPresetId] = useState(null);`
- `const [presetRenameDrafts, setPresetRenameDrafts] = useState({});`
- `const presetControls = { ...DEFAULT_PRESETS, ...presets };`
- `const presetList = Array.isArray(presetControls.list) ? presetControls.list : DEFAULT_PRESETS.list;`
- `handleSavePreset`, `startRenamePreset`, `cancelRenamePreset`, `handleRenamePreset`.

- [ ] **Step 4: Remove the Presets JSX block**

Delete the `<Separator />` immediately preceding `<Label htmlFor="settings-preset-name">Presets</Label>`, the entire `<div className="grid gap-2">...</div>` that wraps the Presets block, and keep the `<Separator />` that follows it (it still separates the Clear-shortcut block from Appearance). If removing the block leaves two adjacent `<Separator />`s, delete one so no double-separator remains.

- [ ] **Step 5: Run SettingsPanel tests**

```bash
npm test -- src/components/SettingsPanel.test.jsx
```

Expected: PASS (all preset tests removed; remaining settings tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "refactor(ui): remove Presets block from SettingsPanel (moved to toolbar)"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the complete test suite**

```bash
npm test
```

Expected: all tests pass. Pay attention to:
- `PresetsPopover.test.jsx` (new) - PASS.
- `SettingsPanel.test.jsx` - PASS, no preset references remain.
- `App.toolbar.test.js` - PASS, Presets popover and renamed Modules tip asserted.
- `usePresets.test.jsx` - PASS (unchanged, but confirms the hook is unaffected).

- [ ] **Step 2: Grep for stale references**

Confirm no remaining references to the removed Settings presets wiring:

- `grep -ri "settings-preset-name" src/` returns nothing.
- `grep -ri "DEFAULT_PRESETS" src/` returns nothing.
- `grep -ri "Layout & Modules" src/` returns nothing.
- `grep -ri "presetName\|editingPresetId\|presetRenameDrafts\|presetControls\|presetList\|handleSavePreset\|startRenamePreset\|cancelRenamePreset\|handleRenamePreset" src/components/SettingsPanel.jsx` returns nothing.

- [ ] **Step 3: Manual smoke test (Tauri dev)**

Run the app in Tauri dev mode and confirm:

- Toolbar shows the new Presets (Bookmark) button between Modules and Settings.
- The Bookmark icon highlights when a preset is active.
- Clicking the button opens the popover with the create row + list.
- Saving a preset from the toolbar works; applying (row click) restores the view and window bounds.
- Update / Rename / Delete icons work; Rename shows inline edit with Save/Cancel; Delete does not also apply.
- Row-tail icons appear on hover and disappear when not hovering.
- Empty list shows the hint.
- Settings sheet no longer has a Presets block.
- Footer still shows the active preset name.
- Modules popover tooltip now reads "Modules".

---

## Self-review notes

- **Spec coverage:** `PresetsPopoverContent` (Task 1), toolbar wiring + Modules rename (Task 2), SettingsPanel removal (Task 3), full verification (Task 4).
- **No data-layer changes:** `presetsStore`, `usePresets`, preset shape, footer label, and `WorkspaceContext` divergence clearing are untouched. This is purely a UI relocation, which keeps the blast radius small.
- **stopPropagation is the highest-risk detail:** if any row-tail icon button forgets to stop propagation, clicking Update/Rename/Delete will also fire Apply. Task 1's tests explicitly assert Delete does not call apply.
- **Row-tail icon visibility:** jsdom cannot trigger `:hover`, so tests assert the `opacity-0 group-hover:opacity-100` class rather than visual state. The manual smoke test (Task 4 Step 3) is where real hover behaviour is confirmed.
- **Parent spec relationship:** this plan does not modify `2026-06-18-presets-redesign-design.md`. The new spec documents the revision. If desired, a one-line note can be appended to the parent spec's "Out of scope" section pointing to the new spec - this is optional and left to the implementer's judgement.
