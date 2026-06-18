# Presets Redesign Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Keep commits small enough that each task can be reviewed and reverted independently.

**Goal:** Replace the old built-in/custom layout preset system with user-created view snapshots managed in Settings. Presets capture workspace view state plus Rust-owned window bounds, live in a new `plvs:presets` persistence domain, apply through an orchestration hook, and surface only in Settings + footer.

**Architecture:** `workspaceReducer` stays pure and owns only live workspace view state. `presetsStore` owns `{ list, activeId }`. `usePresets` orchestrates cross-domain snapshot capture/application and Rust window IPC. `WorkspaceContext` clears `presetsStore.activeId` at the manual view-edit action boundary. Rust continues to own window geometry through the top-level `windowBounds` key, not `plvs:settings`.

**Tech Stack:** JavaScript/JSX (React), Vitest (jsdom/globals), Tauri v2 Rust commands, tauri-plugin-store.

**Spec:** `docs/superpowers/specs/2026-06-18-presets-redesign-design.md`
**Depends on:** `docs/superpowers/specs/2026-06-17-persistence-unification-design.md`, especially domain stores, plugin-store boot injection, and `window_state.rs`.

---

## File Structure

- Modify `src/persistence/index.js` and tests: add `presetsStore`, include it in `exportAll` / `resetAll`.
- Modify `src/persistence/createDomainStore.js` usage or store setup: strip old workspace preset fields via a small migrate/cleanup step.
- Modify `src-tauri/src/lib.rs`: inject `"plvs:presets"` into `window.__PLVS_INITIAL_STATE__`; register new window commands.
- Modify `src-tauri/src/window_state.rs`: add `current_window_bounds` / `apply_window_bounds` helpers and tests.
- Modify `src/ipc/commands.js`: add JS wrappers for the new Rust commands.
- Modify `src/workspace/constants.js`, `types.js`, `reducer.js`, `WorkspaceContext.jsx`, and tests: remove old preset state/actions; add `SET_VIEW`; clear active preset at the context action boundary.
- Modify `src/workspace/WorkspaceToolbar.jsx` and `src/App.jsx`: remove toolbar preset UI; wire `usePresets`; add footer item.
- Add `src/hooks/usePresets.js` and tests.
- Modify `src/components/SettingsPanel.jsx` and tests: add the Settings-managed Presets section.

---

## Task 1: Add the `presetsStore` persistence domain

**Files:**
- Modify: `src/persistence/index.js`
- Modify: `src/persistence/index.test.js`
- Modify: `src/persistence/index.env.test.js` if needed

- [ ] **Step 1: Update persistence tests first**

Extend `src/persistence/index.test.js` so:

- `presetsStore.patch({ list: [], activeId: null })` persists under `plvs:presets`.
- `exportAll()` returns `{ settings, workspace, presets }`.
- `resetAll()` clears all three domains.

- [ ] **Step 2: Add `presetsStore`**

In `src/persistence/index.js`, instantiate:

```js
export const presetsStore = createDomainStore({ name: "plvs:presets", backend });
```

Update:

```js
export function exportAll() {
  return {
    settings: settingsStore.export(),
    workspace: workspaceStore.export(),
    presets: presetsStore.export(),
  };
}
```

and reset all three stores.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- src/persistence/index.test.js src/persistence/index.env.test.js
```

Expected: PASS.

---

## Task 2: Inject presets during Tauri first paint

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/persistence/pluginStoreBackend.test.js`

- [ ] **Step 1: Update JS backend test coverage**

Extend the plugin-store backend tests so `window.__PLVS_INITIAL_STATE__` can include `"plvs:presets"` and `backend.get("plvs:presets")` reads it synchronously.

- [ ] **Step 2: Update Rust boot injection**

In `src-tauri/src/lib.rs`, read:

```rust
let presets = store.get("plvs:presets").unwrap_or(serde_json::json!({}));
```

Then add it to the injected object:

```rust
let initial = serde_json::json!({
  "plvs:settings": settings,
  "plvs:workspace": workspace,
  "plvs:presets": presets,
});
```

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- src/persistence/pluginStoreBackend.test.js
```

If Rust tests are already cheap in the current environment, also run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

---

## Task 3: Strip old preset fields from `plvs:workspace`

**Files:**
- Modify: `src/persistence/index.js` or add a small helper in `src/persistence/`
- Modify: `src/persistence/index.test.js`
- Modify: `src/workspace/WorkspaceContext.jsx`

- [ ] **Step 1: Add cleanup/migration test**

Add coverage that persisted workspace blobs containing `customPresets` and `activePresetId` are read back without those fields after the workspace domain initializes.

Use a case like:

```js
localStorage.setItem(
  "plvs:workspace",
  JSON.stringify({ tree: {}, visibleModules: [], customPresets: [{ id: "x" }], activePresetId: "x" })
);
```

Expected store export after initialization: no `customPresets`, no `activePresetId`.

- [ ] **Step 2: Add the migrate/cleanup function**

Configure `workspaceStore` with a `migrate` callback or equivalent narrow cleanup:

```js
function migrateWorkspace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { customPresets: _customPresets, activePresetId: _activePresetId, ...rest } = value;
  return rest;
}
```

Then:

```js
export const workspaceStore = createDomainStore({
  name: "plvs:workspace",
  backend,
  migrate: migrateWorkspace,
});
```

- [ ] **Step 3: Remove old rehydration**

In `WorkspaceContext.initState`, drop the line that rehydrates `customPresets`.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/persistence/index.test.js src/workspace/WorkspaceContext.test.jsx
```

Expected: PASS.

---

## Task 4: Remove built-in/custom preset state from workspace

**Files:**
- Modify: `src/workspace/constants.js`
- Modify: `src/workspace/types.js`
- Modify: `src/workspace/reducer.js`
- Modify: `src/workspace/constants.test.js`
- Modify: `src/workspace/reducer-tree.test.js`

- [ ] **Step 1: Update tests for the new workspace shape**

In constants tests, assert `DEFAULT_WORKSPACE_STATE` no longer contains:

- `activePresetId`
- `customPresets`

In reducer tests, delete the old `APPLY_PRESET` and `SAVE_PRESET` suites. Replace them with `SET_VIEW` tests.

- [ ] **Step 2: Remove old constants and state fields**

Delete `BUILTIN_PRESETS`.

Remove `activePresetId` and `customPresets` from `DEFAULT_WORKSPACE_STATE` and the `WorkspaceState` typedef.

- [ ] **Step 3: Replace reducer cases**

Delete:

- `APPLY_PRESET`
- `SAVE_PRESET`
- bound actions `applyPreset`
- bound action `saveCurrentAsPreset`

Add:

```js
case "SET_VIEW": {
  const { tree, visibleModules, panelControls } = action.payload;
  return {
    ...state,
    tree,
    visibleModules,
    panelControls: normalizePanelControls(panelControls),
    fullscreenId: null,
  };
}
```

Add bound action:

```js
setView: (view) => dispatch({ type: "SET_VIEW", payload: view }),
```

- [ ] **Step 4: Stop reducer from clearing active preset**

Remove `activePresetId: null` from `SET_TREE` and `MOVE_TAB`. Preset divergence is now handled in `WorkspaceContext`, not the reducer.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- src/workspace/constants.test.js src/workspace/reducer-tree.test.js
```

Expected: PASS.

---

## Task 5: Clear active preset at the `WorkspaceContext` action boundary

**Files:**
- Modify: `src/workspace/WorkspaceContext.jsx`
- Modify: `src/workspace/WorkspaceContext.test.jsx`

- [ ] **Step 1: Write context tests**

Add tests proving:

- manual `setTree` clears `presetsStore.activeId`;
- manual `moveTab` clears `presetsStore.activeId`;
- manual `toggleModuleVisible` clears `presetsStore.activeId`;
- `setView` does **not** clear `presetsStore.activeId`.

Keep the test focused on the context boundary, not reducer internals.

- [ ] **Step 2: Wrap manual edit actions**

In `WorkspaceProvider`, build the bound actions, then wrap manual edit actions:

```js
const actions = useMemo(() => {
  const bound = bindWorkspaceActions(dispatch);
  const clearActivePreset = () => presetsStore.patch({ activeId: null });
  return {
    ...bound,
    setTree: (...args) => {
      clearActivePreset();
      bound.setTree(...args);
    },
    moveTab: (...args) => {
      clearActivePreset();
      bound.moveTab(...args);
    },
    resizeChildren: (...args) => {
      clearActivePreset();
      bound.resizeChildren(...args);
    },
    toggleModuleVisible: (...args) => {
      clearActivePreset();
      bound.toggleModuleVisible(...args);
    },
    setPanelControls: (...args) => {
      clearActivePreset();
      bound.setPanelControls(...args);
    },
  };
}, []);
```

Then merge `actions` into the context value.

Do not wrap `setView`.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- src/workspace/WorkspaceContext.test.jsx src/workspace/reducer-tree.test.js
```

Expected: PASS.

---

## Task 6: Add Rust window bounds commands

**Files:**
- Modify: `src-tauri/src/window_state.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/ipc/commands.js`

- [ ] **Step 1: Add Rust tests around helpers**

Extend `window_state.rs` tests for:

- clamping still preserves visible bounds;
- applying maximized bounds uses normal bounds before maximize where possible;
- serialization still emits `isMaximized`.

Pure helper tests are enough where direct window manipulation is not testable without a live Tauri window.

- [ ] **Step 2: Implement `current_window_bounds`**

Add a Tauri command that reads the current focused/main window's outer position, inner size, and maximized flag into `WindowBounds`.

Use the same physical pixel units as the existing save/restore path.

- [ ] **Step 3: Implement `apply_window_bounds`**

Add a Tauri command that:

- collects current monitor rects;
- clamps incoming bounds with `clamp_to_visible`;
- unmaximizes first if the current window is maximized;
- applies physical size and position;
- maximizes after restoring normal bounds if `bounds.is_maximized` is true.

- [ ] **Step 4: Register commands and JS wrappers**

Register both commands in `tauri::generate_handler!`.

Add wrappers in `src/ipc/commands.js`:

```js
export function currentWindowBounds() {
  return invoke("current_window_bounds");
}

export function applyWindowBounds(bounds) {
  return invoke("apply_window_bounds", { bounds });
}
```

- [ ] **Step 5: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml window_state
npm test -- src/App.toolbar.test.js
```

Expected: PASS. If the Rust command signatures require an `AppHandle` or `WebviewWindow`, keep the command names stable and adjust implementation only.

---

## Task 7: Implement `usePresets`

**Files:**
- Add: `src/hooks/usePresets.js`
- Add: `src/hooks/usePresets.test.jsx`

- [ ] **Step 1: Write hook tests first**

Cover:

- initial read defaults to `{ list: [], activeId: null }`;
- `save(name)` clones `tree`, copies `visibleModules`, normalizes `panelControls`, captures live Rust window bounds when available, appends a generated preset, and sets `activeId`;
- browser/no-Tauri save omits `windowBounds`;
- `apply(id)` calls `setView`, applies window bounds when present, and sets `activeId` only after success;
- `apply(id)` skips the window step when `windowBounds` is absent;
- window apply failure leaves `activeId` null or reports incomplete state;
- `update(id)` preserves `id`/`name` and replaces snapshot fields;
- `rename(id, name)` changes only name;
- `remove(id)` drops the preset and clears active when removing the active one.

- [ ] **Step 2: Implement store subscription**

The hook should read and subscribe to `presetsStore` so Settings and footer update after external patches.

Normalize empty/malformed blobs to:

```js
{ list: [], activeId: null }
```

- [ ] **Step 3: Implement snapshot capture**

Use:

```js
const clonedTree = structuredClone(workspaceState.tree);
const visibleModules = [...workspaceState.visibleModules];
const panelControls = normalizePanelControls(workspaceState.panelControls);
```

If `structuredClone` is unavailable in tests, use a small local fallback around JSON clone for the plain workspace tree shape.

- [ ] **Step 4: Implement actions**

`save`, `update`, `rename`, and `remove` are store patches.

`apply` order:

1. find preset;
2. call `setView` with cloned preset view;
3. if `windowBounds` exists, call `applyWindowBounds`;
4. set `activeId` only after the required window step succeeds or is intentionally skipped.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- src/hooks/usePresets.test.jsx
```

Expected: PASS.

---

## Task 8: Remove toolbar Presets UI

**Files:**
- Modify: `src/workspace/WorkspaceToolbar.jsx`
- Modify: `src/App.jsx`
- Modify: `src/App.toolbar.test.js`

- [ ] **Step 1: Update tests**

Adjust toolbar tests so the module popover contains modules only and no Presets section/dropdown.

- [ ] **Step 2: Remove preset components**

Delete `PresetDropdownContent` and `PresetDropdown` from `WorkspaceToolbar.jsx`.

Remove `BUILTIN_PRESETS` import from the toolbar.

- [ ] **Step 3: Remove render site**

In `App.jsx`, remove the `PresetDropdownContent` import and the toolbar render block for presets.

Keep `VisibilityPopoverContent`.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/App.toolbar.test.js
```

Expected: PASS.

---

## Task 9: Add Settings Presets UI

**Files:**
- Modify: `src/components/SettingsPanel.jsx`
- Modify: `src/components/SettingsPanel.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Add SettingsPanel tests**

Cover:

- empty state appears when `presets.list` is empty;
- saving a new preset calls `presets.save(name)`;
- Apply calls `presets.apply(id)`;
- Update calls `presets.update(id)`;
- Rename changes name via `presets.rename(id, name)`;
- Delete calls `presets.remove(id)`;
- active preset row is marked.

- [ ] **Step 2: Add props**

Add a `presets` prop to `SettingsPanel`, with a default no-op object for test ergonomics:

```js
presets = {
  list: [],
  activeId: null,
  save: () => {},
  apply: () => {},
  update: () => {},
  rename: () => {},
  remove: () => {},
}
```

- [ ] **Step 3: Build UI**

Add a "Presets" block using existing SettingsPanel visual patterns:

- name input + Save button;
- rows with name and active marker;
- primary Apply action;
- secondary Update/Rename/Delete controls, compact if the side panel feels crowded.

Keep controls accessible with labels and avoid oversized layout.

- [ ] **Step 4: Wire from App**

In `App.jsx`, call `usePresets()` inside the app shell and pass its result to `SettingsPanel`.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- src/components/SettingsPanel.test.jsx
```

Expected: PASS.

---

## Task 10: Add footer active preset display

**Files:**
- Modify: `src/App.jsx`
- Modify: relevant App/footer tests, or add focused coverage if none exists

- [ ] **Step 1: Add footer test**

Cover:

- footer shows `Preset - <name>` or existing divider-styled equivalent when `presets.activeId` matches a preset;
- footer shows `Preset - -` or the agreed empty glyph when no preset is active.

Use whatever exact punctuation matches current footer style.

- [ ] **Step 2: Render footer item**

In the `<footer className={SHELL_FOOTER}>` block, add a preset item using the same divider rhythm as existing footer fields.

Compute:

```js
const activePresetName =
  presets.list.find((preset) => preset.id === presets.activeId)?.name ?? "-";
```

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- src/App.toolbar.test.js src/components/SettingsPanel.test.jsx
```

Expected: PASS.

---

## Task 11: End-to-end verification and cleanup

**Files:** potentially many, only for final test fixups.

- [ ] **Step 1: Full JS tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: successful build.

- [ ] **Step 4: Desktop smoke**

Run the desktop app and verify:

- no toolbar Presets section remains;
- Settings can save, apply, update, rename, and delete presets;
- applying a preset restores layout/modules/panel controls;
- applying a preset restores window size/position in the desktop app;
- moving/resizing the window alone does not clear the active preset footer label;
- manually editing layout/modules/panel controls clears the active preset footer label;
- old `workspace.customPresets` / `workspace.activePresetId` do not persist back into `plvs:workspace`;
- `plvs:presets` exists in `plvs-settings.json`.

---

## Self-review notes

- **Spec coverage:** new `presetsStore` domain (Task 1), Rust injection (Task 2), old workspace cleanup (Task 3), reducer purity and `SET_VIEW` (Task 4), `WorkspaceContext` divergence clearing (Task 5), Rust window commands (Task 6), `usePresets` orchestration (Task 7), toolbar removal (Task 8), Settings UI (Task 9), footer active state (Task 10), verification (Task 11).
- **Highest-risk areas:** `WorkspaceContext` action wrapping can accidentally clear active state after preset apply if `setView` is wrapped; keep `setView` unwrapped. Rust window units must remain physical pixels to avoid high-DPI drift. Hook tests should prove saved presets are snapshots, not live references.
- **Out of scope:** toolbar quick switch, preset reordering, import/export UI, global settings capture.
