# App State Ownership — Implementation Plan (Stage 2, part A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the analysis session one owner and move the rest of the Agent Control wiring out of
`AppContent`, without changing when anything re-renders.

**Architecture:** Two more providers join the order from stage 1. `DisplaySnapshotProvider` mounts
`useSnapshot` once and publishes its per-frame result. `AnalysisSessionProvider` reads it and owns
channel labels, analysis requests, backend sync and the panel-control clamps. `AgentControlBridge`
then reads every remaining area itself except visual capture.

**Tech stack:** React 19, JavaScript with JSDoc types checked by `tsc`, Vitest + jsdom, Tauri 2,
Agent Control CLI for verification.

**Spec:** `docs/history/specs/2026-10-06-app-state-ownership-design.md`
**Previous plan:** `docs/history/plans/2026-10-06-app-state-ownership.md` (stage 1, complete).

---

## What changed since the spec

Stage 1 ended at its checkpoint on 2026-10-06. Before planning stage 2, render cost was measured on
the development build with a live source running, using React `Profiler` around the tree, the
header and the panels, and a timer around the body of `AppContent`. Over six 5-second windows:

| Part                              | Time per second | Share |
| --------------------------------- | --------------- | ----- |
| Panels (`SplitLayout` subtree)    | about 280 ms    | 80 %  |
| Header                            | about 40 ms     | 11 %  |
| Footer, shell and everything else | about 30 ms     | 8 %   |
| `AppContent`'s own body           | about 4 ms      | 1 %   |

The tree commits 30 to 37 times a second. A development build renders slower than a release build,
so the absolute numbers are inflated; the shares are the finding.

The spec's stage 2 included frame-rate isolation and shell containers. The measurement shows the
cost it would remove is at most the header and shell share, and only once the header stops
re-rendering per frame. That in turn exposes values that are fresh today only because the tree
re-renders per frame (`deriveSourceTransportState` reads `elapsedMsRef.current` during render). The
user chose on 2026-10-07 to do the ownership moves and leave render frequency alone:

- **In scope (this plan):** the analysis session owner; the remaining Agent Control wiring.
- **In scope (part B, planned after this checkpoint):** the Dock accessory windows, and the visual
  capture wiring that depends on them.
- **Dropped:** frame-rate isolation and shell containers. `AppContent` keeps the per-frame panel
  data and the props assembly.
- **Separate project:** splitting `useAgentControlBridge.js` by command family.

Panel rendering is where the time goes and is outside this work.

## Delivery rules

The delivery rules, the move convention and the coverage rule of the stage 1 plan apply unchanged.

Verification for every task, before its commit:

```bash
npm run check
```

```bash
bash artifacts/app-state/recipe.sh <label>
```

Expected from the second command: `identical apart from revision`, and `pixel compare (empty)`
exits 0. `pixel compare (data)` may report changed pixels inside plotted meter data; open the
difference images if any image exceeds about 10 000 changed pixels and confirm the cause. The
scripts are untracked and were written during stage 1; the baseline under
`artifacts/app-state/baseline/` predates stage 1 and stays the reference.

After editing `src/App.jsx`, remove what the move left unused:

```bash
node artifacts/app-state/drop-unused.cjs src/App.jsx
```

Nothing in this plan may change render frequency. A provider added here may re-render per frame
itself; the value it publishes for other owners must be memoized so that they do not.

## File map

| File                                      | Status | Responsibility                                                          |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `src/runtime/DisplaySnapshotContext.jsx`  | create | The one mount of `useSnapshot`; per-frame snapshot and channel count    |
| `src/runtime/AnalysisSessionContext.jsx`  | create | Channel labels, analysis requests, backend sync, clamps, viewport rules |
| `src/hooks/useLoudnessProfileStats.js`    | create | "Show missing" across every Stats surface; owns no state                |
| `src/lib/historyTimestamps.js`            | create | First and latest timestamp of a history list                            |
| `src/agentControl/AgentControlBridge.jsx` | modify | Builds Workspace, Settings, Analysis, Measurement and Dock context      |
| `src/App.jsx`                             | modify | Loses each moved cluster                                                |
| `docs/architecture.md`                    | modify | Two rows and the closing paragraph of "Frontend state ownership"        |

A test file sits beside each created file.

---

## Task 1: Display snapshot owner

`useSnapshot` holds caches in refs, so it must stay mounted once. The analysis session needs the
channel count it yields, and a provider cannot read `AppContent`.

**Files:**

- Create: `src/runtime/DisplaySnapshotContext.jsx`, `src/runtime/DisplaySnapshotContext.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/runtime/DisplaySnapshotContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { MeterRuntimeProvider, useMeterRuntimeAssembly } from "./MeterRuntimeContext.jsx";
import { DisplaySnapshotProvider, useDisplaySnapshot } from "./DisplaySnapshotContext.jsx";

describe("DisplaySnapshotProvider", () => {
  it("reports no channels before any frame and follows the live frame's channel count", () => {
    /** @type {ReturnType<typeof useMeterRuntimeAssembly>} */
    let assembly;
    /** @type {ReturnType<typeof useDisplaySnapshot>} */
    let snapshot;
    function Probe() {
      assembly = useMeterRuntimeAssembly();
      snapshot = useDisplaySnapshot();
      return null;
    }
    render(
      <MeterRuntimeProvider>
        <DisplaySnapshotProvider>
          <Probe />
        </DisplaySnapshotProvider>
      </MeterRuntimeProvider>
    );

    expect(snapshot.channelCount).toBe(0);
    expect(snapshot.hasHistoryData).toBe(false);

    act(() => assembly.display.setAudio((current) => ({ ...current, peakDb: [-3, -4, -5] })));

    expect(snapshot.channelCount).toBe(3);
    expect(snapshot.displayAudio.peakDb).toEqual([-3, -4, -5]);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useDisplaySnapshot())).toThrow(
      "useDisplaySnapshot must be used inside DisplaySnapshotProvider"
    );
  });
});
```

Run: `npx vitest run src/runtime/DisplaySnapshotContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Create the owner**

Create `src/runtime/DisplaySnapshotContext.jsx`. The three `channelCount` lines are **moved
verbatim** from `AppContent`.

```jsx
import { createContext, useContext } from "react";
import { HIST_SAMPLE_SEC } from "../hooks/useLoudnessHistory.js";
import { useSnapshot } from "../hooks/useSnapshot";
import { useMeterDisplayState, useMeterRuntimeAssembly } from "./MeterRuntimeContext.jsx";

/** @typedef {ReturnType<typeof useSnapshot> & { channelCount: number }} DisplaySnapshot */
const DisplaySnapshotContext = createContext(/** @type {DisplaySnapshot | null} */ (null));

/**
 * The one mount of `useSnapshot`: what the panels show right now, live or at the scrub position.
 *
 * Its value changes on every meter frame. Read it only where per-frame updates are intended; an
 * owner that needs one slow-changing fact from it (the channel count) memoizes what it publishes.
 */
export function DisplaySnapshotProvider({ children }) {
  const { display, routing } = useMeterRuntimeAssembly();
  const { selectedOffset } = useMeterDisplayState();
  const { audio } = display;
  const snapshot = useSnapshot({
    selectedOffset,
    sampleSec: HIST_SAMPLE_SEC,
    intake: routing.intakeRef.current,
    audio,
  });
  const { displayAudio } = snapshot;
  const displayChannelCount = Array.isArray(displayAudio.peakDb) ? displayAudio.peakDb.length : 0;
  const liveChannelCount = Array.isArray(audio.peakDb) ? audio.peakDb.length : 0;
  const channelCount = displayChannelCount > 0 ? displayChannelCount : liveChannelCount;

  return (
    <DisplaySnapshotContext.Provider value={{ ...snapshot, channelCount }}>
      {children}
    </DisplaySnapshotContext.Provider>
  );
}

export function useDisplaySnapshot() {
  const snapshot = useContext(DisplaySnapshotContext);
  if (!snapshot) throw new Error("useDisplaySnapshot must be used inside DisplaySnapshotProvider");
  return snapshot;
}
```

Run: `npx vitest run src/runtime/DisplaySnapshotContext.test.jsx`
Expected: PASS.

- [ ] **Step 3: Use the owner in `App.jsx`**

- In `App`, nest `<DisplaySnapshotProvider>` directly inside `<AppLifecycleProvider>`, with the
  comment `{/* Reads MeterRuntime. Its value changes per meter frame. */}` above it.
- In `AppContent`, replace the `useSnapshot({ ... })` call and its destructuring with the same
  destructuring from `useDisplaySnapshot()`, adding `channelCount` to the list. Delete the three
  `channelCount` lines further down.

- [ ] **Step 4: Verify and commit**

Run the verification with `<label>` = `s2a-task1`.

```bash
git add src/runtime/DisplaySnapshotContext.jsx src/runtime/DisplaySnapshotContext.test.jsx src/App.jsx
git commit -m "refactor(runtime): mount the display snapshot in its own owner" -m "useSnapshot keeps caches in refs and must be mounted once. The analysis session needs the channel count it yields, so it moves from AppContent into a provider. Its value still changes per meter frame; nothing re-renders more or less often than before." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Analysis session owner

**Files:**

- Create: `src/runtime/AnalysisSessionContext.jsx`, `src/runtime/AnalysisSessionContext.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/runtime/AnalysisSessionContext.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { WorkspaceProvider } from "../workspace/WorkspaceContext.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "../hooks/LoudnessProfileContext.jsx";
import { SettingsProvider, useAppSettings } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "../hooks/SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { MeterRuntimeProvider, useMeterRuntimeAssembly } from "./MeterRuntimeContext.jsx";
import { SourceActionsProvider } from "./SourceActionsContext.jsx";
import { DisplaySnapshotProvider } from "./DisplaySnapshotContext.jsx";
import { AnalysisSessionProvider, useAnalysisSession } from "./AnalysisSessionContext.jsx";

function Providers({ children }) {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SceneGuardProvider>
                  <DockProvider>
                    <SourceActionsProvider>
                      <DisplaySnapshotProvider>
                        <AnalysisSessionProvider>{children}</AnalysisSessionProvider>
                      </DisplaySnapshotProvider>
                    </SourceActionsProvider>
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

function mount() {
  const seen = { renders: 0 };
  function Probe() {
    seen.session = useAnalysisSession();
    seen.assembly = useMeterRuntimeAssembly();
    seen.settings = useAppSettings();
    return null;
  }
  function SessionOnly() {
    useAnalysisSession();
    seen.renders += 1;
    return null;
  }
  render(
    <Providers>
      <Probe />
      <SessionOnly />
    </Providers>
  );
  return seen;
}

describe("AnalysisSessionProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("offers stereo choices while idle and follows the channel count", () => {
    const seen = mount();

    expect(seen.session.channelCount).toBe(0);
    expect(seen.session.spectrumChannelOptions.length).toBeGreaterThan(0);

    act(() =>
      seen.assembly.display.setAudio((current) => ({
        ...current,
        peakDb: [-1, -2, -3, -4, -5, -6],
      }))
    );

    expect(seen.session.channelCount).toBe(6);
    expect(seen.session.channelLabelRuntime.channelAutoLabels).toHaveLength(6);
  });

  it("stores a custom channel label for the current channel count and resets it", () => {
    const seen = mount();
    act(() => seen.assembly.display.setAudio((current) => ({ ...current, peakDb: [-1, -2] })));

    act(() => seen.session.setChannelLabelToken(0, "C"));
    expect(seen.settings.channelLabelOverrides[2][0]).toBe("C");
    expect(seen.session.channelLabelRuntime.channelLabelOverride).toBeTruthy();

    act(() => seen.session.resetChannelLabels());
    expect(seen.settings.channelLabelOverrides[2]).toBeUndefined();
  });

  it("keeps its consumers still while frames with the same channel count arrive", () => {
    const seen = mount();
    act(() => seen.assembly.display.setAudio((current) => ({ ...current, peakDb: [-1, -2] })));
    const rendersAfterFirstFrame = seen.renders;

    act(() => seen.assembly.display.setAudio((current) => ({ ...current, peakDb: [-7, -8] })));
    act(() => seen.assembly.display.setAudio((current) => ({ ...current, tpMax: -3 })));

    expect(seen.renders).toBe(rendersAfterFirstFrame);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useAnalysisSession())).toThrow(
      "useAnalysisSession must be used inside AnalysisSessionProvider"
    );
  });
});
```

Run: `npx vitest run src/runtime/AnalysisSessionContext.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Create the owner**

Create `src/runtime/AnalysisSessionContext.jsx` with this shell, then **move verbatim** into
`AnalysisSessionProvider`, in this order, from `AppContent`:

1. `const fileDurationMs = ...` (leave `selectedMediaTimeMs` and its comment in `AppContent`);
2. the file-mode time-window effect with its comment;
3. `previousHistoryRetentionSecRef` and the retention-change effect;
4. `dockPanelInstances`, `derivedAnalysisRequests`, `analysisRequests`, `retainedAnalysisKeys` with
   their comments;
5. the effect that hands the retained keys to the ingesting intakes, with its comment;
6. `channelLabelRuntime`, `channelLabelOverride`, `channelRoles`;
7. the `useRuntimeBackendSync({ ... })` call with its destructuring;
8. `channelAutoLabels`, `peakLabelContext`;
9. `setChannelLabelToken`, `setChannelLayout`, `resetChannelLabels`;
10. `vectorscopePairOptions`, `spectrumChannelOptions` with the comment above the first;
11. the effect that clamps every workspace panel's controls, with its comment;
12. `dockPanels`, `dockControlsByPanelId`, `setDockPanelControls` and the three Dock clamp effects.

The effects keep this order: 2, 3, 5, the four inside `useRuntimeBackendSync`, 11, then the three in 12. That is their order in `AppContent` today.

```jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useSharedTimeViewport } from "../workspace/useSharedTimeViewport.js";
import { deriveClampedPanelControls } from "../workspace/clampPanelControls.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { mergeDockAnalysisRequests, mergeDockRetainedKeys } from "../dock/dockAnalysisRequest.js";
import {
  deriveAnalysisRequests,
  deriveRetainedAnalysisKeys,
} from "../analysis/analysisRequests.js";
import {
  buildVectorscopePairOptions,
  clampVectorscopePairToAvailable,
} from "../math/vectorscopePairMath.js";
import {
  buildSpectrumChannelOptions,
  clampSpectrumChannelToAvailable,
} from "../math/spectrumChannelOptions.js";
import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";
import { seedTokensFromLabels } from "../math/channelRoles.js";
import { rolesForLayout } from "../math/channelLayoutTable.js";
import {
  deriveBackendAnalysisRequests,
  deriveChannelLabelRuntime,
} from "./appRuntimeDerivations.js";
import {
  useMeterDisplayState,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./MeterRuntimeContext.jsx";
import { useSourceActions } from "./SourceActionsContext.jsx";
import { useDisplaySnapshot } from "./DisplaySnapshotContext.jsx";
import { useRuntimeBackendSync } from "./useRuntimeBackendSync.js";

/**
 * @typedef {ReturnType<typeof useRuntimeBackendSync> & {
 *   channelCount: number,
 *   channelLabelRuntime: ReturnType<typeof deriveChannelLabelRuntime>,
 *   peakLabelContext: any,
 *   setChannelLabelToken: (index: number, token: string) => void,
 *   setChannelLayout: (layoutId: string) => void,
 *   resetChannelLabels: () => void,
 *   vectorscopePairOptions: any[],
 *   spectrumChannelOptions: any[],
 *   derivedAnalysisRequests: ReturnType<typeof mergeDockAnalysisRequests>,
 *   analysisRequests: ReturnType<typeof deriveBackendAnalysisRequests>,
 *   fileDurationMs: number | undefined,
 * }} AnalysisSession
 */
const AnalysisSessionContext = createContext(/** @type {AnalysisSession | null} */ (null));

/**
 * What is being analysed and how its channels are named: the channel count and labels, the
 * analysis requests derived from the open panels, their synchronization to the Rust engine, and
 * the repairs applied to panel controls when the channel count changes.
 *
 * Re-renders per meter frame, because the channel count comes from the displayed frame. The value
 * it publishes is memoized on facts that change at human speed, so its consumers do not.
 *
 * Its effects stay in this one component in a fixed order: the backend learns the analysis
 * requests before the clamps repair a selection, exactly as before the move.
 */
export function AnalysisSessionProvider({ children }) {
  const { state: workspaceState, setPanelControlsForPanel } = useWorkspaceStore();
  const { setHistoryWindowSec, setHistoryOffsetSec } = useSharedTimeViewport();
  const { sourceMode } = useMeterRuntime();
  const { setSelectedOffset } = useMeterDisplayState();
  const { routing } = useMeterRuntimeAssembly();
  const { ingestingIntakes } = routing;
  const { channelCount } = useDisplaySnapshot();
  const { fileSession, dialogueGating } = useSourceActions();
  const { docked, layout: dockLayout } = useDock();
  const settings = useAppSettings();
  const {
    historyRetentionSec,
    dialogueVadEngine,
    channelLabelOverrides,
    setChannelLabelOverrides,
  } = settings;

  // (moved declarations 1 to 12 go here, in order)

  const value = useMemo(
    () => ({
      channelCount,
      channelLabelRuntime,
      peakLabelContext,
      setChannelLabelToken,
      setChannelLayout,
      resetChannelLabels,
      vectorscopePairOptions,
      spectrumChannelOptions,
      derivedAnalysisRequests,
      analysisRequests,
      fileDurationMs,
      channelRolesRef,
      dialogueGatingRef,
      dialogueVadEngineRef,
      setChannelRolesForControl,
      setDialogueVadEngineForControl,
    }),
    [
      channelCount,
      channelLabelRuntime,
      peakLabelContext,
      setChannelLabelToken,
      setChannelLayout,
      resetChannelLabels,
      vectorscopePairOptions,
      spectrumChannelOptions,
      derivedAnalysisRequests,
      analysisRequests,
      fileDurationMs,
      channelRolesRef,
      dialogueGatingRef,
      dialogueVadEngineRef,
      setChannelRolesForControl,
      setDialogueVadEngineForControl,
    ]
  );
  return (
    <AnalysisSessionContext.Provider value={value}>{children}</AnalysisSessionContext.Provider>
  );
}

export function useAnalysisSession() {
  const session = useContext(AnalysisSessionContext);
  if (!session) throw new Error("useAnalysisSession must be used inside AnalysisSessionProvider");
  return session;
}
```

Run: `npx vitest run src/runtime/AnalysisSessionContext.test.jsx`
Expected: PASS. If the third test fails, a member of `value` changes identity per frame: find it
with a temporary `console.log` of which dependency differs, and memoize it at its declaration.

- [ ] **Step 3: Use the owner in `App.jsx`**

- In `App`, nest `<AnalysisSessionProvider>` directly inside `<DisplaySnapshotProvider>`, with the
  comment `{/* Reads DisplaySnapshot, Workspace, Dock, Settings and SourceActions. */}`.
- In `AppContent`, where `dockPanelInstances` was:

```jsx
const {
  channelLabelRuntime,
  peakLabelContext,
  setChannelLabelToken,
  setChannelLayout,
  resetChannelLabels,
  vectorscopePairOptions,
  spectrumChannelOptions,
  derivedAnalysisRequests,
  analysisRequests,
  fileDurationMs,
  channelRolesRef,
  dialogueGatingRef,
  dialogueVadEngineRef,
  setChannelRolesForControl,
  setDialogueVadEngineForControl,
} = useAnalysisSession();
const { channelLabelOverride, channelRoles, channelAutoLabels, channelLabelTokens } =
  channelLabelRuntime;
```

Place it before the first use of any of these names; `fileDurationMs` is read by
`selectedMediaTimeMs`' neighbours and by `agentControlAnalysisContext`.

- Delete the now-duplicate single-line reads of `channelLabelRuntime` members in `AppContent`
  (`channelLabelOverride`, `channelRoles`, `channelAutoLabels`, `channelLabelTokens`,
  `peakLabelContext`).
- The two history-performance harness effects and `historyPerformanceRequestKeysRef` stay in
  `AppContent`; they read `analysisRequests` from the destructuring above.

- [ ] **Step 4: Verify by hand and commit**

Run the verification with `<label>` = `s2a-task2`, passing `keep` as the second argument to leave
the app running. Then, with `PLVS_TEST_IDENTITY_ROOT` set to
`%TEMP%\plvs-app-state\data-s2a-task2\multi-instance`:

```bash
npm run --silent desktop:control -- transport live start --json --expected-revision <rev>
```

```bash
npm run --silent desktop:control -- measurement inspect --json
```

Expected: `"ok":true` and a measurement record with a channel count of 2 or more, which shows the
analysis requests reached the engine.

```bash
npm run --silent desktop:control -- settings inspect --json
```

Expected: `channelLabels.channelCount` equals the live channel count and `mode` is `auto`.

Stop live, then stop the app by PID.

```bash
git add src/runtime/AnalysisSessionContext.jsx src/runtime/AnalysisSessionContext.test.jsx src/App.jsx
git commit -m "refactor(analysis): give the analysis session one owner" -m "Channel labels, the analysis requests derived from the open panels, their synchronization to the engine and the clamps that repair panel controls were business rules living in AppContent. They move into a provider whose published value changes only when one of those facts does." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Loudness profile stats as a hook

The "show missing" fulfilment spans workspace Stats panels and Dock Stats. It owns no state; it
derives from three owners, so it is a hook like `useSharedTimeViewport`.

**Files:**

- Create: `src/hooks/useLoudnessProfileStats.js`, `src/hooks/useLoudnessProfileStats.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useLoudnessProfileStats.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { MeterRuntimeProvider } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider } from "./BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "./LoudnessProfileContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "./SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { useLoudnessProfileStats } from "./useLoudnessProfileStats.js";

function wrapper({ children }) {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SceneGuardProvider>
                  <DockProvider>{children}</DockProvider>
                </SceneGuardProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

describe("useLoudnessProfileStats", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("unions the visible stats of every Stats surface in the default layout", () => {
    const { result } = renderHook(
      () => ({ stats: useLoudnessProfileStats(), workspace: useWorkspaceStore().state }),
      { wrapper }
    );
    const hasStatsPanel = Object.values(result.current.workspace.panelsById).some(
      (panel) => panel.moduleId === "stats"
    );

    expect(hasStatsPanel).toBe(true);
    expect(result.current.stats.visibleIds.length).toBeGreaterThan(0);
    expect(typeof result.current.stats.onShowMissing).toBe("function");
  });
});
```

Run: `npx vitest run src/hooks/useLoudnessProfileStats.test.jsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Create the hook**

Create `src/hooks/useLoudnessProfileStats.js`, **moving verbatim** from `AppContent`
`statsPanelIds`, `dockStatsPanelIds` and `loudnessProfileStats` with their comments:

```js
import { useMemo } from "react";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { getPanelControls } from "../workspace/panelControlInstances.js";
import { useDock } from "../dock/DockContext.jsx";
import { normalizeDockModuleControls } from "../dock/dockModuleControls.js";
import { normalizePanelControls } from "../lib/panelControls.js";
import { listMissingPreferredMetrics, planShowMissing } from "../lib/loudnessProfileMissing.js";
import { useLoudnessProfile } from "./LoudnessProfileContext.jsx";

/**
 * The stats every Stats surface shows, and the action that adds the ones the active loudness
 * profile asks for. Owns no state: it reads the Workspace, the Dock layout and the profile.
 */
export function useLoudnessProfileStats() {
  const { state: workspaceState, setPanelControlsForPanel } = useWorkspaceStore();
  const { layout: dockLayout } = useDock();
  const loudnessProfile = useLoudnessProfile();

  // (moved declarations go here, in order)

  return loudnessProfileStats;
}
```

Run: `npx vitest run src/hooks/useLoudnessProfileStats.test.jsx`
Expected: PASS.

- [ ] **Step 3: Use the hook in `App.jsx`**

Replace the moved block with `const loudnessProfileStats = useLoudnessProfileStats();`.

- [ ] **Step 4: Verify and commit**

Run the verification with `<label>` = `s2a-task3`.

```bash
git add src/hooks/useLoudnessProfileStats.js src/hooks/useLoudnessProfileStats.test.jsx src/App.jsx
git commit -m "refactor(loudness): derive the stats a profile needs in a hook" -m "Fulfilling a profile's missing stats spans workspace and Dock Stats surfaces. It owns no state, so it becomes a hook over the three owners it reads." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Agent Control reads Workspace and Settings itself

**Files:**

- Modify: `src/agentControl/AgentControlBridge.jsx`, `src/agentControl/AgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Extend the bridge test first**

In `src/agentControl/AgentControlBridge.test.jsx`, add mocks:

```jsx
vi.mock("../workspace/WorkspaceContext.jsx", () => ({
  useWorkspaceStore: () => ({
    state: { panelsById: {}, panelOrder: [] },
    replaceWorkspace: () => {},
    setPanelControlsForPanel: () => {},
    waitForWorkspacePersistenceEnqueue: async () => {},
  }),
}));
vi.mock("../runtime/AnalysisSessionContext.jsx", () => ({
  useAnalysisSession: () => ({
    channelCount: 2,
    channelLabelRuntime: {
      channelLabelOverride: null,
      channelRoles: null,
      channelLabelTokens: ["L", "R"],
      channelAutoLabels: ["L", "R"],
    },
    setChannelRolesForControl: async () => {},
    setDialogueVadEngineForControl: async () => {},
  }),
}));
vi.mock("./settingsControl.js", () => ({
  buildPublicSettings: (_settings, context) => ({ fromContext: context.channelCount }),
}));
```

Extend the `useAppSettings` mock's return value with `autostartReady: true, clearReady: true,
clearCapturing: false, registrationError: null, onClearRef: { current: null }`, the
`useSourceActions` mock with `dialogueGating: false`, and the `useMeterRuntime` mock with
`running: false`. Add expectations:

```jsx
expect(passed.workspace).toEqual({ panelsById: {}, panelOrder: [] });
expect(typeof passed.replaceWorkspace).toBe("function");
expect(passed.settings).toEqual({ fromContext: 2 });
expect(passed.settingsContext).toMatchObject({
  channelCount: 2,
  channelLabelMode: "auto",
  sourceMode: "live",
  dialogueDetectionActive: false,
});
expect(typeof passed.applySettings).toBe("function");
```

Run: `npx vitest run src/agentControl/AgentControlBridge.test.jsx`
Expected: FAIL, `passed.workspace` is undefined.

- [ ] **Step 2: Move the wiring**

In `src/agentControl/AgentControlBridge.jsx`, read the owners:

```jsx
const {
  state: workspaceState,
  replaceWorkspace,
  setPanelControlsForPanel,
  waitForWorkspacePersistenceEnqueue,
} = useWorkspaceStore();
const {
  channelCount,
  channelLabelRuntime,
  setChannelRolesForControl,
  setDialogueVadEngineForControl,
} = useAnalysisSession();
const { channelLabelOverride, channelRoles } = channelLabelRuntime;
const { dialogueGating } = useSourceActions();
const { sourceMode, running, fileSessions } = meterRuntime;
const { onClearRef } = settings;
```

then **move verbatim** from `AppContent`, in this order:

1. `agentControlSettingsContext`;
2. `agentControlSettings`;
3. `applyAgentControlSettings`.

Pass to the hook `workspace: workspaceState`, `replaceWorkspace`, `setPanelControlsForPanel`,
`waitForWorkspacePersistenceEnqueue`, `settings: agentControlSettings`,
`settingsContext: agentControlSettingsContext`, `applySettings: applyAgentControlSettings`. Add
those seven names to the `Omit` in the props type and delete them from `agentControlBridgeProps`.

Run: `npx vitest run src/agentControl/AgentControlBridge.test.jsx`
Expected: PASS.

- [ ] **Step 3: Verify by hand and commit**

Run the verification with `<label>` = `s2a-task4`, keeping the app running. Then change one setting
through Agent Control and change it back:

```bash
echo '{"interfaceSize":"large"}' | npm run --silent desktop:control -- settings update - --json --expected-revision <rev>
```

```bash
echo '{"interfaceSize":"default"}' | npm run --silent desktop:control -- settings update - --json --expected-revision <rev>
```

Expected: both return `"ok":true` with `"changed":true`. If `large` is not an accepted value, read
the accepted ones from `settings describe --json` and use one of them.

Stop the app by PID.

```bash
git add src/agentControl/AgentControlBridge.jsx src/agentControl/AgentControlBridge.test.jsx src/App.jsx
git commit -m "refactor(agent-control): read workspace and settings from their owners" -m "The Settings area of Agent Control and its executor needed the backend sync, the settings setters and the clear ref, which is why they sat in AppContent. All three have owners now, so the bridge component builds the area itself." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Agent Control reads analysis and measurement itself

**Files:**

- Create: `src/lib/historyTimestamps.js`, `src/lib/historyTimestamps.test.js`
- Modify: `src/agentControl/AgentControlBridge.jsx`, `src/agentControl/AgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Extract the history timestamp helper, test first**

`AppContent` and the Agent Control analysis context both read the first or last row of the history
list, which is either a ring with `rowAt` or a plain array.

Create `src/lib/historyTimestamps.test.js`:

```js
import { describe, expect, it } from "vitest";
import { firstHistoryTimestampMs, latestHistoryTimestampMs } from "./historyTimestamps.js";

const ring = (rows) => ({ length: rows.length, rowAt: (index) => rows[index] });

describe("history timestamps", () => {
  it("reads both ends of a plain array", () => {
    const rows = [{ timestampMs: 100 }, { timestampMs: 250 }];
    expect(firstHistoryTimestampMs(rows)).toBe(100);
    expect(latestHistoryTimestampMs(rows)).toBe(250);
  });

  it("reads both ends of a history ring", () => {
    const rows = ring([{ timestampMs: 5 }, { timestampMs: 9 }, { timestampMs: 12 }]);
    expect(firstHistoryTimestampMs(rows)).toBe(5);
    expect(latestHistoryTimestampMs(rows)).toBe(12);
  });

  it("answers undefined for an empty list or a row without a finite timestamp", () => {
    expect(firstHistoryTimestampMs([])).toBeUndefined();
    expect(latestHistoryTimestampMs(ring([]))).toBeUndefined();
    expect(latestHistoryTimestampMs([{ timestampMs: Number.NaN }])).toBeUndefined();
  });
});
```

Run: `npx vitest run src/lib/historyTimestamps.test.js`
Expected: FAIL, the module does not exist.

Create `src/lib/historyTimestamps.js`:

```js
/** @param {any} list @param {number} index */
function rowAt(list, index) {
  if (!list || list.length <= 0) return null;
  return typeof list.rowAt === "function" ? list.rowAt(index) : list[index];
}

/** @param {any} row */
function finiteTimestamp(row) {
  return Number.isFinite(row?.timestampMs) ? row.timestampMs : undefined;
}

/** The oldest row's timestamp of a history list (a ring with `rowAt`, or an array). */
export function firstHistoryTimestampMs(list) {
  return finiteTimestamp(rowAt(list, 0));
}

/** The newest row's timestamp of a history list (a ring with `rowAt`, or an array). */
export function latestHistoryTimestampMs(list) {
  return finiteTimestamp(rowAt(list, (list?.length ?? 0) - 1));
}
```

Run: `npx vitest run src/lib/historyTimestamps.test.js`
Expected: PASS.

In `AppContent`, replace the body of the `latestTimestampMs` `useMemo` with
`return latestHistoryTimestampMs(histSourceList);`, keeping its dependency list and both comments.

- [ ] **Step 2: Extend the bridge test**

Add a mock and extend two existing ones:

```jsx
vi.mock("../runtime/DisplaySnapshotContext.jsx", () => ({
  useDisplaySnapshot: () => ({ histSourceList: [{ timestampMs: 0 }, { timestampMs: 90_000 }] }),
}));
```

Add to the `useAnalysisSession` mock: `derivedAnalysisRequests: { spectralWaveform: false },
analysisRequests: { vectorscope: [] }, fileDurationMs: undefined`. Add to the `useAppSettings` mock:
`historyRetentionSec: 3600, channelLabelOverrides: {}`. Add to the `useMeterRuntime` mock:
`getLiveMeasurement: () => null, subscribeLiveMeasurement: () => () => {}`. Mock the scene guard:

```jsx
vi.mock("../hooks/SceneGuardContext.jsx", () => ({
  useSceneGuard: () => ({ activeBlockingEditors: [] }),
}));
```

Change the test's props to `{ enabled: false, runtime: { available: false, platform: "x" } }` and
add expectations:

```jsx
expect(passed.analysisContext).toMatchObject({
  channelCount: 2,
  channelLabels: ["L", "R"],
  timeMaxWindowSec: 90,
  timeMaxOffsetSec: 85,
});
expect(passed.dockContext).toMatchObject({
  platform: "x",
  channelCount: 2,
  sourceMode: "live",
  activeEditors: [],
  transitioning: false,
});
expect(passed.measurementContext.liveState).toBe("stopped");
expect(typeof passed.measurementContext.getChannelLabels).toBe("function");
```

Run: `npx vitest run src/agentControl/AgentControlBridge.test.jsx`
Expected: FAIL, `passed.analysisContext` is undefined.

- [ ] **Step 3: Move the wiring**

In `src/agentControl/AgentControlBridge.jsx`, read:

```jsx
const { histSourceList } = useDisplaySnapshot();
const { derivedAnalysisRequests, analysisRequests, fileDurationMs } = useAnalysisSession();
const { activeBlockingEditors } = useSceneGuard();
const { historyRetentionSec, channelLabelOverrides } = settings;
```

(merge these into the destructurings Task 4 added), then **move verbatim** from `AppContent`, in
this order:

1. `agentControlAnalysisContext`, replacing its inline first-row and last-row reads with
   `firstHistoryTimestampMs(histSourceList)` and `latestHistoryTimestampMs(histSourceList)` and
   dropping `latestTimestampMs` from its dependency list (the list keeps `histSourceList` and
   `histSourceList.version` with the existing eslint comment);
2. `measurementChannelLabels`;
3. `agentControlMeasurementContext`.

Pass to the hook:

```jsx
analysisContext: agentControlAnalysisContext,
measurementContext: agentControlMeasurementContext,
dockContext: {
  platform: props.runtime.platform,
  ...agentControlAnalysisContext,
  sourceMode,
  activeEditors: activeBlockingEditors,
  transitioning: dockTransitioning,
  monitors: agentControlMonitors,
  fallbackMonitor: agentControlFallbackMonitor,
  monitorRects: agentControlMonitorRects,
  monitorInventoryReady: agentControlMonitorInventoryReady,
},
```

The props type becomes
`Pick<Parameters<typeof useAgentControlBridge>[0], "enabled" | "runtime" | "visual">`. In
`AppContent`, `agentControlBridgeProps` keeps `enabled`, `runtime` and `visual` only.

Run: `npx vitest run src/agentControl/AgentControlBridge.test.jsx`
Expected: PASS.

- [ ] **Step 4: Verify by hand and commit**

Run the verification with `<label>` = `s2a-task5`, keeping the app running. Then:

```bash
npm run smoke:agent-control
```

Expected: exits 0.

```bash
npm run --silent desktop:control -- measurement inspect --json
```

```bash
npm run --silent desktop:control -- axis inspect --json
```

Expected: both `"ok":true`.

Stop the app by PID.

```bash
git add src/lib/historyTimestamps.js src/lib/historyTimestamps.test.js src/agentControl/AgentControlBridge.jsx src/agentControl/AgentControlBridge.test.jsx src/App.jsx
git commit -m "refactor(agent-control): read analysis and measurement from their owners" -m "AppContent now hands the bridge only what it still owns: whether Agent Control is enabled, the runtime descriptor and visual capture." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Living documentation and checkpoint

**Files:**

- Modify: `docs/architecture.md`
- Modify: `src/runtime/MeterRuntimeContext.jsx`

- [ ] **Step 1: Update "Frontend state ownership"**

In `docs/architecture.md`, add two rows at the end of the owner table:

| Owner           | Owns                                                                             | Read through         |
| --------------- | -------------------------------------------------------------------------------- | -------------------- |
| DisplaySnapshot | What the panels show now, live or at the scrub position; changes per meter frame | `useDisplaySnapshot` |
| AnalysisSession | Channel labels, analysis requests, backend sync, panel-control clamps            | `useAnalysisSession` |

Replace the sentence about `useMeterRuntimeAssembly` with one naming both per-frame contexts:
"`useMeterRuntimeAssembly` and `useDisplaySnapshot` change on every meter frame; only a component
that draws per frame should read them."

Replace the closing paragraph's list of what `AppContent` still owns with: the per-frame panel data
it hands to the panels, the Dock accessory windows, and the props handed to the shell; and state
that `AgentControlBridge` receives only visual capture from `AppContent`.

- [ ] **Step 2: Correct the stale assembly comment**

In `src/runtime/MeterRuntimeContext.jsx`, the comment above `const assembly = {` says its only
consumer is the null-rendering `MeterRuntimeEngines`. Replace its last clause with: "and its
consumers are the ones that work per frame: `MeterRuntimeEngines`, the display snapshot, the
analysis session and `AppContent`."

- [ ] **Step 3: Measure, verify and commit**

```bash
wc -l src/App.jsx src/agentControl/AgentControlBridge.jsx
```

```bash
grep -c "use[A-Z][A-Za-z]*(" src/App.jsx
```

Run the verification with `<label>` = `s2a-task6`.

```bash
git add docs/architecture.md src/runtime/MeterRuntimeContext.jsx
git commit -m "docs(architecture): add the display snapshot and analysis session owners" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Report to the user and stop**

Report, in Chinese: the line and hook-call counts before this plan (1611 lines, 78 calls) and
after; every verification result; anything the effect audit did not predict; and that part B (Dock
accessory windows and visual capture wiring) has no plan yet and needs the user's decision.

---

## Self-review

| Item                                                                  | Task |
| --------------------------------------------------------------------- | ---- |
| Analysis session owner (spec domain 10)                               | 1, 2 |
| Its effects in one component in the existing order (spec audit)       | 2    |
| Settings executor leaves `AppContent` (spec, cross-domain operations) | 4    |
| Remaining Agent Control records leave `AppContent`                    | 4, 5 |
| "Show missing" across Stats surfaces has a home                       | 3    |
| No render-frequency change (decision of 2026-10-07)                   | 1, 2 |
| Living documentation follows the code                                 | 6    |

Deviation from the spec, deliberate: the spec placed the Settings executor in the analysis session
owner. It is Agent Control's own shape (changed paths, compensation), so it lives in the bridge
component and the analysis session exposes the two engine setters it needs.

Names introduced: `useDisplaySnapshot`, `useAnalysisSession`, `useLoudnessProfileStats`,
`firstHistoryTimestampMs`, `latestHistoryTimestampMs`. Fields later tasks rely on are defined where
the owner is created: `channelCount` (Task 1); `channelLabelRuntime`, `derivedAnalysisRequests`,
`analysisRequests`, `fileDurationMs`, `setChannelRolesForControl`,
`setDialogueVadEngineForControl` (Task 2).
