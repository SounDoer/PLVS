# Dock Above Full Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Windows, the Dock strip stays above full-screen windows by default, with an
**Above Full Screen** Views switch, stored in the Preset scene, that restores the current
step-aside behaviour.

**Architecture:** Rust stores `aboveFullScreen` in `dockState` and derives the strip's yield from
Shell's last full-screen report and the switch. The frontend mirrors it through `useDockMode`, the
Dock Views menu, Presets and Agent Control. Portable Presets add it as the first field under a new
additive-field rule, with the Sharesets minimum version derived per Item.

**Tech Stack:** Rust (Tauri 2, windows-sys Shell AppBar API), React 19, Vitest.

**Spec:** `docs/history/specs/2026-11-02-dock-above-full-screen-design.md`

## Global Constraints

- Field name `aboveFullScreen` (JSON / JS), `above_full_screen` (Rust). Default `true` on every platform.
- UI label `Above Full Screen`; glossary Chinese form 全屏时置顶; `aria-label` lowercase.
- Switch visible and Agent Control writable on Windows only. macOS and Linux store the value without native effect.
- Portable Preset: optional field, written only when `false`, absent compiles to `true`; `formatVersion` stays 1.
- Sharesets feature `dockAboveFullScreen: { minimumAppVersion: null, introducedAfter: "0.24.0" }`.
- Normal window behaviour unchanged on every platform.
- Commits use Conventional Commits with scope; work lands on `main`.

## Review Focus

1. Switching off while a full-screen window is already present must yield at once, not at the next
   Shell notification — pinned by the derivation test in Task 1 and native acceptance in Task 8.
2. An existing `dockState` record or stored Preset without the field must read as on, never as off —
   pinned by the serde default test (Task 1) and the stored-Preset normalisation test (Task 3).
3. Opening a Preset on macOS must not mark it modified because the value cannot apply there — pinned
   by the divergence test in Task 3.
4. A Preset with the switch on must export byte-identical to today so existing Sharesets Items and
   old releases are unaffected — pinned by the round-trip test in Task 4.
5. Exiting Dock while yielded or not must leave the normal window's own Always on Top untouched —
   pinned by the existing exit path; native acceptance in Task 8 re-checks it.

---

### Task 1: Rust stores the switch and derives the yield

**Files:**

- Modify: `src-tauri/src/appbar.rs` (statics near `YIELDED`, `ABN_FULLSCREENAPP` handler, `watch_fullscreen`, tests)
- Modify: `src-tauri/src/dock.rs` (`DockStateRecord`, `enter_dock`, new command, tests)
- Modify: `src-tauri/src/lib.rs` (command registration, boot apply after `watch_fullscreen`)
- Modify: `src-tauri/src/feedback_diagnostics.rs:48`

**Interfaces:**

- Produces: `fn should_yield(fullscreen_present: bool, above_full_screen: bool) -> bool` (appbar, private).
- Produces: `pub fn set_above_full_screen<R: tauri::Runtime>(window: &WebviewWindow<R>, enabled: bool) -> Result<(), String>` (appbar, Windows) — stores the switch and re-applies the yield through `set_yielded`.
- Produces: `DockStateRecord.above_full_screen: bool`, serde default `true`, not platform-coerced.
- Produces: `enter_dock(..., above_full_screen: Option<bool>, ...)` and `#[tauri::command] set_dock_above_full_screen(window, flag, enabled: bool, origin: Option<Origin>) -> Result<(), String>`; both persist the record. IPC argument names `aboveFullScreen`, `enabled`.

- [ ] **Step 1: Write failing Rust tests**

In `appbar.rs` tests: `should_yield_only_when_full_screen_and_switch_off` asserting the four
combinations (`(true,false)` → true, the other three → false). In `dock.rs` tests:
`dock_state_without_above_full_screen_defaults_on` deserialising
`{"enabled":true,"edge":"top"}` and asserting `above_full_screen == true`, and
`normalize_for_platform_keeps_above_full_screen` asserting a stored `false` survives normalisation.

- [ ] **Step 2: Run them to see them fail**

Run: `npm run rust:test -- should_yield dock_state_without_above normalize_for_platform_keeps`
Expected: compile errors for the missing function and field.

- [ ] **Step 3: Implement**

Add `FULLSCREEN_PRESENT` and `ABOVE_FULL_SCREEN` (`AtomicBool`, the latter initialised `true`). The
`ABN_FULLSCREENAPP` handler stores `lparam != 0` in `FULLSCREEN_PRESENT` and, when notified, calls
`set_yielded(hwnd, should_yield(..))`. `set_above_full_screen` stores the switch and re-applies the
same way when the window receives Shell notifications. `watch_fullscreen(false)` also clears
`FULLSCREEN_PRESENT`. `enter_dock` resolves the value like `reserve_space` (argument, else stored,
else `true`), calls `set_above_full_screen` on Windows before `watch_fullscreen(true)`, and persists
it. Boot applies the stored value before the existing `watch_fullscreen(true)` in `lib.rs`. Register
`dock::set_dock_above_full_screen` beside `set_dock_reserve_space`. Add `"aboveFullScreen"` to the
diagnostics Dock record. Update the two `reserve_space: true` fixtures in `lib.rs` tests if they
construct the struct literally.

- [ ] **Step 4: Run Rust tests**

Run: `npm run rust:test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(dock): keep the strip above full-screen windows on Windows`

### Task 2: Frontend Dock state and the Views switch

**Files:**

- Modify: `src/ipc/commands.js` (`enterDock`, new `setDockAboveFullScreen`)
- Modify: `src/hooks/useDockMode.js`
- Modify: `src/dock/DockContext.jsx`, `src/dock/DockAccessoriesContext.jsx`, `src/dock/accessoryProtocol.js`
- Modify: `src/dock/editors/DockViews.jsx`
- Modify: `src/workspace/types.js`
- Test: `src/dock/editors/DockViews.test.jsx`, `src/hooks/useDockMode.test.js`, `src/dock/DockAccessoriesContext.test.jsx`

**Interfaces:**

- Consumes: Task 1 IPC `enter_dock { aboveFullScreen }`, `set_dock_above_full_screen { enabled, origin }`.
- Produces: `enterDock(edge, reserveSpace, monitor, height, origin, aboveFullScreen)` keeps current positional order and appends the new argument; `setDockAboveFullScreen({ enabled, origin })`.
- Produces: `useDockMode()` returns `aboveFullScreen`, `setAboveFullScreen(enabled, origin?)`, `toggleAboveFullScreen()`; `enterDockMode(edge, reserveSpaceOverride, monitorOverride, heightOverride, origin, aboveFullScreenOverride)`.
- Produces: accessory action `"toggle-above-full-screen"`; accessory state field `aboveFullScreen`.

- [ ] **Step 1: Write failing tests**

`DockViews.test.jsx`: `shows Above Full Screen on Windows and sends toggle-above-full-screen`
(platform stubbed to Windows, switch checked when `state.aboveFullScreen` is true, click dispatches
the action) and `hides Above Full Screen on macOS`. `useDockMode.test.js`:
`normalizes a missing aboveFullScreen to true`, `keeps a stored false`, and
`toggleAboveFullScreen invokes set_dock_above_full_screen with the inverse`.
`DockAccessoriesContext.test.jsx`: the action reaches `toggleAboveFullScreen`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/dock/editors/DockViews.test.jsx src/hooks/useDockMode.test.js src/dock/DockAccessoriesContext.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Follow the `reserveSpace` path in each file. Switch id `dock-above-full-screen`, placed after
Reserve Space, guarded by `isWindows()`.

- [ ] **Step 4: Run tests**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`feat(dock): add the Above Full Screen switch to Dock Views`

### Task 3: Presets capture, compare and apply the switch

**Files:**

- Modify: `src/hooks/usePresets.js`, `src/hooks/PresetsContext.jsx`, `src/lib/presetDivergence.js`
- Test: `src/hooks/usePresets.test.jsx`, `src/hooks/PresetsContext.test.jsx`, `src/lib/presetDivergence.test.js`

**Interfaces:**

- Consumes: Task 2 `aboveFullScreen`, `setAboveFullScreen`, `enterDockMode(..., aboveFullScreenOverride)`.
- Produces: stored Preset `dock.aboveFullScreen: boolean`, normalised to `true` when absent.

- [ ] **Step 1: Write failing tests**

`usePresets.test.jsx`: `captures dock.aboveFullScreen` and `normalizes a stored preset without
aboveFullScreen to true`. `presetDivergence.test.js`: `differs when aboveFullScreen differs on
Windows` and `uses the stored scene value where the platform cannot apply it` (macOS: live `true`,
scene `false` → not modified). `PresetsContext.test.jsx`: `applying a docked preset passes
aboveFullScreen to enterDockMode` and `calls setAboveFullScreen when only it differs`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/hooks/usePresets.test.jsx src/hooks/PresetsContext.test.jsx src/lib/presetDivergence.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** beside each `reserveSpace` occurrence; the platform gate in divergence is `isWindows()`.

- [ ] **Step 4: Run tests** — same command, PASS.

- [ ] **Step 5: Commit** `feat(presets): store Above Full Screen in the Dock scene`

### Task 4: Portable Presets and the newer-Preset message

**Files:**

- Modify: `src/transfer/portablePreset.js` (`DOCK_ENABLED_FIELDS`, export ~line 236, `compileDock`, `assessPortablePresetSharesetsPublication`)
- Modify: `src/transfer/packShape.js` (Preset parse error path)
- Test: `src/transfer/portablePreset.test.js`, `src/transfer/packShape.test.js`

**Interfaces:**

- Consumes: Task 3 stored `dock.aboveFullScreen`.
- Produces: portable `dock.aboveFullScreen?: false`; `optionalCapabilities` includes `"dockAboveFullScreen"` when false.

- [ ] **Step 1: Write failing tests**

`portablePreset.test.js`: `omits aboveFullScreen when on` (export of an existing fixture is
byte-identical to the current serialisation), `writes aboveFullScreen false when off`,
`compiles a missing aboveFullScreen to true`, `rejects a non-boolean aboveFullScreen with
invalidType at $.dock.aboveFullScreen`, `reports dockAboveFullScreen capability only when off`.
`packShape.test.js`: `a preset with an unknown field reports "This Preset requires a newer version of
PLVS."` with the `unknownField` issue still present.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/transfer/portablePreset.test.js src/transfer/packShape.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Export `...(snapshot.dock.aboveFullScreen === false ? { aboveFullScreen: false } : {})`. In
`packShape.js`, when a Preset fails with any `unknownField` issue, throw `PackValidationError` with
the exact message `This Preset requires a newer version of PLVS.` and the issues.

- [ ] **Step 4: Run tests** — same command, PASS. Also run `npx vitest run src/transfer` to catch Sharesets fixtures.

- [ ] **Step 5: Commit** `feat(presets): carry Above Full Screen in portable Presets`

### Task 5: Sharesets requirement from every registered feature

**Files:**

- Modify: `scripts/sharesets-app-compatibility.mjs`, `scripts/preset-presentation.mjs`
- Modify: `docs/website-and-sharesets.md` ("Curating Sharesets content")
- Test: `scripts/sharesets-app-compatibility.test.js`

**Interfaces:**

- Produces: `SHARESETS_APP_FEATURES` entries `{ minimumAppVersion, introducedAfter, uses(pack) }`; `presetUsesDockAboveFullScreen(pack)` (`items[0].dock.aboveFullScreen === false`).
- `sharesetsAppRequirement(pack)` signature unchanged.

- [ ] **Step 1: Write failing tests**

`a pack using no registered feature requires 0.20.0`, `panelOrientation still requires 0.21.0`,
`a pack with dock aboveFullScreen false reads Requires upcoming PLVS while unassigned`,
`the highest assigned minimum wins` (inject a features table), and
`checkSharesetsAppCompatibility rejects the unassigned dockAboveFullScreen`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run scripts/sharesets-app-compatibility.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** the loop and register both features. Add the four-point additive-field rule from spec D5 to `docs/website-and-sharesets.md`.

- [ ] **Step 4: Run tests** — same command plus `npx vitest run scripts/build-sharesets-site.test.js scripts/documentationStructure.test.js`, PASS.

- [ ] **Step 5: Commit** `feat(sharesets): derive each Item's minimum version from the features it uses`

### Task 6: Agent Control

**Files:**

- Modify: `src/agentControl/protocol.js:1671-1700`, `src/agentControl/dockControl.js` (~577, 618, 707, 756, 760), `src/agentControl/handlers/dock.js:135`, `src/agentControl/presetScene.js`, `src/agentControl/presetSnapshot.js`, `src/agentControl/AgentControlBridge.jsx`
- Modify: `src-tauri/src/cli_control.rs` (parser ~2293-2385, params ~4503-4537, tests ~7773)
- Modify: `src/agentControl/commandManifest.json`, `docs/agent-control/dock.md`
- Regenerate: `docs/agent-control/generated/` via `npm run docs:agent-control`
- Test: `src/agentControl/dockControl.test.js`, `src/agentControl/protocol.test.js`, `src/agentControl/presetScene.test.js`, `src/agentControl/presetSnapshot.test.js`, `cli_control.rs` tests

**Interfaces:**

- Consumes: Task 2 `enterDockMode(..., aboveFullScreenOverride)`, `setAboveFullScreen`.
- Produces: `dock inspect` field `aboveFullScreen`; describe availability entry `aboveFullScreen`; `dock enter --above-full-screen true|false` → `params.aboveFullScreen`.

- [ ] **Step 1: Write failing tests**

`dockControl.test.js`: `inspect reports aboveFullScreen`, `enter with only aboveFullScreen changed
plans a change`, `aboveFullScreen on macOS fails with controlUnavailable at $.aboveFullScreen`.
`protocol.test.js`: non-boolean rejected. `presetScene.test.js`: stored value kept on macOS with no
warning. `cli_control.rs`: `--above-full-screen false` maps to `params["aboveFullScreen"] == false`,
`--above-full-screen yes` is refused.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/agentControl` and `npm run rust:test -- cli_control`
Expected: FAIL.

- [ ] **Step 3: Implement** following the synchronization checklist in `docs/agent-control/README.md`; then `npm run docs:agent-control`.

- [ ] **Step 4: Run tests** — both commands plus `npx vitest run src/agentControl/publicSurfaceDocs.test.js src/agentControl/commandManifest.test.js`, PASS.

- [ ] **Step 5: Commit** `feat(agent-control): expose Dock Above Full Screen`

### Task 7: Decision record and user documentation

**Files:**

- Create: `docs/adr/0044-dock-stays-above-full-screen-windows.md`
- Modify: `docs/user/workspace.md:151-156`, `docs/glossary.md` (after Reserve Space, line 60)

- [ ] **Step 1:** Write the ADR (context: 2026-10-12 yield fix and the user report; decision: default on with a scene switch; rejected: keep yielding, a global non-scene setting, reserving space for full-screen windows).
- [ ] **Step 2:** Rewrite the workspace paragraph per spec D9 and add the glossary row
      `| Above Full Screen | Keeps the Dock strip above full-screen windows instead of stepping aside like the taskbar | 全屏时置顶 | |`.
- [ ] **Step 3:** Run `npx vitest run scripts/documentationStructure.test.js` and `npm run website:verify`. Expected: PASS.
- [ ] **Step 4:** Commit `docs(dock): record and document Above Full Screen`

### Task 8: Native acceptance on Windows

- [ ] **Step 1:** Run `npm run check:changes`. Expected: PASS.
- [ ] **Step 2:** Ask the user to hand over mouse and keyboard. Start `npm run desktop:dev`, enter Dock.
- [ ] **Step 3:** On the Dock's display, with a browser in F11 and separately a full-screen video, take whole-screen screenshots for: switch on (strip visible) and off (strip hidden); toggling each way while full screen is active; Reserve Space on and off; top and bottom edges; leaving full screen (strip returns topmost); exit Dock with normal Always on Top off (normal window not topmost).
- [ ] **Step 4:** Report the evidence and stop; pushing waits for the user.
