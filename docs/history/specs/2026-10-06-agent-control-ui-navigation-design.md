# Agent Control UI Navigation Design

**Date:** 2026-10-06  
**Status:** Proposed for review  
**Scope:** Design only; no product code is changed by this record

## Summary

Add a closed, semantic `ui` command family to Agent Control. It lets an authorized caller inspect
transient UI, open or focus a small set of durable product surfaces, and invoke the same Close or
Cancel intent that the visible UI exposes. It does not offer clicks, selectors, arbitrary focus,
form filling, Save, Send, Confirm, or synthetic product events.

The initial public surface is:

```text
plvs-cli ui inspect --json
plvs-cli ui show settings [--section <section>] --expected-revision <n> --expected-ui-generation <n> --json
plvs-cli ui show panel-settings --panel-id <id> --expected-revision <n> --expected-ui-generation <n> --json
plvs-cli ui show theme-editor --mode <create|edit|customize|duplicate> [--theme-id <id>] [--page <page>] --expected-revision <n> --expected-ui-generation <n> --json
plvs-cli ui show loudness-profile-editor --mode <create|edit> [--profile-id <id>] --expected-revision <n> --expected-ui-generation <n> --json
plvs-cli ui show feedback --expected-revision <n> --expected-ui-generation <n> --json
plvs-cli ui close <surface-id> --expected-revision <n> --expected-ui-generation <n> --json
plvs-cli ui cancel <surface-id> --expected-revision <n> --expected-ui-generation <n> --json
```

Every running-app form continues to accept the existing `--instance <instance-id>` selector. A UI
command always addresses exactly one workbench. Panel IDs, Theme IDs, Profile IDs, revisions,
surface IDs, and UI generations are scoped to that selected running workbench.

`show` may reveal the workbench, activate the tab containing a target Panel, scroll to a semantic
section, open the requested surface, and request focus. It must never save a draft, submit a form,
send Feedback, confirm a destructive action, install an update, or manufacture the event that
normally creates an event-driven dialog.

## Context and current architecture

Agent Control already has the right control boundary:

- `plvs-cli` discovers one or more live workbenches and sends authenticated, bounded JSON-RPC to
  the selected instance over the platform transport.
- `src/agentControl/commandManifest.json` is the checked catalog used by the React protocol,
  Rust CLI parser/help/schema projection, capabilities, and generated reference documentation.
- `src/agentControl/useAgentControlBridge.js` validates and serializes requests, calls React-owned
  business functions, waits for observable settlement, advances one process-local global revision
  for durable controllable state, and maps stable errors.
- `app.inspect` deliberately omits sheets, dialogs, hover state, and other transient React state.
  Visual Capture captures the real rendered pixels but does not arrange those pixels.
- `BlockingEditorsContext` is the application-wide registry for open draft/preview/save/cancel
  editors. Preset scene replacement and Dock entry call the shared scene guard before mutation.
- Theme and Loudness Profile authoring already have React-owned controllers. Their Agent Control
  library mutations use the same planners and commit paths as the GUI rather than editing stores.
- Multi-workbench discovery is already public. The CLI refuses to guess when more than one instance
  is running, and `--instance` selects one instance endpoint.

The missing boundary is a semantic owner for transient UI. Today the open state is split between
`useSettings`, `AppSettingsOverlays`, local Radix Popover/Dialog state, Panel renderers, Theme and
Profile editor controllers, and event-driven lifecycle hooks. External CDP or Playwright can click
those components, but doing so depends on labels, DOM structure, timing, and a debug surface. It
also cannot state which product intent was accepted.

This design adds an app-layer UI navigation controller. It does not make DOM automation part of
Agent Control.

## User scenarios

1. **Guided support:** an agent inspects the selected workbench, opens Settings at Appearance or
   Feedback, and leaves the user at the real product UI. It cannot change a setting or send the
   form through the navigation family.
2. **Exact Panel guidance:** in a workspace containing several Stats or Spectrum instances, an
   agent opens settings for one opaque Panel ID. If that Panel is behind another tab, PLVS activates
   it through the same Workspace operation the UI uses before opening its settings.
3. **Authoring handoff:** an agent opens the real editor to create or edit a Theme/Profile, customize
   a built-in Theme, or duplicate a custom Theme, optionally at a semantic editor page, then hands
   control to the user. This creates only an unsaved editor draft. Save remains a user/editor action
   or a separate existing document mutation command, never a side effect of `show`.
4. **Safe cleanup:** an automation closes only the exact surface it opened. If a user opened a
   different dialog or made an editor dirty in the meantime, generation/surface checks refuse the
   cleanup instead of discarding work.
5. **Visual review:** a tool arranges durable state with existing Agent Control families, opens a
   semantic UI surface, proves its UI generation, captures real pixels, and restores only the state
   it declared it would touch.
6. **Real-event diagnosis:** when PLVS itself opens an update, crash, close, or conflict dialog, an
   agent can identify the surface and its currently safe actions. It cannot create a fake event to
   obtain a screenshot.

## Inventory and product boundary

### Publicly navigable surfaces

These surfaces represent durable user intentions and remain meaningful if their component library,
layout, or button labels change.

| Surface                 | Why it is public                                                                                | `show` target details                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Settings                | A user can be guided to a stable category of application settings.                              | Optional semantic section.                                                   |
| Panel Settings          | A user can be guided to the controls for one stable Panel instance.                             | Required workbench-scoped `panelId`.                                         |
| Theme Editor            | A user can create, edit, customize, or duplicate a Theme through the real preview/draft editor. | Explicit authoring mode; source ID where applicable; optional semantic page. |
| Loudness Profile Editor | A user can create or edit a Profile through the real draft editor.                              | Explicit authoring mode; source ID for edit.                                 |
| Feedback                | Support can bring the user to the real, privacy-preserving Feedback form without sending it.    | No form values are accepted.                                                 |

Editor `show` supports explicit authoring intents without creating a persistent library item:

| Editor command                          | Valid arguments            | Draft opened through the existing GUI controller         |
| --------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `theme-editor --mode create`            | No `--theme-id`            | A new blank custom Theme draft.                          |
| `theme-editor --mode edit`              | Required custom Theme ID   | An edit draft for that saved custom Theme.               |
| `theme-editor --mode customize`         | Required built-in Theme ID | A new custom Theme draft seeded from the built-in Theme. |
| `theme-editor --mode duplicate`         | Required custom Theme ID   | A new custom Theme draft seeded from the saved Theme.    |
| `loudness-profile-editor --mode create` | No `--profile-id`          | A new Profile draft with the GUI defaults.               |
| `loudness-profile-editor --mode edit`   | Required saved Profile ID  | An edit draft for that saved Profile.                    |

The mode is mandatory so a built-in Theme ID cannot silently change `edit` into `customize`, and a
source ID cannot be ignored accidentally. Invalid mode/ID combinations fail atomically before any
surface changes. Opening a create/customize/duplicate draft may mint an internal draft/item ID, but
that ID is transient: it is returned only as draft identity in `ui inspect` and does not appear in
the Theme/Profile library, advance the global revision, dirty the active Preset, or reach
persistence until the user explicitly saves in the editor. `ui show` has no Save path.

Settings sections are a public semantic enum, not text headings or DOM anchors:

```text
behavior
shortcuts
appearance
analysis
channels
transfer
agent-control
about
```

`agent-control` is unavailable when that build does not show the setting. `channels` remains
available with no active channels and scrolls to the explanatory empty state. `about` targets the
version/update/Feedback footer. The names describe product concepts; components may freely change
their markup.

Theme Editor pages are `core`, `palettes`, and `advanced`. Omitting `--page` preserves the page of
an already-open matching editor and otherwise opens its normal default page. Panel Settings has no
public row selector in v1: the Panel's existing settings surface is the semantic destination.

### Observable but not publicly showable surfaces

`ui inspect` reports these surfaces when the application has genuinely opened them, and `ui close`
or `ui cancel` may be available when the visible UI currently offers that action:

- update confirmation and its install/restart-failure phases;
- next-launch crash report prompt;
- application close confirmation;
- Theme/Profile library conflict notification;
- library export picker, import review, and import completion;
- configuration reset confirmation;
- Theme/Profile discard confirmation;
- native-operation error dialogs that are part of an existing user flow.

There is no `ui show update`, `ui show crash-report`, `ui show close-confirmation`, or generic
`ui show dialog`. The updater must first discover a real update, the crash reporter must have a real
pending local report, the OS close flow must request a decision, and a real stale draft must create
a library conflict. Agent Control must not forge those preconditions for screenshots.

When an event-driven surface is busy or offers no Cancel/Close action, inspection reports it as not
dismissible and the corresponding command fails without changing anything.

### Deliberately excluded public surfaces

The following are implementation details, redundant with existing semantic command families, or
primarily screenshot/test states:

- arbitrary buttons, links, inputs, selectors, coordinates, CSS/XPath, accessibility selectors,
  component names, or raw DOM focus;
- Device, Preset, Loudness Profile selection, Focus View, Help, file-history, and similar toolbar
  popovers. Their useful operations already have semantic command families or documentation;
- nested Select menus, tooltips, hover/pressed states, drag handles, rename inputs, color pickers,
  Theme Preview, and inline reset confirmations;
- native open/save dialogs and OS permission prompts;
- file-drop overlays, recording indicators, toasts, transient validation messages, and progress
  animation states;
- fatal-render fallback injection, panic injection, fake update availability, fake crash reports,
  fake hotplug, or fake library conflicts.

This boundary is intentionally narrower than every surface visible in a screenshot. A stable public
CLI is not a screenshot fixture API.

## Command contract

### `ui inspect`

`ui inspect` is a read-only query and accepts `--json` or `--format text`. It returns the current
global `revision`, independent `uiGeneration`, workbench identity, window form, active blocking
editor IDs, and visible public UI surfaces in back-to-front z-order.

Illustrative JSON result:

```json
{
  "revision": 44,
  "uiGeneration": 9,
  "workbench": {
    "instanceId": "opaque-instance-id",
    "workspaceId": "opaque-workspace-id",
    "displayName": "VLC"
  },
  "window": { "form": "normal", "visible": true },
  "activeBlockingEditors": ["theme"],
  "topSurfaceId": "theme-editor:draft-opaque",
  "surfaces": [
    {
      "surfaceId": "theme-editor:draft-opaque",
      "kind": "themeEditor",
      "origin": "navigable",
      "blocking": true,
      "dirty": false,
      "dismissible": true,
      "supportedActions": ["cancel"],
      "target": {
        "intent": "edit",
        "draftId": "custom-studio",
        "themeId": "custom-studio",
        "page": "core"
      }
    }
  ]
}
```

Inspection is intentionally privacy-minimal. It may report semantic identity, dirty/stale/busy
booleans, editor page/section, and allowed actions. It never returns Feedback text, email, crash
notes, report payloads, release-note bodies, typed Theme/Profile field values, clipboard contents,
or DOM text.

`surfaceId` identifies one mounted surface lifetime and is opaque. A surface reopened after closing
may receive a different ID. Callers must obtain it from `ui inspect`, not construct it.

### `ui show`

All `ui show` forms are actions. They require both `--expected-revision` and
`--expected-ui-generation`, do not support `--dry-run`, do not write persistence merely because a
surface opened, and return the settled UI snapshot plus the target surface.

Requiring both tokens keeps two different races explicit:

- `expectedRevision` protects semantic target resolution. A Panel may have been removed or moved
  behind another tab, and a Theme/Profile may have been changed or deleted.
- `expectedUiGeneration` protects transient intent. A user may have opened a dialog or started an
  editor after the caller inspected the UI.

The result includes `changed`, current `revision`, current `uiGeneration`, `action`, `surface`, and
compact `ui` state. Opening/focusing/scrolling alone leaves global revision unchanged. If Panel
navigation activates its containing tab through the existing Workspace business operation, that
durable observable Workspace change advances the global revision once and settles persistence by
the normal Workspace path. The UI generation also advances once for the resulting UI target.

`show` performs only these operations:

1. validate both concurrency tokens, the target ID, availability, and all blockers;
2. reveal/unminimize the selected workbench and request focus through the existing window boundary;
3. use the owning React business function to activate the target tab when Panel Settings needs it;
4. open or retarget the semantic surface through the UI navigation controller;
5. scroll/focus its semantic section or page through component-owned refs;
6. wait for a bounded mount/layout/paint settlement barrier;
7. return the state actually observed.

It cannot call a Save, Send, Confirm, Delete, Reset, Import, Export, Install, Restart, or Apply
handler. No form field values are accepted.

Create/customize/duplicate modes call the same `beginCreate` path as the visible GUI, including its
normal default document, derived name, source copy, preview publication, undo baseline, and transient
draft ID. Edit mode calls the same `beginEdit` path and retains the source library revision needed
for stale-draft detection. These are authoring-session transitions, not Theme/Profile library
mutations. A freshly opened draft is blocking even before it becomes dirty.

An already-open editor is an idempotent match only when its authoring intent and source identity
match the request: `create` matches the current new blank draft, `edit` matches the same saved item,
`customize` matches the same built-in base, and `duplicate` matches the same custom source. A
different intent/source returns `editorActive`; it never replaces the draft. Repeating `create`
after its earlier draft was canceled opens a new draft and may mint a new transient ID.

Settings, Theme/Profile editors, and Feedback are unavailable in Dock form. The command returns
`surfaceUnavailable` and does not exit Dock. Panel Settings uses the normal Panel popover in normal
form and the existing Dock editor accessory for a Dock Panel in Dock form. It never treats a normal
Workspace Panel ID as a Dock Panel ID or vice versa.

### `ui close` and `ui cancel`

Both commands require the exact `surfaceId`, expected global revision, and expected UI generation.
They operate only on that mounted surface and never fall back to whichever dialog happens to be on
top after a race.

- `ui close` is available for navigation surfaces whose visible contract is Close/Escape without
  discarding a draft, such as Settings and Panel Settings.
- `ui cancel` is available where the visible contract has a Cancel, Not Now, or equivalent Escape
  intent, such as Feedback, a clean editor, a close confirmation, or a dismissible crash prompt.

The surface registry exposes which action is valid. Calling the wrong one returns
`uiActionUnavailable` without trying a related action.

The command invokes the same intent callback as the component's button or Escape handler. It never
sets an `open` flag behind the component and never calls a lower-level draft rollback directly.
Consequences are deliberate:

- canceling a clean Theme/Profile editor closes it through its real controller and restores the
  prior preview target;
- canceling a dirty Theme/Profile editor follows the GUI path and opens its real discard
  confirmation instead of silently discarding the draft;
- the discard confirmation exposes only its Cancel/Close path to public UI Navigation. There is no
  generic Confirm command, so Agent Control cannot approve data loss;
- canceling Feedback is exactly its visible Cancel action. It does not submit the form;
- canceling a close-confirmation dialog leaves the application open;
- canceling a crash prompt follows its visible defer/close semantics and does not delete or send a
  report unless that is already the named user action in the component contract;
- an update dialog in a non-dismissible install phase refuses cancellation.

Close/cancel never advance the global revision unless the real visible callback itself changes
durable product state. They advance `uiGeneration` once when the surface topology or dismissibility
changes.

## UI generation and settlement

Transient UI does not belong in the global revision. Adding it there would wake configuration
waiters for sheets and dialogs, make ordinary typing contend with mutations, and contradict the
current public revision definition. UI Navigation therefore introduces a process-local unsigned
`uiGeneration`, reset on application restart.

`uiGeneration` advances once when a low-frequency, publicly observable UI fact changes:

- a registered surface mounts or unmounts;
- the semantic target of a surface changes;
- a Settings section or editor page changes through navigation;
- the first edit changes a draft from clean to dirty, or a save/reset makes it clean;
- stale, busy, blocking, dismissible, or supported-action state changes;
- an event-driven dialog genuinely appears, changes decision phase, or disappears.

It does not advance for every character, pointer move, animation frame, drag position, raw scroll
pixel, update progress tick, measurement frame, hover, or tooltip. This keeps it useful as an
optimistic-concurrency token rather than a rendering counter.

Every successful navigation action waits for a UI settlement barrier owned by the target component:

- the target is mounted and is the registry's intended semantic surface;
- the requested section/page has committed;
- target bounds are non-zero and stable across two animation frames;
- fonts are ready and visible canvases have correctly sized backing stores where applicable;
- no transition owned by that surface is still hiding the requested content.

The bounded failure is `uiNotSettled`. Its details state whether navigation was already committed,
and include the latest revision/UI generation so the caller can inspect rather than retry blindly.

Visual Capture gains an optional `expectedUiGeneration` input for screenshots. When provided, it is
checked at the existing render-settlement boundary alongside optional `expectedRevision`. This
allows `ui show -> visual screenshot` to prove that the intended overlay is still the one being
captured without coupling all screenshots to UI Navigation.

## State machine, conflicts, and idempotency

### Surface categories

The registry classifies each mounted surface as:

- **navigation**: replaceable, non-draft surfaces such as Settings and Panel Settings;
- **blocking editor**: draft/preview/save/cancel surfaces registered with `useBlockingEditor`;
- **event decision**: a modal created by a real application/OS/library event;
- **nested decision**: a confirmation owned by an already-open surface.

Only the first two categories have public `show` targets. All categories can be inspected.

Feedback contains user-authored text with Send/Cancel semantics, so it becomes a blocking editor
while open using ID `feedback`. This makes the existing global rule accurate and prevents scene
replacement or another UI navigation command from hiding and discarding typed Feedback.

### Conflict rules

The controller validates the complete transition before closing or retargeting anything:

1. A matching already-open target is allowed.
2. A different blocking editor returns `editorActive` with the existing stable editor IDs.
3. An event or nested decision that must remain on top returns `uiConflict` with its surface kind
   and allowed actions.
4. A busy, non-dismissible surface returns `uiBusy`.
5. A replaceable navigation surface may close through its real close callback only after the new
   target has been fully validated.
6. A missing Panel/Theme/Profile or a form/section unavailable in the current build/mode fails
   before any visible surface changes.

The controller never invokes `assertSceneOperationAllowed` as a substitute for these rules. It
reads the same blocking-editor registry, while actual scene operations continue to enforce their
guard in their business functions. This avoids creating a second definition of which operation can
destroy an editing context.

### Idempotency

Repeating an exact settled `show` target is a no-op:

- Settings must match the requested section;
- Panel Settings must match Panel ID and window form;
- Theme/Profile editor must match authoring mode, applicable source/base item ID, and requested page
  when one was supplied;
- Feedback must already be the active Feedback surface.

The result returns `changed: false` and neither revision advances. The implementation may reassert
window focus without treating that best-effort OS request as a new UI state. A different section,
page, or Panel target is a real UI change and advances `uiGeneration` once.

Close/cancel for a surface that has already disappeared does not guess. It returns
`uiSurfaceNotFound`. Idempotent cleanup tools should inspect and treat absence of the surface they
opened as already clean.

### Initial stable errors

- `uiGenerationConflict` — expected and current UI generations differ;
- `uiSurfaceNotFound` — the opaque mounted surface ID is no longer present;
- `uiTargetNotFound` — the requested semantic Panel/Theme/Profile does not exist in this workbench;
- `uiTargetNotVisible` — a target cannot be rendered in the current form and cannot be activated
  through the supported business path;
- `surfaceUnavailable` — the build/platform/window form does not support the target;
- `uiActionUnavailable` — this surface does not currently expose the requested Close/Cancel intent;
- `uiConflict` — a real event/nested decision must be handled first;
- `uiBusy` — the owning flow is in a non-dismissible phase;
- `editorActive` — a different blocking editor is open;
- `uiNotSettled` — the target did not reach the bounded mount/layout/paint barrier;
- existing `revisionConflict`, `panelNotFound`, `themeNotFound`, and
  `loudnessProfileNotFound` remain valid where the dedicated resource owns the failure.

State-conflict errors exit `4`; invalid IDs/sections/pages exit `3`; unexpected native or settlement
failures exit `1`, following the existing CLI classes.

## React and bridge architecture

### UI navigation controller

Introduce a React-owned `UiNavigationProvider` under the existing `BlockingEditorsProvider`, with a
`useUiNavigation` hook. It owns only transient navigation intent and the mounted-surface registry.
It does not own Workspace, Theme, Profile, Settings, or persistence data.

The controller exposes typed operations rather than setters:

- `inspectUi()`;
- `showSettings(section)`;
- `showPanelSettings(panelId)`;
- `showThemeEditor({ mode, themeId, page })`;
- `showLoudnessProfileEditor({ mode, profileId })`;
- `showFeedback()`;
- `closeSurface(surfaceId)`;
- `cancelSurface(surfaceId)`.

Components register a semantic descriptor and the exact callbacks their visible UI uses. Registration
is counted like `useBlockingEditor` so StrictMode and duplicate mounts cannot drop a live surface.
Registration/unregistration is what drives topology generation; Agent Control does not discover
surfaces with `querySelector`.

### Existing owners remain authoritative

- Settings continues to open through `useSettings`; the section mapping and scroll/focus refs live
  inside `SettingsPanel`.
- Panel Settings becomes a controlled Popover. Normal Workspace tab activation uses the existing
  Workspace business function; Dock uses `dockAccessoryVisibility.openEditor`. The controller
  never writes `workspaceStore` or a Radix internal state value.
- Theme Editor starts through the existing `beginCreate`/`beginEdit` controller paths used by New,
  Customize, Duplicate, and Edit in the GUI. Page and dismiss intent move to owner-level state so
  the toolbar, Escape, discard confirmation, and Agent Control all call one function. Cancel remains
  the existing preview restore path.
- Loudness Profile Editor starts and cancels through `LoudnessProfileContext.beginCreate`,
  `beginEdit`, and `cancelDraft` via a shared dismiss-intent wrapper that preserves dirty
  confirmation semantics.
- Feedback open/close moves out of an isolated local boolean into the controller-facing owner. Its
  visible Cancel and Agent Control Cancel share one callback, and the surface registers with
  `useBlockingEditor("feedback", open)`.
- Update, crash, close-confirmation, library conflict, transfer, reset, and discard components
  register inspection/dismissal adapters only while their real owners mount them. They expose no
  public show operation.

The bridge receives one memoized `ui` controller in `App.jsx`. `useAgentControlBridge` validates the
request and both generations, calls the controller, and waits for the controller's observable
settlement. It never imports component modules, dispatches DOM events, calls `.click()`, or mutates
a store directly.

### Atomicity and queues

UI actions run through the existing serialized Agent Control action/mutation lane. User input can
still race, which is why both tokens are checked again immediately before the first transition.
Multi-step Panel navigation validates the Panel and destination first, then batches tab activation
and desired-surface state in React. If the owning durable Workspace operation commits, its existing
revision/persistence settlement remains authoritative. UI settlement is reported separately.

There is no rollback by replaying inverse UI callbacks. A post-commit timeout reports the partial
outcome and requires inspection, matching the existing `commitNotObserved` principle.

## Capabilities, schema, CLI, and documentation synchronization

Implementation of each phase must update the complete Agent Control contract together:

1. Add the `ui` entries and strict wire schemas to `commandManifest.json`, including CLI paths,
   args, execution kind, text-output eligibility, and feature gate if one is introduced.
2. Make `app.capabilities.methods` advertise only implemented wire methods. Add a compact
   `features.uiNavigation` capability with supported navigable targets and Settings/editor enums;
   dynamic availability remains in `ui inspect`, not capabilities.
3. Extend protocol normalization so unknown fields, invalid enum values, missing concurrency
   tokens, and incompatible target arguments fail before dispatch.
4. Extend the Rust CLI parser/forwarder/help/text formatter and offline `schema list/get` projection.
   `--instance` behavior stays generic and unchanged.
5. Add the React UI controller, surface registrations, bridge routing, generation tracking, and
   screenshot `expectedUiGeneration` check.
6. Add `docs/agent-control/ui.md` for semantics, concurrency, surface taxonomy, and errors; add the
   family to `docs/agent-control/README.md`; update `docs/user/cli.md` and the matching Settings/user
   guidance because the capability is user-visible.
7. Run `npm run docs:agent-control` to regenerate `docs/agent-control/generated/`; never edit it by
   hand.
8. Extend `publicSurfaceDocs.test.js`, command-manifest counts/fixtures, protocol coverage, Rust CLI
   contract tests, and documentation-structure checks so a command cannot land in only one layer.

`app.inspect` remains unchanged. Transient UI belongs only to `ui inspect`; this preserves the
meaning and payload stability of the broad durable-state snapshot.

## Phased implementation

### Phase 1: observation and non-draft navigation

- Introduce the controller, registry, UI generation, `ui inspect`, capabilities/schema/CLI plumbing,
  and contract documentation.
- Register Settings, normal/Dock Panel Settings, and currently mounted event-driven dialogs.
- Implement `ui show settings`, `ui show panel-settings`, and `ui close`.
- Add optional `expectedUiGeneration` to Visual Capture screenshots.
- Prove instance scoping with two workbenches and duplicate Panel module types.

This phase creates the concurrency and observation foundation without touching authoring editors.

### Phase 2: draft editors and Feedback

- Refactor Theme and Loudness Profile dismissal intent so UI buttons, Escape, discard confirmation,
  and Agent Control share owner-level functions.
- Implement Theme/Profile `show` commands and `ui cancel`.
- Move Feedback open state behind the same owner, register Feedback as blocking, and implement
  `ui show feedback` without any input/submission parameters.
- Add dirty/stale/busy transition generation and conflict tests.

### Phase 3: Agent-Control-only visual review orchestration

- Add a repository tool that consumes a declarative scenario manifest and invokes only `plvs-cli`
  running-app commands.
- Replace Playwright/CDP setup in product screenshot walkthroughs where every required state is now
  semantic.
- Keep performance instrumentation and low-level renderer diagnostics on dedicated development
  probes; UI Navigation is not a replacement for profiling APIs.
- Evaluate a `ui wait --after-generation` query only if event-driven review workflows demonstrate a
  real need. Do not add it speculatively in v1.

Each phase runs focused tests during development and `npm run check` before merge.

## Test plan

### Pure/controller tests

- strict target/section/page validation and privacy-minimal inspection projection;
- one generation increment per topology/target/dismissibility transition;
- no generation churn for additional characters, pointer motion, scroll pixels, or progress ticks;
- exact-target idempotency and retarget generation behavior;
- opaque surface lifetime and stale-surface refusal;
- conflict ordering: validate new target before closing a replaceable surface;
- event-driven surfaces cannot be shown and expose only their actual current actions.

### React integration tests

- Settings opens, scrolls to each semantic section, settles, and repeated show is a no-op;
- Panel Settings opens for the requested Panel among duplicate module instances, activates a hidden
  tab through the existing Workspace path, and uses the Dock editor for a Dock Panel;
- Theme/Profile editors use the existing begin-create/begin-edit paths for every authoring mode,
  preserve default naming/copy/preview/undo behavior, create no library item before Save, and refuse
  a different intent or target while any blocking editor is open;
- repeated create/edit/customize/duplicate requests are idempotent only for the matching current
  authoring intent and source identity;
- clean editor cancel closes through the real controller; dirty editor cancel opens the real discard
  confirmation and does not mutate the library or persisted selection;
- Feedback registers as blocking, never sends on show/cancel, and scene operations are refused
  before mutation while it is open;
- update/crash/close/conflict dialogs appear in inspection only when their real owner mounts them;
- busy update cancellation is refused; close-confirmation cancel leaves the application open;
- no request path calls DOM `.click()`, mutates persistence directly, or bypasses
  `useBlockingEditor`/business functions.

### Protocol, CLI, and compatibility tests

- manifest, capabilities, protocol normalizer, canonical params, parser, help, schema projection,
  text output, JSON envelopes, exit classes, and generated docs agree;
- every action requires both concurrency tokens and never accepts `--dry-run`;
- old clients ignore the new capability/methods; new clients use capability discovery and receive
  normal unknown-command behavior from older apps;
- single-instance default behavior, multi-instance `instanceSelectionRequired`, explicit
  `--instance`, environment selection, and `legacy` compatibility remain intact;
- UI generations from one workbench never affect another workbench;
- screenshot expected-UI-generation conflict creates no artifact.

### Real desktop tests

On Windows and macOS:

1. open each public target in a real Tauri window and capture it through Visual Capture;
2. verify normal/Dock availability and the correct Dock accessory target;
3. run two workbenches with overlapping Panel IDs/module types and prove exact instance routing;
4. race manual UI changes against a stale generation and verify no wrong surface closes;
5. open a dirty editor manually, request another surface, and verify the draft remains visible and
   unchanged;
6. trigger real close confirmation and a development update/crash fixture, then verify inspection
   and safe cancellation without a public synthetic-show command;
7. run `npm run smoke:agent-control` after extending it with one UI inspect/show/screenshot/cancel
   round trip.

This feature does not touch the audio callback, capture engine, or DSP. Capture soak is not required
unless implementation unexpectedly changes those directories.

## Screenshot walkthrough without Playwright or CDP

The future walkthrough tool uses Agent Control as a transaction-like orchestrator, not as a generic
browser driver:

1. select one workbench explicitly and call `capabilities`, `inspect`, and `ui inspect`;
2. refuse to begin if an unrelated blocking editor or event decision is already open;
3. record the exact durable fields the scenario declares it may touch, plus the initial UI surface
   state; do not pretend `app.inspect` is a complete backup of every library;
4. use existing semantic families to arrange Workspace, Panel, Axis, Theme, View, Transport,
   Device, and Dock state with revision checks;
5. call `ui show` with both tokens and retain the returned surface ID/UI generation;
6. call `visual screenshot` with expected revision and expected UI generation;
7. close/cancel only the surface opened by the tool, using its exact surface ID;
8. restore touched durable state in reverse dependency order through the same semantic command
   families, reconciling each new revision;
9. inspect again and compare all declared restoration fields. Any pre-existing or newly dirty draft,
   unknown event dialog, state-committed error, or restoration mismatch fails the run visibly.

The tool must never restore by importing a whole configuration over a live user's unrelated work,
editing `plvs-settings.json`, reloading the WebView, or replaying DOM clicks. Scenario manifests
declare their mutations so restoration is bounded and verifiable.

Clean Settings, Panel Settings, new/edit/customize/duplicate Theme drafts, new/edit Profile drafts,
blank Feedback, normal/Dock layouts, and ordinary screenshots no longer need Playwright/CDP after
Phase 3. Renderer performance and low-level Canvas/WebGL diagnostics may still use development
instrumentation because they ask questions Agent Control's product contract intentionally does not
expose.

## Screenshot scenes that still require development-only fixtures

Public UI Navigation must not expand to cover these. Keep them in component preview routes,
test-only lifecycle injection, or dedicated development harnesses that cannot ship as public Agent
Control methods:

- update available, download progress, install failure, installed/restart failure, and unusually
  long release notes;
- pending crash report variants, send failure/busy state, retention cases, and fatal React fallback;
- close-confirmation variants and native shutdown timing;
- stale Theme/Profile conflicts and library conflict resolution;
- dirty-editor discard confirmation, validation errors, undo/redo edge states, color-picker internals,
  and Theme Preview;
- library export selection, native open/save cancellation, import review/conflicts/completion, and
  configuration reset confirmation;
- OS permission prompts, updater/native file dialogs, real drag-and-drop hover, clipboard paste,
  keyboard-shortcut recording, tooltips, Select menus, hover/pressed/focus-ring states, and toasts;
- deterministic hotplug/disconnect errors, capture failures, and platform-native accessibility or
  scaling states that require a rig;
- Canvas/WebGL fallback, draw-count, frame-backpressure, CPU, memory, and compositing probes.

Fixtures may render the real component and real product state machine with synthetic input, but they
remain explicitly development-only and are never advertised in `app.capabilities` or the installed
CLI schema.

## Compatibility and security

- This is an additive command family under protocol v1. Existing clients ignore new methods and
  feature fields. New clients discover methods before use.
- No DOM selector, arbitrary window handle, URL, file path, form value, or free-form action name
  crosses the wire.
- Current-user transport authentication, request bounds, Agent Control enablement, activity
  visibility, and multi-instance identity checks remain unchanged.
- UI inspection redacts user-authored and diagnostic content.
- `show` cannot cause network transmission or destructive confirmation. The public family contains
  no generic Confirm/Submit/Click command.
- Surface IDs and generations are process-local concurrency tokens, not durable identifiers.
- Public command spelling uses stable product nouns even if React components or Radix primitives
  are replaced.

## Decisions for review

1. Ship the closed target list: Settings, Panel Settings, Theme editor with explicit
   create/edit/customize/duplicate intent, Loudness Profile editor with explicit create/edit intent,
   and Feedback.
2. Keep event-driven dialogs inspectable/cancelable only after real events; never add synthetic
   public show commands for them.
3. Require both global revision and UI generation for every UI action.
4. Keep transient UI out of `app.inspect` and the global revision.
5. Register Feedback as a blocking editor because it owns user-authored draft content.
6. Let Panel Settings activate its containing tab through the existing Workspace business path,
   with the resulting global revision/persistence semantics.
7. Expose separate `close` and `cancel` actions and no generic Confirm action.
8. Make dirty editor cancellation enter the real discard-confirmation flow; Agent Control cannot
   confirm the discard in v1.
9. Add optional screenshot `expectedUiGeneration` for race-free visual review.
10. Keep screenshot-only states in development fixtures, not the installed CLI.
11. Treat creation/customization/duplication as transient authoring-session launch: it may mint a
    draft ID and publish preview state, but it creates no library item or durable revision until the
    user explicitly saves.
