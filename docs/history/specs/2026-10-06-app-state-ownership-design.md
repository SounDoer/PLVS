# App State Ownership Design

Date: 2026-10-06
Status: proposed, awaiting review. No code has been changed.

## Summary

`src/App.jsx` is 2588 lines and its `AppContent` component makes about 148 hook calls. The file is
long because almost every piece of application state is owned by that one component and handed down
as props. A cluster cannot be moved out without carrying 30 to 120 values with it, so splitting the
file by line ranges would only relocate the wiring.

This design gives each state domain one owner, a React context provider, and orders the providers by
dependency. `App.jsx` is left with the provider order and the shell layout. Agent Control becomes a
component at the innermost position of that order and reads each domain directly, so `App.jsx` stops
relaying values to it.

The work is behaviour-preserving. No user-visible behaviour, persisted format, or Agent Control
contract changes.

## Context

### What was measured

Counts are from `main` at `e7b321c2`.

| File                                        | Lines |
| ------------------------------------------- | ----- |
| `src/App.jsx`                               | 2588  |
| `src/agentControl/useAgentControlBridge.js` | 4218  |
| `src/components/PanelSettingsContent.jsx`   | 1941  |

An earlier pass with `artifacts/app-split/deps.cjs` estimated what each cluster of `AppContent`
would need as inputs if extracted as it stands. The estimate is rough and predates about 80 added
lines; it is quoted for scale only.

| Cluster                                        | Lines | Inputs | Outputs |
| ---------------------------------------------- | ----- | ------ | ------- |
| View state (pin, borderless, opacity, glass)   | 122   | 10     | 7       |
| Window visibility and update                   | 74    | 3      | 18      |
| Loudness profile stats                         | 74    | 4      | 3       |
| Channel labels                                 | 74    | 7      | 14      |
| Analysis requests and history retention        | 87    | 11     | 2       |
| Source and footer labels                       | 71    | 14     | 5       |
| Dock transitions and preset hand-off           | 210   | 30     | 4       |
| Dock accessory windows                         | 234   | 27     | 3       |
| Agent Control wiring                           | 524   | 63     | 3       |
| Props assembly for shell, header, footer, dock | 214   | 121    | 11      |

### Three causes

**1. `AppContent` subscribes to frame-rate data.** It calls `useMeterRuntimeAssembly()` and reads
`display.audio`, which is React state set on every meter frame. Every hook in `AppContent` and the
whole props assembly therefore re-run per frame, and the dense `useMemo` use exists to contain that.
The comment in `MeterRuntimeContext.jsx` that the assembly's only consumer is `MeterRuntimeEngines`
is no longer true. This is read from the code; the cost has not been profiled.

**2. Owner hooks can only be mounted in `AppContent`.** `useSettings`, `useAlwaysOnTop`,
`useDockMode`, `useDockLayout`, `usePresets` and `useAudioDevices` each hold `useState` that mirrors
a persistence domain or Rust state. Each may be mounted once (`useDockLayout` says so explicitly), so
their values can reach other components only as props from `AppContent`. The four domains that are
already contexts (Workspace, MeterRuntime, BlockingEditors, LoudnessProfile) are the parts of
`App.jsx` with the least wiring. `UiNavigationProvider`, added on 2026-10-06, follows the same
pattern and adds a registration interface for its targets and surfaces.

**3. Cross-domain operations have no owner.** `applyViewState`, `exitDockRestoringAttributes`,
`applyDockPreset`, the scene guard composition, and the three Agent Control executors
(`applyAgentControlSettings`, `executeAgentControlTransport`, `executeAgentControlDock`) are business
functions. They live in `AppContent` only because it is the one place that holds every part they
need.

The Agent Control wiring is a consequence of 2 and 3. The bridge owns no state. It receives about 30
inputs, detects change by comparing signatures in effects, and settles a mutation when React renders
the committed state.

## Goals

- Every state domain has exactly one owner that other code reads from directly.
- `App.jsx` contains the provider order and the shell layout, and no domain logic.
- Agent Control reads and mutates state without `App.jsx` relaying it.
- Components that do not draw meter data do not re-render per meter frame.
- Each step is a small commit that leaves the application fully working.

## Non-goals

- Changing any user-visible behaviour or visual output.
- Changing the Agent Control public contract. `inspect --json` output is identical before and after,
  apart from `revision`.
- Changing persisted formats, domain boundaries or `plvs-settings.json`.
- The capture layer (`src-tauri/src/audio`, `dsp`, `engine`).
- Introducing a state-management library.
- Splitting `PanelSettingsContent.jsx`. It is a file-organisation problem (a settings widget library
  and per-module rows in one file), not a state-ownership one, and gets its own record.
- The Dock accessory protocol and the accessory webviews.

## Approaches considered

### A. One provider per domain (recommended)

Extend the pattern the codebase already uses. Each domain becomes a provider component; nesting order
is dependency order. Agent Control is a component inside all of them.

- Incremental. One domain moves per commit and the application works after each.
- Keeps the rule that Agent Control mutations go through the React application's business functions,
  guards and persistence paths.
- Cost: nested providers run their effects child-first within a commit, where a single component
  runs them in hook order. Every effect has to be checked (see the audit below).
- Cost: a context re-renders all of its consumers when its value changes, so fast-changing values
  need their own context.

### B. External stores

Move state into module-level stores read with `useSyncExternalStore`. Agent Control reads and writes
the stores without passing through React.

- Agent Control would not depend on the render cycle.
- Cost: the business functions are hooks closed over React state. Moving them is a rewrite, not a
  move, and there is no working intermediate state.
- Cost: it contradicts the standing rule that live mutations pass through the running React
  application. That needs a new ADR and a redefinition of settlement and of screenshot timing.
- Cost: `docs/pitfalls.md` forbids enabling same-context store notification globally, because
  coalesced writes during drags would make every subscriber re-read. A store-first design has to
  solve that for each domain.

### C. Composed hooks inside `AppContent`

Group hook calls into `useAppView()`, `useAppDock()` and similar, still called from `AppContent`.

- The file gets shorter. The 30 to 120 inputs become hook parameters. Ownership does not change, the
  per-frame re-render does not change, and Agent Control is still relayed. Rejected as cosmetic.

### Why A

B's one advantage over A is that Agent Control would keep working if the webview stopped rendering.
That was tested on 2026-10-06 against the development app on Windows. With the main window visible,
hidden (`plugin:window|hide`) and minimized, three `inspect` calls and four mutations (two View, two
shared time-axis) succeeded in every state, each in about one second including the wrapper's own
overhead, with no `commitNotObserved`. `requestAnimationFrame` delivered 64 to 65 frames in two
seconds in all three states, so the webview was not throttled.

Not covered by that test: Dock form, visual capture while hidden, macOS, long hidden periods, and a
session without a debugging port. If Agent Control proves unreliable in one of those, that case can
be addressed on its own. Choosing A does not prevent moving a single domain out of React later.

## Design

### Rules

1. **One owner per domain.** State, the functions that mutate it, and its persistence live in one
   provider. Nothing else writes that domain's store or native state.
2. **Dependencies point outward.** A provider may read providers that enclose it and never one it
   encloses. The nesting order below is the dependency order.
3. **Stored value and native application are separate.** "What the user wants" (a persisted setting)
   and "apply it to the OS window" (an effect) have different dependencies and belong to different
   owners. This is what removes the View and Dock cycle.
4. **Effects on the same native object stay in one component, in their current order.** Always on
   top, decorations, window shadow and glass all act on the main window and move together.
5. **Frame-rate values get their own context.** A context that changes per frame is consumed only by
   components that draw per frame.
6. **A cross-domain operation belongs to the innermost domain it touches.** That domain can read
   every other domain involved.
7. **Presentational components keep their props.** A thin container reads the contexts and passes
   props, so existing component tests stay valid.
8. **Every new context value is a named JSDoc type.** `npm run typecheck` is part of the merge gate.
   The ten record types the bridge already names for its inputs become the context value types and
   move to their owners.

### Domains

Existing owners that do not change: Workspace (`workspace/WorkspaceContext.jsx`), BlockingEditors,
UiNavigation, LoudnessProfile.

| #   | Owner           | Owns                                                                                                                                                                | Reads                                                                |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | MeterRuntime    | Existing. Adds a low-rate display context (below) and the Transport executor used by Agent Control.                                                                 | —                                                                    |
| 2   | Settings        | Everything `useSettings` returns, plus the stored pin value and the Settings drawer's open state.                                                                   | BlockingEditors, UiNavigation                                        |
| 3   | SceneGuard      | `assertSceneOperationAllowed`: the editor registry rule composed with the source-mode rule.                                                                         | BlockingEditors, MeterRuntime                                        |
| 4   | Dock            | `useDockMode`, `useDockLayout`, `docked`, enter and exit transitions including attribute restore, Dock history viewport.                                            | Settings, SceneGuard, MeterRuntime display                           |
| 5   | WindowChrome    | Applying pin, decorations, shadow, glass and the opacity CSS variable to the window; `applyViewState` with rollback; the user-facing setters.                       | Settings, Dock                                                       |
| 6   | Presets         | `usePresets`, `applyDockPreset`, preset error reporting.                                                                                                            | Workspace, Settings, Dock, WindowChrome, LoudnessProfile, SceneGuard |
| 7   | Source          | `useAudioDevices`, selected source and its labels, capture format signature, device selection with notices.                                                         | MeterRuntime                                                         |
| 8   | SourceActions   | `useSourceTransportActions` (`clearAll`, file actions), the reset epochs it bumps, file report export, dialogue engine restart, file-analysis settings.             | MeterRuntime, Workspace, Settings, LoudnessProfile                   |
| 9   | AppLifecycle    | Window visibility, tray, update check and install, close confirmation, crash reporting, keyboard shortcuts, instance identity, runtime coordination.                | Settings, Dock, WindowChrome, Presets, Source, SourceActions         |
| 10  | AnalysisSession | Channel count, channel labels and their setters, analysis requests, retained keys, backend sync, panel-control clamps, the Settings executor used by Agent Control. | MeterRuntime, Workspace, Dock, Settings                              |
| 11  | DockAccessories | Accessory visibility, the accessory bridge, the accessory action dispatcher, the Dock panel-settings navigation target and surface.                                 | Dock, Presets, LoudnessProfile, SourceActions, AnalysisSession       |
| 12  | AgentControl    | No application state. Request queue, revision, settlement, waiters, visual capture bookkeeping.                                                                     | All                                                                  |

Dock is two owners because the accessories need Presets and SourceActions, while Presets needs Dock.
One owner would be a cycle.

### Provider order

```
WorkspaceProvider
  MeterRuntimeProvider
    BlockingEditorsProvider
      UiNavigationProvider
        LoudnessProfileProvider
          SettingsProvider
            SceneGuardProvider
              DockProvider
                WindowChromeProvider
                  PresetsProvider
                    SourceProvider
                      SourceActionsProvider
                        AppLifecycleProvider
                          AnalysisSessionProvider
                            DockAccessoriesProvider
                              AgentControlBridge
                              AppShellContainer
```

The first five are today's order, unchanged. `SettingsProvider` sits inside `BlockingEditorsProvider`
and `UiNavigationProvider` because `useCustomThemeSettings`, which it mounts, registers the theme
editor with them.

### Low-rate display context

`useMeterDisplay` holds `audio` (per frame) together with `notice`, `selectedOffset`,
`selectedSnapshotTimeMs`, `showClock` and their setters. Dock, Presets and Source need the notice
functions long before the frame-rate split, and must not subscribe to the per-frame assembly to get
them.

`MeterRuntimeProvider` publishes a third, memoized context with those low-rate values and stable
setters. `raiseNotice` and `clearNotice` are plain closures today and become `useCallback`. The
provider itself still re-renders per frame, because it owns the `audio` state, but a memoized value
with unchanged dependencies does not propagate. This is the first step, because every later domain
depends on it.

### The View and Dock cycle

WindowChrome needs `docked` to suspend its effects while Rust owns the strip's chrome. Dock exit
needs the user's pin and focus-view values to restore the window. Dock needs only the stored values,
which Settings owns. Only the effects that apply them need `docked`. So the order is Settings, Dock,
WindowChrome, which is the order the hooks already run in.

`useAlwaysOnTop` currently holds the stored pin value and the effect that applies it. It is split:
the value joins Settings, the effect joins WindowChrome.

### Late-bound clear action

`useClearShortcut` (inside Settings, near the outside) needs `clearAll`, which SourceActions owns (far
inside). Today this is `onClearRef`, assigned during render. It stays a ref: Settings owns and
exposes the ref, SourceActions assigns it during render. `useDialogueEngineRestart` and the Agent
Control settings executor read the same ref. This is the one deliberate inward-to-outward link and
is documented at the ref.

### Cross-domain operations

| Operation                                           | Today        | Owner                                                                    |
| --------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `assertSceneOperationAllowed` composition           | `AppContent` | SceneGuard                                                               |
| `exitDockRestoringAttributes`, `onDockChange`       | `AppContent` | Dock                                                                     |
| `applyViewState` and the five setters               | `AppContent` | WindowChrome                                                             |
| `applyDockPreset`, `presetDockState`                | `AppContent` | Presets                                                                  |
| Loudness profile "show missing" across Stats panels | `AppContent` | AnalysisSession                                                          |
| Crash report forces Dock exit                       | `AppContent` | AppLifecycle                                                             |
| `executeAgentControlTransport`                      | `AppContent` | MeterRuntime, taking file-analysis settings as an argument               |
| `applyAgentControlSettings`                         | `AppContent` | AnalysisSession (needs backend sync, Settings setters and the clear ref) |
| `executeAgentControlDock`                           | `AppContent` | Dock                                                                     |
| Dock accessory action dispatcher                    | `AppContent` | DockAccessories                                                          |

Scene operations keep their guard inside the business function, before any mutation. Moving a
function never moves the guard out of it.

### Agent Control

`useAgentControlBridge` becomes `<AgentControlBridge />`, rendered inside every provider. It reads
each domain with that domain's hook. The public-shape projections (`buildPublicSettings`,
`buildTransportSnapshot`, the dock, device, view, analysis and measurement records) are built inside
the bridge from context values. The component is rendered only when Agent Control is available, so a
build without it does none of this work. Today `AppContent` builds all of it on every render.

The monitor inventory and visual-capture capability state, which only Agent Control uses, move into
the bridge component.

What does not change:

- Mutations call the owning domain's business function. The bridge never writes a store.
- Settlement means React rendered the committed state. Signature comparison in effects still drives
  the revision.
- One serialized queue, the same backstop and timeouts, the same wire protocol.

The 4218-line file is then split along the same domains. The core keeps the queue, revision,
settlement and waiters. Each command family becomes a module exporting a plain function that takes
the request, the domain values and the core. The dispatch is currently one closure of about 3000
lines inside an effect with about 25 dependencies; after the split it is a table of family handlers.
This is the last step and can be cut without affecting the rest.

The synchronization checklist in `docs/agent-control/README.md` and its contract tests are unchanged
and must stay green throughout.

### Frame-rate isolation

`useSnapshot`, `useLoudnessHistory`, `frameData` and `historyData` move into one component that sits
directly above `PanelDataProviders`. It is the only consumer of the per-frame assembly besides
`MeterRuntimeEngines`.

Channel count is derived from the per-frame `audio.peakDb` length but changes rarely. AnalysisSession
needs it without subscribing per frame. `MeterRuntimeProvider` derives it and publishes it through
the low-rate context, so its consumers re-render only when the count changes.

The Agent Control analysis context depends on the history ring's version, which advances with every
history sample. It is computed on request inside the bridge instead of on every render.

### What `App.jsx` keeps

- The provider order above, with a comment per provider stating what it depends on.
- `AppShellContainer`, which reads the contexts and renders `AppShell` with the header, footer, file
  summary and Dock strip containers.
- The exported history-performance harness helpers move next to the harness.

## Effect-ordering audit

Within one component React runs effects in hook-call order. Across nested components it runs a
child's effects before its parent's. Moving hooks into nested providers therefore changes the order
in which effects fire within a commit. Each effect reachable from `AppContent` is classified below.

"Data" means the effect needs a value computed earlier in render. Provider nesting preserves that by
construction. "Order" means the effect needs another effect to have fired first in the same commit.

| Effect                                                                                    | Kind  | New owner               | Outcome                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ----- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `sharedTimeViewportRef` mirror                                                            | none  | `useSharedTimeViewport` | Preserved. The setters also write the ref synchronously. The hook owns no state and reads the Workspace context.                 |
| `useAppGlobalEffects` (legacy key cleanup, context-menu suppression)                      | none  | `App` root              | Fires last instead of near first. It removes five legacy `localStorage` keys that nothing reads. Accepted.                       |
| `useSettings` internals (store subscriptions, autostart, clear shortcut, theme)           | none  | Settings                | Moved as a unit, internal order preserved.                                                                                       |
| `useDockMode` reconcile                                                                   | none  | Dock                    | Preserved. Asynchronous; initial state comes from the boot snapshot during render.                                               |
| `useAlwaysOnTop`, `useFocusViewWindow`, `useSurfaceOpacityWindowShadow`, `useGlassEffect` | data  | WindowChrome            | Preserved. All four in one component in today's order; `docked` arrives from Dock above. This is the "dock hooks first" comment. |
| `--surface-opacity` CSS variable                                                          | none  | WindowChrome            | Preserved.                                                                                                                       |
| `usePresets` (store subscription, divergence suppression, bounds listener)                | data  | Presets                 | Preserved. Loudness profile is an enclosing provider, which is the "hoisted above dock and presets" comment.                     |
| Scene guard composition                                                                   | data  | SceneGuard              | Preserved. It encloses Dock and Presets, so no entry point can pick up one rule and miss the other.                              |
| Crash report forces Dock exit                                                             | data  | AppLifecycle            | Preserved.                                                                                                                       |
| `useAudioDevices`, default-output change notice                                           | none  | Source                  | Preserved.                                                                                                                       |
| Window visibility initial read, `useUiNavigationEnvironment`                              | none  | AppLifecycle            | Preserved.                                                                                                                       |
| File-mode time-window fit, retention-change selection reset                               | none  | AnalysisSession         | Preserved.                                                                                                                       |
| Retained keys to intakes, `useRuntimeBackendSync` (four effects), four clamp effects      | order | AnalysisSession         | Preserved by keeping all of them in one component in today's order. The clamps set state and take effect in the next commit.     |
| `useRuntimeBackendSync` refs read by `MeterRuntimeEngines`                                | order | AnalysisSession         | Preserved. `MeterRuntimeEngines` stays a descendant, so its effects already run first, as they do today.                         |
| `onClearRef` assignment and `useDialogueEngineRestart`                                    | order | SourceActions           | Preserved. The ref is assigned during render and every render completes before any effect of the commit.                         |
| History-performance harness (development, browser only)                                   | none  | With the harness        | Preserved.                                                                                                                       |
| `useInstanceIdentity`, `useTray`, `useAppKeyboardShortcuts`, `useViewsChromeReveal`       | none  | AppLifecycle            | Preserved. `useViewsChromeReveal` may join the shell container instead; decided at that step.                                    |
| `useRuntimeCoordination` (needs show-window)                                              | none  | AppLifecycle            | Preserved.                                                                                                                       |
| `useDockAccessoryVisibility`, `useDockAccessoryBridge`, navigation target and surface     | order | DockAccessories         | Preserved by keeping them in one component in today's order.                                                                     |
| Channel metadata to the displayed intake                                                  | none  | AnalysisSession         | Preserved.                                                                                                                       |
| Agent Control monitor inventory, visual capabilities                                      | none  | AgentControl            | Preserved.                                                                                                                       |
| Agent Control signature and settlement effects                                            | none  | AgentControl            | Changed: they fire before the enclosing providers' effects instead of in the middle. They read rendered values only. Accepted.   |
| `visualRuntimeRef` assignment during render                                               | none  | DockAccessories         | Preserved. Read lazily at request time.                                                                                          |

The three ordering comments in `App.jsx` (Dock hooks before always-on-top, loudness profile hoisted
above Dock and Presets, scene guard composition) are all data dependencies. None requires one effect
to fire before another.

This table is re-checked against the code at each step, because the classification of a hook's
internal effects was made by reading and each move can expose a case the reading missed. A step that
finds an "order" dependency across two owners stops and revises this record before continuing.

## Migration

Each step is one or a few commits. Each commit passes `npm run check` and the verification below.

Agent Control is converted to a component in step 2 while it still takes props. Each later step
removes the props for the domain it moves, so `App.jsx` shrinks continuously.

**Stage 1: moves that change no behaviour**

1. Baseline. Record `inspect --json` and a full `ui:walkthrough` image set from a cold start.
2. Low-rate display context in MeterRuntime. `useAgentControlBridge` wrapped as a component that
   still takes props.
3. Settings (including the stored pin value) and SceneGuard.
4. Dock.
5. WindowChrome.
6. Presets.
7. Source, SourceActions, AppLifecycle. The shared time viewport setters become a hook over the
   Workspace context, because SourceActions needs them and they own no state of their own.

**Checkpoint.** Review the result with the user before continuing.

**Stage 2: changes with wider reach**

8. AnalysisSession and frame-rate isolation.
9. DockAccessories.
10. Agent Control reads every domain itself; its three executors are gone from `App.jsx`. Then the
    bridge file is split by family.
11. Shell containers replace the props assembly. `App.jsx` reaches its final form.
12. Living documentation: a "Frontend state ownership" section in `docs/architecture.md`, and an ADR
    recording why state is owned by ordered providers and not an external store, and why Agent
    Control settles on a React commit. Remove the stale assembly comment in `MeterRuntimeContext.jsx`
    when step 8 makes it true again.

Work lands directly on `main`, without a worktree (decided by the user on 2026-10-06).

## Verification

Per commit:

- `npm run check` (includes `npm run typecheck`).
- `npm run desktop:control -- inspect --json` compared with the baseline; identical apart from
  `revision`.
- `npm run ui:walkthrough` into a fresh directory from a cold start with a fresh
  `--plvs-test-app-data-root`, then `npm run ui:compare` against the baseline. Zero changed pixels.
- The development process is stopped by PID before the checkout changes, and never by image name.

This replaces the Playwright and CDP procedure used before 2026-10-06; `CONTRIBUTING.md` now defines
visual review through Agent Control, and `scripts/uiAutomationBoundary.test.js` keeps browser
automation out of product walkthroughs.

Additional checks for specific steps:

- Steps 4, 5 and 9 touch native windows that the walkthrough covers only partly. Each is checked by
  hand in the development app: enter and exit Dock on both edges, pin and borderless before and
  after a Dock round trip, preset apply across Dock and normal form, the accessory header and editor.
- Step 3 and step 6 re-run the scene-operation refusal tests and confirm nothing mutates before a
  refusal.
- Step 8 changes render frequency. React Profiler commit counts for the header and footer are
  recorded before and after with a live source running.
- Step 10 runs `npm run smoke:agent-control`.

The capture layer is not touched, so `smoke:capture` and `soak:capture` are not required by this
work.

## Risks

- **An effect dependency the audit missed.** Mitigated by rule 4, by re-checking the table per step,
  and by the hand checks on native-window steps. Residual risk is highest in Dock and
  DockAccessories.
- **Context fan-out.** A provider that changes often re-renders all consumers. Settings is the
  widest; if profiling at the checkpoint shows a problem, it is split by change frequency (the
  opacity slider is the known fast writer).
- **Provider depth.** About 15 levels. This is the dependency order made explicit and is accepted.
- **Type work.** Each new context needs a named type. The bridge's existing typedefs cover most of
  it.
- **Concurrent feature work on `main`.** `App.jsx` and the bridge are edited often; UI navigation
  added wiring to both on the day this was written. Small commits and a short stage 1 limit the
  conflict surface.

## Open decisions

- Whether stage 2 proceeds, decided at the checkpoint.
