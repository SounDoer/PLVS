# Configurable Transport and Snapshot Shortcuts Implementation Plan

**Goal:** Add default Start / Stop and Live / Snapshot shortcuts while replacing the Clear-specific
shortcut stack with one catalogue-driven, multi-instance-safe system.

**Design:** `docs/history/specs/2026-10-23-shortcut-toggles-design.md`

**Delivery rule:** Keep each task coherent and run its focused tests while implementing. Before the
eventual push, run `npm run check:changes` once after the final intended commit and worktree state.
This plan does not change capture-layer Rust code, so the capture soak reminder is not required.

## Intended structure

The exact names may move during implementation if the surrounding code makes a clearer boundary,
but the ownership must remain:

- `src/data/keyboardShortcutActions.js` — action IDs, labels, defaults, ordering and normalization.
- `src/lib/shortcutPrefs.js` — identity-wide preference load/save and legacy Clear fallback.
- `src/hooks/useKeyboardShortcuts.js` — readiness, capture state, global registration and atomic
  control updates.
- `src/hooks/useAppKeyboardShortcuts.js` — focused-window matching and action-ID dispatch.
- `src/runtime/SourceActionsContext.jsx` / `src/hooks/useSourceTransportActions.js` — the two new
  business actions beside existing Clear.
- `src/settings/SettingsContext.jsx` — the outer-to-inner action-dispatch ref.
- Existing Settings, persistence, coordinator and Agent Control files — consume the shared model;
  none owns a second list of shortcut actions.

## Task 1: Establish the catalogue and strict preference shape

**Files:**

- Create `src/data/keyboardShortcutActions.js` and its colocated test.
- Modify `src/data/keyboardShortcuts.js` and its test to validate fixed/reserved chords against the
  configurable catalogue rather than treating Clear specially.
- Modify `src/lib/accelerator.js` and tests only as needed for nullable configured values and shared
  validation.

**Steps:**

- [ ] Write tests for the three action IDs, catalogue order and exact defaults.
- [ ] Add normalization tests for missing actions, unknown actions, malformed values, null
      accelerators, and `global: true` with no accelerator.
- [ ] Add conflict tests proving duplicate non-null accelerators are rejected independent of Global
      state and fixed reserved chords remain unavailable.
- [ ] Implement exported defaults and helpers without embedding React or persistence behavior.
- [ ] Replace direct `DEFAULT_CLEAR_SHORTCUT` consumers that only need defaults with catalogue
      lookup, leaving persistence wiring for Task 2.
- [ ] Run the focused data and accelerator tests.

## Task 2: Migrate identity-wide persistence and configuration profiles

**Files:**

- Replace `src/lib/clearShortcutPrefs.js` with `src/lib/shortcutPrefs.js` and migrate tests.
- Modify `src-tauri/src/persistence/hydration.rs`, `commands.rs`, `migration.rs` and their integration
  tests.
- Modify `src/persistence/profileShape.js`, `src/persistence/profile.js` and tests.
- Modify `src-tauri/src/profile.rs`, `src-tauri/src/cli_profile.rs` and profile tests.
- Update initial-state contract fixtures that enumerate global preferences.

**Steps:**

- [ ] Add failing JavaScript tests for loading `keyboardShortcuts`, falling back from legacy
      `clearShortcut` / `clearGlobal`, and saving one normalized object with one expected revision.
- [ ] Add Rust persistence tests that hydrate the new key and continue to expose legacy keys only as
      migration inputs.
- [ ] Allow `keyboardShortcuts` in the global preference command and hydration allowlists; keep old
      keys readable but stop writing them.
- [ ] Make the browser fallback use the same normalization and defaults.
- [ ] Bump portable configuration profiles to version 2. Add v1 import fixtures that preserve Clear
      and supply the two new defaults, plus v2 round-trip and Reset to Default fixtures.
- [ ] Ensure imported malformed values normalize identically in JavaScript and Rust paths.
- [ ] Verify `plvs-settings.json` remains the store filename and no manual generated-file edits are
      introduced.
- [ ] Run focused JavaScript profile/persistence tests and the affected Rust tests.

## Task 3: Generalize registration ownership

**Files:**

- Replace `src/hooks/useClearShortcut.js` with `src/hooks/useKeyboardShortcuts.js` and migrate tests.
- Modify `src/hooks/useSettings.js`, `src/settings/SettingsContext.jsx` and their tests.
- Modify runtime-role/coordinator tests if their expected resource ownership currently names only
  Clear.

**Steps:**

- [ ] Test fresh defaults, hydration, external preference refresh, coordinator promotion/demotion,
      unmount cleanup and participant instances that must not register OS shortcuts.
- [ ] Represent registered chords and errors per action rather than with one scalar ref/error.
- [ ] Register only non-null actions with Global requested, preserving unrelated registrations when
      one row changes.
- [ ] Suspend every configurable global registration while any recorder is active and restore the
      requested set when capture ends.
- [ ] Implement GUI updates as normalized whole-object persistence with revision reconciliation.
- [ ] Implement an atomic control setter that can stage registration changes, persist once, and
      restore the previous registration set on registration or persistence failure, including a
      two-action chord swap.
- [ ] Generalize `onClearRef` into one action-dispatch ref whose current map/function is assigned by
      the inner source-actions owner.
- [ ] Keep registration failures isolated per action and in-app matching available.
- [ ] Run the hook, Settings-context and runtime-role focused tests.

## Task 4: Implement the two business actions test-first

**Files:**

- Modify `src/hooks/useSourceTransportActions.js` and tests.
- Modify `src/runtime/SourceActionsContext.jsx` and tests.
- Modify `src/runtime/MeterRuntimeContext.jsx` or add a small runtime helper only if the source
  action lacks an authoritative retained-Live-history predicate.

**Steps:**

- [ ] Add a `toggleLiveCapture` test matrix for stopped/error, running, starting/stopping, FILE, and
      Snapshot-active states.
- [ ] Assert Start / Stop calls the existing asynchronous Live controller, never the dynamic primary
      action, never changes source, and never clears Snapshot.
- [ ] Add a `toggleLiveSnapshot` test matrix for Live edge with history, active Snapshot, no history,
      stopped Live with history, and FILE.
- [ ] Use the retained Live history owner as the availability authority; do not infer history from
      clock visibility or a non-empty rendered meter frame.
- [ ] Enter Snapshot with `selectSnapshot(0)` and leave it with `clearSnapshot()` without touching
      capture lifecycle.
- [ ] Publish both actions plus Clear through the generalized dispatch ref during render, preserving
      the provider ordering used by global registration.
- [ ] Run source-action and meter-display focused tests.

## Task 5: Dispatch configurable shortcuts in the focused window

**Files:**

- Modify `src/hooks/useAppKeyboardShortcuts.js` and tests.
- Modify `src/hooks/AppLifecycleContext.jsx` and tests.

**Steps:**

- [ ] Replace the Clear-only matcher input with normalized bindings plus an action dispatcher.
- [ ] Test all three defaults and customized bindings.
- [ ] Ignore `event.repeat`; prove one physical hold cannot oscillate either toggle.
- [ ] Prevent the browser default for a matched configured chord, including expected business
      no-ops.
- [ ] Suppress all configurable matching during shortcut capture while preserving existing Escape
      Focus View and `CmdOrCtrl+,` Settings behavior.
- [ ] Prove overlays, blocking editors and editable focus do not suppress modifier-bearing action
      chords.
- [ ] Ensure Dock and normal-window providers share the same action semantics.
- [ ] Run the app-keyboard and lifecycle focused suites.

## Task 6: Generalize native multi-workbench routing

**Files:**

- Modify `src-tauri/src/coordinator/mod.rs`, `src-tauri/src/lib.rs` and coordinator tests.
- Modify any frontend global-handler adapter tests that currently expect
  `runtime_route_global_clear`.
- Reuse the existing Agent Control transport protocol; do not add an unguarded state mutation path.

**Steps:**

- [ ] Replace the Clear-only route command with a closed action-ID command.
- [ ] Preserve the current most-recently-focused target selection and coordinator-only
      registration.
- [ ] For remote Start / Stop, inspect the target then issue explicit Live start or stop only when
      source and lifecycle permit it.
- [ ] For remote Live / Snapshot, inspect the target then issue snapshot select-at-zero or clear only
      when source/history state permits it.
- [ ] Preserve the existing remote Clear method and semantics.
- [ ] Treat designed no-ops as success without revision change; do not fall back to the local
      coordinator after a selected target fails.
- [ ] Cover current target, remote target, stale target, FILE, transitions, no history, Snapshot,
      and revision conflict/error propagation.
- [ ] Run the focused Rust coordinator and protocol tests.

## Task 7: Render the three editable Settings rows

**Files:**

- Modify `src/components/ShortcutCapture.jsx` and tests.
- Modify `src/components/SettingsPanel.jsx`, `src/components/AppSettingsOverlays.jsx` and tests.
- Update Settings surface-control inventory tests.

**Steps:**

- [ ] Make `ShortcutCapture` accept an accessible label and nullable value.
- [ ] Test `Not Set`, Escape cancel, Delete/Backspace removal, normal capture, invalid bare keys,
      fixed conflicts and cross-action conflicts.
- [ ] Render catalogue order with existing `SettingsRow`, `ShortcutCapture`, `ResetAction` and
      `SettingsSwitch`; add only lightweight column labels/layout styling.
- [ ] Reset each row to its catalogue default and keep the existing confirmation interaction.
- [ ] Give each Global switch and reset action an action-specific accessible name.
- [ ] Show registration/conflict errors on the affected row with semantic destructive tokens.
- [ ] Prove no new icon-toggle or bespoke settings control was introduced.
- [ ] Add all new controls to `settingsSurfaceCatalog.js` under one `keyboardShortcuts` authority
      field.
- [ ] Run ShortcutCapture, SettingsPanel, overlay and surface-catalog tests.

## Task 8: Update Settings Control and revision settlement

**Files:**

- Modify `src/agentControl/settingsControl.js`, `settingsControl.test.js` and
  `settingsControlContract.test.js`.
- Modify `src/agentControl/AgentControlBridge.jsx`, `useAgentControlBridge.js`, bridge domains,
  signatures and their tests.
- Modify Agent Control snapshot fixtures and public-surface snapshots.

**Steps:**

- [ ] Replace the public `clearShortcut` field with merge-patched `keyboardShortcuts` actions and
      per-action `accelerator` / `global` members.
- [ ] Generate schema defaults directly from the catalogue.
- [ ] Validate unknown action IDs, unknown members, nullable accelerators, malformed chords, fixed
      conflicts and cross-action duplicates atomically.
- [ ] Report per-action registration runtime and shared recorder availability.
- [ ] Refuse shortcut patches during GUI capture without blocking unrelated Settings fields unless
      the same atomic patch contains shortcut changes.
- [ ] Route changed shortcut paths through the atomic control setter and roll back on failure.
- [ ] Generalize bridge domain readiness/signatures so initial shortcut hydration establishes a
      baseline without incrementing global revision; later changes settle once.
- [ ] Update surface coverage and golden snapshots rather than adding a second compatibility alias.
- [ ] Run the complete focused Settings Control and bridge suites.

## Task 9: Update living documentation and generated Agent Control reference

**Files:**

- Modify `docs/user/system-settings.md` and `docs/user/workspace.md`.
- Modify `docs/architecture.md`.
- Modify `docs/agent-control/settings.md` and any configuration-profile page whose examples expose
  shortcut fields.
- Regenerate, never hand-edit, `docs/agent-control/generated/` and the command manifest/reference
  artifacts through the repository's documented command.

**Steps:**

- [ ] Document all three defaults, customization/removal/reset, per-action Global behavior and
      multi-workbench routing.
- [ ] Document the independent capture/display axes and Live-only no-op boundaries.
- [ ] Describe catalogue ownership and action-ID routing in architecture.
- [ ] Update Settings Control semantics, atomicity, availability and runtime registration states.
- [ ] Run `npm run docs:agent-control` and review the generated diff.
- [ ] Run documentation structure and public-surface contract tests.

## Task 10: Integrated verification and visual review

- [ ] Run all focused tests touched above, then the scope selected by `npm run check:changes` at the
      final unchanged HEAD/index/worktree state before push.
- [ ] Start `npm run desktop:dev` and verify the three default rows on Windows.
- [ ] Use Agent Control inspection and screenshots to compare the Settings layout before and after;
      confirm control height, alignment, reset affordances and error placement at supported interface
      sizes.
- [ ] Verify local Start / Stop in Live, in Snapshot, during transitions and in FILE.
- [ ] Verify local Live / Snapshot while running, stopped, empty and in FILE.
- [ ] Enable each Global switch one at a time, test from another application, then test all three
      together.
- [ ] Open a second workbench and verify one coordinator registration routes each action to the most
      recently focused workbench.
- [ ] Record a chord while another shortcut is Global and confirm no action fires during capture.
- [ ] Force one unavailable global chord and confirm only that row errors while all in-app shortcuts
      and other Global actions continue.
- [ ] Export a version 2 configuration, import a version 1 fixture, restart the desktop app and
      inspect persisted values; do not use a Vite reload to validate persistence.
- [ ] Review the final diff for accidental edits under `src/generated/` or
      `docs/agent-control/generated/` made by hand.

## Commit shape

Keep commits conventional, scoped and independently reviewable. A reasonable sequence is:

1. `feat(shortcuts): add configurable action catalogue`
2. `feat(persistence): migrate keyboard shortcut preferences`
3. `feat(shortcuts): generalize registration and dispatch`
4. `feat(transport): add live and snapshot shortcut actions`
5. `feat(settings): expose configurable shortcut rows`
6. `feat(agent-control): expose keyboard shortcut settings`
7. `docs(shortcuts): document transport and snapshot bindings`

Do not commit solely to follow this suggested split if an implementation discovery makes another
coherent boundary clearer. Run focused tests during the sequence; the complete scope-aware gate is
required once before push, not after every commit.
