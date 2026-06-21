# Panel-level Reset & Inline Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add granular per-panel/per-section `Reset` affordances and bring the existing destructive deletes under one unified inline confirmation pattern, covering seven panel-layer actions (4 resets, 3 deletes).

**Architecture:** A single self-contained `InlineConfirm` component encapsulates the two-step "arm → confirm" interaction, reusing the existing ✓/✗ rename idiom. Each of the seven call sites renders its own idle trigger through `InlineConfirm`. A new `RESET_WORKSPACE` reducer action restores the default workspace and clears the active preset. The Stats reset is upgraded to reset both visibility and order. `CloseConfirmDialog` and `resetAll()` are untouched.

**Tech Stack:** React 19, Vite, Vitest + @testing-library/react (jsdom), lucide-react icons, Tailwind, shadcn/ui.

Spec: `docs/superpowers/specs/2026-06-21-panel-reset-and-confirmations-design.md`

**Cross-cutting note — accessible names:** All four reset triggers show the visible text `Reset`. To keep them distinguishable for screen readers and tests, each idle trigger carries a distinct `aria-label` (`Reset clear shortcut`, `Reset channel labels`, `Reset stats`, `Reset layout`). Visible text stays `Reset`; the accessible name comes from the `aria-label`.

---

### Task 1: `InlineConfirm` primitive

**Files:**
- Create: `src/components/InlineConfirm.jsx`
- Test: `src/components/InlineConfirm.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/InlineConfirm.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InlineConfirm } from "./InlineConfirm.jsx";

function setup(onConfirm = vi.fn()) {
  render(
    <InlineConfirm
      onConfirm={onConfirm}
      confirmLabel="Confirm action"
      cancelLabel="Cancel action"
      trigger={(arm) => (
        <button type="button" onClick={arm}>
          Reset
        </button>
      )}
    />
  );
  return { onConfirm };
}

describe("InlineConfirm", () => {
  it("shows only the trigger when idle", () => {
    setup();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(screen.queryByLabelText("Confirm action")).toBeNull();
  });

  it("arms on trigger click without calling onConfirm", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Confirm action")).toBeTruthy();
    expect(screen.getByLabelText("Cancel action")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm and returns to idle on confirm", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByLabelText("Confirm action"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("returns to idle on cancel without calling onConfirm", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByLabelText("Cancel action"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("disarms on Escape without calling onConfirm", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/InlineConfirm.test.jsx`
Expected: FAIL — cannot resolve `./InlineConfirm.jsx`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/InlineConfirm.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Two-step inline confirmation for a single destructive control.
 *
 * Idle: renders `trigger(arm)` — the call site's own button, which calls `arm`
 * on activation. Armed: renders a ✓ (confirm) / ✗ (cancel) pair in place,
 * reusing the rename ✓/✗ idiom. Confirm runs `onConfirm` and returns to idle;
 * Escape, the ✗, or unmount cancels with no effect.
 *
 * @param {(arm: () => void) => React.ReactNode} props.trigger
 * @param {() => void} props.onConfirm
 * @param {string} props.confirmLabel  aria-label for the ✓
 * @param {string} props.cancelLabel   aria-label for the ✗
 */
export function InlineConfirm({ trigger, onConfirm, confirmLabel, cancelLabel, className }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const onKey = (e) => {
      if (e.key === "Escape") setArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  if (!armed) return trigger(() => setArmed(true));

  return (
    <span className={cn("flex items-center gap-0.5", className)}>
      <button
        type="button"
        aria-label={confirmLabel}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        className="rounded p-0.5 text-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Check className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={() => setArmed(false)}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/InlineConfirm.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/InlineConfirm.jsx src/components/InlineConfirm.test.jsx
git commit -m "feat(ui): add InlineConfirm two-step confirmation primitive" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `RESET_WORKSPACE` reducer action

**Files:**
- Modify: `src/workspace/reducer.js` (add import, reducer case, bound action)
- Test: `src/workspace/reducer.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `src/workspace/reducer.test.js`:

```js
import { describe, expect, it } from "vitest";
import { workspaceReducer } from "./reducer.js";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";

describe("workspaceReducer RESET_WORKSPACE", () => {
  it("restores tree, panels, order, and panel controls to defaults", () => {
    const mutated = {
      ...DEFAULT_WORKSPACE_STATE,
      panelOrder: ["peak"],
      panelsById: { peak: { id: "peak", moduleId: "peak", customTitle: "My Peak" } },
      tree: { type: "leaf", tabs: ["peak"], activeTab: "peak" },
    };

    const next = workspaceReducer(mutated, { type: "RESET_WORKSPACE" });

    expect(next.tree).toEqual(DEFAULT_WORKSPACE_STATE.tree);
    expect(next.panelsById).toEqual(DEFAULT_WORKSPACE_STATE.panelsById);
    expect(next.panelOrder).toEqual(DEFAULT_WORKSPACE_STATE.panelOrder);
    expect(next.panelControlsById).toEqual(DEFAULT_WORKSPACE_STATE.panelControlsById);
    expect(next.fullscreenId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace/reducer.test.js`
Expected: FAIL — `RESET_WORKSPACE` falls through to `default`, so `next.panelOrder` still equals `["peak"]`.

- [ ] **Step 3: Write minimal implementation**

In `src/workspace/reducer.js`, add the import near the other imports at the top of the file (after the existing `./treeUtils.js` import):

```js
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
```

Add this case inside the `switch (action.type)` in `workspaceReducer`, immediately before the `default:` case:

```js
    case "RESET_WORKSPACE":
      return { ...DEFAULT_WORKSPACE_STATE };
```

Add this bound action inside the object returned by `bindWorkspaceActions`, after the `setPanelControls` entry:

```js
    resetWorkspace: () => dispatch({ type: "RESET_WORKSPACE" }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workspace/reducer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/reducer.js src/workspace/reducer.test.js
git commit -m "feat(workspace): add RESET_WORKSPACE reducer action" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire `resetWorkspace` through context with active-preset clearing

**Files:**
- Modify: `src/workspace/WorkspaceContext.jsx:24-58` (wrap `resetWorkspace` with `clearActivePreset`)
- Test: `src/workspace/WorkspaceContext.test.jsx` (add one case)

- [ ] **Step 1: Write the failing test**

In `src/workspace/WorkspaceContext.test.jsx`, the file already has a `WorkspaceStateProbe`/render helper used by the existing "clears presets.activeId on manual …" cases (see the `setTree`/`addPanel` cases around lines 59–91). Add a new case in the same `describe` block, mirroring the existing ones but calling `resetWorkspace`:

```jsx
  it("clears presets.activeId on resetWorkspace", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    let actions;
    render(
      <WorkspaceProvider>
        <ActionsProbe onActions={(a) => (actions = a)} />
      </WorkspaceProvider>
    );
    act(() => actions.resetWorkspace());
    expect(presetsStore.read().activeId).toBeNull();
  });
```

If the existing tests use a different probe/dispatch mechanism than an `ActionsProbe`, copy whatever pattern the neighbouring `addPanel` case uses (lines 73–77) verbatim and swap the action call to `resetWorkspace()`. The assertion (`activeId` becomes `null`) is the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace/WorkspaceContext.test.jsx`
Expected: FAIL — `actions.resetWorkspace` is `undefined` (not yet wrapped/exposed through context).

- [ ] **Step 3: Write minimal implementation**

In `src/workspace/WorkspaceContext.jsx`, inside the `actions` `useMemo` (the object returned after `const bound = ...; const clearActivePreset = ...;`), add a wrapped `resetWorkspace` alongside the other wrapped actions (e.g. after `setPanelControlsForPanel`):

```jsx
      resetWorkspace: (...args) => {
        clearActivePreset();
        bound.resetWorkspace(...args);
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workspace/WorkspaceContext.test.jsx`
Expected: PASS (all cases, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/workspace/WorkspaceContext.jsx src/workspace/WorkspaceContext.test.jsx
git commit -m "feat(workspace): clear active preset on resetWorkspace" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Modules popover — layout Reset (#4) and delete-panel confirm (#7)

**Files:**
- Modify: `src/workspace/WorkspaceToolbar.jsx` (import `InlineConfirm`; wrap delete in `PanelRow`; add layout Reset in `ModulesPopoverContent`)
- Test: `src/workspace/WorkspaceToolbar.test.jsx` (add cases)

- [ ] **Step 1: Write the failing tests**

Append these cases inside the `describe("ModulesPopoverContent", …)` block in `src/workspace/WorkspaceToolbar.test.jsx`:

```jsx
  it("arms then resets the layout via the Reset control", () => {
    render(
      <WorkspaceProvider>
        <ModulesPopoverContent />
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    expect(screen.getByLabelText("Confirm reset layout")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Confirm reset layout"));
    // Default workspace has seven panels; the first is the Level Meter.
    expect(screen.getByText("Level Meter")).toBeTruthy();
  });

  it("arms delete on the panel trash before removing", () => {
    render(
      <WorkspaceProvider>
        <ModulesPopoverContent />
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByLabelText("Delete Level Meter"));
    // Row still present while armed; a confirm affordance appears.
    expect(screen.getByLabelText("Confirm delete Level Meter")).toBeTruthy();
    expect(screen.getByText("Level Meter")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Confirm delete Level Meter"));
    expect(screen.queryByText("Level Meter")).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/workspace/WorkspaceToolbar.test.jsx`
Expected: FAIL — no `Reset layout` button; `Delete Level Meter` removes immediately (no `Confirm delete Level Meter`).

- [ ] **Step 3: Write the implementation**

In `src/workspace/WorkspaceToolbar.jsx`:

Add the import near the other `@/components/ui/...` imports at the top:

```jsx
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
```

Replace the delete `IconAction` in `PanelRow` (the one with `label={`Delete ${title}`}`) with an `InlineConfirm`-wrapped trigger:

```jsx
        <InlineConfirm
          onConfirm={() => removePanel(panelId)}
          confirmLabel={`Confirm delete ${title}`}
          cancelLabel={`Cancel delete ${title}`}
          trigger={(arm) => (
            <IconAction
              label={`Delete ${title}`}
              icon={<Trash2 className="size-3.5" />}
              className="hover:text-destructive"
              onClick={arm}
            />
          )}
        />
```

Update `ModulesPopoverContent` to pull `resetWorkspace` from the store and render a layout Reset after `AddPanelControl`:

```jsx
export function ModulesPopoverContent() {
  const { state, resetWorkspace } = useWorkspaceStore();
  const panelIds = state.panelOrder.filter((id) => state.panelsById[id]);

  return (
    <>
      <div className="grid w-max min-w-44 max-w-full gap-0.5">
        {panelIds.map((panelId) => (
          <PanelRow key={panelId} panelId={panelId} />
        ))}
        {panelIds.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No panels</p>
        ) : null}
      </div>
      <AddPanelControl />
      <div className="mt-1 flex justify-end">
        <InlineConfirm
          onConfirm={resetWorkspace}
          confirmLabel="Confirm reset layout"
          cancelLabel="Cancel reset layout"
          trigger={(arm) => (
            <button
              type="button"
              aria-label="Reset layout"
              onClick={arm}
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Reset
            </button>
          )}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/workspace/WorkspaceToolbar.test.jsx`
Expected: PASS (existing + 2 new cases).

- [ ] **Step 5: Commit**

```bash
git add src/workspace/WorkspaceToolbar.jsx src/workspace/WorkspaceToolbar.test.jsx
git commit -m "feat(workspace): layout reset and delete-panel confirmation in Modules popover" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Stats reset (#3) — reset visibility + order, behind confirm

**Files:**
- Modify: `src/components/PanelHeaderControls.jsx` (import `DEFAULT_PANEL_CONTROLS` and `InlineConfirm`; rename `onResetOrder` → `onReset`; reset both fields; swap `Reset order` button for `InlineConfirm`)
- Test: `src/components/PanelHeaderControls.test.jsx:255-274` (replace the existing "resets the order" case)

- [ ] **Step 1: Update the test (new failing expectation)**

Replace the existing `it("resets the order to LOUDNESS_STATS_ORDER", …)` case (lines 255–274) with:

```jsx
  it("resets order and visibility to defaults after confirm", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelHeaderControls
        activeTab="loudnessStats"
        panelControls={{
          ...DEFAULT_PANEL_CONTROLS,
          loudnessStatsOrder: ["psr", "momentary", "integrated"],
          loudnessStatsVisibleIds: ["psr"],
        }}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset stats" }));
    expect(onPanelControlsChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Confirm reset stats"));
    expect(onPanelControlsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        loudnessStatsOrder: LOUDNESS_STATS_ORDER,
        loudnessStatsVisibleIds: DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds,
      })
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PanelHeaderControls.test.jsx`
Expected: FAIL — no `Reset stats` button (current label is `Reset order`).

- [ ] **Step 3: Write the implementation**

In `src/components/PanelHeaderControls.jsx`:

Add `DEFAULT_PANEL_CONTROLS` to the existing import from `@/lib/panelControls.js`:

```jsx
import {
  DEFAULT_PANEL_CONTROLS,
  LEVEL_METER_MODE_OPTIONS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  LOUDNESS_STATS_OPTIONS,
  LOUDNESS_STATS_ORDER,
  normalizePanelControls,
} from "@/lib/panelControls.js";
```

Add the `InlineConfirm` import near the other `@/components/...` imports:

```jsx
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
```

In `SortableStatsChip`, change the prop `onResetOrder` to `onReset` in the destructured params, and replace the bottom `Reset order` button with:

```jsx
        <div className="mt-1">
          <InlineConfirm
            onConfirm={onReset}
            confirmLabel="Confirm reset stats"
            cancelLabel="Cancel reset stats"
            trigger={(arm) => (
              <button
                type="button"
                aria-label="Reset stats"
                onClick={arm}
                className="w-full rounded-sm px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
              >
                Reset
              </button>
            )}
          />
        </div>
```

In the `loudnessStats` branch of `PanelHeaderControls`, replace the `onResetOrder={…}` prop passed to `SortableStatsChip` with `onReset` that resets both fields:

```jsx
        onReset={() => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              loudnessStatsOrder: [...LOUDNESS_STATS_ORDER],
              loudnessStatsVisibleIds: [...DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds],
            })
          );
        }}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PanelHeaderControls.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PanelHeaderControls.jsx src/components/PanelHeaderControls.test.jsx
git commit -m "feat(panels): stats Reset clears visibility and order behind confirmation" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Presets — delete confirmation (#5)

**Files:**
- Modify: `src/components/PresetsPopover.jsx` (import `InlineConfirm`; wrap the delete trash button)
- Test: `src/components/PresetsPopover.test.jsx:253-284` (replace the two delete cases)

- [ ] **Step 1: Update the tests (new failing expectations)**

Replace the existing `it("deletes a preset via the Delete icon", …)` (lines 253–266) and `it("does not call apply when the Delete icon is clicked (stopPropagation)", …)` (lines 268–284) with:

```jsx
  it("deletes a preset only after confirming", () => {
    const remove = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{ ...NOOP_PRESETS, list: [{ id: "a", name: "Focus" }], remove }}
      />
    );
    fireEvent.click(screen.getByLabelText("Delete preset Focus"));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm delete preset Focus"));
    expect(remove).toHaveBeenCalledWith("a");
  });

  it("does not apply the preset while arming or confirming delete", () => {
    const apply = vi.fn();
    const remove = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{ ...NOOP_PRESETS, list: [{ id: "a", name: "Focus" }], apply, remove }}
      />
    );
    fireEvent.click(screen.getByLabelText("Delete preset Focus"));
    fireEvent.click(screen.getByLabelText("Confirm delete preset Focus"));
    expect(remove).toHaveBeenCalledWith("a");
    expect(apply).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PresetsPopover.test.jsx`
Expected: FAIL — clicking `Delete preset Focus` calls `remove` immediately; no `Confirm delete preset Focus`.

- [ ] **Step 3: Write the implementation**

In `src/components/PresetsPopover.jsx`, add the import near the top:

```jsx
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
```

Replace the delete `<button … aria-label={`Delete preset ${preset.name}`} …>` (the one wrapping `<Trash2 />`) with:

```jsx
                      <InlineConfirm
                        onConfirm={() => presets.remove(preset.id)}
                        confirmLabel={`Confirm delete preset ${preset.name}`}
                        cancelLabel={`Cancel delete preset ${preset.name}`}
                        trigger={(arm) => (
                          <button
                            type="button"
                            aria-label={`Delete preset ${preset.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              arm();
                            }}
                            className="rounded text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PresetsPopover.test.jsx`
Expected: PASS (all cases — the hover/focus-style cases still find the idle `Delete preset Focus` trigger).

- [ ] **Step 5: Commit**

```bash
git add src/components/PresetsPopover.jsx src/components/PresetsPopover.test.jsx
git commit -m "feat(presets): confirm before deleting a preset" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Settings panel — clear (#1), channel labels (#2), delete theme (#6)

**Files:**
- Modify: `src/components/SettingsPanel.jsx` (import `InlineConfirm`; wrap clear Reset, channel-labels Reset with relabel, delete-theme button)
- Test: `src/components/SettingsPanel.test.jsx` (update channel-labels cases; add clear + delete-theme confirm cases)

- [ ] **Step 1: Update / add tests (new failing expectations)**

In `src/components/SettingsPanel.test.jsx`, replace the two channel-labels cases (lines 314–339) with:

```jsx
  it("disables Reset when there is no channel-label override", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={2}
        channelLabelTokens={["L", "R"]}
        channelLabelHasOverride={false}
      />
    );
    expect(screen.getByRole("button", { name: "Reset channel labels" }).disabled).toBe(true);
  });

  it("resets channel labels only after confirming", () => {
    const resetChannelLabels = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={2}
        channelLabelTokens={["L", "R"]}
        channelLabelHasOverride={true}
        resetChannelLabels={resetChannelLabels}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset channel labels" }));
    expect(resetChannelLabels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm reset channel labels"));
    expect(resetChannelLabels).toHaveBeenCalledTimes(1);
  });
```

Add a clear-shortcut confirm case (place it in whichever `describe` block covers keyboard shortcuts, or a new `describe("SettingsPanel — Clear shortcut", …)`):

```jsx
  it("resets the clear shortcut only after confirming", () => {
    const setClearShortcut = vi.fn();
    render(
      <SettingsPanel {...BASE_PROPS} clearReady={true} setClearShortcut={setClearShortcut} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset clear shortcut" }));
    expect(setClearShortcut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm reset clear shortcut"));
    expect(setClearShortcut).toHaveBeenCalledWith("CmdOrCtrl+K");
  });
```

Add a delete-theme confirm case (place near the existing theme-actions cases):

```jsx
  it("deletes the active custom theme only after confirming", () => {
    const deleteCustomTheme = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="custom-1"
        customThemeOptions={[{ id: "custom-1", label: "Custom Theme" }]}
        activeIsCustom={true}
        deleteCustomTheme={deleteCustomTheme}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteCustomTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm delete theme"));
    expect(deleteCustomTheme).toHaveBeenCalledWith("custom-1");
  });
```

Note: `BASE_PROPS` already mocks `resetChannelLabels`/`setClearShortcut`/`deleteCustomTheme` (see the top of the test file); the cases above pass explicit spies where they assert calls. If `clearReady` is not part of `BASE_PROPS`, the explicit `clearReady={true}` in the clear case is sufficient.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: FAIL — buttons named `Reset channel labels` / `Reset clear shortcut` don't exist yet (current labels are `Reset to Auto` and an unlabeled `Reset`); delete is immediate.

- [ ] **Step 3: Write the implementation**

In `src/components/SettingsPanel.jsx`, add the import near the other component imports:

```jsx
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
```

Replace the Clear-shortcut Reset `<Button … onClick={() => setClearShortcut(DEFAULT_CLEAR_SHORTCUT)}>Reset</Button>` with:

```jsx
                      <InlineConfirm
                        onConfirm={() => setClearShortcut(DEFAULT_CLEAR_SHORTCUT)}
                        confirmLabel="Confirm reset clear shortcut"
                        cancelLabel="Cancel reset clear shortcut"
                        trigger={(arm) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!clearReady}
                            onClick={arm}
                            aria-label="Reset clear shortcut"
                          >
                            Reset
                          </Button>
                        )}
                      />
```

Replace the Channel-labels Reset `<Button … onClick={resetChannelLabels} … >Reset to Auto</Button>` with:

```jsx
                    <InlineConfirm
                      onConfirm={resetChannelLabels}
                      confirmLabel="Confirm reset channel labels"
                      cancelLabel="Cancel reset channel labels"
                      trigger={(arm) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={arm}
                          disabled={!channelLabelHasOverride}
                          aria-label="Reset channel labels"
                          className="h-auto px-2 py-1 text-xs"
                        >
                          Reset
                        </Button>
                      )}
                    />
```

Replace the delete-theme `<Button … onClick={() => deleteCustomTheme(fixedThemeSelectValue)}>Delete</Button>` with:

```jsx
                          <InlineConfirm
                            onConfirm={() => deleteCustomTheme(fixedThemeSelectValue)}
                            confirmLabel="Confirm delete theme"
                            cancelLabel="Cancel delete theme"
                            trigger={(arm) => (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={themeControlsDisabled}
                                className="text-destructive"
                                onClick={arm}
                              >
                                Delete
                              </Button>
                            )}
                          />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: PASS — including the unchanged "keeps custom theme actions on their own row" and "locks theme controls" cases (the idle `Delete` trigger keeps its text and `disabled` wiring).

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(settings): confirm clear/channel-label resets and theme delete" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full check suite**

Run: `npm run check`
Expected: PASS — frontend format + lint + test + build + version + Rust fmt/clippy/test all green. In particular, confirm no stray references to the removed labels remain:

Run: `npx vitest run`
Expected: PASS (entire suite).

- [ ] **Step 2: Manual sanity grep for stale labels**

Run: `git grep -n "Reset to Auto\|Reset order\|onResetOrder"`
Expected: no matches in `src/` (only this plan / the spec under `docs/` may mention them historically).

- [ ] **Step 3: Commit any formatting fixups (if `npm run check` changed files)**

```bash
git add -A
git commit -m "chore: formatting after panel reset & confirmation work" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(Skip this commit if `git status` is clean.)

---

## Self-Review

**Spec coverage:**
- #1 Clear reset + confirm → Task 7. ✅
- #2 Channel labels reset (relabel) + confirm → Task 7. ✅
- #3 Stats reset visibility+order + confirm + relabel → Task 5. ✅
- #4 Modules layout reset (full default + clear preset) + confirm → Tasks 2, 3, 4. ✅
- #5 Delete preset + confirm → Task 6. ✅
- #6 Delete theme + confirm → Task 7. ✅
- #7 Delete panel + confirm → Task 4. ✅
- Unified inline confirmation primitive → Task 1. ✅
- Label unification to `Reset` (distinct `aria-label`s) → Tasks 4, 5, 7. ✅
- `CloseConfirmDialog` / `resetAll()` untouched → not modified by any task. ✅
- Out of scope (global reset, window geometry, per-chip resets) → no task touches them. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**Type/name consistency:** `InlineConfirm({ trigger, onConfirm, confirmLabel, cancelLabel, className })` is defined in Task 1 and used with exactly those props in Tasks 4–7. Reducer action `RESET_WORKSPACE` / bound `resetWorkspace` defined in Task 2 and consumed in Tasks 3–4. `onResetOrder` → `onReset` rename is applied consistently in Task 5 (both the prop declaration in `SortableStatsChip` and the call site in `PanelHeaderControls`). Aria-labels (`Reset clear shortcut`, `Reset channel labels`, `Reset stats`, `Reset layout`) and confirm/cancel labels match between each implementation and its test. ✅
