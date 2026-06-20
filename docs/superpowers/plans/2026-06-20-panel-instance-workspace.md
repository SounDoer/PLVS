# Panel Instance Workspace Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. Keep each task independently reviewable.

**Goal:** Allow users to add, delete, and rename any number of panel instances,
including multiple instances of the same module type. Keep the toolbar entry
named `Modules`; convert its popover into a panel management surface with current
panel rows and a bottom `+ Add Panel` control.

**Architecture:** Split panel identity from module type. The workspace split
tree stores panel instance ids. `MODULE_REGISTRY` remains keyed by module type.
Panel display names are resolved from `customTitle` or automatic module-title
numbering.

**Tech Stack:** React/JSX, workspace reducer/tree utilities, existing domain
stores, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-panel-instance-workspace-design.md`

---

## File Structure

- Add `src/workspace/panelInstances.js`
- Add `src/workspace/panelInstances.test.js`
- Modify `src/workspace/types.js`
- Modify `src/workspace/constants.js`
- Modify `src/workspace/reducer.js`
- Modify `src/workspace/WorkspaceContext.jsx`
- Modify `src/workspace/registry.jsx`
- Modify `src/workspace/WorkspaceToolbar.jsx`
- Modify `src/workspace/LeafView.jsx`
- Modify `src/workspace/SplitLayout.jsx`
- Modify `src/workspace/DragContext.jsx`
- Modify `src/hooks/usePresets.js`
- Modify relevant tests:
  - `src/workspace/reducer-tree.test.js`
  - `src/workspace/WorkspaceContext.test.jsx`
  - `src/workspace/constants.test.js`
  - `src/workspace/SplitLayout.test.js`
  - `src/components/PanelHeaderControls.test.jsx`
  - `src/hooks/usePresets.test.jsx`
  - `src/App.toolbar.test.js`

---

## Task 1: Add panel instance helpers

**Files:**
- Add: `src/workspace/panelInstances.js`
- Add: `src/workspace/panelInstances.test.js`
- Modify: `src/workspace/types.js`

- [ ] **Step 1: Define the instance shape**

Update typedefs:

```js
/**
 * @typedef {string} PanelId
 * @typedef {{
 *   id: PanelId,
 *   moduleId: ModuleId,
 *   customTitle?: string,
 *   config?: object,
 * }} PanelInstance
 */
```

Update `LeafNode.tabs`, `LeafNode.activeTab`, and `fullscreenId` to use
`PanelId`.

- [ ] **Step 2: Create helper module**

Create helpers:

```js
export function createPanelId(moduleId, panelsById) {}
export function createPanel(moduleId, panelsById, overrides) {}
export function trimCustomTitle(value) {}
export function resolvePanelDisplayName(state, panelId) {}
export function resolvePanelModuleId(state, panelId) {}
export function resolvePanelDefinition(state, panelId) {}
```

Rules:

- generated ids must not collide;
- `customTitle` is trimmed;
- empty custom title is omitted/cleared;
- duplicate custom titles are allowed;
- automatic numbering applies only among unnamed instances of the same module.

- [ ] **Step 3: Test helper behavior**

Cover:

- creating duplicate module instances generates unique ids;
- single unnamed Spectrum displays `Spectrum`;
- two unnamed Spectrums display `Spectrum 1` and `Spectrum 2`;
- custom title overrides automatic title;
- custom-titled panels do not participate in automatic numbering;
- empty custom title clears to automatic title.

---

## Task 2: Upgrade default workspace shape

**Files:**
- Modify: `src/workspace/constants.js`
- Modify: `src/workspace/constants.test.js`

- [ ] **Step 1: Add default panel instances**

Default state should use the new shape:

```js
{
  tree: DEFAULT_TREE,
  panelsById: DEFAULT_PANELS_BY_ID,
  panelOrder: DEFAULT_PANEL_ORDER,
  fullscreenId: null,
  panelControls: DEFAULT_PANEL_CONTROLS,
}
```

No migration is required. Existing `visibleModules` should be removed from the
target state shape.

- [ ] **Step 2: Keep initial ids readable**

For default panels, ids may remain equal to module ids (`peak`, `loudness`,
`spectrum`) to make tests and source inspection readable. They are now panel ids,
not module uniqueness guarantees.

- [ ] **Step 3: Update tests**

Assert:

- `DEFAULT_WORKSPACE_STATE` has `panelsById` and `panelOrder`;
- default `peak` panel maps to module id `peak`;
- default registry title for `peak` remains `Level Meter`;
- no `visibleModules` key remains in the default state.

---

## Task 3: Add reducer actions for instances and naming

**Files:**
- Modify: `src/workspace/reducer.js`
- Modify: `src/workspace/reducer-tree.test.js`

- [ ] **Step 1: Add `ADD_PANEL`**

Payload:

```js
{ moduleId }
```

Behavior:

- create a new `PanelInstance`;
- add it to `panelsById`;
- append id to `panelOrder`;
- insert a new leaf to the right of the root;
- if the tree is null, the new leaf becomes the root.

- [ ] **Step 2: Add `REMOVE_PANEL`**

Payload:

```js
{ id }
```

Behavior:

- remove the tab from the tree with existing `removeTab`;
- delete from `panelsById`;
- remove from `panelOrder`;
- clear fullscreen if that instance was fullscreen.

- [ ] **Step 3: Add `RENAME_PANEL`**

Payload:

```js
{ id, customTitle }
```

Behavior:

- trim `customTitle`;
- non-empty value sets `panelsById[id].customTitle`;
- empty value removes `customTitle`;
- duplicate custom titles are allowed.

- [ ] **Step 4: Replace visibility semantics**

Remove `TOGGLE_MODULE_VISIBLE` from the active UI flow. Rendering should be based
on panel instances in the tree, not `visibleModules`.

- [ ] **Step 5: Update `SET_VIEW`**

`SET_VIEW` should set:

```js
tree
panelsById
panelOrder
panelControls
fullscreenId: null
```

No old-shape compatibility is required for this slice.

- [ ] **Step 6: Test reducer behavior**

Cover:

- adding two Level Meter panels creates two panel ids;
- removing one duplicate leaves the other;
- renaming a panel sets `customTitle`;
- renaming to whitespace clears `customTitle`;
- removing a fullscreen panel clears fullscreen;
- moving duplicated panel ids through `MOVE_TAB` still works.

---

## Task 4: Update WorkspaceContext

**Files:**
- Modify: `src/workspace/WorkspaceContext.jsx`
- Modify: `src/workspace/WorkspaceContext.test.jsx`

- [ ] **Step 1: Initialize only the new shape**

`initState()` accepts the new shape or falls back to `DEFAULT_WORKSPACE_STATE`.
Because migration is out of scope, malformed/old workspace blobs can reset to
defaults.

Always set `fullscreenId: null` after reading storage.

- [ ] **Step 2: Clear active preset on instance edits**

Wrap these manual actions with `presetsStore.activeId = null`:

- `addPanel`
- `removePanel`
- `renamePanel`
- `moveTab`
- `resizeChildren`
- `setPanelControls`

- [ ] **Step 3: Test**

Cover:

- old/malformed persisted shape resets to defaults;
- fullscreen is never restored;
- add/remove/rename clear active preset;
- `setView` from preset apply does not clear active preset.

---

## Task 5: Resolve instances in rendering

**Files:**
- Modify: `src/workspace/registry.jsx`
- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/workspace/SplitLayout.jsx`
- Modify: `src/workspace/DragContext.jsx`

- [ ] **Step 1: Add registry/instance resolution helpers**

Expose or re-export:

```js
resolvePanelDefinition(state, panelId)
resolvePanelModuleId(state, panelId)
resolvePanelDisplayName(state, panelId)
```

- [ ] **Step 2: Update `LeafView`**

Use panel ids for tab identity and module ids for component/header-control
routing:

- tab label uses `resolvePanelDisplayName`;
- active component comes from `resolvePanelDefinition`;
- `PanelHeaderControls.activeTab` receives module id;
- tab `X` removes the panel instance;
- leaf `X` removes all panel instances in that leaf.

- [ ] **Step 3: Update `SplitLayout`**

Use resolved definitions for:

- min-size calculations;
- fullscreen rendering;
- fullscreen title.

Digit shortcuts remain module-oriented: key `1` fullscreens the first visible
Level Meter instance.

- [ ] **Step 4: Update drag preview**

Drag preview displays the same resolved panel display name.

---

## Task 6: Rebuild Modules popover

**Files:**
- Modify: `src/workspace/WorkspaceToolbar.jsx`
- Modify: `src/App.toolbar.test.js`

- [ ] **Step 1: Rename component if practical**

Rename `VisibilityPopoverContent` to `ModulesPopoverContent` if the callsite
churn is small. If not, keep the old component name temporarily but implement
new behavior.

- [ ] **Step 2: Render current panel rows**

The popover body should be:

```txt
Modules

<panel rows>

[+ Add Panel v]
```

No `Current` or `Add` section labels.

Each panel row:

- shows resolved display name;
- has rename icon;
- has trash icon;
- trash calls `removePanel(id)` and does not trigger rename.

- [ ] **Step 3: Add inline rename**

Clicking rename changes the row into edit mode:

```txt
[input             ] [check] [x]
```

Rules:

- Enter/check commits;
- Escape/X cancels;
- whitespace-only commit clears custom title and restores automatic name;
- duplicate names are allowed.

- [ ] **Step 4: Add bottom `+ Add Panel` control**

The bottom control opens a dropdown/menu of module types from
`MODULE_REGISTRY`.

Selecting an item calls `addPanel(moduleId)`.

The `peak` module should display as `Level Meter` because it uses the registry
title.

- [ ] **Step 5: Keep toolbar naming**

Toolbar button and tooltip remain `Modules`.

- [ ] **Step 6: Test**

Assert:

- popover title is `Modules`;
- no `Current` or `Add` label is rendered;
- current panel rows render;
- delete button removes a panel;
- rename commits and cancels;
- bottom `+ Add Panel` exists;
- selecting `Level Meter` calls add for module id `peak`.

---

## Task 7: Capture and restore instances in presets

**Files:**
- Modify: `src/hooks/usePresets.js`
- Modify: `src/hooks/usePresets.test.jsx`

- [ ] **Step 1: Save new workspace shape**

Snapshots include:

```js
tree
panelsById
panelOrder
panelControls
```

- [ ] **Step 2: Apply new presets**

Preset apply restores:

```js
tree
panelsById
panelOrder
panelControls
```

No old preset migration is required.

- [ ] **Step 3: Test**

Cover:

- save includes duplicate panel instances;
- save includes custom titles;
- apply restores duplicate instances and custom titles.

---

## Task 8: Verification

- [ ] **Step 1: Run targeted tests**

```bash
npm test -- src/workspace/panelInstances.test.js src/workspace/reducer-tree.test.js src/workspace/WorkspaceContext.test.jsx src/hooks/usePresets.test.jsx src/App.toolbar.test.js
```

- [ ] **Step 2: Run workspace/rendering tests**

```bash
npm test -- src/workspace
```

- [ ] **Step 3: Run full frontend tests**

```bash
npm test
```

- [ ] **Step 4: Build and lint**

```bash
npm run build
npm run lint
```

- [ ] **Step 5: Manual desktop QA**

Run the desktop app and verify:

- toolbar button and tooltip still say `Modules`;
- Modules popover lists current panels without `Current`/`Add` headings;
- bottom `+ Add Panel` opens module choices;
- adding Level Meter twice creates two panel instances;
- duplicate unnamed panels show numbered titles consistently in the panel,
  Modules list, fullscreen title, and drag preview;
- renaming a panel updates the same title everywhere;
- clearing a custom name restores automatic naming;
- duplicate custom names are allowed;
- deleting from Modules removes the matching panel;
- deleting from the panel header removes the matching panel;
- removing all panels shows `No panels`;
- presets save and restore duplicate panels and custom names.

---

## Self-review notes

- **Highest-risk area:** keeping display names consistent across panel header,
  Modules rows, fullscreen, and drag preview.
- **No migration:** old workspace/preset shapes may reset. Do not spend effort on
  compatibility in this slice.
- **Controls limitation:** first slice keeps panel controls global. That means
  duplicate panels share controls until a later per-instance config pass.
- **Toolbar language:** do not rename the toolbar button or tooltip away from
  `Modules`.
