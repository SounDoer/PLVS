# App State Ownership — Implementation Plan (Stage 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Settings, the scene guard, Dock, window chrome, Presets, the audio source, source
actions and the application lifecycle one owner each, so `AppContent` stops holding and relaying
their state.

**Architecture:** Each domain becomes a React context provider that mounts the existing owner hooks
unchanged. Providers nest in dependency order above `AppContent`, which reads them through one hook
per domain. Agent Control becomes a component that takes over one domain's wiring per task. Nothing
user-visible, persisted or public changes.

**Tech stack:** React 19, JavaScript with JSDoc types checked by `tsc` (`npm run typecheck`),
Vitest + jsdom + `@testing-library/react`, Tauri 2, Agent Control CLI for verification.

**Spec:** `docs/history/specs/2026-10-06-app-state-ownership-design.md`

**Scope:** Stage 1 of the spec (migration steps 1 to 7). Stage 2 (AnalysisSession and frame-rate
isolation, DockAccessories, the Agent Control bridge split, shell containers, living documentation)
gets its own plan after the checkpoint in Task 11, because the user decides there whether and how it
proceeds.

---

## Delivery rules

- Work lands on `main`. One task is one commit unless the task says otherwise.
- Commit subjects follow Conventional Commits with a scope, for example
  `refactor(app): give settings one owner`. End every commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pass the message with several `-m`
  flags; do not use a PowerShell here-string.
- Documentation, comments and commit messages are in English.
- Every new context value has a named JSDoc type. Do not add `@ts-nocheck`, `@ts-ignore` or
  `@ts-expect-error`.
- Never run the development app while the checkout is changing. Stop it by PID first (Recipe V).
- If a step reveals an effect that must fire before another effect owned by a different provider,
  stop, revise the audit table in the spec, and tell the user before continuing.

### The move convention

Most of this plan moves existing code between files without changing it. Where a step says
**move verbatim**, cut the named declarations from `AppContent` in `src/App.jsx`, paste them into
the new file in the listed order, and change nothing inside them except:

- an identifier that now comes from a context instead of a local variable, as the step states;
- imports, which move with the code that uses them.

Comments attached to a moved declaration move with it. The listed order is the order the
declarations have in `AppContent` today; keep it, because effect order inside one component is
hook-call order. After each move, delete imports in `src/App.jsx` that the move left unused.

The plan gives full code for everything that is new (context, provider shell, hook, types, tests)
and names what is moved. It does not reprint moved bodies: reprinting 1500 lines that must stay
byte-identical would only add a way for them to drift.

### Coverage for moved code

New tests cover the new seams only: each context hook, and each rule a provider now owns. Behaviour
of moved code stays covered by the suites that cover it today (`src/App.smoke.test.jsx`,
`src/hooks/useDockMode.test.js`, `src/dock/useDockLayout.test.js`, `src/hooks/usePresets.test.jsx`,
`src/hooks/useSettings.*.test.jsx`, `src/agentControl/useAgentControlBridge.test.jsx`) and by
Recipe V. Those suites must pass unmodified unless a step says to change one.

### Recipe V: verification for every task

Run after the code for a task is complete and before its commit. `<label>` is the task number, for
example `task03`. All output goes under `artifacts/app-state/`, which `.gitignore` already excludes.

1. Merge gate:

   ```bash
   npm run check
   ```

   Expected: exits 0.

2. Run the capture script, which is untracked and was written in Task 0:

   ```bash
   bash artifacts/app-state/recipe.sh <label>
   ```

   It stops any development build by PID, cold-starts one on an isolated profile, saves
   `inspect --json`, runs two walkthroughs, stops the app and compares with the baseline. Three
   facts found while capturing the baseline shape it:

   - The isolated profile lives outside the repository (`%TEMP%\plvs-app-state\data-<label>`).
     Inside the repository the first-run storage rename fails with "Access is denied", because
     Vite's watcher holds the new directory open.
   - The CLI finds an isolated app only when `PLVS_TEST_IDENTITY_ROOT` points at that profile's
     `multi-instance` directory.
   - Two launches of the same code differ in `$.device.observedAt` and
     `$.loudnessProfile.activeId` (a timestamp and an identifier seeded on first run), and in the
     meter contents of any screenshot that shows analysed audio. The snapshot comparison ignores
     those two paths. The walkthrough runs twice: once without the audio fixture, which is
     deterministic, and once with the stock manifest.

3. Expected output:

   - `identical apart from revision`;
   - `pixel compare (empty)` exits 0 with every image `identical`;
   - `pixel compare (data)` may report changed pixels. Baseline against baseline measured 1933 to
     4364 per image, all inside the meters. Open the difference images under
     `artifacts/app-state/<label>/diff-data/` and confirm nothing outside plotted meter data
     changed.

   A task that needs the app left running for a hand check passes `keep` as a second argument and
   stops the app by PID afterwards.

If the snapshot or the empty walkthrough reports a difference, the task is not done. Find the cause; do not re-baseline.

---

## File map

| File                                      | Status | Responsibility                                                               |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| `src/runtime/MeterRuntimeContext.jsx`     | modify | Adds the low-rate display context                                            |
| `src/hooks/useMeterDisplay.js`            | modify | `raiseNotice` and `clearNotice` become stable                                |
| `src/agentControl/AgentControlBridge.jsx` | create | Component around `useAgentControlBridge`; takes over wiring domain by domain |
| `src/hooks/useWindowPinnedSetting.js`     | create | Stored pin value and its setter                                              |
| `src/hooks/useAlwaysOnTop.js`             | modify | Only the effect that applies the pin                                         |
| `src/hooks/useSettings.js`                | modify | Includes the stored pin value                                                |
| `src/settings/SettingsContext.jsx`        | create | Settings owner and the late-bound clear ref                                  |
| `src/hooks/SceneGuardContext.jsx`         | create | Composed scene guard                                                         |
| `src/lib/errorDetails.js`                 | create | `errorDetails` helper shared by providers                                    |
| `src/lib/sceneOperationNotice.js`         | create | `reportSceneOperationError` helper                                           |
| `src/dock/DockContext.jsx`                | create | Dock mode, layout, transitions, history viewport, Dock executor              |
| `src/hooks/WindowChromeContext.jsx`       | create | Native window effects, `applyViewState`, view setters, chrome reveal         |
| `src/hooks/PresetsContext.jsx`            | create | Preset library and the Dock hand-off                                         |
| `src/runtime/SourceContext.jsx`           | create | Devices, selected source, labels, format signature                           |
| `src/workspace/useSharedTimeViewport.js`  | create | Shared time viewport value and setters over the Workspace context            |
| `src/runtime/SourceActionsContext.jsx`    | create | Clear, file actions, report export, dialogue restart                         |
| `src/hooks/AppLifecycleContext.jsx`       | create | Visibility, tray, update, close confirm, crash reports, shortcuts            |
| `src/App.jsx`                             | modify | Loses each moved cluster; gains the provider order                           |

A test file sits beside each created file.

---

## Task 0: Baseline

**Files:**

- Create (untracked): `artifacts/app-state/compare-inspect.cjs`

- [ ] **Step 1: Write the snapshot comparison script**

Create `artifacts/app-state/compare-inspect.cjs`:

```js
// Compares two `inspect --json` results, ignoring the revision counter, and names what differs.
const fs = require("fs");
const [beforePath, afterPath] = process.argv.slice(2);
const load = (path) => {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  if (!parsed.ok) throw new Error(`${path} is not a successful inspect result`);
  const { revision: _revision, ...rest } = parsed.result;
  return rest;
};
const differences = [];
const walk = (before, after, path) => {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const bothObjects = before && after && typeof before === "object" && typeof after === "object";
  if (!bothObjects) {
    differences.push(`${path}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    return;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    walk(before[key], after[key], `${path}.${key}`);
  }
};
walk(load(beforePath), load(afterPath), "$");
if (differences.length === 0) {
  console.log("identical apart from revision");
} else {
  console.log(differences.join("\n"));
  process.exit(1);
}
```

- [ ] **Step 2: Capture the baseline**

Run Recipe V steps 2, 3, 5 and 6 on the unmodified checkout with `<label>` = `baseline`, writing the
walkthrough to `artifacts/app-state/baseline`. In place of step 4, save the snapshot:

```bash
npm run --silent desktop:control -- inspect --json > artifacts/app-state/baseline-inspect.json
```

- [ ] **Step 3: Prove the baseline is reproducible**

Repeat Recipe V steps 2 to 6 on the same unmodified checkout with `<label>` = `baseline2`.

Expected: `identical apart from revision`, and `ui:compare` reports no changed image.

If the snapshot differs only in a field that is different on every launch (for example an instance
identifier), add that path to an ignore list in `compare-inspect.cjs` and record the path in the
Task 11 report. If pixels differ between two launches of the same code, stop and tell the user: the
comparison cannot gate the following tasks until that is understood.

No commit. Nothing tracked changed.

---

## Task 1: Low-rate display context

Dock, Presets and Source need `raiseNotice`, `clearNotice` and `setSelectedOffset`. Today those come
only from the assembly context, whose value changes on every meter frame.

**Files:**

- Modify: `src/hooks/useMeterDisplay.js`
- Modify: `src/runtime/MeterRuntimeContext.jsx`
- Test: `src/runtime/MeterRuntimeContext.test.jsx`

- [ ] **Step 1: Write the failing test**

In `src/runtime/MeterRuntimeContext.test.jsx`, extend the imports:

```jsx
import { act, render, renderHook } from "@testing-library/react";
import {
  MeterRuntimeProvider,
  useMeterDisplayState,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./MeterRuntimeContext.jsx";
```

Add inside `describe("MeterRuntimeProvider", ...)`:

```jsx
it("keeps low-rate display consumers still while meter frames arrive", () => {
  let probeRenders = 0;
  let assembly;
  let displayState;
  function Probe() {
    displayState = useMeterDisplayState();
    probeRenders += 1;
    return null;
  }
  function Driver() {
    assembly = useMeterRuntimeAssembly();
    return null;
  }
  render(
    <MeterRuntimeProvider>
      <Probe />
      <Driver />
    </MeterRuntimeProvider>
  );

  const rendersBeforeFrame = probeRenders;
  act(() => assembly.display.setAudio((current) => ({ ...current, tpMax: -3 })));
  expect(probeRenders).toBe(rendersBeforeFrame);

  act(() => displayState.raiseNotice("error", "Boom"));
  expect(probeRenders).toBe(rendersBeforeFrame + 1);
  expect(displayState.notice).toMatchObject({ kind: "error", text: "Boom" });
});

it("refuses the low-rate display hook outside the provider", () => {
  expect(() => renderHook(() => useMeterDisplayState())).toThrow(
    "useMeterDisplayState must be used inside MeterRuntimeProvider"
  );
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/runtime/MeterRuntimeContext.test.jsx`
Expected: FAIL, `useMeterDisplayState` is not exported.

- [ ] **Step 3: Make the notice functions stable**

In `src/hooks/useMeterDisplay.js`, replace `clearGuardTimer`, `clearNotice` and `raiseNotice` with:

```js
const clearGuardTimer = useCallback(() => {
  if (guardTimerRef.current) {
    clearTimeout(guardTimerRef.current);
    guardTimerRef.current = null;
  }
}, []);

const clearNotice = useCallback(() => {
  clearGuardTimer();
  setNotice(null);
}, [clearGuardTimer]);

const raiseNotice = useCallback(
  (/** @type {string} */ kind, text, details) => {
    clearGuardTimer();
    setNotice({
      kind,
      text,
      ...(typeof details === "string" && details ? { details } : null),
    });
    // Refusals and informational notices describe a moment rather than a state to act on, so they
    // clear themselves; errors stay until the next action.
    if (kind === "guard" || kind === "info") {
      guardTimerRef.current = setTimeout(() => {
        guardTimerRef.current = null;
        setNotice(null);
      }, 5000);
    }
  },
  [clearGuardTimer]
);
```

- [ ] **Step 4: Publish the low-rate context**

In `src/runtime/MeterRuntimeContext.jsx`, add beside the other two contexts:

```jsx
/**
 * The display state that changes at human speed. Split from the assembly, whose value changes on
 * every meter frame, so a consumer that only raises a notice or reads the scrub position does not
 * re-render per frame.
 *
 * @typedef {{
 *   notice: ReturnType<typeof useMeterDisplay>["notice"],
 *   raiseNotice: ReturnType<typeof useMeterDisplay>["raiseNotice"],
 *   clearNotice: ReturnType<typeof useMeterDisplay>["clearNotice"],
 *   selectedOffset: number,
 *   setSelectedOffset: ReturnType<typeof useMeterDisplay>["setSelectedOffset"],
 *   selectedSnapshotTimeMs: number | null,
 *   showClock: boolean,
 * }} MeterDisplayState
 */
const MeterDisplayStateContext = createContext(/** @type {MeterDisplayState | null} */ (null));
```

Inside `MeterRuntimeProvider`, after `const assembly = { ... }`:

```jsx
const displayState = useMemo(
  () => ({
    notice: display.notice,
    raiseNotice: display.raiseNotice,
    clearNotice: display.clearNotice,
    selectedOffset: display.selectedOffset,
    setSelectedOffset: display.setSelectedOffset,
    selectedSnapshotTimeMs: display.selectedSnapshotTimeMs,
    showClock: display.showClock,
  }),
  [
    display.notice,
    display.raiseNotice,
    display.clearNotice,
    display.selectedOffset,
    display.setSelectedOffset,
    display.selectedSnapshotTimeMs,
    display.showClock,
  ]
);
```

Wrap the children once more, innermost:

```jsx
<MeterDisplayStateContext.Provider value={displayState}>
  {children}
</MeterDisplayStateContext.Provider>
```

Add the hook at the end of the file:

```jsx
export function useMeterDisplayState() {
  const state = useContext(MeterDisplayStateContext);
  if (!state) throw new Error("useMeterDisplayState must be used inside MeterRuntimeProvider");
  return state;
}
```

- [ ] **Step 5: Run the test and see it pass**

Run: `npx vitest run src/runtime/MeterRuntimeContext.test.jsx`
Expected: PASS.

- [ ] **Step 6: Read the low-rate values from the new hook in `AppContent`**

In `src/App.jsx`, import `useMeterDisplayState` and add, directly after
`const meterRuntime = useMeterRuntime();`:

```jsx
const {
  notice,
  raiseNotice,
  clearNotice,
  selectedOffset,
  setSelectedOffset,
  selectedSnapshotTimeMs,
  showClock,
} = useMeterDisplayState();
```

Reduce the destructuring of `display` further down to what still comes from the assembly:

```jsx
const { display, routing } = useMeterRuntimeAssembly();
const { audio, setAudio } = display;
const { elapsedMsRef } = display.clock;
```

- [ ] **Step 7: Verify and commit**

Run Recipe V with `<label>` = `task01`.

```bash
git add src/hooks/useMeterDisplay.js src/runtime/MeterRuntimeContext.jsx src/runtime/MeterRuntimeContext.test.jsx src/App.jsx
git commit -m "refactor(runtime): publish low-rate display state apart from meter frames" -m "Notices and the scrub position shared one context value with the per-frame audio record, so anything that raised a notice re-rendered on every frame. They now have a memoized context of their own." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Agent Control bridge as a component

**Files:**

- Create: `src/agentControl/AgentControlBridge.jsx`
- Test: `src/agentControl/AgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/agentControl/AgentControlBridge.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const useAgentControlBridge = vi.hoisted(() => vi.fn());
vi.mock("./useAgentControlBridge.js", () => ({ useAgentControlBridge }));

import { AgentControlBridge } from "./AgentControlBridge.jsx";

describe("AgentControlBridge", () => {
  it("renders nothing and hands its props to the bridge hook", () => {
    const props = { enabled: false, runtime: { available: false } };
    const { container } = render(<AgentControlBridge {...props} />);

    expect(container.innerHTML).toBe("");
    expect(useAgentControlBridge).toHaveBeenCalledWith(props);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/agentControl/AgentControlBridge.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Create the component**

Create `src/agentControl/AgentControlBridge.jsx`:

```jsx
import { useAgentControlBridge } from "./useAgentControlBridge.js";

/**
 * Agent Control as a component, so it can sit inside the domain providers and read them itself.
 * It still receives every area as a prop; each domain that gains an owner moves its wiring from
 * `App.jsx` into this file.
 *
 * @param {Parameters<typeof useAgentControlBridge>[0]} props
 */
export function AgentControlBridge(props) {
  useAgentControlBridge(props);
  return null;
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run src/agentControl/AgentControlBridge.test.jsx`
Expected: PASS.

- [ ] **Step 5: Render it from `AppContent`**

In `src/App.jsx`:

- Replace the import of `useAgentControlBridge` with
  `import { AgentControlBridge } from "./agentControl/AgentControlBridge.jsx";`.
- Change `useAgentControlBridge({ ...options });` to `const agentControlBridgeProps = { ...options };`,
  keeping the options object exactly as it is.
- The overlays passed as `AppShell` children render only in normal form, so the bridge must not be
  one of them. Wrap the returned tree in a fragment and render the bridge beside the shell:

```jsx
return (
  <>
    <AgentControlBridge {...agentControlBridgeProps} />
    <AppShell
    /* props unchanged */
    >
      {/* children unchanged */}
    </AppShell>
  </>
);
```

The bridge's effects now run before `AppContent`'s instead of between them. The spec's audit
accepts this: they read rendered values only.

- [ ] **Step 6: Verify and commit**

Run Recipe V with `<label>` = `task02`, then additionally, while the app from Recipe V is running
(between its steps 5 and 6):

```bash
npm run smoke:agent-control
```

Expected: exits 0.

```bash
git add src/agentControl/AgentControlBridge.jsx src/agentControl/AgentControlBridge.test.jsx src/App.jsx
git commit -m "refactor(agent-control): mount the bridge as a component" -m "A component can sit inside the domain providers and read them, which a hook called from AppContent cannot. It still takes every area as a prop for now." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Settings owner

**Files:**

- Create: `src/hooks/useWindowPinnedSetting.js`, `src/hooks/useWindowPinnedSetting.test.js`
- Modify: `src/hooks/useAlwaysOnTop.js`, `src/hooks/useAlwaysOnTop.test.js`
- Modify: `src/hooks/useSettings.js`
- Create: `src/settings/SettingsContext.jsx`, `src/settings/SettingsContext.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing tests for the pin split**

Create `src/hooks/useWindowPinnedSetting.test.js`:

```js
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { presetsStore, settingsStore } from "../persistence/index.js";
import { useWindowPinnedSetting } from "./useWindowPinnedSetting.js";

describe("useWindowPinnedSetting", () => {
  beforeEach(() => {
    localStorage.clear();
    settingsStore.reset();
    presetsStore.reset();
  });

  it("starts from the stored value", () => {
    settingsStore.patch({ windowPinned: true });
    const { result } = renderHook(() => useWindowPinnedSetting());
    expect(result.current.windowPinned).toBe(true);
  });

  it("stores a change and marks the active preset dirty", () => {
    const { result } = renderHook(() => useWindowPinnedSetting());

    act(() => result.current.setWindowPinned(true));

    expect(result.current.windowPinned).toBe(true);
    expect(settingsStore.read().windowPinned).toBe(true);
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("treats anything but true as unpinned", () => {
    const { result } = renderHook(() => useWindowPinnedSetting());
    act(() => result.current.setWindowPinned("yes"));
    expect(result.current.windowPinned).toBe(false);
  });
});
```

In `src/hooks/useAlwaysOnTop.test.js`, every test that asserts the stored value or the dirty flag is
now covered above: delete those tests. Rewrite the remaining ones, which assert calls to
`setAlwaysOnTop`, to drive the effect-only hook. The render call in each becomes:

```js
const { rerender } = renderHook(({ pinned, suspended }) => useAlwaysOnTop(pinned, { suspended }), {
  initialProps: { pinned: false, suspended: false },
});
```

and a state change becomes `rerender({ pinned: true, suspended: false })`. Keep every existing
expectation on `mockSetAlwaysOnTop` (applies the value on mount, re-applies on change, does nothing
while suspended, re-asserts when suspension ends).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/hooks/useWindowPinnedSetting.test.js src/hooks/useAlwaysOnTop.test.js`
Expected: FAIL, `useWindowPinnedSetting` does not exist and `useAlwaysOnTop` ignores its first
argument.

- [ ] **Step 3: Split the hook**

Create `src/hooks/useWindowPinnedSetting.js`:

```js
import { useCallback, useState } from "react";
import { presetsStore, settingsStore } from "../persistence/index.js";

/**
 * The stored always-on-top preference. Applying it to the window is `useAlwaysOnTop`, which has a
 * different owner: the Dock needs this value to restore the window, and the effect needs to know
 * whether the Dock is active.
 */
export function useWindowPinnedSetting() {
  const [windowPinned, setPinned] = useState(() => settingsStore.read().windowPinned === true);

  const setWindowPinned = useCallback((nextPinned) => {
    const next = nextPinned === true;
    settingsStore.patch({ windowPinned: next });
    presetsStore.patch({ dirty: true });
    setPinned(next);
  }, []);

  return { windowPinned, setWindowPinned };
}
```

Replace the body of `src/hooks/useAlwaysOnTop.js` with:

```js
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";

/**
 * Applies the stored always-on-top preference to the window.
 *
 * @param {boolean} pinned
 * @param {{ suspended?: boolean }} [options]
 */
export function useAlwaysOnTop(pinned, { suspended = false } = {}) {
  useEffect(() => {
    // While docked (suspended), Rust owns always-on-top: the strip is forced
    // topmost by apply_dock_form, and this effect must not undo that when the
    // stored pin is false (e.g. a preset apply flips windowPinned while
    // docked). `suspended` stays in the deps so flipping it false on exit
    // re-asserts the stored value — a harmless double-set with exitDock's own
    // restore.
    if (suspended) return;
    if (!isTauri()) return;
    getCurrentWindow().setAlwaysOnTop(pinned);
  }, [pinned, suspended]);
}
```

`togglePin` had no caller and is dropped.

In `src/hooks/useSettings.js`, import `useWindowPinnedSetting`, call it after `useViewSettings()`:

```js
const windowPinnedSetting = useWindowPinnedSetting();
```

and add `...windowPinnedSetting,` to the returned object directly after `...viewSettings,`.

- [ ] **Step 4: Run the pin tests and see them pass**

Run: `npx vitest run src/hooks/useWindowPinnedSetting.test.js src/hooks/useAlwaysOnTop.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the settings owner**

Create `src/settings/SettingsContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { presetsStore, settingsStore } from "../persistence/index.js";
import { SettingsProvider, useAppSettings } from "./SettingsContext.jsx";

function wrapper({ children }) {
  return (
    <BlockingEditorsProvider>
      <UiNavigationProvider>
        <SettingsProvider>{children}</SettingsProvider>
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
}

describe("SettingsProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    settingsStore.reset();
    presetsStore.reset();
  });

  it("owns the stored view values and writes them through", () => {
    const { result } = renderHook(() => useAppSettings(), { wrapper });

    act(() => result.current.setWindowPinned(true));
    act(() => result.current.setSurfaceOpacity(60));

    expect(result.current.windowPinned).toBe(true);
    expect(result.current.surfaceOpacity).toBe(60);
    expect(settingsStore.read().windowPinned).toBe(true);
  });

  it("hands out one clear ref for the whole session", () => {
    const { result, rerender } = renderHook(() => useAppSettings(), { wrapper });
    const first = result.current.onClearRef;

    expect(first.current).toBeNull();
    rerender();
    expect(result.current.onClearRef).toBe(first);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useAppSettings())).toThrow(
      "useAppSettings must be used inside SettingsProvider"
    );
  });
});
```

Run: `npx vitest run src/settings/SettingsContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 6: Create the owner**

Create `src/settings/SettingsContext.jsx`:

```jsx
import { createContext, useContext, useRef } from "react";
import { useSettings } from "../hooks/useSettings.js";

/**
 * @typedef {ReturnType<typeof useSettings> & {
 *   onClearRef: import("react").MutableRefObject<(() => any) | null>,
 * }} AppSettings
 */
const SettingsContext = createContext(/** @type {AppSettings | null} */ (null));

/**
 * The one mount of `useSettings`: every stored preference, including the view values the Dock
 * restores and the window chrome applies.
 *
 * `onClearRef` is the single link that points inward. The clear shortcut is a setting, registered
 * here; the action it triggers belongs to the source actions, which mount far inside and assign the
 * ref during render. A ref rather than a context read, because this provider cannot read one it
 * encloses.
 */
export function SettingsProvider({ children }) {
  const onClearRef = useRef(/** @type {(() => any) | null} */ (null));
  const settings = useSettings({ onClearRef });
  return (
    <SettingsContext.Provider value={{ ...settings, onClearRef }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useAppSettings() {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error("useAppSettings must be used inside SettingsProvider");
  return settings;
}
```

Run: `npx vitest run src/settings/SettingsContext.test.jsx`
Expected: PASS.

- [ ] **Step 7: Use the owner in `App.jsx`**

- In `App`, nest `<SettingsProvider>` directly inside `<LoudnessProfileProvider>`, around
  `<AppContent />`.
- In `AppContent`, delete `const onClearRef = useRef(null);` and replace
  `const settings = useSettings({ onClearRef });` with:

```jsx
const settings = useAppSettings();
const { onClearRef, windowPinned: pinned, setWindowPinned: setPinnedStored } = settings;
```

- Replace `const { pinned, setPinned: setPinnedStored } = useAlwaysOnTop({ suspended: docked });`
  with `useAlwaysOnTop(pinned, { suspended: docked });`, keeping its comment and its position.
- Remove the `useSettings` import.

- [ ] **Step 8: Verify and commit**

Run Recipe V with `<label>` = `task03`.

```bash
git add src/hooks/useWindowPinnedSetting.js src/hooks/useWindowPinnedSetting.test.js src/hooks/useAlwaysOnTop.js src/hooks/useAlwaysOnTop.test.js src/hooks/useSettings.js src/settings/SettingsContext.jsx src/settings/SettingsContext.test.jsx src/App.jsx
git commit -m "refactor(settings): give settings one owner outside AppContent" -m "useSettings could be mounted once, so every setting reached other components as a prop from AppContent. It now lives in a provider. The stored pin value moves in with the other view values; applying it to the window stays a separate effect, because that effect depends on the Dock and the Dock depends on the value." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Scene guard owner

**Files:**

- Create: `src/hooks/SceneGuardContext.jsx`, `src/hooks/SceneGuardContext.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/SceneGuardContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MeterRuntimeProvider, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider, useBlockingEditor } from "./BlockingEditorsContext.jsx";
import { SceneGuardProvider, useSceneGuard } from "./SceneGuardContext.jsx";
import {
  SCENE_OPERATIONS,
  SceneOperationBlockedError,
  SceneOperationUnavailableError,
} from "../lib/sceneOperations.js";

function wrapper({ children }) {
  return (
    <MeterRuntimeProvider>
      <BlockingEditorsProvider>
        <SceneGuardProvider>{children}</SceneGuardProvider>
      </BlockingEditorsProvider>
    </MeterRuntimeProvider>
  );
}

describe("SceneGuardProvider", () => {
  it("allows scene operations in live mode with no editor open", () => {
    const { result } = renderHook(() => useSceneGuard(), { wrapper });

    expect(result.current.activeBlockingEditors).toEqual([]);
    expect(() =>
      result.current.assertSceneOperationAllowed(SCENE_OPERATIONS.dockEnter)
    ).not.toThrow();
  });

  it("refuses dock entry in file mode", () => {
    const { result } = renderHook(() => ({ guard: useSceneGuard(), runtime: useMeterRuntime() }), {
      wrapper,
    });

    act(() => result.current.runtime.switchSource("file"));

    expect(() =>
      result.current.guard.assertSceneOperationAllowed(SCENE_OPERATIONS.dockEnter)
    ).toThrow(SceneOperationUnavailableError);
  });

  it("refuses every scene operation while a blocking editor is open", () => {
    const { result } = renderHook(
      () => {
        useBlockingEditor("theme", true);
        return useSceneGuard();
      },
      { wrapper }
    );

    expect(result.current.activeBlockingEditors).toEqual(["theme"]);
    expect(() => result.current.assertSceneOperationAllowed(SCENE_OPERATIONS.presetApply)).toThrow(
      SceneOperationBlockedError
    );
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useSceneGuard())).toThrow(
      "useSceneGuard must be used inside SceneGuardProvider"
    );
  });
});
```

Run: `npx vitest run src/hooks/SceneGuardContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Create the owner**

Create `src/hooks/SceneGuardContext.jsx`. The two comment blocks above
`assertSceneOperationAllowed` in `AppContent` (the one beginning "The scene guard." and the one
beginning "FILE mode forbids the dock outright") move here, above the `useCallback`.

```jsx
import { createContext, useCallback, useContext, useMemo } from "react";
import { useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { useBlockingEditors } from "./BlockingEditorsContext.jsx";
import {
  SceneOperationUnavailableError,
  sceneOperationUnavailableReason,
} from "../lib/sceneOperations.js";

/**
 * @typedef {{
 *   activeBlockingEditors: readonly string[],
 *   assertSceneOperationAllowed: (operation: string) => void,
 * }} SceneGuard
 */
const SceneGuardContext = createContext(/** @type {SceneGuard | null} */ (null));

export function SceneGuardProvider({ children }) {
  const { sourceMode } = useMeterRuntime();
  const { activeBlockingEditors, assertSceneOperationAllowed: assertNoBlockingEditor } =
    useBlockingEditors();
  // (moved comments go here)
  const assertSceneOperationAllowed = useCallback(
    (/** @type {string} */ operation) => {
      assertNoBlockingEditor(operation);
      const reason = sceneOperationUnavailableReason(operation, { sourceMode });
      if (reason) throw new SceneOperationUnavailableError(operation, reason);
    },
    [assertNoBlockingEditor, sourceMode]
  );
  const value = useMemo(
    () => ({ activeBlockingEditors, assertSceneOperationAllowed }),
    [activeBlockingEditors, assertSceneOperationAllowed]
  );
  return <SceneGuardContext.Provider value={value}>{children}</SceneGuardContext.Provider>;
}

/// Throws outside the provider for the reason `useBlockingEditors` does: a guard that silently
/// allows everything looks exactly like a guard that is running.
export function useSceneGuard() {
  const value = useContext(SceneGuardContext);
  if (!value) throw new Error("useSceneGuard must be used inside SceneGuardProvider");
  return value;
}
```

Run: `npx vitest run src/hooks/SceneGuardContext.test.jsx`
Expected: PASS.

- [ ] **Step 3: Use the owner in `App.jsx`**

- In `App`, nest `<SceneGuardProvider>` directly inside `<SettingsProvider>`.
- In `AppContent`, replace the `useBlockingEditors()` destructuring and the
  `assertSceneOperationAllowed` `useCallback` with:

```jsx
const { activeBlockingEditors, assertSceneOperationAllowed } = useSceneGuard();
```

- Remove the imports this leaves unused (`useBlockingEditors`, `SceneOperationUnavailableError`).
  `sceneOperationUnavailableReason` is still used by `dockPresetUnavailableReason`; keep it.

- [ ] **Step 4: Verify and commit**

Run Recipe V with `<label>` = `task04`.

```bash
git add src/hooks/SceneGuardContext.jsx src/hooks/SceneGuardContext.test.jsx src/App.jsx
git commit -m "refactor(scene): give the composed scene guard an owner" -m "The guard combines the editor registry with the source mode. It was composed in AppContent because only AppContent held both; both are contexts, so the composition is now a provider that Dock and Presets can enclose themselves in." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Dock owner

**Files:**

- Create: `src/lib/errorDetails.js`, `src/lib/sceneOperationNotice.js`,
  `src/lib/sceneOperationNotice.test.js`
- Create: `src/dock/DockContext.jsx`, `src/dock/DockContext.test.jsx`
- Modify: `src/agentControl/AgentControlBridge.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Extract the two notice helpers, test first**

Create `src/lib/sceneOperationNotice.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { errorDetails } from "./errorDetails.js";
import { reportSceneOperationError } from "./sceneOperationNotice.js";
import { SCENE_OPERATIONS, SceneOperationBlockedError } from "./sceneOperations.js";

describe("errorDetails", () => {
  it("joins a prefix with the error message", () => {
    expect(errorDetails("Dock failed", new Error("no monitor"))).toBe("Dock failed: no monitor");
    expect(errorDetails("Dock failed", "plain")).toBe("Dock failed: plain");
  });
});

describe("reportSceneOperationError", () => {
  it("shows a refusal's own sentence without technical detail", () => {
    const raiseNotice = vi.fn();
    const refusal = new SceneOperationBlockedError(SCENE_OPERATIONS.presetApply, ["theme"]);

    reportSceneOperationError(raiseNotice, refusal, "Preset failed.", "Preset failed");

    expect(raiseNotice).toHaveBeenCalledWith("error", refusal.message);
  });

  it("shows the fallback line with detail for a genuine failure", () => {
    const raiseNotice = vi.fn();

    reportSceneOperationError(raiseNotice, new Error("ipc"), "Preset failed.", "Preset failed");

    expect(raiseNotice).toHaveBeenCalledWith("error", "Preset failed.", "Preset failed: ipc");
  });
});
```

Run: `npx vitest run src/lib/sceneOperationNotice.test.js`
Expected: FAIL, the modules do not exist.

Create `src/lib/errorDetails.js`:

```js
/**
 * @param {string} prefix
 * @param {unknown} error
 */
export function errorDetails(prefix, error) {
  return `${prefix}: ${/** @type {any} */ (error)?.message || String(error)}`;
}
```

Create `src/lib/sceneOperationNotice.js`:

```js
import { errorDetails } from "./errorDetails.js";
import { isSceneOperationRefused } from "./sceneOperations.js";

/**
 * A refused scene operation is not a failure to report as one -- the guard did its job. Say what
 * the user has to do instead, and keep the technical detail for everything else.
 *
 * @param {(kind: string, text: string, details?: string) => void} raiseNotice
 * @param {unknown} error
 * @param {string} fallbackMessage
 * @param {string} detailPrefix
 */
export function reportSceneOperationError(raiseNotice, error, fallbackMessage, detailPrefix) {
  if (isSceneOperationRefused(error)) {
    raiseNotice("error", /** @type {Error} */ (error).message);
    return;
  }
  raiseNotice("error", fallbackMessage, errorDetails(detailPrefix, error));
}
```

Run: `npx vitest run src/lib/sceneOperationNotice.test.js`
Expected: PASS.

In `src/App.jsx`, delete the module-level `errorDetails` function and import it from
`./lib/errorDetails.js`. Replace the `reportSceneOperationError` `useCallback` with:

```jsx
const reportSceneError = useCallback(
  (error, fallbackMessage, detailPrefix) =>
    reportSceneOperationError(raiseNotice, error, fallbackMessage, detailPrefix),
  [raiseNotice]
);
```

and rename its uses inside `AppContent` from `reportSceneOperationError` to `reportSceneError`.

- [ ] **Step 2: Write the failing test for the Dock owner**

Create `src/dock/DockContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "../hooks/SceneGuardContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { DockProvider, useDock } from "./DockContext.jsx";

function wrapper({ children }) {
  return (
    <MeterRuntimeProvider>
      <BlockingEditorsProvider>
        <UiNavigationProvider>
          <SettingsProvider>
            <SceneGuardProvider>
              <DockProvider>{children}</DockProvider>
            </SceneGuardProvider>
          </SettingsProvider>
        </UiNavigationProvider>
      </BlockingEditorsProvider>
    </MeterRuntimeProvider>
  );
}

describe("DockProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("reports the normal window form outside Tauri and exposes the layout", () => {
    const { result } = renderHook(() => useDock(), { wrapper });

    expect(result.current.docked).toBe(false);
    expect(result.current.dockEnabled).toBe(false);
    expect(Array.isArray(result.current.layout.panels)).toBe(true);
    expect(typeof result.current.exitDockRestoringAttributes).toBe("function");
    expect(typeof result.current.onDockChange).toBe("function");
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useDock())).toThrow("useDock must be used inside DockProvider");
  });
});
```

Run: `npx vitest run src/dock/DockContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Create the owner**

Create `src/dock/DockContext.jsx` with this shell, then **move verbatim** into
`DockProvider`, in this order, from `AppContent`:

1. the `useDockMode({ assertSceneOperationAllowed })` call with its destructuring and the comment
   block above it ("Dock hooks run first ...");
2. `const dockLayout = useDockLayout();`
3. `const docked = isTauri() && dockEnabled;`
4. `exitDockRestoringAttributes` with its comment block ("Dock transitions. ...");
5. `onDockChange`;
6. `const dockHistoryViewport = useDockHistoryViewport({ maxWindowSec: historyRetentionSec });`
7. `executeAgentControlDock`, renamed `executeDockForControl`;
8. `onDockHeightChange`.

Inside the moved code, `reportSceneOperationError(error, a, b)` in `onDockChange` becomes
`reportSceneOperationError(raiseNotice, error, a, b)` with `raiseNotice` in its dependency list in
place of the old callback, and `historyRetentionSec`, `focusView` and `pinned` come from
`useAppSettings()` as shown.

```jsx
import { createContext, useCallback, useContext } from "react";
import { useDockMode } from "../hooks/useDockMode.js";
import { useSceneGuard } from "../hooks/SceneGuardContext.jsx";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useMeterDisplayState } from "../runtime/MeterRuntimeContext.jsx";
import { isTauri } from "../ipc/env.js";
import { errorDetails } from "../lib/errorDetails.js";
import { reportSceneOperationError } from "../lib/sceneOperationNotice.js";
import { useDockLayout } from "./useDockLayout.js";
import { useDockHistoryViewport } from "./useDockHistoryViewport.js";

/**
 * @typedef {ReturnType<typeof useDockMode> & {
 *   docked: boolean,
 *   layout: ReturnType<typeof useDockLayout>,
 *   historyViewport: ReturnType<typeof useDockHistoryViewport>,
 *   exitDockRestoringAttributes: (options?: {
 *     reportError?: boolean, bounds?: any, decorations?: any, alwaysOnTop?: any,
 *   }) => Promise<{ ok: boolean, error: any }>,
 *   onDockChange: (edgeOrNull: string | null) => Promise<void>,
 *   onDockHeightChange: (height: number, options?: { persist?: boolean }) => Promise<void>,
 *   executeDockForControl: (method: string, projected: any) => Promise<any>,
 * }} DockOwner
 */
const DockContext = createContext(/** @type {DockOwner | null} */ (null));

/**
 * The Dock window form: Rust-mirrored mode, strip layout, and the transitions between forms.
 *
 * Encloses the window chrome on purpose. The chrome effects need `docked` to stand down while Rust
 * owns the strip; exit needs the user's stored pin and focus-view values, which are settings and
 * therefore available here, to restore the window.
 */
export function DockProvider({ children }) {
  const { assertSceneOperationAllowed } = useSceneGuard();
  const { focusView, windowPinned: pinned, historyRetentionSec } = useAppSettings();
  const { clearNotice, raiseNotice, setSelectedOffset } = useMeterDisplayState();

  // (moved declarations 1 to 8 go here, in order)

  const dockMode = {
    dockEnabled,
    dockEdge,
    dockMonitor,
    dockHeight,
    dockPreviewHeight,
    dockSuspended,
    dockTransitioning,
    reserveSpace,
    enterDockMode,
    exitDockMode,
    setReserveSpace,
    toggleReserveSpace,
    resizeDockHeight,
    suspendDockMode,
    resumeDockMode,
  };
  return (
    <DockContext.Provider
      value={{
        ...dockMode,
        docked,
        layout: dockLayout,
        historyViewport: dockHistoryViewport,
        exitDockRestoringAttributes,
        onDockChange,
        onDockHeightChange,
        executeDockForControl,
      }}
    >
      {children}
    </DockContext.Provider>
  );
}

export function useDock() {
  const dock = useContext(DockContext);
  if (!dock) throw new Error("useDock must be used inside DockProvider");
  return dock;
}
```

`useCallback` is imported for the moved callbacks; `errorDetails` for the moved notices.

Run: `npx vitest run src/dock/DockContext.test.jsx`
Expected: PASS.

- [ ] **Step 4: Use the owner in `App.jsx`**

- In `App`, nest `<DockProvider>` directly inside `<SceneGuardProvider>`.
- In `AppContent`, where the `useDockMode` call was, read the owner under the names the rest of the
  component already uses:

```jsx
const dock = useDock();
const {
  docked,
  dockEnabled,
  dockEdge,
  dockMonitor,
  dockHeight,
  dockPreviewHeight,
  dockSuspended,
  dockTransitioning,
  reserveSpace,
  enterDockMode,
  setReserveSpace,
  toggleReserveSpace,
  resizeDockHeight,
  suspendDockMode,
  resumeDockMode,
  layout: dockLayout,
  historyViewport: dockHistoryViewport,
  exitDockRestoringAttributes,
  onDockChange,
  onDockHeightChange,
} = dock;
```

- Remove the imports the move left unused (`useDockMode`, `useDockLayout`,
  `useDockHistoryViewport`).

- [ ] **Step 5: Move the Dock wiring of Agent Control into the bridge component**

In `src/agentControl/AgentControlBridge.jsx`, the component now builds the Dock area itself.
**Move verbatim** from `AppContent` into `AgentControlBridge`, above the hook call:

1. the four `agentControlMonitor*` `useState` declarations and the monitor inventory `useEffect`
   that follows them;
2. the `agentControlDock` `useMemo`.

They read `useDock()` in place of `AppContent`'s locals:

```jsx
import { useDock } from "../dock/DockContext.jsx";

/**
 * @param {Omit<Parameters<typeof useAgentControlBridge>[0], "dock" | "executeDock" | "dockContext"> & {
 *   dockContext: Omit<
 *     import("./useAgentControlBridge.js").AgentControlDockContext,
 *     "transitioning" | "monitors" | "fallbackMonitor" | "monitorRects" | "monitorInventoryReady"
 *   >,
 * }} props
 */
export function AgentControlBridge(props) {
  const {
    docked,
    dockEdge,
    dockMonitor,
    dockHeight,
    dockSuspended,
    dockTransitioning,
    reserveSpace,
    layout: dockLayout,
    executeDockForControl,
  } = useDock();

  // (moved declarations 1 and 2 go here)

  useAgentControlBridge({
    ...props,
    dock: agentControlDock,
    dockContext: {
      ...props.dockContext,
      transitioning: dockTransitioning,
      monitors: agentControlMonitors,
      fallbackMonitor: agentControlFallbackMonitor,
      monitorRects: agentControlMonitorRects,
      monitorInventoryReady: agentControlMonitorInventoryReady,
    },
    executeDock: executeDockForControl,
  });
  return null;
}
```

If `AgentControlDockContext` is not exported from `useAgentControlBridge.js`, the typedef is
already a module-level JSDoc typedef there and is importable by name; no change is needed.

In `AppContent`, delete `dock`, `executeDock`, and the five moved keys of `dockContext` from
`agentControlBridgeProps`.

Update `src/agentControl/AgentControlBridge.test.jsx`: the component now needs a Dock owner. Mock
it at the top of the file and adjust the assertion:

```jsx
vi.mock("../dock/DockContext.jsx", () => ({
  useDock: () => ({
    docked: false,
    dockEdge: "bottom",
    dockMonitor: null,
    dockHeight: 72,
    dockSuspended: false,
    dockTransitioning: false,
    reserveSpace: false,
    layout: { panelsById: {}, panelOrder: [], panelSizesById: {}, controlsByPanelId: {} },
    executeDockForControl: async () => {},
  }),
}));
```

```jsx
it("renders nothing and builds the Dock area from the Dock owner", () => {
  const props = { enabled: false, runtime: { available: false }, dockContext: { platform: "x" } };
  const { container } = render(<AgentControlBridge {...props} />);

  expect(container.innerHTML).toBe("");
  const passed = useAgentControlBridge.mock.calls.at(-1)[0];
  expect(passed.dock).toMatchObject({ enabled: false, edge: "bottom", height: 72 });
  expect(passed.dockContext).toMatchObject({ platform: "x", transitioning: false, monitors: [] });
  expect(typeof passed.executeDock).toBe("function");
});
```

The monitor inventory effect returns early outside Tauri, so the test needs no further mocks.

- [ ] **Step 6: Verify and commit**

Run Recipe V with `<label>` = `task05`. Before stopping the app in step 6 of the recipe, check the
Dock by hand, because the walkthrough covers only part of it:

- enter Dock on the top edge, then the bottom edge, then exit; the window returns to its previous
  size and position;
- with Pin on, enter and exit Dock; the window is still on top afterwards;
- with Borderless on, enter and exit Dock; the window is still borderless afterwards;
- switch to File mode; the Dock control is disabled.

```bash
npm run --silent desktop:control -- dock inspect --json
```

Expected: `"ok":true`.

```bash
git add src/lib/errorDetails.js src/lib/sceneOperationNotice.js src/lib/sceneOperationNotice.test.js src/dock/DockContext.jsx src/dock/DockContext.test.jsx src/agentControl/AgentControlBridge.jsx src/agentControl/AgentControlBridge.test.jsx src/App.jsx
git commit -m "refactor(dock): give the dock form one owner" -m "Dock mode, strip layout and the enter and exit transitions were hooks and callbacks in AppContent. They are now a provider that encloses the window chrome, and Agent Control reads the Dock from it directly." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Window chrome owner

**Files:**

- Create: `src/hooks/WindowChromeContext.jsx`, `src/hooks/WindowChromeContext.test.jsx`
- Modify: `src/agentControl/AgentControlBridge.jsx`, `src/agentControl/AgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/WindowChromeContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "./BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { SettingsProvider, useAppSettings } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "./SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { WindowChromeProvider, useWindowChrome } from "./WindowChromeContext.jsx";

function wrapper({ children }) {
  return (
    <MeterRuntimeProvider>
      <BlockingEditorsProvider>
        <UiNavigationProvider>
          <SettingsProvider>
            <SceneGuardProvider>
              <DockProvider>
                <WindowChromeProvider>{children}</WindowChromeProvider>
              </DockProvider>
            </SceneGuardProvider>
          </SettingsProvider>
        </UiNavigationProvider>
      </BlockingEditorsProvider>
    </MeterRuntimeProvider>
  );
}

describe("WindowChromeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
    document.documentElement.style.removeProperty("--surface-opacity");
  });

  it("stores a view change through the settings owner", async () => {
    const { result } = renderHook(
      () => ({ chrome: useWindowChrome(), settings: useAppSettings() }),
      { wrapper }
    );

    act(() => result.current.chrome.setPinned(true));
    act(() => result.current.chrome.setCompactPanels(true));

    await waitFor(() => expect(result.current.settings.windowPinned).toBe(true));
    await waitFor(() => expect(result.current.settings.focusView.compactPanels).toBe(true));
    expect(result.current.chrome.focusViewActive).toBe(true);
  });

  it("publishes surface opacity as a CSS variable", async () => {
    const { result } = renderHook(() => useWindowChrome(), { wrapper });

    act(() => result.current.setSurfaceOpacity(40));

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--surface-opacity")).toBe("40%")
    );
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useWindowChrome())).toThrow(
      "useWindowChrome must be used inside WindowChromeProvider"
    );
  });
});
```

Run: `npx vitest run src/hooks/WindowChromeContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Create the owner**

Create `src/hooks/WindowChromeContext.jsx` with this shell, then **move verbatim** into
`WindowChromeProvider`, in this order, from `AppContent`:

1. `useAlwaysOnTop(pinned, { suspended: docked });` with its comment;
2. `useFocusViewWindow(...)` with its comment;
3. `useSurfaceOpacityWindowShadow(surfaceOpacity);`
4. `applyViewState`;
5. `setPinned`, `setFocusField`, `setAutoHideControls`, `setCompactPanels`, `setBorderless`,
   `setSurfaceOpacity`, `setGlassEnabled`;
6. `useGlassEffect(glassEnabled, resolvedTheme.colorScheme === "dark");`
7. the effect that sets `--surface-opacity`;
8. `focusViewActive` and `frameless`;
9. the `useViewsChromeReveal({ ... })` call with its destructuring.

All four native effects (1, 2, 3, 6) and the CSS effect (7) keep this relative order: they act on
the same window.

```jsx
import { createContext, useCallback, useContext, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { isTauri } from "../ipc/env.js";
import { isMacOS } from "../lib/platform.js";
import { useAlwaysOnTop } from "./useAlwaysOnTop.js";
import { setWindowDecorations, useFocusViewWindow } from "./useFocusViewWindow.js";
import {
  syncSurfaceOpacityWindowShadow,
  useSurfaceOpacityWindowShadow,
} from "./useSurfaceOpacityWindowShadow.js";
import { setGlassEffect, useGlassEffect } from "./useGlassEffect.js";
import { useViewsChromeReveal } from "./useViewsChromeReveal.js";

/**
 * @typedef {{
 *   view: {
 *     pinned: boolean,
 *     focusView: import("../lib/focusView.js").FocusView,
 *     surfaceOpacity: number,
 *     glassEnabled: boolean,
 *   },
 *   applyViewState: (next: any, options?: { changed?: string[] }) => Promise<void>,
 *   setPinned: (value: boolean) => void,
 *   setAutoHideControls: (value: boolean) => void,
 *   setCompactPanels: (value: boolean) => void,
 *   setBorderless: (value: boolean) => void,
 *   setSurfaceOpacity: (value: number) => void,
 *   setGlassEnabled: (value: boolean) => void,
 *   focusViewActive: boolean,
 *   frameless: boolean,
 *   reveal: ReturnType<typeof useViewsChromeReveal>,
 * }} WindowChrome
 */
const WindowChromeContext = createContext(/** @type {WindowChrome | null} */ (null));

/**
 * Applies the stored view values to the OS window and owns the functions that change them.
 *
 * Enclosed by the Dock: every native effect here stands down while docked, because Rust owns the
 * strip's chrome and topmost state. The stored values themselves are settings, which is how the
 * Dock can restore them on exit without reading this provider.
 */
export function WindowChromeProvider({ children }) {
  const {
    windowPinned: pinned,
    setWindowPinned: setPinnedStored,
    focusView,
    setFocusView,
    surfaceOpacity,
    setSurfaceOpacity: setSurfaceOpacityStored,
    glassEnabled,
    setGlassEnabled: setGlassEnabledStored,
    resolvedTheme,
  } = useAppSettings();
  const { docked } = useDock();

  // (moved declarations 1 to 9 go here, in order; keep the useViewsChromeReveal result whole)
  // const reveal = useViewsChromeReveal({ autoHideControls: focusView.autoHideControls, frameless });

  return (
    <WindowChromeContext.Provider
      value={{
        view: { pinned, focusView, surfaceOpacity, glassEnabled },
        applyViewState,
        setPinned,
        setAutoHideControls,
        setCompactPanels,
        setBorderless,
        setSurfaceOpacity,
        setGlassEnabled,
        focusViewActive,
        frameless,
        reveal,
      }}
    >
      {children}
    </WindowChromeContext.Provider>
  );
}

export function useWindowChrome() {
  const chrome = useContext(WindowChromeContext);
  if (!chrome) throw new Error("useWindowChrome must be used inside WindowChromeProvider");
  return chrome;
}
```

For declaration 9, assign the hook result to `reveal` without destructuring; `AppContent`
destructures it under the old names in the next step.

Run: `npx vitest run src/hooks/WindowChromeContext.test.jsx`
Expected: PASS.

- [ ] **Step 3: Use the owner in `App.jsx`**

- In `App`, nest `<WindowChromeProvider>` directly inside `<DockProvider>`.
- In `AppContent`, where `applyViewState` was:

```jsx
const {
  applyViewState,
  setPinned,
  setAutoHideControls,
  setCompactPanels,
  setBorderless,
  setSurfaceOpacity,
  setGlassEnabled,
  focusViewActive,
  frameless,
  reveal: {
    controlsVisible: focusControlsVisible,
    showControls: showFocusControls,
    hideControlsLater: hideFocusControlsLater,
    hideControlsNow: hideFocusControlsNow,
    toggleControls: toggleFocusControls,
    holdControls: holdFocusControls,
    releaseControlsHold: releaseFocusControlsHold,
    handleWindowDrag,
  },
} = useWindowChrome();
```

- `AppContent` still reads `pinned`, `focusView`, `surfaceOpacity`, `glassEnabled`,
  `setPinnedStored`, `setFocusView`, `setSurfaceOpacityStored` and `setGlassEnabledStored` from
  `settings` for `usePresets` until Task 7. Leave those.
- Remove the imports the move left unused.

- [ ] **Step 4: Move the View wiring of Agent Control into the bridge component**

In `src/agentControl/AgentControlBridge.jsx`, **move verbatim** the `agentControlViewContext`
`useMemo` from `AppContent`. It reads:

```jsx
const { view, applyViewState } = useWindowChrome();
const { pinned, focusView, surfaceOpacity, glassEnabled } = view;
```

and takes `platform` from `props.runtime.platform` in place of `agentControlRuntime.platform`. Pass
`viewContext: agentControlViewContext` to the hook, add `"viewContext"` to the `Omit` in the props
type, and delete `viewContext` from `agentControlBridgeProps` in `AppContent`.

In `src/agentControl/AgentControlBridge.test.jsx`, add the mock and one expectation:

```jsx
vi.mock("../hooks/WindowChromeContext.jsx", () => ({
  useWindowChrome: () => ({
    view: {
      pinned: false,
      focusView: { autoHideControls: false, compactPanels: false, borderless: false },
      surfaceOpacity: 100,
      glassEnabled: false,
    },
    applyViewState: async () => {},
  }),
}));
```

```jsx
expect(passed.viewContext).toMatchObject({ docked: false, view: { surfaceOpacity: 100 } });
```

- [ ] **Step 5: Verify and commit**

Run Recipe V with `<label>` = `task06`. Before stopping the app, check by hand: Pin, Borderless,
Auto-Hide Controls, Compact Panels and Surface Opacity each take effect from the View menu and
survive a Dock round trip. Then:

```bash
npm run --silent desktop:control -- view inspect --json
```

Expected: `"ok":true`.

```bash
git add src/hooks/WindowChromeContext.jsx src/hooks/WindowChromeContext.test.jsx src/agentControl/AgentControlBridge.jsx src/agentControl/AgentControlBridge.test.jsx src/App.jsx
git commit -m "refactor(view): give window chrome one owner" -m "The effects that apply pin, decorations, shadow and glass to the window, and the function that changes them with rollback, move from AppContent into a provider enclosed by the Dock. They stay in one component in their existing order because they act on the same window." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Presets owner

**Files:**

- Create: `src/hooks/PresetsContext.jsx`, `src/hooks/PresetsContext.test.jsx`
- Modify: `src/agentControl/AgentControlBridge.jsx`, `src/agentControl/AgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/PresetsContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider, useBlockingEditor } from "./BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "./LoudnessProfileContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "./SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { WindowChromeProvider } from "./WindowChromeContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { isSceneOperationRefused } from "../lib/sceneOperations.js";
import { PresetsProvider, usePresetLibrary } from "./PresetsContext.jsx";

function wrapper({ children }) {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SceneGuardProvider>
                  <DockProvider>
                    <WindowChromeProvider>
                      <PresetsProvider>{children}</PresetsProvider>
                    </WindowChromeProvider>
                  </DockProvider>
                </SceneGuardProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

describe("PresetsProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("saves the current scene as a preset and makes it active", async () => {
    const { result } = renderHook(() => usePresetLibrary(), { wrapper });

    await act(() => result.current.save("Mix"));

    expect(result.current.list.map((preset) => preset.name)).toEqual(["Mix"]);
    expect(result.current.activeId).toBe(result.current.list[0].id);
    expect(result.current.dirty).toBe(false);
  });

  it("refuses to save while a blocking editor is open and changes nothing", async () => {
    const { result } = renderHook(
      () => {
        useBlockingEditor("theme", true);
        return { presets: usePresetLibrary(), workspace: useWorkspaceStore().state };
      },
      { wrapper }
    );
    const workspaceBefore = result.current.workspace;

    let refusal;
    await act(async () => {
      refusal = await result.current.presets.save("Mix").catch((error) => error);
    });

    expect(isSceneOperationRefused(refusal)).toBe(true);
    expect(result.current.presets.list).toEqual([]);
    expect(presetsStore.read().list ?? []).toEqual([]);
    expect(result.current.workspace).toBe(workspaceBefore);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => usePresetLibrary())).toThrow(
      "usePresetLibrary must be used inside PresetsProvider"
    );
  });
});
```

Run: `npx vitest run src/hooks/PresetsContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Create the owner**

Create `src/hooks/PresetsContext.jsx` with this shell, then **move verbatim** into
`PresetsProvider`, in this order, from `AppContent`:

1. `applyDockPreset` with its comment block ("Preset apply hand-off ...");
2. `onPresetApplyError` with its comment;
3. `presetDockState` with its comment;
4. the `usePresets({ ... })` call, assigned to `presets`.

Inside the moved code, `dockLayout` is `dock.layout`, the Dock fields come from `useDock()`, and
`loudnessProfile` comes from `useLoudnessProfile()`, as destructured in the shell.

```jsx
import { createContext, useCallback, useContext, useMemo } from "react";
import { usePresets } from "./usePresets.js";
import { useLoudnessProfile } from "./LoudnessProfileContext.jsx";
import { useSceneGuard } from "./SceneGuardContext.jsx";
import { syncSurfaceOpacityWindowShadow } from "./useSurfaceOpacityWindowShadow.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { useMeterDisplayState, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { supportsDockMode } from "../lib/platform.js";
import { errorDetails } from "../lib/errorDetails.js";
import {
  SCENE_OPERATIONS,
  isSceneOperationRefused,
  sceneOperationUnavailableReason,
} from "../lib/sceneOperations.js";

const PresetsContext = createContext(
  /** @type {import("./usePresets.js").PresetsApi | null} */ (null)
);

/**
 * The preset library and the hand-off that applies a preset's Dock state.
 *
 * Enclosed by everything a preset captures or replaces -- workspace, view settings, Dock, loudness
 * profile -- and by the scene guard, so Apply, Save and Update are refused in the business function
 * whichever entry point calls them.
 */
export function PresetsProvider({ children }) {
  const { sourceMode } = useMeterRuntime();
  const { clearNotice, raiseNotice, setSelectedOffset } = useMeterDisplayState();
  const { activeBlockingEditors, assertSceneOperationAllowed } = useSceneGuard();
  const loudnessProfile = useLoudnessProfile();
  const {
    windowPinned: pinned,
    setWindowPinned: setPinnedStored,
    focusView,
    setFocusView,
    surfaceOpacity,
    setSurfaceOpacity: setSurfaceOpacityStored,
    glassEnabled,
    setGlassEnabled: setGlassEnabledStored,
  } = useAppSettings();
  const {
    dockEnabled,
    dockEdge,
    dockMonitor,
    dockHeight,
    reserveSpace,
    enterDockMode,
    setReserveSpace,
    resizeDockHeight,
    exitDockRestoringAttributes,
    layout: dockLayout,
  } = useDock();

  // (moved declarations 1 to 4 go here, in order)

  return <PresetsContext.Provider value={presets}>{children}</PresetsContext.Provider>;
}

export function usePresetLibrary() {
  const presets = useContext(PresetsContext);
  if (!presets) throw new Error("usePresetLibrary must be used inside PresetsProvider");
  return presets;
}
```

The hook is named `usePresetLibrary` because `usePresets` is the owner hook it wraps.

Run: `npx vitest run src/hooks/PresetsContext.test.jsx`
Expected: PASS. If the second test fails because `save` resolves instead of rejecting, the guard
moved out of the business function during the move: restore `assertSceneOperationAllowed` in the
`usePresets` arguments.

- [ ] **Step 3: Use the owner in `App.jsx`**

- In `App`, nest `<PresetsProvider>` directly inside `<WindowChromeProvider>`.
- In `AppContent`, replace the moved block with `const presets = usePresetLibrary();`.
- Remove the imports the move left unused, and the destructured settings setters that only
  `usePresets` used (`setPinnedStored`, `setFocusView`, `setSurfaceOpacityStored`,
  `setGlassEnabledStored`).

- [ ] **Step 4: Move the Presets and library wiring of Agent Control into the bridge component**

In `src/agentControl/AgentControlBridge.jsx`, read the owners and stop taking these as props:

```jsx
const presets = usePresetLibrary();
const loudnessProfile = useLoudnessProfile();
const settings = useAppSettings();
```

Pass to the hook:

```jsx
presets,
loudnessProfile,
hasLoudnessReference: Number.isFinite(loudnessProfile.referenceLufs),
customThemes: settings.customThemes,
theme: { control: settings.themeControl, state: settings.themeControl.readState() },
```

Add `"presets" | "loudnessProfile" | "hasLoudnessReference" | "customThemes" | "theme"` to the
`Omit` in the props type and delete those five keys from `agentControlBridgeProps` in `AppContent`.

In `src/agentControl/AgentControlBridge.test.jsx`, add mocks for the three hooks:

```jsx
vi.mock("../hooks/PresetsContext.jsx", () => ({
  usePresetLibrary: () => ({ list: [], activeId: null, dirty: false }),
}));
vi.mock("../hooks/LoudnessProfileContext.jsx", () => ({
  useLoudnessProfile: () => ({ profiles: [], active: "off", referenceLufs: null }),
}));
vi.mock("../settings/SettingsContext.jsx", () => ({
  useAppSettings: () => ({
    customThemes: {},
    themeControl: { readState: () => ({ appearance: {}, themes: [] }) },
  }),
}));
```

and the expectations:

```jsx
expect(passed.presets).toMatchObject({ activeId: null });
expect(passed.hasLoudnessReference).toBe(false);
expect(passed.theme.state).toEqual({ appearance: {}, themes: [] });
```

- [ ] **Step 5: Verify and commit**

Run Recipe V with `<label>` = `task07`. Before stopping the app, check by hand: save a preset,
change a panel, the footer shows the preset name with `*`; apply the preset, the `*` clears; open
the Theme Editor and try to apply a preset, it is refused with a notice; Cancel the editor.

```bash
npm run --silent desktop:control -- preset list --json
```

Expected: `"ok":true`.

```bash
git add src/hooks/PresetsContext.jsx src/hooks/PresetsContext.test.jsx src/agentControl/AgentControlBridge.jsx src/agentControl/AgentControlBridge.test.jsx src/App.jsx
git commit -m "refactor(presets): give the preset library one owner" -m "usePresets took fifteen values from AppContent because it could not reach the view settings, the Dock or the loudness profile itself. It now mounts in a provider those owners enclose, and Agent Control reads presets, the loudness profile and themes from their owners." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Source owner

**Files:**

- Create: `src/runtime/SourceContext.jsx`, `src/runtime/SourceContext.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/runtime/SourceContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MeterRuntimeProvider } from "./MeterRuntimeContext.jsx";
import { SourceProvider, useSource } from "./SourceContext.jsx";

function wrapper({ children }) {
  return (
    <MeterRuntimeProvider>
      <SourceProvider>{children}</SourceProvider>
    </MeterRuntimeProvider>
  );
}

describe("SourceProvider", () => {
  it("reports no connected source in a browser build", () => {
    const { result } = renderHook(() => useSource(), { wrapper });

    expect(result.current.selectedSource).toBeNull();
    expect(result.current.sourceDisplayName).toBeNull();
    expect(result.current.footerSourceLabel).toBe("Not connected");
    expect(result.current.captureFormatSignature).toBe("");
    expect(result.current.audioOutputs).toEqual([]);
    expect(result.current.audioInputs).toEqual([]);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useSource())).toThrow(
      "useSource must be used inside SourceProvider"
    );
  });
});
```

Run: `npx vitest run src/runtime/SourceContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Create the owner**

Create `src/runtime/SourceContext.jsx` with this shell, then **move verbatim** into
`SourceProvider`, in this order, from `AppContent`:

1. the `useAudioDevices({ ... })` call with its destructuring, assigned to `devices` and
   destructured from it as shown;
2. `audioOutputs`, `audioInputs`;
3. `onSelectCaptureDevice`;
4. `captureFormatSignature`;
5. `selectedSource`, `sourceDisplayName`;
6. `previousDefaultOutputLabelRef` and the default-output notice effect with its comment;
7. `footerSourceLabel`.

```jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useAudioDevices } from "../hooks/useAudioDevices.js";
import { automaticOutputChangeNotice } from "../lib/captureHealth.js";
import { errorDetails } from "../lib/errorDetails.js";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { isTauri } from "../ipc/env.js";
import { useMeterDisplayState, useMeterRuntime } from "./MeterRuntimeContext.jsx";

/**
 * @typedef {ReturnType<typeof useAudioDevices> & {
 *   audioOutputs: any[],
 *   audioInputs: any[],
 *   onSelectCaptureDevice: (deviceId: string) => Promise<void>,
 *   captureFormatSignature: string,
 *   selectedSource: { type: string, label: string } | null,
 *   sourceDisplayName: string | null,
 *   footerSourceLabel: string,
 * }} SourceOwner
 */
const SourceContext = createContext(/** @type {SourceOwner | null} */ (null));

/** The capture source: the device inventory, the selection, and the labels derived from it. */
export function SourceProvider({ children }) {
  const meterRuntime = useMeterRuntime();
  const { sourceMode, running, beginDeviceRestartForControl } = meterRuntime;
  const { clearNotice, raiseNotice } = useMeterDisplayState();

  // (moved declarations 1 to 7 go here, in order)
  // const devices = useAudioDevices({ liveLifecycle: meterRuntime.liveLifecycle, beginDeviceRestartForControl });
  // const { audioDevices, captureApplications, captureDeviceId, selectCaptureDevice,
  //         defaultOutputFormatSig, defaultOutputLabel } = devices;

  return (
    <SourceContext.Provider
      value={{
        ...devices,
        audioOutputs,
        audioInputs,
        onSelectCaptureDevice,
        captureFormatSignature,
        selectedSource,
        sourceDisplayName,
        footerSourceLabel,
      }}
    >
      {children}
    </SourceContext.Provider>
  );
}

export function useSource() {
  const source = useContext(SourceContext);
  if (!source) throw new Error("useSource must be used inside SourceProvider");
  return source;
}
```

Run: `npx vitest run src/runtime/SourceContext.test.jsx`
Expected: PASS.

- [ ] **Step 3: Use the owner in `App.jsx`**

- In `App`, nest `<SourceProvider>` directly inside `<PresetsProvider>`.
- In `AppContent`, where `useAudioDevices` was:

```jsx
const {
  snapshot: audioDeviceSnapshot,
  audioDevices,
  captureApplications,
  captureDeviceId,
  safeAudioDeviceId,
  commitCaptureDevice,
  previewSelection,
  refreshInventory,
  defaultOutputLabel,
  audioOutputs,
  audioInputs,
  onSelectCaptureDevice,
  captureFormatSignature,
  sourceDisplayName,
  footerSourceLabel,
} = useSource();
```

- Remove the imports the move left unused.

`agentControlDevice` stays in `AppContent` for now: it needs `updateBusy`, which gains an owner in
Task 10.

- [ ] **Step 4: Verify and commit**

Run Recipe V with `<label>` = `task08`. Before stopping the app, check by hand: the Sources menu
lists outputs, inputs and applications; selecting another device changes the footer's Source label.

```bash
npm run --silent desktop:control -- device inspect --json
```

Expected: `"ok":true`.

```bash
git add src/runtime/SourceContext.jsx src/runtime/SourceContext.test.jsx src/App.jsx
git commit -m "refactor(source): give the capture source one owner" -m "The device inventory, the selection and the labels derived from it move from AppContent into a provider beside the metering runtime." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Source actions owner

**Files:**

- Create: `src/workspace/useSharedTimeViewport.js`, `src/workspace/useSharedTimeViewport.test.jsx`
- Create: `src/runtime/SourceActionsContext.jsx`, `src/runtime/SourceActionsContext.test.jsx`
- Modify: `src/agentControl/AgentControlBridge.jsx`, `src/agentControl/AgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Extract the shared time viewport hook, test first**

Create `src/workspace/useSharedTimeViewport.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { presetsStore, workspaceStore } from "../persistence/index.js";
import { WorkspaceProvider, useWorkspaceStore } from "./WorkspaceContext.jsx";
import { useSharedTimeViewport } from "./useSharedTimeViewport.js";

function wrapper({ children }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

describe("useSharedTimeViewport", () => {
  beforeEach(() => {
    localStorage.clear();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("writes the window and the offset to the workspace's shared time axis", () => {
    const { result } = renderHook(
      () => ({ viewport: useSharedTimeViewport(), workspace: useWorkspaceStore().state }),
      { wrapper }
    );

    act(() => result.current.viewport.setHistoryWindowSec(120));
    act(() => result.current.viewport.setHistoryOffsetSec((offset) => offset + 5));

    expect(result.current.viewport.sharedTimeViewport).toMatchObject({
      windowSec: 120,
      offsetSec: 5,
    });
    expect(result.current.workspace.axisViewports.time).toMatchObject({
      windowSec: 120,
      offsetSec: 5,
    });
  });

  it("applies two updates made before a render to the latest value", () => {
    const { result } = renderHook(() => useSharedTimeViewport(), { wrapper });

    act(() => {
      result.current.setHistoryWindowSec(90);
      result.current.setHistoryOffsetSec(7);
    });

    expect(result.current.sharedTimeViewport).toMatchObject({ windowSec: 90, offsetSec: 7 });
  });
});
```

Run: `npx vitest run src/workspace/useSharedTimeViewport.test.jsx`
Expected: FAIL, the module does not exist.

Create `src/workspace/useSharedTimeViewport.js`, **moving verbatim** from `AppContent` the
`sharedTimeViewport` `useMemo`, `sharedTimeViewportRef`, its sync effect, `setHistoryWindowSec`
and `setHistoryOffsetSec`:

```js
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { normalizeAxisViewport } from "./axisViewports.js";

/**
 * The workspace's shared time axis as a window and an offset, with setters that accept a value or
 * an updater. Owns no state: it reads and writes the Workspace context, so any component may call
 * it.
 */
export function useSharedTimeViewport() {
  const { state: workspaceState, setAxisViewport } = useWorkspaceStore();

  // (moved declarations go here, in order)

  return { sharedTimeViewport, setHistoryWindowSec, setHistoryOffsetSec };
}
```

Run: `npx vitest run src/workspace/useSharedTimeViewport.test.jsx`
Expected: PASS.

In `AppContent`, replace the moved block with:

```jsx
const { sharedTimeViewport, setHistoryWindowSec, setHistoryOffsetSec } = useSharedTimeViewport();
```

and drop `setAxisViewport` from the `useWorkspaceStore()` destructuring if nothing else uses it.

- [ ] **Step 2: Write the failing test for the source actions owner**

Create `src/runtime/SourceActionsContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { WorkspaceProvider } from "../workspace/WorkspaceContext.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "../hooks/LoudnessProfileContext.jsx";
import { SettingsProvider, useAppSettings } from "../settings/SettingsContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { MeterRuntimeProvider, useMeterRuntime } from "./MeterRuntimeContext.jsx";
import { SourceActionsProvider, useSourceActions } from "./SourceActionsContext.jsx";

function wrapper({ children }) {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SourceActionsProvider>{children}</SourceActionsProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

describe("SourceActionsProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("binds the settings owner's clear ref to its clear action", () => {
    const { result } = renderHook(
      () => ({ actions: useSourceActions(), settings: useAppSettings() }),
      { wrapper }
    );

    expect(result.current.settings.onClearRef.current).toBe(result.current.actions.clearAll);
  });

  it("bumps both reset epochs when a clear succeeds", async () => {
    const { result } = renderHook(
      () => ({ actions: useSourceActions(), runtime: useMeterRuntime() }),
      { wrapper }
    );
    const before = result.current.actions.vectorscopeResetEpoch;

    act(() => result.current.runtime.startLive());
    await act(() => result.current.actions.clearAll());

    expect(result.current.actions.vectorscopeResetEpoch).toBe(before + 1);
    expect(result.current.actions.stereoMapResetEpoch).toBe(before + 1);
  });

  it("describes the dialogue settings a file analysis should run with", () => {
    const { result } = renderHook(() => useSourceActions(), { wrapper });
    const { dialogue } = result.current.currentFileAnalysisSettings();

    expect(dialogue.enabled).toBe(result.current.dialogueGating);
    expect(dialogue.engine === null).toBe(!result.current.dialogueGating);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useSourceActions())).toThrow(
      "useSourceActions must be used inside SourceActionsProvider"
    );
  });
});
```

Run: `npx vitest run src/runtime/SourceActionsContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Create the owner**

Create `src/runtime/SourceActionsContext.jsx` with this shell, then **move verbatim** into
`SourceActionsProvider`, in this order, from `AppContent`:

1. the two reset-epoch `useState` declarations;
2. `const fileSession = activeFileSession ?? EMPTY_FILE_SESSION;` together with the module-level
   `EMPTY_FILE_SESSION` constant;
3. the `dialogueGating` derivation
   (`const { dialogueGating } = useMemo(() => deriveDialogueRuntime(workspaceState), [workspaceState]);`);
4. `currentFileAnalysisSettings`;
5. the `useFileAnalysisReportExport({ ... })` call;
6. the `useSourceTransportActions({ ... })` call, assigned to `actions` without destructuring;
7. `onClearRef.current = actions.clearAll;`
8. `useDialogueEngineRestart(dialogueVadEngine, dialogueGating, onClearRef);`

`APP_VERSION` moves with declaration 5: import `packageInfo` from `../../package.json` here and
keep the constant in `App.jsx` as well while `AppSettingsOverlays` still receives it from there.

```jsx
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import packageInfo from "../../package.json";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useSharedTimeViewport } from "../workspace/useSharedTimeViewport.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { useFileAnalysisReportExport } from "../hooks/useFileAnalysisReportExport.js";
import { useSourceTransportActions } from "../hooks/useSourceTransportActions.js";
import { useDialogueEngineRestart } from "../hooks/useDialogueEngineRestart.js";
import { deriveDialogueRuntime } from "./appRuntimeDerivations.js";
import { useMeterDisplayState, useMeterRuntime } from "./MeterRuntimeContext.jsx";

const APP_VERSION = packageInfo.version;
const EMPTY_FILE_SESSION = Object.freeze({ state: "empty" });

/**
 * @typedef {ReturnType<typeof useSourceTransportActions> & {
 *   fileSession: any,
 *   dialogueGating: boolean,
 *   currentFileAnalysisSettings: () => { dialogue: { enabled: boolean, engine: any } },
 *   exportFileAnalysisReport: (...args: any[]) => any,
 *   copyFileAnalysisReportMarkdown: (...args: any[]) => any,
 *   vectorscopeResetEpoch: number,
 *   stereoMapResetEpoch: number,
 * }} SourceActions
 */
const SourceActionsContext = createContext(/** @type {SourceActions | null} */ (null));

/**
 * What the user does to the active source: start and stop, clear, and the file actions.
 *
 * Assigns the settings owner's clear ref during render. The clear shortcut is registered out there
 * and the action lives in here; see `SettingsProvider`.
 */
export function SourceActionsProvider({ children }) {
  const { state: workspaceState } = useWorkspaceStore();
  const { setHistoryWindowSec, setHistoryOffsetSec } = useSharedTimeViewport();
  const {
    sourceMode,
    running,
    activeFileSession,
    startLive,
    stopLive,
    switchSource,
    clearActiveSource,
    beginFileAnalysis: beginRuntimeFileAnalysis,
    reanalyzeFile,
    selectFile,
    removeFile,
    clearFiles,
    stopFileAnalysis,
  } = useMeterRuntime();
  const { selectedOffset, setSelectedOffset, raiseNotice } = useMeterDisplayState();
  const settings = useAppSettings();
  const { onClearRef, dialogueVadEngine } = settings;
  const loudnessProfile = useLoudnessProfile();

  // (moved declarations 1 to 8 go here, in order)

  return (
    <SourceActionsContext.Provider
      value={{
        ...actions,
        fileSession,
        dialogueGating,
        currentFileAnalysisSettings,
        exportFileAnalysisReport,
        copyFileAnalysisReportMarkdown,
        vectorscopeResetEpoch,
        stereoMapResetEpoch,
      }}
    >
      {children}
    </SourceActionsContext.Provider>
  );
}

export function useSourceActions() {
  const actions = useContext(SourceActionsContext);
  if (!actions) throw new Error("useSourceActions must be used inside SourceActionsProvider");
  return actions;
}
```

Inside `currentFileAnalysisSettings`, `settings.dialogueVadEngine` keeps reading from `settings`.

Run: `npx vitest run src/runtime/SourceActionsContext.test.jsx`
Expected: PASS.

- [ ] **Step 4: Use the owner in `App.jsx`**

- In `App`, nest `<SourceActionsProvider>` directly inside `<SourceProvider>`.
- In `AppContent`, where `useSourceTransportActions` was:

```jsx
const {
  fileSession,
  dialogueGating,
  currentFileAnalysisSettings,
  exportFileAnalysisReport,
  copyFileAnalysisReportMarkdown,
  vectorscopeResetEpoch,
  stereoMapResetEpoch,
  clearAll,
  openFile,
  onSelectFile,
  onStopFile,
  onReanalyzeFile,
  onRemoveFile,
  onClearAllFiles,
  handleDropFile,
  onStartClick,
  onSourceTransportAction,
  onSourceModeChange,
} = useSourceActions();
```

Move this destructuring up to the first place any of these names is used (the `fileSession`
line): the values no longer depend on anything computed in `AppContent`.

- `AppContent` keeps reading `onClearRef` from `settings` for `applyAgentControlSettings`.
- Remove the imports the move left unused.

- [ ] **Step 5: Move the Transport wiring of Agent Control into the bridge component**

In `src/agentControl/AgentControlBridge.jsx`, **move verbatim** from `AppContent`:

1. `executeAgentControlTransport`;
2. the `agentControlTransport` `useMemo`.

They read the owners directly:

```jsx
const meterRuntime = useMeterRuntime();
const { selectedOffset } = useMeterDisplayState();
const { captureDeviceId } = useSource();
const { currentFileAnalysisSettings } = useSourceActions();
```

with the runtime verbs `executeAgentControlTransport` uses destructured from `meterRuntime`
(`analyzingFileId`, `stopFileAnalysis`, `switchSource`, `stopLiveForControl`, `startLiveForControl`,
`clearLiveForControl`, `beginFileAnalysisForControl`, `reanalyzeFileForControl`, `selectFile`,
`removeFile`, `clearFiles`). Pass to the hook:

```jsx
transport: agentControlTransport,
transportContext: { docked, deviceTransitioning: meterRuntime.liveDeviceTransition !== null },
executeTransport: executeAgentControlTransport,
uiNavigation: useUiNavigation(),
```

Call `useUiNavigation()` once at the top of the component and pass the result; the line above shows
the key, not a hook call inside an object literal. Add
`"transport" | "transportContext" | "executeTransport" | "uiNavigation"` to the `Omit` in the props
type and delete those four keys from `agentControlBridgeProps` in `AppContent`. Delete the
`uiNavigation` local in `AppContent` if `preparePanelSettings` does not use it.

In `src/agentControl/AgentControlBridge.test.jsx`, add:

```jsx
vi.mock("../runtime/MeterRuntimeContext.jsx", () => ({
  useMeterRuntime: () => ({
    sourceMode: "live",
    liveLifecycle: "stopped",
    liveDeviceTransition: null,
    fileSessions: [],
    activeFileId: null,
    analyzingFileId: null,
  }),
  useMeterDisplayState: () => ({ selectedOffset: -1 }),
}));
vi.mock("../runtime/SourceContext.jsx", () => ({
  useSource: () => ({ captureDeviceId: "default" }),
}));
vi.mock("../runtime/SourceActionsContext.jsx", () => ({
  useSourceActions: () => ({
    currentFileAnalysisSettings: () => ({ dialogue: { enabled: false, engine: null } }),
  }),
}));
vi.mock("../uiNavigation/UiNavigationContext.jsx", () => ({
  useUiNavigation: () => ({ inspectUi: () => ({}) }),
}));
```

```jsx
expect(passed.transport).toMatchObject({ source: "live" });
expect(passed.transportContext).toEqual({ docked: false, deviceTransitioning: false });
expect(typeof passed.executeTransport).toBe("function");
```

- [ ] **Step 6: Verify and commit**

Run Recipe V with `<label>` = `task09`. Before stopping the app, check by hand: Start, Stop and
Clear work; the Clear shortcut works; opening a file analyses it and Clear removes it.

```bash
npm run --silent desktop:control -- transport inspect --json
```

Expected: `"ok":true`.

```bash
git add src/workspace/useSharedTimeViewport.js src/workspace/useSharedTimeViewport.test.jsx src/runtime/SourceActionsContext.jsx src/runtime/SourceActionsContext.test.jsx src/agentControl/AgentControlBridge.jsx src/agentControl/AgentControlBridge.test.jsx src/App.jsx
git commit -m "refactor(source): give source actions one owner" -m "Start, stop, clear and the file actions move from AppContent into a provider, which also binds the clear shortcut's late ref. The shared time viewport setters become a hook over the Workspace context, since they own no state. Agent Control builds its Transport area from the owners." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Application lifecycle owner

**Files:**

- Create: `src/hooks/AppLifecycleContext.jsx`, `src/hooks/AppLifecycleContext.test.jsx`
- Modify: `src/agentControl/AgentControlBridge.jsx`, `src/agentControl/AgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/AppLifecycleContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { WorkspaceProvider } from "../workspace/WorkspaceContext.jsx";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "./BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "./LoudnessProfileContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "./SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { WindowChromeProvider } from "./WindowChromeContext.jsx";
import { PresetsProvider } from "./PresetsContext.jsx";
import { SourceProvider } from "../runtime/SourceContext.jsx";
import { SourceActionsProvider } from "../runtime/SourceActionsContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { AppLifecycleProvider, useAppLifecycle } from "./AppLifecycleContext.jsx";

function wrapper({ children }) {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SceneGuardProvider>
                  <DockProvider>
                    <WindowChromeProvider>
                      <PresetsProvider>
                        <SourceProvider>
                          <SourceActionsProvider>
                            <AppLifecycleProvider>{children}</AppLifecycleProvider>
                          </SourceActionsProvider>
                        </SourceProvider>
                      </PresetsProvider>
                    </WindowChromeProvider>
                  </DockProvider>
                </SceneGuardProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

describe("AppLifecycleProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("starts visible, idle and with no dialog open", () => {
    const { result } = renderHook(() => useAppLifecycle(), { wrapper });

    expect(result.current.windowVisible).toBe(true);
    expect(result.current.updateBusy).toBe(false);
    expect(result.current.closeConfirm.dialogOpen).toBe(false);
    expect(result.current.crashReporting.pendingReport ?? null).toBeNull();
    expect(typeof result.current.updateControls.refreshUpdateCheck).toBe("function");
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useAppLifecycle())).toThrow(
      "useAppLifecycle must be used inside AppLifecycleProvider"
    );
  });
});
```

Run: `npx vitest run src/hooks/AppLifecycleContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Create the owner**

Create `src/hooks/AppLifecycleContext.jsx` with this shell, then **move verbatim** into
`AppLifecycleProvider`, in this order, from `AppContent`:

1. `crashReportSetting` and `crashReporting` with the comment above them;
2. the `windowVisible` `useState`, the `useUiNavigationEnvironment({ ... })` call, and the effect
   that reads the initial visibility;
3. `onHideWindow`, `onShowWindow`;
4. the `useUpdateCheck()` and `useApplyUpdate()` calls and `updateBusy`;
5. the `useCloseConfirm({ ... })` call, assigned to `closeConfirm` without destructuring;
6. `onToggleWindow`, with `requestCloseAction` read as `closeConfirm.requestCloseAction`;
7. the effect that exits the Dock when a crash report is pending;
8. `useInstanceIdentity({ sourceLabel: sourceDisplayName, running });`
9. `stopRuntimeForCoordination`, `startRuntimeAfterCoordination` and the
   `useRuntimeCoordination({ ... })` call;
10. the `useTray({ ... })` call, with `onQuit: () => closeConfirm.requestCloseAction("quit")`;
11. the `useAppKeyboardShortcuts({ ... })` call with its comment.

```jsx
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { useMeterDisplayState, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { useSource } from "../runtime/SourceContext.jsx";
import { useSourceActions } from "../runtime/SourceActionsContext.jsx";
import { useRuntimeCoordination } from "../runtime/coordination.js";
import { useUiNavigationEnvironment } from "../uiNavigation/UiNavigationContext.jsx";
import { hideAppWindow, toggleAppWindow } from "../lib/windowVisibility.js";
import { isTauri } from "../ipc/env.js";
import { useSceneGuard } from "./SceneGuardContext.jsx";
import { useWindowChrome } from "./WindowChromeContext.jsx";
import { usePresetLibrary } from "./PresetsContext.jsx";
import { useCrashReportSetting } from "./useCrashReportSetting.js";
import { useCrashReporting } from "./useCrashReporting.js";
import { useUpdateCheck } from "./useUpdateCheck.js";
import { useApplyUpdate } from "./useApplyUpdate.js";
import { useCloseConfirm } from "./useCloseConfirm.js";
import { useInstanceIdentity } from "./useInstanceIdentity.js";
import { useTray } from "./useTray.js";
import { useAppKeyboardShortcuts } from "./useAppKeyboardShortcuts.js";

/**
 * @typedef {{
 *   crashReportSetting: ReturnType<typeof useCrashReportSetting>,
 *   crashReporting: ReturnType<typeof useCrashReporting>,
 *   windowVisible: boolean,
 *   onShowWindow: () => Promise<void>,
 *   updateBusy: boolean,
 *   updateControls: ReturnType<typeof useUpdateCheck> & ReturnType<typeof useApplyUpdate>,
 *   closeConfirm: ReturnType<typeof useCloseConfirm>,
 * }} AppLifecycle
 */
const AppLifecycleContext = createContext(/** @type {AppLifecycle | null} */ (null));

/**
 * The application around the meter: whether the window is shown, the tray, updates, the close
 * dialog, crash reports, and the global shortcuts. Mounts inside every domain those need.
 */
export function AppLifecycleProvider({ children }) {
  const settings = useAppSettings();
  const { setSettingsOpen, clearShortcut, focusView, resolvedTheme } = settings;
  const { docked, suspendDockMode, resumeDockMode, exitDockRestoringAttributes } = useDock();
  const { reveal } = useWindowChrome();
  const { activeBlockingEditors } = useSceneGuard();
  const presets = usePresetLibrary();
  const meterRuntime = useMeterRuntime();
  const { running, analyzingFileId, stopFileAnalysis, stopLiveForControl, startLiveForControl } =
    meterRuntime;
  const { switchSource } = meterRuntime;
  const { showClock } = useMeterDisplayState();
  const {
    audioOutputs,
    audioInputs,
    captureApplications,
    safeAudioDeviceId,
    defaultOutputLabel,
    onSelectCaptureDevice,
    sourceDisplayName,
  } = useSource();
  const { clearAll, onStartClick } = useSourceActions();
  const toggleFocusControls = reveal.toggleControls;

  // (moved declarations 1 to 11 go here, in order)

  return (
    <AppLifecycleContext.Provider
      value={{
        crashReportSetting,
        crashReporting,
        windowVisible,
        onShowWindow,
        updateBusy,
        updateControls: {
          updateInfo,
          refreshUpdateCheck,
          installStatus,
          downloadProgress,
          install,
          restartToApply,
          resetInstall,
        },
        closeConfirm,
      }}
    >
      {children}
    </AppLifecycleContext.Provider>
  );
}

export function useAppLifecycle() {
  const lifecycle = useContext(AppLifecycleContext);
  if (!lifecycle) throw new Error("useAppLifecycle must be used inside AppLifecycleProvider");
  return lifecycle;
}
```

Run: `npx vitest run src/hooks/AppLifecycleContext.test.jsx`
Expected: PASS.

- [ ] **Step 3: Use the owner in `App.jsx`**

- In `App`, nest `<AppLifecycleProvider>` directly inside `<SourceActionsProvider>`.
- In `AppContent`, where `crashReportSetting` was:

```jsx
const {
  crashReportSetting,
  crashReporting,
  windowVisible,
  updateBusy,
  updateControls,
  closeConfirm: {
    dialogOpen: closeDialogOpen,
    closeError,
    closing,
    handleConfirm: handleCloseConfirm,
    handleRetry: handleCloseRetry,
    handleCancel: handleCloseCancel,
  },
} = useAppLifecycle();
```

- Pass `updateControls={updateControls}` to `AppSettingsOverlays` in place of the inline object, and
  read `updateControls.updateInfo?.hasUpdate` for the footer's `hasUpdate`.
- Remove the imports the move left unused.

- [ ] **Step 4: Move the Device wiring of Agent Control into the bridge component**

In `src/agentControl/AgentControlBridge.jsx`, **move verbatim** the `agentControlDevice` `useMemo`
from `AppContent`. It reads `snapshot: audioDeviceSnapshot`, `captureDeviceId`, `previewSelection`
and `commitCaptureDevice` from `useSource()`, `beginDeviceRestartForControl` and the live fields
from `meterRuntime`, and `updateBusy` from `useAppLifecycle()`. Pass `device: agentControlDevice`,
add `"device"` to the `Omit` in the props type, and delete `device` from `agentControlBridgeProps`.

In `src/agentControl/AgentControlBridge.test.jsx`, add:

```jsx
vi.mock("../hooks/AppLifecycleContext.jsx", () => ({
  useAppLifecycle: () => ({ updateBusy: false }),
}));
```

extend the `useSource` mock's return value with
`snapshot: null, previewSelection: async () => {}, commitCaptureDevice: async () => {}`, and add:

```jsx
expect(passed.device).toMatchObject({ runtimeUnavailable: false, snapshot: null });
```

- [ ] **Step 5: Verify and commit**

Run Recipe V with `<label>` = `task10`. Before stopping the app, check by hand: closing the window
shows the close dialog and Cancel dismisses it; the tray menu shows and hides the window; Settings
shows the update section; the Settings keyboard shortcut opens Settings and does nothing while
docked.

```bash
git add src/hooks/AppLifecycleContext.jsx src/hooks/AppLifecycleContext.test.jsx src/agentControl/AgentControlBridge.jsx src/agentControl/AgentControlBridge.test.jsx src/App.jsx
git commit -m "refactor(app): give the application lifecycle one owner" -m "Window visibility, the tray, updates, the close dialog, crash reports, instance identity, runtime coordination and the global shortcuts move from AppContent into a provider enclosed by every domain they read." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Checkpoint

- [ ] **Step 1: Annotate the provider order**

In `App`, add one comment line above each provider added in Tasks 3 to 10 naming what it reads, for
example `{/* Reads Settings and SceneGuard. Encloses WindowChrome, which needs `docked`. */}`. Keep
the two existing comments about `BlockingEditorsProvider` and `DockStats`, correcting the second if
it still says `dockLayout` is a hook in `AppContent`.

- [ ] **Step 2: Measure**

```bash
wc -l src/App.jsx src/agentControl/AgentControlBridge.jsx src/agentControl/useAgentControlBridge.js
```

```bash
grep -c "use[A-Z][A-Za-z]*(" src/App.jsx
```

- [ ] **Step 3: Verify and commit**

Run Recipe V with `<label>` = `task11`.

```bash
git add src/App.jsx
git commit -m "docs(app): state what each provider in the order depends on" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Report to the user and stop**

Report, in Chinese:

- `App.jsx` line count and hook-call count, before (2588 lines, about 148 calls) and after;
- what `AppContent` still owns, by reading what is left: the per-frame data path (`useSnapshot`,
  `useLoudnessHistory`, frame and history records), channel labels and analysis requests, the Dock
  accessories, the Settings executor and the remaining Agent Control records, and the props
  assembly;
- every Recipe V result, including any path added to the snapshot ignore list in Task 0;
- anything found that the spec's effect audit did not predict;
- that Stage 2 has no plan yet and needs the user's decision before one is written.

Do not start Stage 2.

---

## Self-review

Spec coverage, Stage 1 only:

| Spec item                                                       | Task     |
| --------------------------------------------------------------- | -------- |
| Migration step 1, baseline                                      | 0        |
| Migration step 2, low-rate display context and bridge component | 1, 2     |
| Migration step 3, Settings with stored pin, SceneGuard          | 3, 4     |
| Migration step 4, Dock                                          | 5        |
| Migration step 5, WindowChrome                                  | 6        |
| Migration step 6, Presets                                       | 7        |
| Migration step 7, Source, SourceActions, AppLifecycle           | 8, 9, 10 |
| Checkpoint                                                      | 11       |
| Rule 4, same-window effects in one component in order           | 6        |
| Rule 8, named JSDoc type per context                            | 1, 3–10  |
| Late-bound clear action                                         | 3, 9     |
| Scene guard stays inside the business function                  | 4, 7     |
| Agent Control props removed per domain                          | 5–10     |
| Verification per commit                                         | Recipe V |

Deliberately left for Stage 2: `applyAgentControlSettings` and the settings, analysis, measurement
and visual records of Agent Control; `agentControlEnabled` and the visual capability state; the
Dock accessories; channel labels and analysis requests; the frame-rate split; shell containers; the
bridge file split; living documentation.

Names used across tasks: `useMeterDisplayState`, `useAppSettings`, `useSceneGuard`, `useDock`,
`useWindowChrome`, `usePresetLibrary`, `useSource`, `useSharedTimeViewport`, `useSourceActions`,
`useAppLifecycle`. Context fields referenced by a later task are defined in the task that creates
them: `windowPinned` and `setWindowPinned` (3), `layout`, `historyViewport`,
`exitDockRestoringAttributes` and `executeDockForControl` (5), `view`, `applyViewState` and
`reveal` (6), `currentFileAnalysisSettings` and `clearAll` (9), `updateBusy` (10).
