# Agent Control UI Navigation — Implementation Plan

> Proposed implementation plan. Do not begin product-code changes until this plan is reviewed.

**Goal:** Add a closed, semantic Agent Control UI Navigation family that can inspect transient UI,
open stable product surfaces, safely invoke their real Close/Cancel paths, and support race-free
visual walkthroughs without Playwright/CDP.

**Architecture:** Introduce a React-owned UI Navigation controller and mounted-surface registry under
the existing blocking-editor provider. Keep durable product state in its current owners; the new
controller stores only navigation intent, opaque surface lifetimes, and a low-frequency
`uiGeneration`. Route the public JSON-RPC methods through the existing Agent Control bridge and
checked command manifest. Components expose semantic adapters and their real business callbacks;
the bridge never clicks DOM nodes or writes stores.

**Tech stack:** React 19, JavaScript/JSDoc, Vitest/jsdom, Rust/Serde CLI forwarding, existing Agent
Control command manifest/schema/docs generator, Tauri 2 window and visual-capture boundaries.

**Spec:**
`docs/history/specs/2026-10-06-agent-control-ui-navigation-design.md`

---

## Delivery rules

- Implement phases in order. Each phase is independently reviewable and ends with focused tests,
  generated-doc reconciliation, `npm run check`, and real-desktop verification where applicable.
- Work on `main` unless the user explicitly asks for an isolated worktree, per `AGENTS.md`.
- Before each task, re-run `git status --short`. Preserve unrelated changes and do not rewrite a
  file already being changed elsewhere without reconciling the overlap first.
- Use tests first for state-machine, protocol, bridge, and component behavior. UI settlement and
  native focus/capture checks also require real-desktop verification because jsdom cannot prove
  pixels or native window behavior.
- Never hand-edit `docs/agent-control/generated/`; regenerate it with
  `npm run docs:agent-control` after manifest/schema changes.
- Do not add generic Click, Confirm, Submit, selector, coordinate, DOM-text, or fake-event paths at
  any phase.

## Public delivery slices

| Phase | Public additions                                                                            | Main risk closed                                                                                   |
| ----- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1     | `ui inspect`, Settings/Panel Settings `show`, `ui close`, screenshot `expectedUiGeneration` | Transient observation, generation semantics, exact instance/Panel routing                          |
| 2     | Theme/Profile authoring `show`, Feedback `show`, `ui cancel`, event-dialog observation      | Draft safety, real Cancel/Escape equivalence, no implicit Save/Send/Confirm                        |
| 3     | Agent-Control-only visual walkthrough tool                                                  | Repeatable orchestration, bounded restoration, removal of Playwright/CDP from product walkthroughs |

The manifest and capabilities advertise only methods completed in the current phase. Do not publish
future entries early.

---

## Phase 1 — UI identity, observation, and non-draft navigation

### Task 1: Define the pure UI Navigation state model

**Files:**

- Create: `src/uiNavigation/uiNavigationModel.js`
- Create: `src/uiNavigation/uiNavigationModel.test.js`

- [ ] Define the stable public enums for Settings sections, surface kinds/origins, and supported
      actions. Initial navigable kinds are `settings` and `panelSettings`; the model must already be
      able to project read-only event-decision descriptors without exposing their content.
- [ ] Define opaque surface-lifetime creation. IDs must be process-local, non-semantic, bounded
      strings; callers cannot derive one from a Panel ID or component name.
- [ ] Define the public `ui inspect` projection: generation, window form/visibility, workbench
      identity, active blocking-editor IDs, back-to-front surfaces, top surface, privacy-minimal
      target metadata, and supported actions.
- [ ] Define a generation reducer that increments exactly once for surface mount/unmount,
      semantic-target change, section/page change, clean/dirty boundary, stale/busy/blocking/
      dismissibility/action change, and real event-decision phase change.
- [ ] Prove the reducer does not increment for repeated identical observations, pointer/drag
      coordinates, raw scroll pixels, progress ticks, hover, animation, or repeated dirty input.
- [ ] Define stable model errors: `uiGenerationConflict`, `uiSurfaceNotFound`,
      `uiTargetNotFound`, `uiTargetNotVisible`, `surfaceUnavailable`, `uiActionUnavailable`,
      `uiConflict`, `uiBusy`, and `uiNotSettled`.
- [ ] Keep error details bounded and privacy-safe.

Run:

```powershell
npx vitest run src/uiNavigation/uiNavigationModel.test.js
```

Expected: generation and projection semantics are executable without React, DOM, persistence, or
Agent Control transport.

Commit:

```text
feat(ui): define navigation state model
```

---

### Task 2: Add the React controller and counted surface registry

**Files:**

- Create: `src/uiNavigation/UiNavigationContext.jsx`
- Create: `src/uiNavigation/UiNavigationContext.test.jsx`
- Modify: `src/App.jsx`

- [ ] Add `UiNavigationProvider` inside `BlockingEditorsProvider` and outside the editor/surface
      owners that must register with it.
- [ ] Expose `useUiNavigation()` for command operations and `useUiSurface()` for component
      registration. Consumer access outside the provider must throw; registration may follow the
      existing blocking-editor testability rule only if the consumer side remains fail-loud.
- [ ] Count registrations so React StrictMode double effects and duplicate mounts cannot remove a
      still-live surface.
- [ ] Store callbacks in refs so registry descriptors can update without remounting a surface or
      capturing stale Close/Cancel handlers.
- [ ] Expose `inspectUi`, `showSettings`, `showPanelSettings`, `closeSurface`, and a read-only
      `uiGeneration`. Do not add editor/Feedback public operations in Phase 1.
- [ ] Read `instanceId` and `workspaceId` from the existing boot snapshot. Accept the current
      Source-derived display name from `App` as presentation metadata; do not create another
      instance registry.
- [ ] Read active blocking editors from `BlockingEditorsContext`; do not copy the registry.
- [ ] Serialize controller actions and recheck expected revision/UI generation immediately before
      the first transition.
- [ ] Unit-test manual registration, action registration, exact surface lifetime, z-order,
      StrictMode, stale generation, wrong-surface refusal, and idempotent show/close.

Run:

```powershell
npx vitest run src/uiNavigation/UiNavigationContext.test.jsx src/hooks/BlockingEditorsContext.test.jsx
```

Expected: React owns one coherent transient UI registry without changing any existing surface yet.

Commit:

```text
feat(ui): add navigation controller
```

---

### Task 3: Make Settings semantically navigable

**Files:**

- Modify: `src/hooks/useSettings.js`
- Modify: `src/components/AppSettingsOverlays.jsx`
- Modify: `src/components/SettingsPanel.jsx`
- Modify: `src/components/SettingsPanel.test.jsx`
- Modify: `src/components/AppSettingsOverlays.test.jsx`
- Modify: `src/components/settingsDrawerContract.test.js`
- Modify: `src/App.jsx`

- [ ] Add stable section IDs for `behavior`, `shortcuts`, `appearance`, `analysis`, `channels`,
      `transfer`, `agent-control`, and `about` at the component-owned section elements. Do not use
      English heading text as the contract.
- [ ] Keep `agent-control` dynamically unavailable when that build does not render the row;
      `channels` must still target its empty explanatory state.
- [ ] Give `SettingsPanel` one semantic `show(section)` adapter that uses owned refs,
      `scrollIntoView`, and focus management after the Sheet mounts.
- [ ] Register one Settings surface only while the Sheet is mounted/open. Manual shortcut/header/
      footer opens and closes must update the same registry/generation as Agent Control.
- [ ] Make exact section requests idempotent. A different section advances `uiGeneration` once,
      even if the final raw scroll position is unchanged because the Sheet is short.
- [ ] Route Close through the same `onOpenChange`/animation-completion path as the visible close
      control. Do not set the final owner state behind the Sheet's transition contract.
- [ ] Add a bounded component acknowledgement after mount, target scroll/focus, layout stability,
      and transition completion. Report unavailable section before closing another surface.
- [ ] Test every section, manual open/close, repeated show, unavailable Agent Control section,
      animation completion, and absence of durable setting writes.

Run:

```powershell
npx vitest run src/components/SettingsPanel.test.jsx src/components/AppSettingsOverlays.test.jsx src/components/settingsDrawerContract.test.js src/uiNavigation/UiNavigationContext.test.jsx
```

Expected: Settings can be opened, positioned, observed, and closed through one semantic owner while
preserving all current GUI behavior.

Commit:

```text
feat(ui): navigate settings sections
```

---

### Task 4: Make normal and Dock Panel Settings navigable

**Files:**

- Modify: `src/components/PanelSettingsMenu.jsx`
- Modify: `src/components/PanelSettingsMenu.test.jsx`
- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/workspace/SplitLayout.jsx`
- Modify: `src/workspace/SplitLayout.test.js`
- Modify: `src/dock/useDockAccessoryVisibility.test.jsx`
- Modify: `src/App.jsx`
- Modify: `src/uiNavigation/UiNavigationContext.jsx`
- Modify: `src/uiNavigation/UiNavigationContext.test.jsx`
- Create or modify the nearest tree-location helper and test only if no existing pure helper can
  locate a Panel's leaf path.

- [ ] Pass the stable Panel instance ID into `PanelSettingsMenu`; module ID/title are insufficient
      when several instances share a module.
- [ ] Convert the Radix Popover to controlled `open/onOpenChange` state backed by the navigation
      controller. Manual trigger, Escape, and outside interaction must use the same path.
- [ ] Resolve a normal Workspace Panel to its containing leaf. If hidden behind a tab, call the
      existing `setActiveTab(path, panelId)` business action before opening settings.
- [ ] Preserve the current semantics of active-tab persistence and global revision observation;
      do not mark a Preset dirty merely for tab navigation if the existing action does not.
- [ ] In fullscreen, target only the fullscreen Panel. Define and test whether a non-fullscreen
      target exits fullscreen through the existing business action or returns
      `uiTargetNotVisible`; follow the spec's no-hidden-bypass rule and record the chosen behavior
      in `docs/agent-control/ui.md`.
- [ ] In Dock form, resolve only IDs in the Dock layout and call
      `dockAccessoryVisibility.openEditor("module:<panelId>")`; never confuse a Workspace Panel
      with a Dock Panel having a similar module.
- [ ] Reject missing/unsupported targets before closing Settings or another replaceable navigation
      surface.
- [ ] Register `panelSettings` with Panel ID and presentation (`normal`, `fullscreen`, or `dock`).
      Close must use the Popover/Dock accessory's existing path.
- [ ] Test duplicate module instances, hidden tab activation, revision plus generation changes,
      fullscreen behavior, Dock routing, exact-target idempotency, missing target, and manual close.

Run:

```powershell
npx vitest run src/components/PanelSettingsMenu.test.jsx src/workspace/SplitLayout.test.js src/dock/useDockAccessoryVisibility.test.jsx src/uiNavigation/UiNavigationContext.test.jsx
```

Expected: one semantic Panel ID opens exactly one real settings surface in the current window form.

Commit:

```text
feat(ui): navigate panel settings
```

---

### Task 5: Add Phase 1 wire methods and bridge routing

**Files:**

- Modify: `src/agentControl/commandManifest.json`
- Modify: `src/agentControl/commandManifest.js` only if a reusable generation schema reference is
  needed
- Modify: `src/agentControl/commandManifest.test.js`
- Modify: `src/agentControl/commandManifestTestFixtures.js`
- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/appSnapshot.js`
- Modify: `src/agentControl/appSnapshot.test.js`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] Add only `ui.inspect`, `ui.show.settings`, `ui.show.panelSettings`, and `ui.close` manifest
      entries in Phase 1.
- [ ] Use strict wire params. Every action requires `expectedRevision` and
      `expectedUiGeneration`; queries accept no params; actions reject `dryRun` and unknown fields.
- [ ] Project `features.uiNavigation` from implemented manifest entries, including supported
      targets and Settings section enum. Keep dynamic mode/section availability in `ui inspect`.
- [ ] Add a shared expected-UI-generation validator with non-negative safe-integer bounds and
      stable `uiGenerationRequired`/`uiGenerationConflict` details.
- [ ] Route `ui.inspect` directly to the controller's privacy-minimal snapshot.
- [ ] Before a UI action, check global revision with the bridge's existing current ref, then let the
      controller atomically recheck UI generation and target validity.
- [ ] Return `changed`, `action`, current `revision`, current `uiGeneration`, target `surface`, and
      compact `ui` state. Do not flush persistence for a UI-only action.
- [ ] When hidden-tab activation changes Workspace, reuse existing revision and persistence
      settlement; increment each generation exactly once and report both final values.
- [ ] Map controller failures to the agreed stable codes and existing exit classes. On settlement
      timeout, include committed/latest revision and UI generation so callers inspect before retry.
- [ ] Add bidirectional manifest/protocol/bridge coverage so every advertised method dispatches and
      every dispatch branch is advertised.

Run:

```powershell
npx vitest run src/agentControl/commandManifest.test.js src/agentControl/protocol.test.js src/agentControl/appSnapshot.test.js src/agentControl/useAgentControlBridge.test.jsx src/uiNavigation/*.test.*
```

Expected: frontend capabilities, validation, dispatch, concurrency, and UI ownership agree for the
Phase 1 family.

Commit:

```text
feat(agent-control): expose ui navigation foundation
```

---

### Task 6: Add Phase 1 CLI parsing, forwarding, help, and text output

**Files:**

- Modify: `src-tauri/src/cli_control.rs`
- Modify: `src-tauri/src/cli_contract.rs`
- Modify: `src-tauri/src/cli_manifest.rs` only if schema projection needs a named generation ref
- Modify: adjacent CLI snapshot/fixture files returned by the focused tests

- [ ] Add `ControlCommand` variants and strict parsing for:

```text
ui inspect <--json|--format text>
ui show settings [--section <section>] --expected-revision <n> --expected-ui-generation <n> --json
ui show panel-settings --panel-id <id> --expected-revision <n> --expected-ui-generation <n> --json
ui close <surface-id> --expected-revision <n> --expected-ui-generation <n> --json
```

- [ ] Preserve generic `--instance` extraction before family parsing and the existing environment/
      `legacy` behavior.
- [ ] Build exact camelCase wire params and never infer missing expected tokens.
- [ ] Keep actions JSON-only and `ui inspect` eligible for grouped text output. Text output must not
      print sensitive/internal descriptor fields.
- [ ] Derive family/root help and offline `schema list/get` from the manifest; update handwritten
      prose only where semantics cannot live in the catalog.
- [ ] Test option ordering, duplicate/missing options, invalid enums/integers/IDs, `--format text`
      eligibility, request JSON, method names, exit mapping, multi-instance forwarding, and help.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_control::tests --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml cli_contract --no-fail-fast
```

Expected: installed and development CLIs expose the same checked Phase 1 UI surface.

Commit:

```text
feat(cli): add ui navigation commands
```

---

### Task 7: Bind screenshots to UI generation

**Files:**

- Modify: `src/agentControl/commandManifest.json`
- Modify: `src/agentControl/commandManifestTestFixtures.js`
- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/visualControl.js`
- Modify: `src/agentControl/visualControl.test.js`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/agentControl/useVisualCaptureSurfaces.js`
- Modify: `src/agentControl/useVisualCaptureSurfaces.test.jsx`
- Modify: `src-tauri/src/cli_control.rs`
- Modify: `scripts/smoke-agent-control.mjs`
- Modify: `scripts/smoke-agent-control.test.js`

- [ ] Add optional `expectedUiGeneration` to `visual screenshot`; keep recordings unchanged in this
      feature unless a later real workflow requires correlation at start.
- [ ] Validate it in the frontend protocol and Rust CLI using the same safe-integer rules as UI
      actions.
- [ ] Recheck it at the existing render-settlement boundary immediately before native capture
      allocation, alongside optional expected revision.
- [ ] Return `uiGenerationConflict` without creating/staging an artifact when stale.
- [ ] Include the captured UI generation as correlation metadata in successful screenshot results.
- [ ] Add one smoke round trip: inspect UI, show Settings, screenshot with both expected values,
      close exact surface, and verify PNG plus final absence of the surface.

Run:

```powershell
npx vitest run src/agentControl/protocol.test.js src/agentControl/visualControl.test.js src/agentControl/useVisualCaptureSurfaces.test.jsx src/agentControl/useAgentControlBridge.test.jsx scripts/smoke-agent-control.test.js
cargo test --manifest-path src-tauri/Cargo.toml cli_control::tests --no-fail-fast
```

Expected: screenshots can prove the intended transient surface survived from navigation settlement
to capture allocation.

Commit:

```text
feat(visual): correlate screenshots with ui generation
```

---

### Task 8: Publish and verify the Phase 1 contract

**Files:**

- Create: `docs/agent-control/ui.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/agent-control/visual.md`
- Modify: `docs/user/cli.md`
- Modify: `docs/user/system-settings.md`
- Modify: `src/agentControl/publicSurfaceDocs.test.js`
- Generated: `docs/agent-control/generated/commands.md`
- Generated: `docs/agent-control/generated/schema.md`
- Modify: `scripts/documentationStructure.test.js` only for code-owned command facts not already
  covered by the manifest/docs snapshot.

- [ ] Document target meanings, two-token concurrency, generation rules, privacy-minimal inspection,
      idempotency, exact surface close, normal/fullscreen/Dock Panel behavior, settlement, errors,
      and multi-workbench selection.
- [ ] Make clear that `app.inspect` remains durable-state inspection and `ui inspect` is transient
      presentation inspection.
- [ ] Document optional screenshot UI generation and the `show -> screenshot -> close` workflow.
- [ ] Regenerate checked reference pages and make snapshot differences intentional.
- [ ] Run the full gate and a real Windows desktop smoke. Run macOS verification on an available
      host before considering the cross-platform phase complete.

Run:

```powershell
npm run docs:agent-control
npx vitest run src/agentControl/publicSurfaceDocs.test.js scripts/documentationStructure.test.js
npm run check
npm run smoke:agent-control
```

Expected: Phase 1 is a complete public feature with no undocumented or unadvertised path.

Commit:

```text
docs(agent-control): document ui navigation
```

---

## Phase 2 — Authoring editors, Feedback, and real event decisions

### Task 9: Lift editor page and dismissal intent to shared owners

**Files:**

- Modify: `src/components/ThemeEditor.jsx`
- Modify: `src/components/ThemeEditor.test.jsx`
- Modify: `src/hooks/useThemeEditor.js`
- Modify: `src/hooks/useThemeEditor.test.js`
- Modify: `src/hooks/useCustomThemeSettings.js`
- Modify: `src/hooks/useCustomThemeSettings.test.jsx`
- Modify: `src/components/LoudnessProfileEditor.jsx`
- Modify: `src/components/LoudnessProfileEditor.test.jsx`
- Modify: `src/hooks/LoudnessProfileContext.jsx`
- Modify: `src/hooks/LoudnessProfileContext.test.jsx`
- Modify: `src/components/AppSettingsOverlays.jsx`
- Modify: `src/components/AppSettingsOverlays.test.jsx`

- [ ] Move Theme Editor page selection and both editors' dismiss intent out of component-only local
      paths far enough that the visible close button, Escape, discard confirmation, and Agent
      Control invoke exactly one owner function.
- [ ] Do not move draft documents into UI Navigation. Theme/Profile controllers remain the only
      authoring-state owners.
- [ ] Preserve name-edit Escape behavior, undo/redo, preview publication/restoration, stale-source
      detection, default documents/names, save validation, and editor position persistence.
- [ ] Give each draft origin metadata sufficient to distinguish `create`, `edit`, `customize`, and
      `duplicate` plus source/base ID without exposing full document contents.
- [ ] Ensure Cancel of a clean draft closes directly; Cancel of a dirty draft opens the existing
      discard confirmation; confirming discard remains a visible UI-only action outside public
      Agent Control.
- [ ] Test that none of these refactors changes existing Save or library semantics.

Run:

```powershell
npx vitest run src/components/ThemeEditor.test.jsx src/hooks/useThemeEditor.test.js src/hooks/useCustomThemeSettings.test.jsx src/components/LoudnessProfileEditor.test.jsx src/hooks/LoudnessProfileContext.test.jsx src/components/AppSettingsOverlays.test.jsx
```

Expected: editors expose semantic begin/dismiss/page adapters without duplicating or weakening their
business rules.

Commit:

```text
refactor(editors): share authoring navigation intents
```

---

### Task 10: Add Theme/Profile authoring navigation

**Files:**

- Modify: `src/uiNavigation/uiNavigationModel.js`
- Modify: `src/uiNavigation/uiNavigationModel.test.js`
- Modify: `src/uiNavigation/UiNavigationContext.jsx`
- Modify: `src/uiNavigation/UiNavigationContext.test.jsx`
- Modify: `src/components/AppSettingsOverlays.jsx`
- Modify: `src/agentControl/commandManifest.json`
- Modify: `src/agentControl/commandManifestTestFixtures.js`
- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/appSnapshot.js`
- Modify: `src/agentControl/appSnapshot.test.js`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src-tauri/src/cli_control.rs`

- [ ] Implement the explicit command contracts:

```text
ui show theme-editor --mode create [--page <page>] ...
ui show theme-editor --mode edit --theme-id <custom-id> [--page <page>] ...
ui show theme-editor --mode customize --theme-id <builtin-id> [--page <page>] ...
ui show theme-editor --mode duplicate --theme-id <custom-id> [--page <page>] ...
ui show loudness-profile-editor --mode create ...
ui show loudness-profile-editor --mode edit --profile-id <id> ...
```

- [ ] Make mode mandatory and validate mode/ID combinations before closing any replaceable surface.
- [ ] Call only the existing GUI `beginCreate`/`beginEdit` paths. A show action may mint a transient
      draft ID and publish preview state but must not create a library item, write persistence,
      advance global revision, or dirty a Preset.
- [ ] Register the mounted editor with intent, source/base ID, draft ID, page, clean/dirty/stale/
      blocking state, and Cancel action; redact document values.
- [ ] Treat the editor as blocking immediately, not only after dirty.
- [ ] Make repeated requests idempotent only when mode, source/base identity, and requested page
      match. Any different authoring request returns `editorActive` without touching the draft.
- [ ] Extend capabilities, CLI parser/help/schema/text output, bridge, and errors atomically.
- [ ] Test every valid/invalid mode, built-in/custom boundary, source deletion race, clean/dirty
      cancellation, repeated create after cancellation, and no durable mutation before Save.

Run:

```powershell
npx vitest run src/uiNavigation/*.test.* src/hooks/useThemeEditor.test.js src/hooks/useCustomThemeSettings.test.jsx src/hooks/LoudnessProfileContext.test.jsx src/agentControl/protocol.test.js src/agentControl/useAgentControlBridge.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml cli_control::tests --no-fail-fast
```

Expected: all real editor launch modes are remotely navigable without expanding `show` into Save.

Commit:

```text
feat(agent-control): navigate authoring editors
```

---

### Task 11: Make Feedback a blocking navigable draft

**Files:**

- Modify: `src/components/FeedbackDialog.jsx`
- Modify: `src/components/FeedbackDialog.test.jsx`
- Modify: `src/components/AppSettingsOverlays.jsx`
- Modify: `src/components/AppSettingsOverlays.test.jsx`
- Modify: `src/hooks/BlockingEditorsContext.test.jsx`
- Modify: `src/lib/sceneOperations.js` only after reconciling any existing worktree changes
- Modify: nearest scene-operation integration tests, including an Agent Control entry point
- Modify: UI Navigation/manifest/protocol/bridge/CLI files from Task 10

- [ ] Move Feedback open/close ownership behind the shared UI adapter while keeping the current
      Settings-to-Feedback path intact.
- [ ] Register `useBlockingEditor("feedback", open)` because the dialog contains user-authored
      content with Send/Cancel semantics.
- [ ] Implement `ui show feedback` with no content, email, diagnostics, or submission parameters.
- [ ] Implement public `ui cancel <surface-id>` and register Feedback's visible Cancel callback.
- [ ] Prove show never reads diagnostics or performs network IO and cancel never calls
      `submitFeedback`.
- [ ] Test Preset apply/save/update and Dock entry refusal before mutation while Feedback is open,
      including an Agent Control path that could otherwise operate behind the modal.
- [ ] Preserve successful-send delayed close, validation, privacy link, diagnostics opt-in, and
      error retry behavior.

Run:

```powershell
npx vitest run src/components/FeedbackDialog.test.jsx src/components/AppSettingsOverlays.test.jsx src/hooks/BlockingEditorsContext.test.jsx src/hooks/usePresets.test.jsx src/agentControl/useAgentControlBridge.test.jsx
```

Expected: Feedback can be opened and safely canceled, but no scene replacement or network action
can bypass its draft semantics.

Commit:

```text
feat(ui): navigate feedback safely
```

---

### Task 12: Register real event and nested decision surfaces

**Files:**

- Modify: `src/components/UpdateDialog.jsx`
- Modify: `src/components/UpdateDialog.test.jsx`
- Modify: `src/components/CrashReportDialog.jsx`
- Modify: `src/components/CrashReportDialog.test.jsx`
- Modify: `src/components/CloseConfirmDialog.jsx`
- Modify: `src/components/CloseConfirmDialog.test.jsx`
- Modify: `src/components/LibraryConflictDialog.jsx`
- Modify: `src/components/LibraryConflictDialog.test.jsx`
- Modify: `src/components/ConfirmDialog.jsx`
- Modify: `src/components/ConfirmDialog.test.jsx`
- Modify: `src/components/LibraryExportDialog.jsx`
- Modify: `src/components/ItemPickerDialog.jsx`
- Modify: adjacent tests for transfer/reset/discard owners
- Modify: `src/uiNavigation/uiNavigationModel.js`
- Modify: `src/uiNavigation/UiNavigationContext.jsx`

- [ ] Register each real mounted decision with stable kind, `origin: event` or `origin: nested`,
      busy/dismissible/blocking state, and only the action its visible UI currently permits.
- [ ] Do not add any `show` method for these surfaces.
- [ ] Do not expose release notes, crash report payload/note/email, Feedback content, transfer item
      details beyond an already-public semantic type, or library-conflict document values.
- [ ] Route Cancel/Close through the same current callback as the visible UI. Busy updater phases
      must expose no dismissal action; close-confirmation Cancel must leave the app open; discard
      confirmation Cancel must keep the editor/draft.
- [ ] Increment generation once when the real owner mounts/unmounts or its decision phase changes,
      not for progress ticks or typing.
- [ ] Test that synthetic controller calls cannot create these surfaces and that another `show`
      returns `uiConflict`/`uiBusy` without hiding them.

Run:

```powershell
npx vitest run src/components/UpdateDialog.test.jsx src/components/CrashReportDialog.test.jsx src/components/CloseConfirmDialog.test.jsx src/components/LibraryConflictDialog.test.jsx src/components/ConfirmDialog.test.jsx src/components/AppSettingsOverlays.test.jsx src/uiNavigation/*.test.*
```

Expected: real decisions become safely observable without becoming a public fixture API.

Commit:

```text
feat(ui): inspect event driven decisions
```

---

### Task 13: Publish and verify the complete Phase 2 contract

**Files:**

- Modify: `docs/agent-control/ui.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/user/cli.md`
- Modify: `docs/user/system-settings.md`
- Modify: `docs/agent-control/themes.md`
- Modify: `docs/agent-control/loudness-profiles.md`
- Modify: `src/agentControl/publicSurfaceDocs.test.js`
- Generated: `docs/agent-control/generated/commands.md`
- Generated: `docs/agent-control/generated/schema.md`

- [ ] Document authoring modes, transient draft identity, blocking-before-dirty, idempotency keys,
      Cancel/discard behavior, Feedback privacy, observable event decisions, and the absence of
      generic Confirm/Save/Send.
- [ ] Regenerate reference docs and update command counts/fixtures intentionally.
- [ ] Run the full gate plus real desktop workflows on Windows and macOS: clean and dirty editors,
      Feedback, close confirmation, and development-only real lifecycle fixtures for update/crash.

Run:

```powershell
npm run docs:agent-control
npm run check
npm run smoke:agent-control
```

Expected: the complete UI family is public, synchronized, and proven not to bypass drafts or user
decisions.

Commit:

```text
docs(agent-control): complete ui navigation contract
```

---

## Phase 3 — Agent-Control-only visual walkthroughs

### Task 14: Define the declarative walkthrough manifest and restoration ledger

**Files:**

- Create: `scripts/ui-visual-walkthrough-lib.mjs`
- Create: `scripts/ui-visual-walkthrough-lib.test.js`
- Create: `docs/history/notes/` fixture/example only if a one-off review record is needed; do not
  create living docs that point back into history

- [ ] Define a bounded scenario manifest containing explicit workbench selector, durable commands,
      one UI target, screenshot target/output, and the exact state fields the scenario may touch.
- [ ] Reject arbitrary executable commands, shell strings, DOM selectors, free-form UI actions,
      generic Confirm, or undeclared restoration fields.
- [ ] Build a restoration ledger from initial `capabilities`, `inspect`, family-specific reads, and
      `ui inspect`. Do not treat `app.inspect` as a complete library backup.
- [ ] Refuse to start with an unrelated blocking editor, event decision, or unsupported capability.
- [ ] Define reverse dependency order, revision reconciliation, exact surface cleanup, and final
      equality verification. A generation conflict, state-committed error, unknown surface, or
      mismatch must stop and preserve evidence rather than force cleanup.
- [ ] Unit-test manifest validation and restoration planning without launching PLVS.

Run:

```powershell
npx vitest run scripts/ui-visual-walkthrough-lib.test.js
```

Expected: scenario scope and cleanup obligations are explicit before any live mutation.

Commit:

```text
feat(tooling): define ui visual walkthroughs
```

---

### Task 15: Implement the walkthrough runner using only `plvs-cli`

**Files:**

- Create: `scripts/ui-visual-walkthrough.mjs`
- Create: `scripts/ui-visual-walkthrough.test.js`
- Modify: `package.json`
- Modify: existing product-gallery/walkthrough script only after its scenarios are covered by the
  new manifest

- [ ] Invoke only the installed/development Agent Control CLI for live orchestration. Do not import
      Playwright, connect to CDP, evaluate JavaScript in the WebView, edit persistence files, or
      reload the frontend.
- [ ] Sequence `inspect -> family mutations -> ui show -> visual screenshot -> exact ui close/cancel
    -> durable restore -> verification`, refreshing revision/UI generation after every accepted
      change.
- [ ] Materialize command input documents in a private temporary directory and clean only that
      verified directory.
- [ ] Emit a bounded JSON report with scenario, commands, artifacts, initial/final identities,
      restoration verification, and failure evidence; do not include private draft/report content.
- [ ] Add dry fixture tests around the process runner and one real desktop scenario covering
      Settings, Panel Settings, Theme customize draft, Profile create draft, and blank Feedback.
- [ ] Keep renderer/performance probes and event-only screenshots on their dedicated development
      harnesses.

Run:

```powershell
npx vitest run scripts/ui-visual-walkthrough-lib.test.js scripts/ui-visual-walkthrough.test.js
npm run desktop
# In a second terminal, run the new walkthrough command against the development instance.
```

Expected: ordinary product UI walkthroughs require no Playwright/CDP and leave all declared state
exactly restored.

Commit:

```text
feat(tooling): orchestrate ui screenshots through agent control
```

---

### Task 16: Migrate eligible screenshot scenarios and retain explicit fixtures

**Files:**

- Modify: eligible gallery/walkthrough manifests and scripts discovered during Task 15
- Modify: `package.json` only if obsolete Playwright usage can be removed without affecting the
  separate community-preview renderer
- Modify: relevant development-fixture documentation/tests

- [ ] Migrate clean Settings sections, normal/Dock Panel Settings, Theme create/edit/customize/
      duplicate drafts, Profile create/edit drafts, blank Feedback, and ordinary Workspace/Dock
      captures.
- [ ] Keep development-only fixtures for update phases, crash variants/fatal fallback,
      close-confirmation timing, stale library conflicts, dirty discard/validation/undo edge states,
      Theme Preview/color pickers, transfer/native file dialogs, reset confirmation, OS permissions,
      drag/clipboard/shortcut capture, menus/tooltips/hover/focus states, hotplug/capture failures,
      and low-level renderer/performance probes.
- [ ] Do not remove Playwright globally if `generate-community-previews.mjs` still legitimately uses
      its isolated browser preview application. The goal is removal from real PLVS scene
      orchestration, not dependency removal by slogan.
- [ ] Compare before/after artifacts and require the same semantic scene, dimensions, and target
      crop before deleting an old path.
- [ ] Run all migrated walkthroughs twice and verify identical restoration reports.

Run:

```powershell
npm run check
npm run smoke:agent-control
# Run the migrated visual-review command twice against a clean development workbench.
```

Expected: public UI Navigation covers durable product walkthroughs while exceptional states remain
honest, development-only fixtures.

Commit:

```text
refactor(tooling): remove cdp from ui walkthroughs
```

---

## Final acceptance checklist

- [ ] `app.capabilities`, manifest, protocol, bridge, Rust parser/forwarder, help, offline schema,
      generated docs, and user docs advertise the same completed UI methods.
- [ ] `app.inspect` remains unchanged; transient presentation exists only under `ui inspect`.
- [ ] Every UI action requires both concurrency tokens; exact-surface Close/Cancel cannot target a
      replacement surface after a race.
- [ ] UI-only transitions never write persistence, dirty a Preset, or advance global revision.
      Hidden-tab activation reports its real Workspace revision effect.
- [ ] Create/customize/duplicate launches create only transient drafts; no library item exists
      before visible Save.
- [ ] A blocking editor is protected while open, not merely while dirty.
- [ ] Dirty Cancel opens the real discard decision; public Agent Control cannot confirm it.
- [ ] Feedback show/cancel performs no network request and blocks scene replacement.
- [ ] Event-driven dialogs cannot be synthesized through the public family.
- [ ] Screenshot generation conflict creates no artifact.
- [ ] Multi-workbench selection is exact and generations/surface IDs never cross instances.
- [ ] Real Windows and macOS UI/capture verification passes.
- [ ] `npm run check` passes before merge.
