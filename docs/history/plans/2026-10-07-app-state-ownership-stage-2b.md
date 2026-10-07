# App State Ownership — Implementation Plan (Stage 2, part B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Dock accessory windows one owner and let Agent Control read visual capture
itself, so `AgentControlBridge` takes no props from `AppContent`.

**Architecture:** The transport pill's state joins the display snapshot, because the accessory
header shows it and a provider cannot read `AppContent`. `DockAccessoriesProvider` then owns
accessory visibility, the accessory bridge and its action dispatcher. A small
`AgentControlStateProvider` holds the three pieces of Agent Control state that the shell also needs.
Nothing changes when anything re-renders.

**Tech stack:** React 19, JavaScript with JSDoc types checked by `tsc`, Vitest + jsdom, Tauri 2,
Agent Control CLI for verification.

**Spec:** `docs/history/specs/2026-10-06-app-state-ownership-design.md`
**Previous plans:** `docs/history/plans/2026-10-06-app-state-ownership.md` (stage 1) and
`docs/history/plans/2026-10-07-app-state-ownership-stage-2a.md` (stage 2 part A); both complete.

---

## Delivery rules

The delivery rules, the move convention and the coverage rule of the stage 1 plan apply unchanged,
and so does the rule of part A: nothing here may change render frequency.

Verification for every task, before its commit:

```bash
npm run check
```

```bash
bash artifacts/app-state/recipe.sh <label>
```

```bash
bash artifacts/app-state/dock-walk.sh <label>
```

Expected: `identical apart from revision`; `pixel compare (empty)` exits 0; and the Dock walk
reports every image identical to its reference. The first two scripts exist from stage 1. The third
is written in Task 0.

The RDP session must stay attached while a task is verified. In a detached session the screenshot
size changes, the Settings drawer screenshot is unstable and recording fails; all three were seen
on known-good code during part A.

After editing `src/App.jsx`, remove what the move left unused:

```bash
node artifacts/app-state/drop-unused.cjs src/App.jsx
```

## File map

| File                                            | Status | Responsibility                                                            |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `src/runtime/DisplaySnapshotContext.jsx`        | modify | Also derives the transport pill's state                                   |
| `src/dock/DockAccessoriesContext.jsx`           | create | Accessory visibility, accessory bridge, action dispatcher, visual runtime |
| `src/agentControl/AgentControlStateContext.jsx` | create | Runtime descriptor, enabled flag, platform capabilities, recording state  |
| `src/agentControl/settleDockAccessory.js`       | create | Waits for a Dock accessory to be paintable before a capture               |
| `src/agentControl/AgentControlBridge.jsx`       | modify | Builds the visual area; takes no props                                    |
| `src/App.jsx`                                   | modify | Loses each moved cluster                                                  |
| `docs/architecture.md`                          | modify | Owner table and closing paragraph of "Frontend state ownership"           |

A test file sits beside each created file.

---

## Task 0: Dock reference capture

The stage 1 walkthrough never enters the Dock, so it cannot see the accessory windows this plan
moves. This task adds a second capture that does, and proves it is reproducible before any code
changes.

**Files:**

- Create (untracked): `artifacts/app-state/dock-walk.sh`

- [ ] **Step 1: Write the capture script**

Create `artifacts/app-state/dock-walk.sh`:

```bash
#!/usr/bin/env bash
# Cold-starts the dev app on an isolated profile, enters the Dock, opens a Dock panel's settings
# through UI navigation, and screenshots the strip and the editor accessory.
# Usage: dock-walk.sh <label>     (label "dock-ref" captures the reference and compares nothing)
set -u
label=$1
cd /c/Users/shenxichen/repos/PLVS || exit 1
A=artifacts/app-state
out="$A/$label-dock"
dev_pids() {
  powershell -NoProfile -Command "(Get-Process plvs -ErrorAction SilentlyContinue | Where-Object { \$_.Path -like '*target\\debug\\plvs.exe' }).Id" | tr -d '\r'
}
stop_app() { for pid in $(dev_pids); do taskkill //PID "$pid" //T //F >/dev/null 2>&1; done; }
ctl() { npm run --silent desktop:control -- "$@"; }
field() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(!r.ok){console.error('FAILED '+r.error.code+': '+r.error.message);process.exit(1)}console.log(eval('r.result'+process.argv[1]))})" "$1"; }
rev() { ctl inspect --json | field ".revision"; }
gen() { ctl ui inspect --json | field ".uiGeneration"; }

stop_app; sleep 2
DATA_WIN="$(cygpath -w "$TEMP/plvs-app-state")\\data-$label-dock"
rm -rf "$(cygpath -u "$DATA_WIN")" "$out"
mkdir -p "$out"
export PLVS_TEST_IDENTITY_ROOT="$DATA_WIN\\multi-instance"
npm run desktop -- -- -- --plvs-test-app-data-root "$DATA_WIN" >"$out/app.log" 2>&1 &
for _ in $(seq 1 120); do
  if ctl inspect --json 2>/dev/null | grep -q '"ok":true'; then break; fi
  sleep 3
done
sleep 5

ctl dock enter --edge top --json --expected-revision "$(rev)" | field ".changed" >/dev/null
sleep 3
powershell -NoProfile -ExecutionPolicy Bypass -File "$A/winstate.ps1" -Park >/dev/null
panel=$(ctl dock inspect --json | field ".dock.panels.find((p)=>p.moduleId==='spectrum').id")
echo "dock panel: $panel"
ctl visual screenshot --target main --out "$out/strip.png" --json | field ".artifact?.kind ?? 'ok'" >/dev/null
surface=$(ctl ui show panel-settings --panel-id "$panel" --expected-revision "$(rev)" --expected-ui-generation "$(gen)" --json | field ".surface.surfaceId")
echo "surface: $surface"
sleep 2
ctl visual describe --json >"$out/describe.json"
ctl visual screenshot --target dock-editor --out "$out/editor.png" --json | field ".artifact?.kind ?? 'ok'" >/dev/null
ctl visual screenshot --target main --out "$out/strip-editor-open.png" --json | field ".artifact?.kind ?? 'ok'" >/dev/null
ctl ui close "$surface" --expected-revision "$(rev)" --expected-ui-generation "$(gen)" --json | field ".changed ?? true" >/dev/null
sleep 1
ctl ui inspect --json | field ".surfaces.length" | sed 's/^/surfaces after close: /'
ctl dock exit --json --expected-revision "$(rev)" | field ".changed" >/dev/null
sleep 2
powershell -NoProfile -ExecutionPolicy Bypass -File "$A/winstate.ps1"
stop_app; sleep 3

ls "$out"/*.png | sed 's/.*\///'
if [ "$label" != dock-ref ]; then
  npm run --silent ui:compare -- --before "$A/dock-ref-dock" --after "$out" --out-dir "$out/diff" >"$out/compare.log" 2>&1
  echo "dock pixel compare exit: $?"
  node -e "const r=require('./$out/diff/report.json');for(const i of Object.values(r).find(Array.isArray))console.log('  ',i.path,i.status,i.changedPixels??'')"
fi
```

If a command's result shape differs from what a `field` expression expects, correct the expression
in the script; the shapes are in `docs/agent-control/generated/commands.md`. The sequence itself
(enter, navigate, three screenshots, close, exit) is the contract.

- [ ] **Step 2: Capture the reference and prove it reproducible**

On the unmodified checkout:

```bash
bash artifacts/app-state/dock-walk.sh dock-ref
```

```bash
bash artifacts/app-state/dock-walk.sh dock-ref2
```

Expected from the second run: three images, all `identical`, `surfaces after close: 0`, and the
window rectangle after exit equal to the default (`rect=254,87,2686,1662` on this machine).

If an image differs between the two runs of the same code, find out why before continuing (pointer
hover, an animation, a timestamp in the strip). Remove the cause from the capture, or drop that one
image from the gate and say so in the Task 4 report. Do not start Task 1 with an unexplained
difference.

No commit. Nothing tracked changed.

---

## Task 1: Transport state joins the display snapshot

The accessory header shows the transport pill, whose state `AppContent` derives per frame. It is a
"what is shown right now" value like the rest of the display snapshot.

**Files:**

- Modify: `src/runtime/DisplaySnapshotContext.jsx`, `src/runtime/DisplaySnapshotContext.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Extend the test first**

`DisplaySnapshotProvider` will read the source actions, so the test needs their providers. Replace
the test's render tree with one that nests, outermost first, `WorkspaceProvider`,
`MeterRuntimeProvider`, `BlockingEditorsProvider`, `UiNavigationProvider`,
`LoudnessProfileProvider`, `SettingsProvider`, `SourceActionsProvider`, `DisplaySnapshotProvider`,
and add to the `describe` block:

```jsx
beforeEach(() => {
  localStorage.clear();
  stubMatchMedia();
  settingsStore.reset();
  workspaceStore.reset();
  presetsStore.reset();
});
```

with the imports that needs (`beforeEach` from `vitest`, the three stores from
`../persistence/index.js`, `stubMatchMedia` from `../testing/matchMedia.js`, and each provider from
its module). Add a `useMeterRuntime()` read to `Probe`, stored as `runtime`, and this test:

```jsx
it("describes the transport pill: ready, then running", () => {
  // (render as in the first test, with Probe also capturing `runtime`)
  expect(snapshot.sourceTransportState).toMatchObject({
    sourceLabel: "Live",
    statusLabel: "Ready",
    actionKind: "startLive",
  });

  act(() => runtime.startLive());

  expect(snapshot.sourceTransportState).toMatchObject({
    chromeState: "live",
    actionKind: "stopLive",
  });
});
```

Run: `npx vitest run src/runtime/DisplaySnapshotContext.test.jsx`
Expected: FAIL, `sourceTransportState` is undefined.

- [ ] **Step 2: Move the derivation**

In `src/runtime/DisplaySnapshotContext.jsx`, read what the derivation needs:

```jsx
const { sourceMode, running, analyzingFileSession } = useMeterRuntime();
const { selectedOffset, selectedSnapshotTimeMs } = useMeterDisplayState();
const { fileSession } = useSourceActions();
const { elapsedMsRef } = display.clock;
```

then **move verbatim** from `AppContent`, after the `useSnapshot` call and in this order:

1. `selectedMediaTimeMs` with its comment (it reads `snapshot.targetTimestampMs`; destructure
   `targetTimestampMs` and `histSourceList` from `snapshot` next to `displayAudio`);
2. the `latestTimestampMs` `useMemo` with its comments;
3. the `deriveSourceTransportState({ ... })` call.

Publish it: `value={{ ...snapshot, channelCount, sourceTransportState }}`, and extend the typedef to
`ReturnType<typeof useSnapshot> & { channelCount: number, sourceTransportState: ReturnType<typeof deriveSourceTransportState> }`.

Update the provider's doc comment: it now reads SourceActions as well as MeterRuntime.

Run: `npx vitest run src/runtime/DisplaySnapshotContext.test.jsx`
Expected: PASS.

- [ ] **Step 3: Use it in `App.jsx`**

Add `sourceTransportState` to the `useDisplaySnapshot()` destructuring in `AppContent`. In `App`,
change the comment above `<DisplaySnapshotProvider>` to
`{/* Reads MeterRuntime and SourceActions. Its value changes per meter frame. */}`.

- [ ] **Step 4: Verify and commit**

Run the verification with `<label>` = `s2b-task1`.

```bash
git add src/runtime/DisplaySnapshotContext.jsx src/runtime/DisplaySnapshotContext.test.jsx src/App.jsx
git commit -m "refactor(runtime): derive the transport pill's state with the display snapshot" -m "The Dock accessory header shows the transport pill, and its owner cannot read AppContent. The state is a per-frame 'what is shown now' value, so it joins the display snapshot." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Dock accessories owner

**Files:**

- Create: `src/dock/DockAccessoriesContext.jsx`, `src/dock/DockAccessoriesContext.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/dock/DockAccessoriesContext.test.jsx`. Its wrapper nests every provider of `App` in
order, outermost first: `WorkspaceProvider`, `MeterRuntimeProvider`, `BlockingEditorsProvider`,
`UiNavigationProvider`, `LoudnessProfileProvider`, `SettingsProvider`, `SceneGuardProvider`,
`DockProvider`, `WindowChromeProvider`, `PresetsProvider`, `SourceProvider`,
`SourceActionsProvider`, `AppLifecycleProvider`, `DisplaySnapshotProvider`,
`AnalysisSessionProvider`, `DockAccessoriesProvider`. Use the same `beforeEach` as Task 1.

```jsx
describe("DockAccessoriesProvider", () => {
  // beforeEach as in Task 1

  it("reports no accessory and the normal-form capture targets when not docked", () => {
    const { result } = renderHook(() => useDockAccessories(), { wrapper });

    expect(result.current.visibility.editorView).toBeNull();
    expect(result.current.hoveredDockPanelId).toBeNull();
    expect(result.current.visualRuntimeRef.current).toMatchObject({
      windowForm: "normal",
      sourceMode: "live",
      availableScreenshotTargets: ["main", "workspace", "panel"],
      availableAudioSources: ["none", "measuredSource"],
    });
    expect(result.current.visualRuntimeRef.current.accessoryGeometry.dockEditor.visible).toBe(
      false
    );
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useDockAccessories())).toThrow(
      "useDockAccessories must be used inside DockAccessoriesProvider"
    );
  });
});
```

Run: `npx vitest run src/dock/DockAccessoriesContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Create the owner**

Create `src/dock/DockAccessoriesContext.jsx` with this shell, then **move verbatim** into
`DockAccessoriesProvider`, in this order, from `AppContent`:

1. `onDockAccessoryError`;
2. the `useDockAccessoryVisibility({ ... })` call, assigned to `dockAccessoryVisibility`;
3. `preparePanelSettings` and the `useUiNavigationTarget("panelSettings", ...)` call;
4. `dockPanelSettingsView`, `dockPanelSettingsId`, `dockPanelSettingsActive` and the
   `useUiSurface({ ... })` call;
5. the `visualRuntimeRef.current = { ... }` assignment;
6. the `hoveredDockPanelId` `useState`;
7. `dockHeaderState`, `dockEditorState`;
8. `onDockAccessoryAction`;
9. the `useDockAccessoryBridge({ ... })` call.

Inside the moved code: `reportSceneError(error, a, b)` becomes
`reportSceneOperationError(raiseNotice, error, a, b)` and its entry in the dependency list becomes
`raiseNotice` (already listed); `dockPanels` is `dockLayout.panels`.

```jsx
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { usePresetLibrary } from "../hooks/PresetsContext.jsx";
import { useMeterDisplayState, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { useSourceActions } from "../runtime/SourceActionsContext.jsx";
import { useDisplaySnapshot } from "../runtime/DisplaySnapshotContext.jsx";
import { useAnalysisSession } from "../runtime/AnalysisSessionContext.jsx";
import { useUiNavigationTarget, useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { preparePanelSettingsNavigation } from "../uiNavigation/panelSettingsNavigation.js";
import { LOUDNESS_PROFILE_OFF } from "../lib/loudnessProfileCatalog.js";
import { errorDetails } from "../lib/errorDetails.js";
import { reportSceneOperationError } from "../lib/sceneOperationNotice.js";
import { useDock } from "./DockContext.jsx";
import { useDockAccessoryBridge } from "./useDockAccessoryBridge.js";
import { useDockAccessoryVisibility } from "./useDockAccessoryVisibility.js";

/**
 * @typedef {{
 *   visibility: ReturnType<typeof useDockAccessoryVisibility>,
 *   hoveredDockPanelId: string | null,
 *   visualRuntimeRef: import("react").MutableRefObject<any>,
 * }} DockAccessories
 */
const DockAccessoriesContext = createContext(/** @type {DockAccessories | null} */ (null));

/**
 * The two accessory webviews beside the Dock strip: when each is shown, the state published to
 * them, and what their actions do in the main window.
 *
 * A second owner beside `DockProvider`, not part of it: the accessories list presets and loudness
 * profiles and drive the source, and those owners need the Dock form themselves.
 *
 * Its effects stay in this one component in a fixed order: visibility, navigation registration,
 * then the bridge that publishes to the accessories.
 */
export function DockAccessoriesProvider({ children }) {
  const { state: workspaceState, setActiveTab } = useWorkspaceStore();
  const { sourceMode, running } = useMeterRuntime();
  const { notice, raiseNotice, clearNotice, showClock } = useMeterDisplayState();
  const { sourceTransportState } = useDisplaySnapshot();
  const { channelCount, vectorscopePairOptions, spectrumChannelOptions } = useAnalysisSession();
  const { clearAll, onSourceTransportAction } = useSourceActions();
  const presets = usePresetLibrary();
  const loudnessProfile = useLoudnessProfile();
  const {
    docked,
    dockEdge,
    dockHeight,
    dockSuspended,
    reserveSpace,
    toggleReserveSpace,
    exitDockRestoringAttributes,
    onDockChange,
    layout: dockLayout,
  } = useDock();
  const dockPanels = dockLayout.panels;
  const visualRuntimeRef = useRef(null);

  // (moved declarations 1 to 9 go here, in order)

  return (
    <DockAccessoriesContext.Provider
      value={{ visibility: dockAccessoryVisibility, hoveredDockPanelId, visualRuntimeRef }}
    >
      {children}
    </DockAccessoriesContext.Provider>
  );
}

export function useDockAccessories() {
  const accessories = useContext(DockAccessoriesContext);
  if (!accessories) {
    throw new Error("useDockAccessories must be used inside DockAccessoriesProvider");
  }
  return accessories;
}
```

Run: `npx vitest run src/dock/DockAccessoriesContext.test.jsx`
Expected: PASS.

- [ ] **Step 3: Use the owner in `App.jsx`**

- In `App`, nest `<DockAccessoriesProvider>` directly inside `<AnalysisSessionProvider>`, with the
  comment
  `{/* Reads Dock, Presets, LoudnessProfile, SourceActions, DisplaySnapshot and AnalysisSession. */}`.
- In `AppContent`, delete `const visualRuntimeRef = useRef(null);` and, where the moved block was:

```jsx
const {
  visibility: dockAccessoryVisibility,
  hoveredDockPanelId,
  visualRuntimeRef,
} = useDockAccessories();
```

Place it before `agentControlVisual`, which reads `visualRuntimeRef` until Task 3.

- `dockProps` keeps reading `dockAccessoryVisibility` and `hoveredDockPanelId` from that
  destructuring.

- [ ] **Step 4: Verify and commit**

Run the verification with `<label>` = `s2b-task2`. The Dock walk is the check that matters here: it
drives `preparePanelSettings`, the accessory visibility, the navigation surface and its close
callback, and the visual runtime geometry.

```bash
git add src/dock/DockAccessoriesContext.jsx src/dock/DockAccessoriesContext.test.jsx src/App.jsx
git commit -m "refactor(dock): give the dock accessory windows one owner" -m "Accessory visibility, the state published to the two accessory webviews and the dispatcher for their actions move from AppContent into a provider. It is separate from the Dock owner because it reads presets, loudness profiles and source actions, which themselves read the Dock." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Agent Control state owner; the bridge takes no props

**Files:**

- Create: `src/agentControl/AgentControlStateContext.jsx`,
  `src/agentControl/AgentControlStateContext.test.jsx`
- Create: `src/agentControl/settleDockAccessory.js`, `src/agentControl/settleDockAccessory.test.js`
- Modify: `src/agentControl/AgentControlBridge.jsx`, `src/agentControl/AgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Move the accessory settle helper, test first**

Create `src/agentControl/settleDockAccessory.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { settleDockAccessory } from "./settleDockAccessory.js";

const runtime = (visible) => ({
  accessoryGeometry: { dockEditor: { visible, width: 320, height: 200 } },
});
const options = (overrides = {}) => ({
  getRevision: () => 7,
  getUiGeneration: () => 3,
  ...overrides,
});

describe("settleDockAccessory", () => {
  it("refuses a target that is not shown", async () => {
    await expect(
      settleDockAccessory({ kind: "dockEditor" }, runtime(false), options())
    ).rejects.toMatchObject({ reason: "targetUnavailable" });
  });

  it("describes a shown accessory by its own window and size", async () => {
    const settled = await settleDockAccessory({ kind: "dockEditor" }, runtime(true), options());

    expect(settled).toMatchObject({
      windowLabel: "dock-editor",
      rect: { x: 0, y: 0, width: 320, height: 200 },
      viewport: { width: 320, height: 200 },
      revision: 7,
      uiGeneration: 3,
    });
  });

  it("refuses when the revision moved before the capture", async () => {
    await expect(
      settleDockAccessory({ kind: "dockEditor" }, runtime(true), options({ expectedRevision: 6 }))
    ).rejects.toMatchObject({ reason: "revisionConflict" });
  });
});
```

Run: `npx vitest run src/agentControl/settleDockAccessory.test.js`
Expected: FAIL, the module does not exist.

Create `src/agentControl/settleDockAccessory.js` by **moving verbatim** the module-level functions
`nextPaint` and `settleDockAccessory` from `src/App.jsx`, exporting `settleDockAccessory`.

Run: `npx vitest run src/agentControl/settleDockAccessory.test.js`
Expected: PASS.

- [ ] **Step 2: Write the failing test for the state owner**

Create `src/agentControl/AgentControlStateContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { AgentControlStateProvider, useAgentControlState } from "./AgentControlStateContext.jsx";

function wrapper({ children }) {
  return <AgentControlStateProvider>{children}</AgentControlStateProvider>;
}

describe("AgentControlStateProvider", () => {
  it("starts from the boot descriptor and never asks for capabilities when unavailable", () => {
    const { result } = renderHook(() => useAgentControlState(), { wrapper });

    expect(result.current.runtime.available).not.toBe(true);
    expect(result.current.enabled).toBe(false);
    expect(result.current.platformCapabilities).toBeNull();
    expect(result.current.recordingState).toBeNull();
  });

  it("holds the enabled flag and the recording state the shell shows", () => {
    const { result } = renderHook(() => useAgentControlState(), { wrapper });

    act(() => result.current.setEnabled(true));
    act(() => result.current.setRecordingState("recording"));

    expect(result.current.enabled).toBe(true);
    expect(result.current.recordingState).toBe("recording");
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useAgentControlState())).toThrow(
      "useAgentControlState must be used inside AgentControlStateProvider"
    );
  });
});
```

Run: `npx vitest run src/agentControl/AgentControlStateContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Create the state owner**

Create `src/agentControl/AgentControlStateContext.jsx`. The capabilities effect is **moved
verbatim** from `AppContent`.

```jsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getVisualCaptureCapabilities } from "../ipc/commands.js";
import { readAgentControlRuntime } from "./appSnapshot.js";

/**
 * @typedef {{
 *   runtime: ReturnType<typeof readAgentControlRuntime>,
 *   enabled: boolean,
 *   setEnabled: (enabled: boolean) => void,
 *   platformCapabilities: any,
 *   recordingState: any,
 *   setRecordingState: (state: any) => void,
 * }} AgentControlState
 */
const AgentControlStateContext = createContext(/** @type {AgentControlState | null} */ (null));

/**
 * The Agent Control state two parties share: the bridge, and the shell that shows the recording
 * indicator and hosts the Settings switch. Everything else Agent Control needs it reads from the
 * domain owners.
 */
export function AgentControlStateProvider({ children }) {
  const runtime = useMemo(readAgentControlRuntime, []);
  const [platformCapabilities, setPlatformCapabilities] = useState(null);
  const [recordingState, setRecordingState] = useState(null);
  // (moved capabilities effect goes here, with `agentControlRuntime` renamed `runtime` and
  //  `setVisualPlatformCapabilities` renamed `setPlatformCapabilities`)
  const [enabled, setEnabled] = useState(() => runtime.enabled === true);

  const value = useMemo(
    () => ({
      runtime,
      enabled,
      setEnabled,
      platformCapabilities,
      recordingState,
      setRecordingState,
    }),
    [enabled, platformCapabilities, recordingState, runtime]
  );
  return (
    <AgentControlStateContext.Provider value={value}>{children}</AgentControlStateContext.Provider>
  );
}

export function useAgentControlState() {
  const state = useContext(AgentControlStateContext);
  if (!state) {
    throw new Error("useAgentControlState must be used inside AgentControlStateProvider");
  }
  return state;
}
```

Run: `npx vitest run src/agentControl/AgentControlStateContext.test.jsx`
Expected: PASS.

- [ ] **Step 4: Extend the bridge test**

In `src/agentControl/AgentControlBridge.test.jsx`, add mocks:

```jsx
vi.mock("./AgentControlStateContext.jsx", () => ({
  useAgentControlState: () => ({
    runtime: { available: true, platform: "x" },
    enabled: true,
    platformCapabilities: { platform: "x" },
    setRecordingState: () => {},
  }),
}));
vi.mock("../dock/DockAccessoriesContext.jsx", () => ({
  useDockAccessories: () => ({ visualRuntimeRef: { current: { windowForm: "normal" } } }),
}));
vi.mock("./useVisualCaptureSurfaces.js", () => ({
  useVisualCaptureSurfaces: () => ({ settle: async () => "surface", subscribe: () => () => {} }),
}));
vi.mock("../lib/runtimeRole.js", () => ({ isParticipantInstance: () => false }));
```

Render `<AgentControlBridge />` with no props, replace `expect(passed.enabled).toBe(false)` with
`expect(passed.enabled).toBe(true)`, and add:

```jsx
expect(passed.runtime).toEqual({ available: true, platform: "x" });
expect(passed.visual.platformCapabilities).toEqual({ platform: "x" });
expect(passed.visual.getRuntime()).toEqual({ windowForm: "normal" });
await expect(passed.visual.settle({ kind: "panel" }, {})).resolves.toBe("surface");
```

making the test function `async`.

Run: `npx vitest run src/agentControl/AgentControlBridge.test.jsx`
Expected: FAIL.

- [ ] **Step 5: Move the visual wiring**

In `src/agentControl/AgentControlBridge.jsx`:

- The component takes no props. Read
  `const { runtime, enabled, platformCapabilities, setRecordingState } = useAgentControlState();`
  and replace every `props.runtime` with `runtime`.
- Read `const { visualRuntimeRef } = useDockAccessories();` and
  `const visualCaptureSurfaces = useVisualCaptureSurfaces({ workspace: workspaceState });`.
- **Move verbatim** the `agentControlVisual` `useMemo` from `AppContent`, with
  `visualPlatformCapabilities` renamed `platformCapabilities` and `setVisualRecordingState` renamed
  `setRecordingState` (add `setRecordingState` and `visualRuntimeRef` to its dependency list).
- Pass to the hook:

```jsx
enabled:
  runtime.available === true &&
  (enabled || isParticipantInstance()) &&
  platformCapabilities !== null,
runtime,
visual: agentControlVisual,
```

and remove `...props`.

In `src/App.jsx`:

- In `App`, nest `<AgentControlStateProvider>` directly inside `<DockAccessoriesProvider>`, with
  the comment `{/* Reads nothing. Shared by the bridge and the shell. */}`.
- In `AppContent`, delete `agentControlRuntime`, the capabilities state and effect,
  `visualRecordingState`, `agentControlEnabled`, `visualCaptureSurfaces`, `agentControlVisual`,
  `agentControlBridgeProps`, and the destructured `visualRuntimeRef`. Read
  `const { recordingState: visualRecordingState, setEnabled: setAgentControlEnabled } = useAgentControlState();`
  and render `<AgentControlBridge />`.

Run: `npx vitest run src/agentControl/AgentControlBridge.test.jsx`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run the verification with `<label>` = `s2b-task3`, passing `keep` to `recipe.sh`, then with the app
still running:

```bash
npm run smoke:agent-control
```

Expected: exits 0 (screenshot and recording, which also shows the recording indicator path).

Stop the app by PID, then run the Dock walk.

```bash
git add src/agentControl/AgentControlStateContext.jsx src/agentControl/AgentControlStateContext.test.jsx src/agentControl/settleDockAccessory.js src/agentControl/settleDockAccessory.test.js src/agentControl/AgentControlBridge.jsx src/agentControl/AgentControlBridge.test.jsx src/App.jsx
git commit -m "refactor(agent-control): build visual capture in the bridge; it takes no props" -m "The enabled flag, the platform capabilities and the recording state are shared with the shell, so they get a small owner of their own. With the Dock accessories owned too, the bridge reads everything it needs and AppContent relays nothing to Agent Control." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Living documentation and checkpoint

**Files:**

- Modify: `docs/architecture.md`

- [ ] **Step 1: Update "Frontend state ownership"**

Add two rows at the end of the owner table:

| Owner             | Owns                                                                                 | Read through           |
| ----------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| DockAccessories   | When each Dock accessory window is shown, the state published to them, their actions | `useDockAccessories`   |
| AgentControlState | Whether Agent Control is enabled, platform capture capabilities, the recording state | `useAgentControlState` |

In the DisplaySnapshot row, add "and the transport pill's state". Replace the closing paragraph
with: `AppContent` still owns the per-frame data it hands to the panels and the props handed to the
shell; Agent Control is mounted as `AgentControlBridge`, which reads every area from its owner.

- [ ] **Step 2: Measure, verify and commit**

```bash
wc -l src/App.jsx src/agentControl/AgentControlBridge.jsx
```

```bash
grep -c "use[A-Z][A-Za-z]*(" src/App.jsx
```

Run the verification with `<label>` = `s2b-task4`.

```bash
git add docs/architecture.md
git commit -m "docs(architecture): add the dock accessories and agent control state owners" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Report to the user and stop**

Report, in Chinese: the line and hook-call counts before this plan (1112 lines, 51 calls) and
after; every verification result; anything unexpected; and the hand checks only the user can do,
because the accessory windows are separate webviews that Agent Control cannot click in:

- in the Dock, hover the strip so the header appears, then use Start/Stop and Clear from it;
- open the modules editor from the header, add a module, reorder two, remove one, reset;
- apply a preset and switch the loudness profile from the Dock;
- change the Dock edge and toggle Reserve Space from the header;
- restore the window from the header.

---

## Self-review

| Item                                                            | Task |
| --------------------------------------------------------------- | ---- |
| Dock accessories owner (spec domain 11)                         | 2    |
| Its effects in one component in the existing order (spec audit) | 2    |
| `visualRuntimeRef` assignment stays a render-time write (audit) | 2    |
| Agent Control reads every area itself (spec, Agent Control)     | 3    |
| Verification that reaches the accessory windows                 | 0    |
| No render-frequency change                                      | 1, 2 |
| Living documentation follows the code                           | 4    |

Additions the spec did not name, both forced by dependency direction: the transport pill's state
moves into the display snapshot (Task 1), and Agent Control gets a small state owner for what it
shares with the shell (Task 3).

Names introduced: `useDockAccessories`, `useAgentControlState`, `settleDockAccessory` (module).
Fields later tasks rely on: `sourceTransportState` (Task 1); `visibility`, `hoveredDockPanelId`,
`visualRuntimeRef` (Task 2); `runtime`, `enabled`, `setEnabled`, `platformCapabilities`,
`recordingState`, `setRecordingState` (Task 3).
