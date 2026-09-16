# Persistence Consumer Migration + Trim Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint every persistence consumer at the Plan 1 domain stores, retire the `plvs.ui` blob, resolve the `panelControls` double-write, remove `focusId` from the state model, make `fullscreenId` runtime-only, delete the vestigial drag-ratio layout code, and wire one-shot legacy-key cleanup on boot.

**Architecture:** Each consumer stops touching `localStorage`/`plvs.ui` directly and instead reads/writes `settingsStore` or `workspaceStore` (from `src/persistence`). `panelControls` becomes single-sourced in workspace state (its already-existing home), so App.jsx's local mirror and its three sync effects are removed. Backend stays localStorage (Plan 3 swaps in plugin-store). No data migration — early users reset once.

**Tech Stack:** JavaScript/JSX (React), Vitest (jsdom, globals), localStorage.

**Spec:** `docs/superpowers/specs/2026-06-17-persistence-unification-design.md`
**Depends on:** Plan 1 (`docs/superpowers/plans/2026-06-17-persistence-foundation.md`) — `src/persistence/{index,createDomainStore,localStorageBackend,cleanupLegacyKeys}.js` must exist.

**Field assignment (target):**
- `settingsStore` (`plvs:settings`): `referenceLufs`, `appearance`, `themeId`, `channelLabelOverrides`, `closeAction`, `windowPinned`, `captureDeviceId`, `clearShortcut`, `clearGlobal` *(captureDeviceId/clearShortcut stay on plugin-store until Plan 3; not touched here)*.
- `workspaceStore` (`plvs:workspace`): `tree`, `visibleModules`, `activePresetId`, `panelControls`, `customPresets`.

---

## File Structure (Plan 2)

- Modify `src/hooks/useAlwaysOnTop.js` — `windowPinned` → `settingsStore`.
- Modify `src/hooks/useCloseConfirm.js` — `closeAction` → `settingsStore`.
- Modify `src/hooks/useSettings.js` — `referenceLufs`/`appearance`/`themeId`/`closeAction` → `settingsStore`.
- Modify `src/preferences/themeResolve.js` — read shell theme fields from `settingsStore`.
- Modify `src/App.jsx` — settings persist effect → `settingsStore`; untangle `panelControls`; drop ratio state/wiring; boot cleanup.
- Modify `src/lib/panelControls.js` — delete `readPersistedPanelControls`/`writePersistedPanelControls`.
- Modify `src/workspace/WorkspaceContext.jsx` — persist via `workspaceStore`; reset `fullscreenId` on load.
- Modify `src/workspace/constants.js` — drop `focusId` from `DEFAULT_WORKSPACE_STATE`; remove unused `WORKSPACE_STORAGE_KEY`.
- Modify `src/workspace/types.js` — drop `focusId` from `WorkspaceState`.
- Modify `src/workspace/reducer.js` — `SET_FOCUS` keeps only tab activation; `TOGGLE_MODULE_VISIBLE` drops the focus-clear branch.
- Delete `src/components/PanelSet.jsx`, `src/hooks/useLayoutDrag.js` and their wiring.
- Modify `src/workspace/AudioDataContext.jsx` — drop the stale `PanelSet` comment.
- Modify `src/uiPreferences.js` — drop `patchUiState`/`readUiState`/`subscribeUiState` re-exports.
- Delete `src/preferences/uiStore.js` + `src/preferences/uiStore.test.js`.
- Update affected tests throughout.

---

## Task 1: Migrate `windowPinned` to settingsStore

**Files:**
- Modify: `src/hooks/useAlwaysOnTop.js`
- Test: `src/hooks/useAlwaysOnTop.test.js`

- [ ] **Step 1: Update the test to use the settings domain key**

In `src/hooks/useAlwaysOnTop.test.js`, replace every `localStorage.setItem("plvs:windowPinned", "true")` seed with a settings blob, and the read assertion with the blob field. Replace the four occurrences:

```js
// seed (was: localStorage.setItem("plvs:windowPinned", "true"))
localStorage.setItem("plvs:settings", JSON.stringify({ windowPinned: true }));
```

```js
// assertion (was: expect(localStorage.getItem("plvs:windowPinned")).toBe("true"))
expect(JSON.parse(localStorage.getItem("plvs:settings")).windowPinned).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useAlwaysOnTop.test.js`
Expected: FAIL — hook still reads/writes the old `plvs:windowPinned` key.

- [ ] **Step 3: Rewrite the hook against settingsStore**

Replace the storage mechanics in `src/hooks/useAlwaysOnTop.js`. Old:

```js
const STORAGE_KEY = "plvs:windowPinned";
// ...
    return localStorage.getItem(STORAGE_KEY) === "true";
// ...
    localStorage.setItem(STORAGE_KEY, String(next));
```

New — import the store and use `read()`/`patch()`:

```js
import { settingsStore } from "../persistence/index.js";
// ...
    return settingsStore.read().windowPinned === true;
// ...
    settingsStore.patch({ windowPinned: next });
```

(Keep the rest of the hook — the `setAlwaysOnTop` Tauri call and effect — unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useAlwaysOnTop.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAlwaysOnTop.js src/hooks/useAlwaysOnTop.test.js
git commit -m "refactor(persistence): move windowPinned to settings domain"
```

---

## Task 2: Migrate `closeAction` to settingsStore

`closeAction` is read/written by two modules sharing the old `plvs:closeAction` key: `useCloseConfirm.js` and `useSettings.js`. Move both to `settingsStore.closeAction`. Semantics unchanged: value is `"tray"`/`"quit"`; **absent means "ask"**, and choosing "ask" clears the field.

**Files:**
- Modify: `src/hooks/useCloseConfirm.js`, `src/hooks/useSettings.js`
- Test: `src/hooks/useCloseConfirm.test.js`, `src/hooks/useSettings.rtl.test.jsx`

- [ ] **Step 1: Update tests to the settings key**

In `src/hooks/useCloseConfirm.test.js` and `src/hooks/useSettings.rtl.test.jsx`, replace `localStorage.setItem("plvs:closeAction", "tray")` seeds with:

```js
localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "tray" }));
```

Replace the write assertions:

```js
// was: expect(localStorage.getItem("plvs:closeAction")).toBe("tray")
expect(JSON.parse(localStorage.getItem("plvs:settings")).closeAction).toBe("tray");
```

```js
// was: expect(localStorage.getItem("plvs:closeAction")).toBeNull()  (the "ask" case)
expect(JSON.parse(localStorage.getItem("plvs:settings") ?? "{}").closeAction).toBeUndefined();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useCloseConfirm.test.js src/hooks/useSettings.rtl.test.jsx`
Expected: FAIL — modules still use the old key.

- [ ] **Step 3: Rewrite `useCloseConfirm.js`**

Replace its localStorage mechanics. Old:

```js
const STORAGE_KEY = "plvs:closeAction";
// ...
        const saved = localStorage.getItem(STORAGE_KEY);
// ...
      localStorage.setItem(STORAGE_KEY, action);
```

New:

```js
import { settingsStore } from "../persistence/index.js";
// ...
        const saved = settingsStore.read().closeAction ?? null;
// ...
      settingsStore.patch({ closeAction: action });
```

- [ ] **Step 4: Rewrite the `closeAction` block in `useSettings.js`**

Replace the constant and the three direct localStorage calls. Old:

```js
const CLOSE_ACTION_KEY = "plvs:closeAction";
// ...
  const [closeAction, setCloseActionState] = useState(
    () => localStorage.getItem(CLOSE_ACTION_KEY) ?? "ask"
  );
// ...
  function setCloseAction(value) {
    if (value === "ask") {
      localStorage.removeItem(CLOSE_ACTION_KEY);
    } else {
      localStorage.setItem(CLOSE_ACTION_KEY, value);
    }
    setCloseActionState(value);
  }
```

New (drop the constant; clearing "ask" writes `closeAction: undefined`, which `patch`'s merge stores as absent on the next read path — to truly remove it, reset the field explicitly):

```js
  const [closeAction, setCloseActionState] = useState(
    () => settingsStore.read().closeAction ?? "ask"
  );
// ...
  function setCloseAction(value) {
    if (value === "ask") {
      const { closeAction: _drop, ...rest } = settingsStore.read();
      settingsStore.reset();
      settingsStore.patch(rest);
    } else {
      settingsStore.patch({ closeAction: value });
    }
    setCloseActionState(value);
  }
```

Add the import at the top of `useSettings.js`:

```js
import { settingsStore } from "../persistence/index.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useCloseConfirm.test.js src/hooks/useSettings.rtl.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCloseConfirm.js src/hooks/useSettings.js src/hooks/useCloseConfirm.test.js src/hooks/useSettings.rtl.test.jsx
git commit -m "refactor(persistence): move closeAction to settings domain"
```

---

## Task 3: Migrate theme + referenceLufs + channelLabelOverrides to settingsStore

`appearance`/`themeId` resolution (`themeResolve.js`) and `referenceLufs` (`useSettings.js`) read the `plvs.ui` blob today; App.jsx persists them (plus the dead drag ratios + `channelLabelOverrides`) via `patchUiState`. Move all settings fields to `settingsStore` and stop persisting drag ratios.

**Files:**
- Modify: `src/preferences/themeResolve.js`, `src/hooks/useSettings.js`, `src/App.jsx`
- Test: `src/hooks/useSettings.rtl.test.jsx`, `src/preferences/themeResolve` is covered via existing `parsePersistedUiStateJson` tests (kept).

- [ ] **Step 1: Point `readPersistedShellThemeFields` at settingsStore**

In `src/preferences/themeResolve.js`, replace the `readUiState` import and usage. Old:

```js
import { readUiState } from "./uiStore.js";
// ...
export function readPersistedShellThemeFields(prefs) {
  return parsePersistedUiStateJson(readUiState(prefs));
}
```

New:

```js
import { settingsStore } from "../persistence/index.js";
// ...
export function readPersistedShellThemeFields() {
  return parsePersistedUiStateJson(settingsStore.read());
}
```

(`parsePersistedUiStateJson` is unchanged — it already accepts a parsed object.)

- [ ] **Step 2: Point `referenceLufs` init at settingsStore**

In `src/hooks/useSettings.js`, replace the `readUiState` usage. Old:

```js
  const [referenceLufs, setReferenceLufs] = useState(() =>
    normalizeReferenceLufs(readUiState().referenceLufs)
  );
```

New:

```js
  const [referenceLufs, setReferenceLufs] = useState(() =>
    normalizeReferenceLufs(settingsStore.read().referenceLufs)
  );
```

Update the import block: remove `readUiState`, `subscribeUiState` from the `../uiPreferences` import and replace the cross-window subscription. Old:

```js
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  readUiState,
  resolveThemeId,
  subscribeUiState,
} from "../uiPreferences";
```

New:

```js
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveThemeId,
} from "../uiPreferences";
```

And the subscribe effect. Old:

```js
  useEffect(
    () =>
      subscribeUiState(() => {
        const next = readPersistedShellThemeFields(UI_PREFERENCES);
        setAppearance(next.appearance);
        setThemeId(next.themeId);
      }),
    []
  );
```

New:

```js
  useEffect(
    () =>
      settingsStore.subscribe(() => {
        const next = readPersistedShellThemeFields();
        setAppearance(next.appearance);
        setThemeId(next.themeId);
      }),
    []
  );
```

Also update the two `readPersistedShellThemeFields(UI_PREFERENCES)` initializers (appearance, themeId useState) to call `readPersistedShellThemeFields()` with no argument.

- [ ] **Step 3: Repoint App.jsx's settings persist effect; drop ratios**

In `src/App.jsx`, the effect at lines ~884-895 persists settings + ratios via `patchUiState`. Replace it. Old:

```js
    patchUiState({
      mainLeft,
      leftTopRatio,
      rightTopRatio,
      loudnessHistWidthRatio,
      spectrogramTopRatio,
      referenceLufs,
      appearance,
      themeId: appearance === "system" ? null : fixedThemeSelectValue,
      channelLabelOverrides,
    });
```

New (settings only; ratios dropped):

```js
    settingsStore.patch({
      referenceLufs,
      appearance,
      themeId: appearance === "system" ? null : fixedThemeSelectValue,
      channelLabelOverrides,
    });
```

Update the effect dependency array to drop the five ratio variables (`mainLeft`, `leftTopRatio`, `rightTopRatio`, `loudnessHistWidthRatio`, `spectrogramTopRatio`), leaving `[referenceLufs, appearance, fixedThemeSelectValue, channelLabelOverrides]`.

In the restore effect (lines ~870-881), remove the five ratio restores and read `channelLabelOverrides` from the settings store. Old:

```js
    if (typeof s.mainLeft === "number") setMainLeft(s.mainLeft);
    if (typeof s.leftTopRatio === "number") setLeftTopRatio(s.leftTopRatio);
    if (typeof s.rightTopRatio === "number") setRightTopRatio(s.rightTopRatio);
    if (typeof s.loudnessHistWidthRatio === "number")
      setLoudnessHistWidthRatio(s.loudnessHistWidthRatio);
    if (typeof s.spectrogramTopRatio === "number") setSpectrogramTopRatio(s.spectrogramTopRatio);
    setChannelLabelOverrides(sanitizeChannelLabelOverrides(s.channelLabelOverrides));
```

New:

```js
    setChannelLabelOverrides(sanitizeChannelLabelOverrides(s.channelLabelOverrides));
```

Find where `s` is read at the top of that restore effect (currently `const s = readUiState();` or via `readPersistedShellThemeFields`); change the source to `const s = settingsStore.read();`. Replace the `patchUiState`/`readUiState` imports from `./lib/panelControls.js`/`./uiPreferences` accordingly (see Task 5 and Task 9 for the panelControls and uiStore import cleanups). Add near the other imports:

```js
import { settingsStore } from "./persistence/index.js";
```

- [ ] **Step 4: Update `useSettings.rtl.test.jsx` seeds for referenceLufs**

Replace the `plvs.ui` seeds. Old:

```js
    localStorage.setItem(UI_PREFERENCES.layoutPersistKey, JSON.stringify({ referenceLufs: -14 }));
```

New:

```js
    localStorage.setItem("plvs:settings", JSON.stringify({ referenceLufs: -14 }));
```

(Apply to both `referenceLufs` seed lines.)

- [ ] **Step 5: Run the affected tests**

Run: `npx vitest run src/hooks/useSettings.rtl.test.jsx src/preferences/themeResolve` (the themeResolve parse tests live alongside; adjust path if needed via `npx vitest run -t parsePersistedUiStateJson`).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/preferences/themeResolve.js src/hooks/useSettings.js src/App.jsx src/hooks/useSettings.rtl.test.jsx
git commit -m "refactor(persistence): move theme/referenceLufs/channelLabelOverrides to settings domain; stop persisting drag ratios"
```

---

## Task 4: Migrate WorkspaceContext to workspaceStore

**Files:**
- Modify: `src/workspace/WorkspaceContext.jsx`, `src/workspace/constants.js`
- Test: `src/workspace/constants.test.js`

- [ ] **Step 1: Update `constants.test.js` for the new key**

The test currently asserts `WORKSPACE_STORAGE_KEY === "plvs:workspace:v3"`. Remove that test (the constant is being deleted). Replace the `it("uses plvs:workspace:v3 ...")` block with a check that `DEFAULT_WORKSPACE_STATE` has no `focusId` (set up here for Task 6) and the expected keys:

```js
  it("DEFAULT_WORKSPACE_STATE has the lean persisted shape", () => {
    expect(Object.keys(DEFAULT_WORKSPACE_STATE).sort()).toEqual(
      ["activePresetId", "customPresets", "fullscreenId", "panelControls", "tree", "visibleModules"].sort()
    );
  });
```

Remove the now-unused `WORKSPACE_STORAGE_KEY` import from the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace/constants.test.js`
Expected: FAIL — `WORKSPACE_STORAGE_KEY` import and/or shape mismatch.

- [ ] **Step 3: Rewrite WorkspaceContext persistence**

In `src/workspace/WorkspaceContext.jsx`, replace the localStorage mechanics with `workspaceStore`. Old:

```js
import { DEFAULT_WORKSPACE_STATE, WORKSPACE_STORAGE_KEY } from "./constants.js";
// ...
function initState() {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_STATE;
    const parsed = JSON.parse(raw);
    if (!parsed.tree || !Array.isArray(parsed.visibleModules)) return DEFAULT_WORKSPACE_STATE;
    return {
      ...DEFAULT_WORKSPACE_STATE,
      ...parsed,
      customPresets: Array.isArray(parsed.customPresets) ? parsed.customPresets : [],
    };
  } catch (_) {
    return DEFAULT_WORKSPACE_STATE;
  }
}
```

New (read via store; **reset `fullscreenId` on load** so it is runtime-only — Task 7's behavior, applied here):

```js
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { workspaceStore } from "../persistence/index.js";
// ...
function initState() {
  const parsed = workspaceStore.read();
  if (!parsed.tree || !Array.isArray(parsed.visibleModules)) return DEFAULT_WORKSPACE_STATE;
  return {
    ...DEFAULT_WORKSPACE_STATE,
    ...parsed,
    customPresets: Array.isArray(parsed.customPresets) ? parsed.customPresets : [],
    fullscreenId: null, // transient view state: never restored across launches
  };
}
```

Replace the persist effect. Old:

```js
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }, [state]);
```

New:

```js
  useEffect(() => {
    workspaceStore.patch(state);
  }, [state]);
```

- [ ] **Step 4: Remove the unused constant**

In `src/workspace/constants.js`, delete the line:

```js
export const WORKSPACE_STORAGE_KEY = "plvs:workspace:v3";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/workspace/constants.test.js`
Expected: PASS. (`DEFAULT_WORKSPACE_STATE` still has `focusId` at this point — Step 1's shape test will fail on the extra key. Fix by completing Task 6 next; if running this task alone, temporarily include `focusId` in the expected array, then remove it in Task 6.)

> Ordering note: Tasks 4 and 6 are coupled through `DEFAULT_WORKSPACE_STATE`'s shape. Execute Task 6 immediately after Task 4 (or together) so the shape assertion lands once.

- [ ] **Step 6: Commit**

```bash
git add src/workspace/WorkspaceContext.jsx src/workspace/constants.js src/workspace/constants.test.js
git commit -m "refactor(persistence): persist workspace via workspaceStore; reset fullscreenId on load"
```

---

## Task 5: Single-source `panelControls` in workspace state (untangle App.jsx)

Today App.jsx keeps a **local** `panelControls` state (seeded from `plvs.ui` via `readPersistedPanelControls`, written back via `writePersistedPanelControls`) **and** mirrors it to/from `workspaceState.panelControls` through three effects. Make `workspaceState.panelControls` the single source: derive the UI values from it, route edits straight to the workspace store, and delete the local state, the mirror effects, and the `plvs.ui` read/write helpers.

**Files:**
- Modify: `src/App.jsx`, `src/lib/panelControls.js`
- Test: `src/lib/panelControls.test.js`

- [ ] **Step 1: Delete the `plvs.ui` panelControls helpers**

In `src/lib/panelControls.js`, delete both functions and their `patchUiState`/`readUiState` import:

```js
export function readPersistedPanelControls(prefs = UI_PREFERENCES) {
  return normalizePanelControls(readUiState(prefs)?.panelControls);
}

export function writePersistedPanelControls(panelControls, prefs = UI_PREFERENCES) {
  patchUiState({ panelControls: normalizePanelControls(panelControls) }, prefs);
}
```

Remove the now-unused import line at the top of `panelControls.js`:

```js
import { patchUiState, readUiState } from "../preferences/uiStore.js";
```

(Keep `normalizePanelControls`, `DEFAULT_PANEL_CONTROLS`, and the metadata exports — they are still used.)

- [ ] **Step 2: Update `panelControls.test.js`**

Delete the test cases that import and exercise `readPersistedPanelControls`/`writePersistedPanelControls` (the cases asserting `plvs.ui` round-trips). Remove those two names from the test's import block. Keep the `normalizePanelControls` tests.

- [ ] **Step 3: Rewrite App.jsx panelControls plumbing to single-source**

In `src/App.jsx`:

(a) Remove the local state + its normalize, and derive from workspace instead. Old (lines ~201-209):

```js
  const [panelControls, setPanelControlsState] = useState(() => readPersistedPanelControls());
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const vectorscopePairUi = normalizedPanelControls.vectorscopePair;
  const spectrumChannelUi = normalizedPanelControls.spectrumChannel;
  const spectrumViewUi = normalizedPanelControls.spectrumView;
  const spectrumPeakHoldUi = normalizedPanelControls.spectrumPeakHold;
```

New (the existing `workspacePanelControls` memo at ~280 becomes the source; move it above this point or reference it — keep a single normalized value named `normalizedPanelControls`):

```js
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(workspaceState.panelControls),
    [workspaceState.panelControls]
  );
  const vectorscopePairUi = normalizedPanelControls.vectorscopePair;
  const spectrumChannelUi = normalizedPanelControls.spectrumChannel;
  const spectrumViewUi = normalizedPanelControls.spectrumView;
  const spectrumPeakHoldUi = normalizedPanelControls.spectrumPeakHold;
```

(b) Delete the now-duplicate `workspacePanelControls` memo and the sync bookkeeping (lines ~280-292): the `workspacePanelControls` memo, `panelControlsKey`, `workspacePanelControlsKey`, and `lastSyncedPanelControlsKeyRef`.

(c) Route edits straight to the workspace store. Old `updatePanelControls` (lines ~294-300):

```js
  const updatePanelControls = useCallback((nextPanelControls) => {
    setPanelControlsState((current) =>
      normalizePanelControls(
        typeof nextPanelControls === "function" ? nextPanelControls(current) : nextPanelControls
      )
    );
  }, []);
```

New (apply against the current workspace value and dispatch through the bound action `setWorkspacePanelControls` — confirm the action name from `bindWorkspaceActions`; reducer exposes `setPanelControls`):

```js
  const updatePanelControls = useCallback(
    (nextPanelControls) => {
      const current = normalizePanelControls(workspaceState.panelControls);
      const next = normalizePanelControls(
        typeof nextPanelControls === "function" ? nextPanelControls(current) : nextPanelControls
      );
      setWorkspacePanelControls(next);
    },
    [workspaceState.panelControls, setWorkspacePanelControls]
  );
```

Ensure `setWorkspacePanelControls` is destructured from `useWorkspaceStore()` (the reducer binding is `setPanelControls`; rename in destructure: `const { ..., setPanelControls: setWorkspacePanelControls } = useWorkspaceStore();` — match the existing destructure site).

(d) Delete the three mirror effects: the `writePersistedPanelControls` effect (lines ~320-322), the workspace→local sync effect (lines ~324-333), and the local→workspace effect that calls `setWorkspacePanelControls(normalizedPanelControls)` (around line ~335-341). With single-sourcing they are obsolete.

(e) Remove the now-unused imports from `./lib/panelControls.js` at the top of App.jsx:

```js
  readPersistedPanelControls,
  writePersistedPanelControls,
```

(Keep `normalizePanelControls`.)

- [ ] **Step 4: Run the panelControls + reducer suites**

Run: `npx vitest run src/lib/panelControls.test.js src/workspace/reducer-tree.test.js`
Expected: PASS.

- [ ] **Step 5: Manual reasoning check (no code)**

Confirm every downstream use of `normalizedPanelControls`/`vectorscopePairUi`/`spectrumChannelUi`/`spectrumViewUi`/`spectrumPeakHoldUi` (App.jsx lines ~439, 515-529, 561-573, 587-642, 646-714, 974-1038) still resolves — they reference the same identifiers, now sourced from workspace state. No edits needed beyond the source swap.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "refactor(persistence): single-source panelControls in workspace state"
```

---

## Task 6: Remove `focusId` from the workspace state model

**Files:**
- Modify: `src/workspace/constants.js`, `src/workspace/types.js`, `src/workspace/reducer.js`
- Test: `src/workspace/reducer-tree.test.js`

- [ ] **Step 1: Update reducer tests**

In `src/workspace/reducer-tree.test.js`, delete the two `TOGGLE_MODULE_VISIBLE` focus cases ("clears focusId when hiding the focused module", "preserves focusId when hiding a non-focused module") and change the `SET_FOCUS` describe block to assert the **tab activation** effect instead of `focusId`. Replace the `focusId`-based assertions:

```js
  it("activates the target tab in its leaf", () => {
    const root = {
      type: "leaf",
      tabs: ["peak", "loudness"],
      activeTab: "peak",
    };
    const next = workspaceReducer(state(root), { type: "SET_FOCUS", payload: { id: "loudness" } });
    expect(next.tree.activeTab).toBe("loudness");
    expect(next).not.toHaveProperty("focusId");
  });
```

(Use the existing `state()` helper in that file; drop any `focusId` from its inline states.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace/reducer-tree.test.js`
Expected: FAIL — reducer still sets/clears `focusId`.

- [ ] **Step 3: Remove `focusId` from defaults and type**

In `src/workspace/constants.js`, delete `focusId: null,` from `DEFAULT_WORKSPACE_STATE`.

In `src/workspace/types.js`, delete the `focusId: ModuleId | null,` line from the `WorkspaceState` typedef.

- [ ] **Step 4: Strip `focusId` from the reducer**

In `src/workspace/reducer.js`:

`TOGGLE_MODULE_VISIBLE` — old:

```js
      const focusId = isVisible && state.focusId === id ? null : state.focusId;
      // Tree structure is unchanged — visibleModules controls rendering only
      return { ...state, visibleModules, focusId };
```

New:

```js
      // Tree structure is unchanged — visibleModules controls rendering only
      return { ...state, visibleModules };
```

`SET_FOCUS` — old:

```js
    case "SET_FOCUS": {
      const { id } = action.payload;
      const path = findLeafWithTab(state.tree, id);
      if (!path) return { ...state, focusId: id };
      const newTree = updateNode(state.tree, path, (node) => ({ ...node, activeTab: id }));
      return { ...state, tree: newTree, focusId: id };
    }
```

New (keep only the tab activation; a missing leaf is a no-op):

```js
    case "SET_FOCUS": {
      const { id } = action.payload;
      const path = findLeafWithTab(state.tree, id);
      if (!path) return state;
      const newTree = updateNode(state.tree, path, (node) => ({ ...node, activeTab: id }));
      return { ...state, tree: newTree };
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/workspace/reducer-tree.test.js src/workspace/constants.test.js`
Expected: PASS (the Task 4 shape assertion now matches with `focusId` gone).

- [ ] **Step 6: Commit**

```bash
git add src/workspace/constants.js src/workspace/types.js src/workspace/reducer.js src/workspace/reducer-tree.test.js
git commit -m "refactor(workspace): remove focusId from the state model"
```

---

## Task 7: Confirm `fullscreenId` is runtime-only

`fullscreenId` reset-on-load was implemented in Task 4 (`initState` forces `fullscreenId: null`). This task adds the regression test.

**Files:**
- Test: `src/workspace/WorkspaceContext.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

```js
// src/workspace/WorkspaceContext.test.jsx
import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "./WorkspaceContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";

function Probe({ onState }) {
  const { state } = useWorkspaceStore();
  onState(state);
  return null;
}

describe("WorkspaceContext fullscreenId", () => {
  afterEach(() => localStorage.clear());

  it("never restores fullscreenId from storage", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({ ...DEFAULT_WORKSPACE_STATE, fullscreenId: "peak" })
    );
    let captured = null;
    render(
      <WorkspaceProvider>
        <Probe onState={(s) => (captured = s)} />
      </WorkspaceProvider>
    );
    expect(captured.fullscreenId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (behavior already implemented in Task 4)**

Run: `npx vitest run src/workspace/WorkspaceContext.test.jsx`
Expected: PASS. If it FAILS, ensure Task 4 Step 3's `fullscreenId: null` line is present in `initState`.

- [ ] **Step 3: Commit**

```bash
git add src/workspace/WorkspaceContext.test.jsx
git commit -m "test(workspace): fullscreenId is runtime-only, never restored"
```

---

## Task 8: Delete the vestigial drag-ratio layout code

`PanelSet` is never rendered and `useLayoutDrag`'s handlers are computed in App.jsx but never attached. Remove them and the App.jsx ratio state.

**Files:**
- Delete: `src/components/PanelSet.jsx`, `src/hooks/useLayoutDrag.js`
- Modify: `src/App.jsx`, `src/workspace/AudioDataContext.jsx`

- [ ] **Step 1: Confirm nothing renders PanelSet or uses the drag handlers**

Run: `npx grep -rn "PanelSet\|useLayoutDrag\|beginLayoutDrag\|onLayoutDragMove\|onLayoutDragUp" src` (or use ripgrep). 
Expected: matches only in `src/components/PanelSet.jsx`, `src/hooks/useLayoutDrag.js`, the App.jsx import + destructure (lines ~14, 741-753), and the stale comment in `src/workspace/AudioDataContext.jsx:8`. No JSX `<PanelSet` and no attachment of the handlers.

- [ ] **Step 2: Remove App.jsx ratio state and the useLayoutDrag call**

In `src/App.jsx`, delete:
- the `useLayoutDrag` import (line ~14);
- the five ratio `useState` lines (~238-246: `mainLeft`, `leftTopRatio`, `rightTopRatio`, `spectrogramTopRatio`, `loudnessHistWidthRatio`);
- the entire `useLayoutDrag({ ... })` call and its destructured result (lines ~741-753).

Verify no remaining reference to `mainLeft`/`leftTopRatio`/`rightTopRatio`/`loudnessHistWidthRatio`/`spectrogramTopRatio`/`setMainLeft`/`setLeftTopRatio`/`setRightTopRatio`/`setLoudnessHistWidthRatio`/`setSpectrogramTopRatio`/`beginLayoutDrag`/`onLayoutDragMove`/`onLayoutDragUp` exists in App.jsx after deletion.

- [ ] **Step 3: Delete the dead files**

```bash
git rm src/components/PanelSet.jsx src/hooks/useLayoutDrag.js
```

(If a `src/hooks/useLayoutDrag.test.js` or `PanelSet.test.jsx` exists, remove it too — check with `git ls-files src | grep -iE "PanelSet|useLayoutDrag"`.)

- [ ] **Step 4: Fix the stale comment**

In `src/workspace/AudioDataContext.jsx`, update the line-8 comment that references "through PanelSet" to reference the current layout, e.g.:

```js
 * through the split layout. Module components consume via useAudioData().
```

- [ ] **Step 5: Build to verify no dangling references**

Run: `npx vitest run` then `npm run build`
Expected: tests PASS; build succeeds (a dangling identifier would fail the build).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(layout): remove vestigial ratio layout (PanelSet, useLayoutDrag)"
```

---

## Task 9: Retire the `plvs.ui` adapter (`uiStore.js`)

With all consumers migrated (Tasks 2, 3, 5), nothing reads `plvs.ui`.

**Files:**
- Delete: `src/preferences/uiStore.js`, `src/preferences/uiStore.test.js`
- Modify: `src/uiPreferences.js`, `src/preferences/data.js`

- [ ] **Step 1: Confirm no remaining importers**

Run: `npx grep -rn "uiStore\|patchUiState\|readUiState\|subscribeUiState\|layoutPersistKey" src`
Expected: matches only in `src/preferences/uiStore.js`, `src/preferences/uiStore.test.js`, the `src/uiPreferences.js` re-export, and the `layoutPersistKey` definition in `src/preferences/data.js`. No functional consumer.

- [ ] **Step 2: Drop the re-exports**

In `src/uiPreferences.js`, delete the line:

```js
export { patchUiState, readUiState, subscribeUiState } from "./preferences/uiStore.js";
```

Update the module's top comment that points "Persistence — `src/preferences/uiStore.js` (`plvs.ui` blob adapter)" to reference `src/persistence/` instead.

- [ ] **Step 3: Remove the dead `layoutPersistKey`**

In `src/preferences/data.js`, delete `layoutPersistKey: "plvs.ui",` from `UI_PREFERENCES`. Run `npx grep -rn "layoutPersistKey" src` and fix any remaining references (there should be none after Task 3/Step 4 updated the test seeds).

- [ ] **Step 4: Delete the adapter and its test**

```bash
git rm src/preferences/uiStore.js src/preferences/uiStore.test.js
```

- [ ] **Step 5: Run the full suite + build**

Run: `npx vitest run` then `npm run build`
Expected: PASS and successful build.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(persistence): retire the plvs.ui adapter"
```

---

## Task 10: Wire one-shot legacy-key cleanup on boot

**Files:**
- Modify: `src/App.jsx` (or the app entry that mounts once)

- [ ] **Step 1: Call `cleanupLegacyKeys` once on mount**

In `src/App.jsx`, add the import:

```js
import { cleanupLegacyKeys } from "./persistence/cleanupLegacyKeys.js";
```

Add a mount-once effect near the other top-level effects:

```js
  useEffect(() => {
    cleanupLegacyKeys();
  }, []);
```

This runs after the domain stores have already read their values (the stores read lazily on first `read()`, which happens during component init before this effect), so removing the old keys cannot strip live data.

- [ ] **Step 2: Add a boot-cleanup regression test**

Create `src/persistence/cleanupLegacyKeys.boot.test.js`:

```js
import { afterEach, describe, expect, it } from "vitest";
import { cleanupLegacyKeys, LEGACY_LOCALSTORAGE_KEYS } from "./cleanupLegacyKeys.js";

describe("legacy cleanup does not touch new domains", () => {
  afterEach(() => localStorage.clear());

  it("removes only legacy keys, preserving plvs:settings/plvs:workspace", () => {
    for (const k of LEGACY_LOCALSTORAGE_KEYS) localStorage.setItem(k, "x");
    localStorage.setItem("plvs:settings", JSON.stringify({ referenceLufs: -23 }));
    localStorage.setItem("plvs:workspace", JSON.stringify({ activePresetId: "lls" }));
    cleanupLegacyKeys();
    expect(JSON.parse(localStorage.getItem("plvs:settings"))).toEqual({ referenceLufs: -23 });
    expect(JSON.parse(localStorage.getItem("plvs:workspace"))).toEqual({ activePresetId: "lls" });
    for (const k of LEGACY_LOCALSTORAGE_KEYS) expect(localStorage.getItem(k)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/persistence/cleanupLegacyKeys.boot.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/persistence/cleanupLegacyKeys.boot.test.js
git commit -m "feat(persistence): clean up legacy storage keys on boot"
```

---

## Task 11: Full verification

**Files:** none.

- [ ] **Step 1: Full JS suite**

Run: `npx vitest run`
Expected: PASS (all suites, including the migrated ones).

- [ ] **Step 2: Lint + format + build**

Run: `npm run lint && npx prettier --check "src/**/*.{js,jsx}" && npm run build`
Expected: clean lint, formatted, successful build.

- [ ] **Step 3: Manual smoke (dev)**

Run: `npm run dev`, open the app, and verify: theme + reference LUFS + layout persist across reload; toggling modules, resizing splitters, switching presets, and saving a preset all persist; window-pin toggle persists; a fullscreened panel does NOT survive a reload. Confirm `localStorage` contains only `plvs:settings` and `plvs:workspace` (DevTools → Application → Local Storage), and the old keys are gone.

- [ ] **Step 4: Commit any formatting fixups**

```bash
git add -A
git commit -m "chore(persistence): formatting after migration" --allow-empty
```

---

## Self-review notes (Plan 2)

- **Spec coverage:** consumer migration to `settings`/`workspace` (Tasks 1-4) ✓; `panelControls` single home (Task 5) ✓; `focusId` removed from the model (Task 6) ✓; `fullscreenId` runtime-only (Tasks 4+7) ✓; vestigial drag-ratio code removed (Task 8) ✓; `plvs.ui` retired (Task 9) ✓; legacy-key cleanup wired (Task 10) ✓. Plugin-store backend, Rust injection, and window geometry remain in **Plan 3**.
- **Coupling flagged:** Tasks 4 and 6 share `DEFAULT_WORKSPACE_STATE`'s shape — execute together/adjacently.
- **Type consistency:** `settingsStore`/`workspaceStore`/`cleanupLegacyKeys` names match Plan 1's exports; the reducer action used in Task 5 is `setPanelControls` (bound), aliased to `setWorkspacePanelControls` in App.jsx.
- **Risk note:** Task 5 (App.jsx panelControls untangle) is the highest-risk change; its Step 5 reasoning check and the dev smoke (Task 11/Step 3) are the guards. If the IPC sync for vectorscope/spectrum regresses, verify `vectorscopePairUi`/`spectrumChannelUi` still derive from `normalizedPanelControls`.
