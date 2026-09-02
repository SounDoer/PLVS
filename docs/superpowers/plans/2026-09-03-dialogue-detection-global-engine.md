# Dialogue Detection Global Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dialogue VAD engine from a per-Stats-panel control to a single global setting, and make changing it restart the measurement.

**Architecture:** The engine value moves from `panelControls` (workspace + presets) to `settingsStore`, surfaced as one `Dialogue Detection` row in the system settings panel. Enablement stays implicit — showing a dialogue row in any Stats panel is still what turns the detector on — so `deriveDialogueRuntime` loses its engine half and returns gating only. A boot-time one-shot migration lifts the currently-effective value into settings before the panel-control key is normalized away. Changing the engine while gating is active fires the existing `clearAll`.

**Tech Stack:** React 19, Vitest + Testing Library (jsdom), Tauri 2 / Rust backend (untouched by this change).

**Spec:** `docs/superpowers/specs/2026-09-03-dialogue-detection-global-engine-design.md`

---

## File Structure

**Created:**
- `src/hooks/useDialogueVadEngineSetting.js` — owns the settings-backed engine value, mirroring `useHistoryRetentionSetting.js`.
- `src/hooks/useDialogueVadEngineSetting.test.jsx` — its tests.
- `src/persistence/migrateDialogueVadEngine.js` — the one-shot boot migration.
- `src/persistence/migrateDialogueVadEngine.test.js` — its tests.

**Modified:**
- `src/settings/defaults.js` — re-export the engine default and normalizer so settings consumers have one import site, matching how `historyRetentionSec` is handled.
- `src/lib/panelControls.js` — delete the `dialogueVadEngine` row and its now-unused imports.
- `src/runtime/appRuntimeDerivations.js` — `deriveDialogueRuntime` returns `{ dialogueGating }` only.
- `src/hooks/useSettings.js` — spread in the new hook.
- `src/components/SettingsPanel.jsx` — add the `Dialogue Detection` row.
- `src/components/AppSettingsOverlays.jsx` — pass the new props through.
- `src/components/PanelSettingsContent.jsx` — remove the Stats VAD row, `SettingsVadSelect`, `vadOpen`, and dead imports.
- `src/lib/statsCatalog.js` — point the four dialogue rows at the global setting via their tooltips.
- `src/App.jsx` — read the engine from settings, wire the clear-on-change effect.
- `src/main.jsx` — call the migration before `createRoot`, main surface only.

**Test files updated:** `src/lib/panelControls.test.js`, `src/runtime/appRuntimeDerivations.test.js`, `src/components/PanelSettingsContent.test.jsx`, `src/components/SettingsPanel.test.jsx`.

## Decision made during planning

The Stats panel's `SettingsVadSelect` renders an external-link button per engine (`Open TEN VAD official link`). The system settings panel uses Radix `Select` everywhere, which cannot host a per-option button cleanly. **The link survives as a single external-link button on the `Dialogue Detection` row, pointing at the currently selected engine** — the feature is kept, the widget is not ported.

---

### Task 1: Drop the panel control

Removing the row from the `CONTROLS` table is what makes `normalizePanelControls` stop emitting the key — for workspace state and for every stored preset alike.

**Files:**
- Modify: `src/lib/panelControls.js:2`, `src/lib/panelControls.js:550-554`
- Test: `src/lib/panelControls.test.js:137`, `:161-168`, `:269`

- [ ] **Step 1: Update the tests to expect the key to be gone**

In `src/lib/panelControls.test.js`, delete the line `dialogueVadEngine: "firered",` at line 137 and the identical line at line 269 (both are inside expected-object literals compared with `toEqual`).

Replace the whole `normalizes the dialogue VAD engine` test (lines 160-169) with:

```js
  it("drops the dialogue VAD engine, which is now a global setting", () => {
    expect(normalizePanelControls({}).dialogueVadEngine).toBeUndefined();
    expect(normalizePanelControls({ dialogueVadEngine: "silero" }).dialogueVadEngine).toBeUndefined();
    expect(DEFAULT_PANEL_CONTROLS.dialogueVadEngine).toBeUndefined();
  });
```

Confirm `DEFAULT_PANEL_CONTROLS` is already imported at the top of the file; if not, add it to the existing import from `./panelControls.js`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/panelControls.test.js
```

Expected: FAIL — the new test reports `"firered"` where `undefined` was expected.

- [ ] **Step 3: Delete the control row**

In `src/lib/panelControls.js`, delete this entire object from the `CONTROLS` array (around line 550):

```js
  {
    key: "dialogueVadEngine",
    default: DEFAULT_DIALOGUE_VAD_ENGINE,
    normalize: (row, raw) => normalizeDialogueVadEngine(readStored(raw, row)),
  },
```

Then delete the now-unused import on line 2:

```js
import { DEFAULT_DIALOGUE_VAD_ENGINE, normalizeDialogueVadEngine } from "./dialogueVadEngines.js";
```

Leave `src/lib/dialogueVadEngines.js` itself untouched — Task 2 moves its consumers, not the module.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/panelControls.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "refactor(panel-controls): drop dialogueVadEngine from panel controls" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Expose the engine through settings defaults

`src/settings/defaults.js` is the single import site settings consumers use (see `normalizeHistoryRetentionSec`). Re-export the two existing helpers there rather than duplicating them.

**Files:**
- Modify: `src/settings/defaults.js`

- [ ] **Step 1: Add the re-exports**

At the top of `src/settings/defaults.js`, next to the existing imports, add:

```js
import {
  DEFAULT_DIALOGUE_VAD_ENGINE as DIALOGUE_VAD_ENGINE_FALLBACK,
  normalizeDialogueVadEngine as normalizeDialogueVadEngineValue,
} from "../lib/dialogueVadEngines.js";
```

Then, next to `DEFAULT_HISTORY_RETENTION_SEC`, add:

```js
export const DEFAULT_DIALOGUE_VAD_ENGINE = DIALOGUE_VAD_ENGINE_FALLBACK;
```

And next to `normalizeHistoryRetentionSec`, add:

```js
export function normalizeDialogueVadEngine(raw) {
  return normalizeDialogueVadEngineValue(raw);
}
```

- [ ] **Step 2: Verify nothing broke**

```bash
npx vitest run src/settings
```

Expected: PASS (or "no test files found" if `src/settings` has none — either is fine; the real check is the next task's tests importing these names).

- [ ] **Step 3: Commit**

```bash
git add src/settings/defaults.js
git commit -m "refactor(settings): expose the dialogue VAD engine default and normalizer" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The settings hook

**Files:**
- Create: `src/hooks/useDialogueVadEngineSetting.js`
- Create: `src/hooks/useDialogueVadEngineSetting.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useDialogueVadEngineSetting.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDialogueVadEngineSetting } from "./useDialogueVadEngineSetting.js";
import { settingsStore } from "../persistence/index.js";

beforeEach(() => {
  settingsStore.reset();
});

describe("useDialogueVadEngineSetting", () => {
  it("falls back to the default engine when nothing is stored", () => {
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    expect(result.current.dialogueVadEngine).toBe("firered");
  });

  it("reads a stored engine", () => {
    settingsStore.patch({ dialogueVadEngine: "ten" });
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    expect(result.current.dialogueVadEngine).toBe("ten");
  });

  it("repairs an unknown stored engine", () => {
    settingsStore.patch({ dialogueVadEngine: "nonsense" });
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    expect(result.current.dialogueVadEngine).toBe("firered");
  });

  it("persists a new engine and updates state", () => {
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    act(() => {
      result.current.setDialogueVadEngine("silero");
    });
    expect(result.current.dialogueVadEngine).toBe("silero");
    expect(settingsStore.read().dialogueVadEngine).toBe("silero");
  });

  it("ignores an unknown engine on write", () => {
    const { result } = renderHook(() => useDialogueVadEngineSetting());
    act(() => {
      result.current.setDialogueVadEngine("nonsense");
    });
    expect(result.current.dialogueVadEngine).toBe("firered");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/hooks/useDialogueVadEngineSetting.test.jsx
```

Expected: FAIL — cannot resolve `./useDialogueVadEngineSetting.js`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useDialogueVadEngineSetting.js`:

```js
import { useState } from "react";
import { settingsStore } from "../persistence/index.js";
import { normalizeDialogueVadEngine } from "../settings/defaults.js";

/**
 * The dialogue detector, global to the app. It lives in settings rather than in panel controls
 * because the audio engine has exactly one detector: a per-panel value could only ever be
 * resolved by discarding all but one of them.
 */
export function useDialogueVadEngineSetting() {
  const [dialogueVadEngine, setDialogueVadEngineState] = useState(() =>
    normalizeDialogueVadEngine(settingsStore.read().dialogueVadEngine)
  );

  function setDialogueVadEngine(value) {
    const next = normalizeDialogueVadEngine(value);
    settingsStore.patch({ dialogueVadEngine: next });
    setDialogueVadEngineState(next);
  }

  return { dialogueVadEngine, setDialogueVadEngine };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/hooks/useDialogueVadEngineSetting.test.jsx
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDialogueVadEngineSetting.js src/hooks/useDialogueVadEngineSetting.test.jsx
git commit -m "feat(settings): add the global dialogue VAD engine setting hook" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The boot migration

Must run before workspace state is written back, so it lives in `main.jsx` ahead of `createRoot` rather than in a React effect.

**Files:**
- Create: `src/persistence/migrateDialogueVadEngine.js`
- Create: `src/persistence/migrateDialogueVadEngine.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/persistence/migrateDialogueVadEngine.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { migrateDialogueVadEngine } from "./migrateDialogueVadEngine.js";
import { settingsStore, workspaceStore } from "./index.js";

function workspaceWith(panels) {
  return {
    tree: { type: "leaf", panelId: panels[0]?.id ?? "p1" },
    panelOrder: panels.map((panel) => panel.id),
    panelsById: Object.fromEntries(
      panels.map((panel) => [panel.id, { id: panel.id, moduleId: panel.moduleId }])
    ),
    panelControlsById: Object.fromEntries(
      panels
        .filter((panel) => panel.engine !== undefined)
        .map((panel) => [panel.id, { dialogueVadEngine: panel.engine }])
    ),
  };
}

beforeEach(() => {
  settingsStore.reset();
  workspaceStore.reset();
});

describe("migrateDialogueVadEngine", () => {
  it("lifts the first Stats panel's engine into settings", () => {
    workspaceStore.patch(
      workspaceWith([{ id: "p1", moduleId: "stats", engine: "ten" }])
    );
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("ten");
  });

  it("takes the first Stats panel in panelOrder when they disagree", () => {
    workspaceStore.patch(
      workspaceWith([
        { id: "p1", moduleId: "spectrum" },
        { id: "p2", moduleId: "stats", engine: "silero" },
        { id: "p3", moduleId: "stats", engine: "ten" },
      ])
    );
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("silero");
  });

  it("writes nothing when there is no Stats panel", () => {
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "spectrum" }]));
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBeUndefined();
  });

  it("writes nothing when the Stats panel carries no engine", () => {
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "stats" }]));
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBeUndefined();
  });

  it("leaves an existing settings value alone", () => {
    settingsStore.patch({ dialogueVadEngine: "silero" });
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "stats", engine: "ten" }]));
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("silero");
  });

  it("repairs an unknown stored engine to the default", () => {
    workspaceStore.patch(
      workspaceWith([{ id: "p1", moduleId: "stats", engine: "nonsense" }])
    );
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("firered");
  });

  it("is a no-op on a second run", () => {
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "stats", engine: "ten" }]));
    migrateDialogueVadEngine();
    settingsStore.patch({ dialogueVadEngine: "silero" });
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("silero");
  });

  it("survives a workspace with no panelOrder", () => {
    workspaceStore.patch({ tree: null });
    expect(() => migrateDialogueVadEngine()).not.toThrow();
    expect(settingsStore.read().dialogueVadEngine).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/persistence/migrateDialogueVadEngine.test.js
```

Expected: FAIL — cannot resolve `./migrateDialogueVadEngine.js`.

- [ ] **Step 3: Write the migration**

Create `src/persistence/migrateDialogueVadEngine.js`:

```js
// src/persistence/migrateDialogueVadEngine.js
/**
 * One-shot, idempotent lift of the dialogue VAD engine from panel controls into settings.
 *
 * The engine used to be a Stats panel control. `normalizePanelControls` rebuilds its output from
 * the control table, so deleting that row drops the key from workspace state and from every stored
 * preset on the next normalize -- which also means the value is gone for good. This runs first and
 * saves the one value that was actually in effect.
 *
 * "First Stats panel in `panelOrder` wins" is deliberately the rule `deriveDialogueRuntime` used
 * when it resolved the same conflict, so nobody's effective engine changes across the upgrade.
 * Presets are not migrated: there is one global engine now, and five conflicting old values have
 * nowhere to go.
 */
import { settingsStore, workspaceStore } from "./index.js";
import { normalizeDialogueVadEngine } from "../settings/defaults.js";

export function migrateDialogueVadEngine() {
  const settings = settingsStore.read();
  if (settings.dialogueVadEngine !== undefined) return;

  const workspace = workspaceStore.read();
  const panelOrder = Array.isArray(workspace.panelOrder) ? workspace.panelOrder : [];
  const panelsById = workspace.panelsById ?? {};
  const controlsById = workspace.panelControlsById ?? {};

  for (const panelId of panelOrder) {
    if (panelsById[panelId]?.moduleId !== "stats") continue;
    const stored = controlsById[panelId]?.dialogueVadEngine;
    if (stored === undefined) continue;
    settingsStore.patch({ dialogueVadEngine: normalizeDialogueVadEngine(stored) });
    return;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/persistence/migrateDialogueVadEngine.test.js
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/migrateDialogueVadEngine.js src/persistence/migrateDialogueVadEngine.test.js
git commit -m "feat(persistence): migrate the dialogue VAD engine into settings" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Run the migration at boot

**Files:**
- Modify: `src/main.jsx`

- [ ] **Step 1: Add the call**

In `src/main.jsx`, add to the imports:

```js
import { migrateDialogueVadEngine } from "./persistence/migrateDialogueVadEngine.js";
```

Then, immediately after the existing `const surface = applyDocumentSurface(window.location.search);` line, add:

```js
// Main surface only: the dock accessories are separate webviews over the same storage and have no
// Stats panels to read from. Must run before `createRoot`, since the first workspace write-back
// normalizes the old panel-control key away.
if (surface !== "dock-header" && surface !== "dock-editor") {
  migrateDialogueVadEngine();
}
```

- [ ] **Step 2: Verify the app still builds**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/main.jsx
git commit -m "feat(boot): run the dialogue VAD engine migration before render" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Narrow `deriveDialogueRuntime` to gating

**Files:**
- Modify: `src/runtime/appRuntimeDerivations.js:8`, `:75-94`
- Test: `src/runtime/appRuntimeDerivations.test.js:160-200`

- [ ] **Step 1: Update the tests**

In `src/runtime/appRuntimeDerivations.test.js`, change the two expectations:

Line 186: `).toEqual({ dialogueGating: true, dialogueVadEngine: "silero" });`
becomes:
```js
    ).toEqual({ dialogueGating: true });
```

Line 199: `).toEqual({ dialogueGating: false, dialogueVadEngine: "firered" });`
becomes:
```js
    ).toEqual({ dialogueGating: false });
```

Leave the `dialogueVadEngine: "silero"` / `"ten"` values in the *input* fixtures at lines 176 and 181 — they now assert that a stale key in stored controls is ignored.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/runtime/appRuntimeDerivations.test.js
```

Expected: FAIL — received object still carries `dialogueVadEngine`.

- [ ] **Step 3: Narrow the function**

In `src/runtime/appRuntimeDerivations.js`, replace the whole `deriveDialogueRuntime` function with:

```js
/// Whether any Stats panel is showing a dialogue row. Showing one is what turns the detector on;
/// which detector runs is a global setting, not a panel control.
export function deriveDialogueRuntime(workspaceState) {
  for (const panelId of workspaceState.panelOrder) {
    const panel = workspaceState.panelsById[panelId];
    if (panel?.moduleId !== "stats") continue;
    const controls = getPanelControls(workspaceState, panelId);
    if (controls.statsVisibleIds.some((id) => DIALOGUE_STAT_IDS.includes(id))) {
      return { dialogueGating: true };
    }
  }

  return { dialogueGating: false };
}
```

Then delete the now-unused import on line 8:

```js
import { DEFAULT_DIALOGUE_VAD_ENGINE } from "../lib/dialogueVadEngines.js";
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/runtime/appRuntimeDerivations.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/appRuntimeDerivations.js src/runtime/appRuntimeDerivations.test.js
git commit -m "refactor(runtime): deriveDialogueRuntime returns gating only" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Remove the Stats panel VAD row

**Files:**
- Modify: `src/components/PanelSettingsContent.jsx:32`, `:707-770`, `:1424-1483`
- Test: `src/components/PanelSettingsContent.test.jsx:1160-1193`

- [ ] **Step 1: Replace the test**

In `src/components/PanelSettingsContent.test.jsx`, replace the whole test starting at line 1160 (`it("renders the Stats VAD selector with official links and updates the selected engine", ...)`, through its closing `});` at line 1193) with:

```jsx
  it("offers no VAD selector, since the detector is a global setting", () => {
    render(
      <PanelSettingsContent
        activeTab="stats"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    expect(screen.queryByText("VAD")).toBeNull();
    expect(screen.queryByRole("button", { name: "dialogue vad" })).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/components/PanelSettingsContent.test.jsx
```

Expected: FAIL — `queryByText("VAD")` finds the row.

- [ ] **Step 3: Remove the row and its widget**

In `src/components/PanelSettingsContent.jsx`:

a. In the `stats` branch, delete the entire `<SettingsRow label="VAD">…</SettingsRow>` block (the row wrapping `<SettingsVadSelect ... />`, around lines 1464-1481).

b. Delete the `selectedVad` const declared just above the `return` in that branch:

```js
    const selectedVad =
      DIALOGUE_VAD_ENGINE_OPTIONS.find(
        (option) => option.id === normalizedPanelControls.dialogueVadEngine
      ) ?? DIALOGUE_VAD_ENGINE_OPTIONS[0];
```

c. Delete the whole `function SettingsVadSelect({ ... }) { ... }` declaration (starts at line 707).

d. Delete the import on line 32:

```js
import { DIALOGUE_VAD_ENGINE_OPTIONS } from "@/lib/dialogueVadEngines.js";
```

e. Remove the `vadOpen` / `setVadOpen` state declaration. Find it with:

```bash
grep -n "vadOpen" src/components/PanelSettingsContent.jsx
```

Delete every line the grep reports.

f. Run the linter to catch anything left dangling (`openExternalUrl`, `InlineDetailTrigger`, `Check`, `SETTINGS_DETAIL_SURFACE_CLASS` may or may not still have other users — the linter, not guesswork, decides):

```bash
npm run lint
```

Delete only the imports the linter names as unused.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/components/PanelSettingsContent.test.jsx && npm run lint
```

Expected: tests PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/PanelSettingsContent.jsx src/components/PanelSettingsContent.test.jsx
git commit -m "refactor(panel-settings): remove the Stats VAD selector" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The global settings row

**Files:**
- Modify: `src/components/SettingsPanel.jsx:165-166` (props), `:432-450` (the History Length section)
- Test: `src/components/SettingsPanel.test.jsx:504-526`

- [ ] **Step 1: Write the failing tests**

In `src/components/SettingsPanel.test.jsx`, add after the existing History Length tests (after line 526):

```jsx
  const DIALOGUE_PROPS = {
    dialogueVadEngine: "firered",
    setDialogueVadEngine: vi.fn(),
  };

  it("renders Dialogue Detection with the three engines", () => {
    render(<SettingsPanel {...BASE_PROPS} {...DIALOGUE_PROPS} />);
    fireEvent.click(screen.getByLabelText("Dialogue Detection"));
    expect(screen.getByText("Silero VAD")).toBeTruthy();
    expect(screen.getByText("FireRedVAD")).toBeTruthy();
    expect(screen.getByText("TEN VAD")).toBeTruthy();
  });

  it("calls setDialogueVadEngine when a new engine is chosen", () => {
    const setDialogueVadEngine = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        {...DIALOGUE_PROPS}
        setDialogueVadEngine={setDialogueVadEngine}
      />
    );
    fireEvent.click(screen.getByLabelText("Dialogue Detection"));
    fireEvent.click(screen.getByText("TEN VAD"));
    expect(setDialogueVadEngine).toHaveBeenCalledWith("ten");
  });

  it("opens the official link for the selected engine", () => {
    const openExternalUrl = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        {...DIALOGUE_PROPS}
        dialogueVadEngine="ten"
        openExternalUrl={openExternalUrl}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Open TEN VAD official link" }));
    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/TEN-framework/ten-vad");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/components/SettingsPanel.test.jsx
```

Expected: FAIL — `getByLabelText("Dialogue Detection")` finds nothing.

- [ ] **Step 3: Add the row**

In `src/components/SettingsPanel.jsx`, add to the imports:

```js
import {
  DIALOGUE_VAD_ENGINE_OPTIONS,
  DEFAULT_DIALOGUE_VAD_ENGINE,
} from "@/lib/dialogueVadEngines.js";
```

`ExternalLink` is already imported from `lucide-react` on line 3, and `Select` / `SelectTrigger` / `SelectValue` / `SelectContent` / `SelectItem` plus `SELECT_TRIGGER_CLASS` / `SELECT_CONTENT_CLASS` are already in scope — do not re-import any of them.

Add to the destructured props, next to `setHistoryRetentionSec = () => {},`:

```js
  dialogueVadEngine = DEFAULT_DIALOGUE_VAD_ENGINE,
  setDialogueVadEngine = () => {},
```

Inside the History Length `<SettingsSection>` (the one at line 433), after the closing `</SettingsRow>` of the History Length row and before `</SettingsSection>`, add:

```jsx
                  <SettingsRow
                    labelNode={
                      <SettingsLabelWithTip
                        label="Dialogue Detection"
                        tip="The detector behind the Stats dialogue metrics. Showing one of those metrics is what switches it on; changing the detector restarts the measurement."
                      />
                    }
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      <Select value={dialogueVadEngine} onValueChange={setDialogueVadEngine}>
                        <SelectTrigger
                          aria-label="Dialogue Detection"
                          className={SELECT_TRIGGER_CLASS}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                          {DIALOGUE_VAD_ENGINE_OPTIONS.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {(() => {
                        const selected =
                          DIALOGUE_VAD_ENGINE_OPTIONS.find(
                            (option) => option.id === dialogueVadEngine
                          ) ?? DIALOGUE_VAD_ENGINE_OPTIONS[0];
                        return (
                          <button
                            type="button"
                            aria-label={`Open ${selected.label} official link`}
                            className="rounded-xs p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground"
                            onClick={() => void openExternalUrl(selected.url)}
                          >
                            <ExternalLink aria-hidden="true" className="size-3" />
                          </button>
                        );
                      })()}
                    </div>
                  </SettingsRow>
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/components/SettingsPanel.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(settings): add the Dialogue Detection row" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Wire the hook through to the panel

**Files:**
- Modify: `src/hooks/useSettings.js:19-40`
- Modify: `src/components/AppSettingsOverlays.jsx:83`

- [ ] **Step 1: Add the hook to `useSettings`**

In `src/hooks/useSettings.js`, add the import:

```js
import { useDialogueVadEngineSetting } from "./useDialogueVadEngineSetting.js";
```

Add the call next to `const historyRetentionSetting = useHistoryRetentionSetting();`:

```js
  const dialogueVadEngineSetting = useDialogueVadEngineSetting();
```

And spread it in the returned object next to `...historyRetentionSetting,`:

```js
    ...dialogueVadEngineSetting,
```

- [ ] **Step 2: Pass the props down**

In `src/components/AppSettingsOverlays.jsx`, next to the existing `historyRetentionSec={settings.historyRetentionSec}` line (83), add:

```jsx
        dialogueVadEngine={settings.dialogueVadEngine}
        setDialogueVadEngine={settings.setDialogueVadEngine}
```

Check whether `setHistoryRetentionSec` is passed on a neighbouring line; if it is passed via a spread rather than explicitly, match that style instead.

```bash
grep -n "setHistoryRetentionSec\|historyRetentionSec" src/components/AppSettingsOverlays.jsx
```

- [ ] **Step 3: Verify the wiring**

```bash
npx vitest run src/components/AppSettingsOverlays.test.jsx src/hooks/useSettings.rtl.test.jsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSettings.js src/components/AppSettingsOverlays.jsx
git commit -m "feat(settings): wire the dialogue engine setting to the settings panel" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Feed the engine from settings, and clear on change

`clearAll` is defined at `src/App.jsx:991`, so the change-detecting effect must sit below it. It follows the same shape as the existing `previousHistoryRetentionSecRef` effect at `src/App.jsx:632`, which is how this file already handles "react to a settings value changing, but not on mount".

**Files:**
- Modify: `src/App.jsx:765-777`, and a new effect after `src/App.jsx:1026`

- [ ] **Step 1: Read the engine from settings**

In `src/App.jsx`, replace lines 765-768:

```js
  const { dialogueGating, dialogueVadEngine } = useMemo(
    () => deriveDialogueRuntime(workspaceState),
    [workspaceState]
  );
```

with:

```js
  const { dialogueGating } = useMemo(
    () => deriveDialogueRuntime(workspaceState),
    [workspaceState]
  );
  const dialogueVadEngine = settings.dialogueVadEngine;
```

Everything downstream — `useRuntimeBackendSync` at line 771 and `currentFileAnalysisSettings` at line 788 — keeps reading the same two names and needs no change.

- [ ] **Step 2: Add the clear-on-change effect**

In `src/App.jsx`, immediately after `onClearRef.current = clearAll;` (line 1026), add:

```js
  // Changing the detector restarts the measurement. The dialogue accumulator resets on an engine
  // switch while `integrated` does not (src-tauri/src/dsp/loudness.rs), so without this the two
  // would be measuring different time windows and Dialogue Offset would subtract one from the
  // other and still render a number. Gated on gating: with no dialogue row on screen the switch
  // changes nothing observable, and destroying a running measurement would buy nothing.
  const previousDialogueVadEngineRef = useRef(dialogueVadEngine);
  useEffect(() => {
    if (previousDialogueVadEngineRef.current === dialogueVadEngine) return;
    previousDialogueVadEngineRef.current = dialogueVadEngine;
    if (!dialogueGating) return;
    clearAll();
  }, [dialogueVadEngine, dialogueGating, clearAll]);
```

- [ ] **Step 3: Verify the app builds and the smoke test passes**

```bash
npx vitest run src/App.smoke.test.jsx && npm run build
```

Expected: PASS, then a successful build.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): take the dialogue engine from settings and clear on change" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Point the Stats metric tooltips at the setting

The control now sits two surfaces away from the metrics it governs. The four dialogue entries carry the pointer.

**Files:**
- Modify: `src/lib/statsCatalog.js:54-80`

- [ ] **Step 1: Extend the four `hint` strings**

The catalog entries carry a `hint` field. Replace the four dialogue entries (lines 54-79) with:

```js
  dialogueCoverage: {
    label: "Dialogue Coverage",
    shortLabel: "Dlg Cov",
    unit: "%",
    hint: "Share of time dialogue is detected. Detector set by Dialogue Detection in Settings",
  },
  dialogueIntegrated: {
    label: "Dialogue Integrated",
    shortLabel: "Dlg I",
    unit: "LUFS",
    hint: "Loudness over dialogue only. Detector set by Dialogue Detection in Settings",
  },
  dialogueRange: {
    label: "Dialogue Range",
    shortLabel: "Dlg LRA",
    unit: "LU",
    hint: "Loudness range over dialogue only. Detector set by Dialogue Detection in Settings",
  },
  dialogueOffset: {
    label: "Dialogue Offset",
    shortLabel: "Dlg Offset",
    unit: "LU",
    hint: "Dialogue loudness relative to the overall mix. Detector set by Dialogue Detection in Settings",
  },
```

(No trailing period — the neighbouring entries have none.)

- [ ] **Step 2: Verify**

```bash
npx vitest run src/lib/statsCatalog.test.js
```

Expected: PASS. If a test asserts one of these exact `hint` strings, update that assertion to the new text.

- [ ] **Step 3: Commit**

```bash
git add src/lib/statsCatalog.js
git commit -m "docs(stats): point the dialogue metric tooltips at the global setting" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Full gate and manual verification

- [ ] **Step 1: Run the merge gate**

```bash
npm run check
```

Expected: PASS. If a Vitest failure names `scripts/tauriSecurityConfig.test.js` or `scripts/tauriDependencyContract.test.js`, it is unrelated to this change — those read Tauri config; re-check whether the working tree is clean of unrelated edits.

- [ ] **Step 2: Manual check in the real app**

```bash
npm run desktop
```

Verify, in order:
1. Settings shows `Dialogue Detection` under History Length with the current engine.
2. With no Stats panel showing a dialogue row: change the engine — Integrated keeps accumulating, nothing resets.
3. Add a Stats panel, enable `Dialogue Coverage`. Let it run for a minute; Integrated and Dialogue Coverage both show values.
4. Change the engine — the measurement restarts (Integrated returns to accumulating from now, Max values clear).
5. The Stats panel settings no longer offer a VAD row.

- [ ] **Step 3: Commit any fixes**

If steps above surface a fix, commit it with a message describing the fix, ending with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Notes for the implementer

- **Rust is untouched.** No `smoke:capture` or `soak:capture` run is needed for this change.
- **`src/lib/dialogueVadEngines.js` stays where it is.** Only its consumers move.
- **Do not add an Off option.** Enablement stays implicit — showing a dialogue row is what turns the detector on. An Off entry would be a second switch contradicting the first, and would leave dialogue rows reading `--` with no explanation. See the spec's Decisions section.
- **Do not run multiple engines concurrently.** The dialogue metrics are single-valued from `LoudnessBlock` through the frame payload to the four columns in `src/lib/AudioSnapHistorySlab.js`. That is out of scope by decision, not oversight.
