# Shared Settings in the Normal Window and Dock

Date: 2026-11-04
Status: In progress. Shared content and persistent ownership are implemented; the native Dock
Settings host and its entry point are not yet exposed.

## Intent

Expose Settings in the Dock toolbar without leaving Dock or restarting capture. Share the
Settings controls, validation, authoring rules, and business actions with the normal window.
Keep native window growth bounded and avoid adding Dock branches throughout individual controls.

The visible entry remains **Settings**, matching the current normal-window label.

## Findings from the baseline implementation

Inspected baseline: `6f1486775` on `main`, before the extraction below.

| Area                   | Current implementation                                                                                                                                                                                           | Consequence                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings ownership     | `SettingsProvider` mounts one `useSettings` in the main application.                                                                                                                                             | Keep this owner; a second provider in another WebView would also mount preference effects and integrations.                                        |
| Settings presentation  | `SettingsPanel.jsx` combines controls, section navigation, Radix Sheet framing, animation, and UI Navigation registration.                                                                                       | It cannot be moved unchanged into a small accessory window.                                                                                        |
| Overlay lifetime       | `AppShell.jsx` renders its children, including `AppSettingsOverlays`, only in normal form.                                                                                                                       | Dock unmounts configuration actions, overlay-local state, and navigation registrations in that subtree. Merely adding a button cannot expose them. |
| Authoring              | Theme state lives in `useCustomThemeSettings` / its editor controller; feedback state and submission currently live inside `FeedbackDialog`. Profile authoring is supplied by the existing Loudness Profile API. | There is reusable business logic, but feedback and some overlay coordination still need extraction.                                                |
| Dock windows           | `dock_accessories.rs` uses fixed labels, serialized creation, and reuse. Toolbar and editor are prepared on Dock entry; update/import windows have separate preparation paths. Closing normally hides windows.   | Each accessory is a real WebView with retained resource cost, rather than an inexpensive DOM popup.                                                |
| Small Dock editor      | `DockEditorApp.jsx` closes on blur and Escape and measures content plus space for dropdowns.                                                                                                                     | Its transient-menu behavior is unsuitable for Settings authoring and native file-dialog workflows.                                                 |
| Existing reuse example | `DockUpdateApp.jsx` renders shared update content from snapshots and sends actions to the main window.                                                                                                           | Use this established presentation/owner split rather than inventing a second application runtime.                                                  |
| Accessory permissions  | `capabilities/dock-accessories.json` grants event exchange; main has the store, native integration, and file-dialog permissions.                                                                                 | Keep settings mutations and native operations in main.                                                                                             |
| Existing entry points  | Tray Settings restores normal form; Dock status Settings also exits Dock; the Settings shortcut is ignored in Dock.                                                                                              | All entry points need the same routing policy.                                                                                                     |
| Automation             | `UiNavigationContext.jsx` explicitly rejects Theme and Loudness Profile editor navigation in Dock; Settings targets are registered in the unmounted normal subtree.                                              | Availability, registration, settlement, and target reporting must change together.                                                                 |

Sources above refer to files under `src/`, except native files under `src-tauri/src/` and
capabilities under `src-tauri/`. These are source-inspection findings, not runtime measurements.
The native code records an earlier Windows measurement of approximately 33 MB private memory and
70 MB working set per accessory renderer; this is context, not a budget or a current result.

## Recommended structure

### Shared content, two presentation hosts, one owner

Keep the normal Settings side sheet. Add one lazily created Settings accessory per workbench,
tentatively named `dock-settings`. Repeated clicks focus the existing window. Settings does not
borrow the transient `dock-editor` and does not create a native window for each child editor.

Separate the current implementation along these boundaries:

1. **Main-owned controller:** current values, business actions, authoring drafts, preview, busy/error
   state, and flow coordination. Mount the necessary controller layer outside AppShell's
   normal-only presentation branch. Keep existing settings, profile, and transfer owners; do not
   create another `useSettings`, capture runtime, or shortcut registration in the accessory.
2. **Shared content:** Settings sections and editor/form bodies take values and callbacks. They
   contain no Dock detection, window positioning, cross-window events, or duplicate persistence.
   Extract only the framing and side effects necessary for reuse; retain existing control widgets.
3. **Presentation hosts:** normal uses the current Sheet and floating/dialog framing; Dock uses one
   native Settings window. The hosts own framing, positioning, focus, and section settlement.
4. **Small explicit accessory adapter:** main publishes serializable view state; the accessory maps
   callbacks to named actions, which main dispatches through the existing business functions.
   Use the existing accessory event conventions. Do not build generic remote React, serialize
   arbitrary callbacks, or expose a generic store-patch action.

React context and function references cannot be shared across the separate WebViews. Sharing
components therefore still requires this explicit adapter; it is necessary integration work,
not something that reuse of JSX alone removes.

Keep purely visual state local where practical: expanded help, hover, scroll, and focus. Keep
authoritative drafts and operations in main, including feedback submission and diagnostic capture.
Feedback diagnostics must describe the owning application, not just the accessory. Text inputs may
keep local typing state, but Save/Submit must carry the current value explicitly or await an
acknowledged draft update. Closing must never race an unacknowledged draft change.

### Behavior that remains shared

| Operation                 | Contract in both forms                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Change a regular setting  | Existing immediate-apply behavior, validation, errors, and persistence; no new global Save button.                            |
| Theme/Profile authoring   | Same fields, preview, undo where supported, Save, Cancel, stale-source handling, and existing discard decisions.              |
| Feedback                  | Same content, consent, diagnostics preview, submission, and close/busy rules.                                                 |
| Import/export/reset       | Existing parsing, selection, confirmation, native dialogs, and relaunch semantics.                                            |
| Close a child surface     | Run its existing dismiss/cancel action; do not treat hiding a native window as cancellation.                                  |
| Focus another application | Does not dismiss the Settings accessory or lose drafts. Normal Sheet outside-click dismissal can remain normal-host behavior. |
| Escape/window close       | Route to the foremost active surface's existing close/cancel decision; busy and unsaved rules still apply.                    |
| Scene operations          | Retain business-function guards based on an editor being open, including clean drafts.                                        |

Do not add automatic return to Settings after editing only in Dock. Current Theme and Feedback
entry actions close Settings; preserve those transitions in both forms initially. A later return
navigation improvement should be designed and applied to both forms together.

Native title bars, screen placement, and modal scope differ between a side sheet and a separate
window. The ordinary Sheet blocks the normal workspace; the Dock Settings window is not an
OS-wide modal. Explicitly preserve business-operation blocking through existing guards, without
claiming the two window hosts have identical native modality.

### Window and flow coordination

- Opening Settings closes the small Dock editor. The toolbar may hide independently; that must not
  close Settings. Settings and its child editors occupy the same native Settings window.
- Confirmation dialogs and dropdowns stay inside that window, using shared components with correct
  local portal roots, focus trapping, and adequate viewport space. Do not blanket-disable modal
  behavior or add delayed focus retries to individual controls.
- Keep existing update and import accessories in this iteration. Reuse their existing flows and
  shared content. When one of these takes over, suspend the Settings presentation and restore it
  after the flow settles. Do not render the same review/update in both windows. Background update
  checks and downloads must not steal focus. A conflicting active draft must be reconciled through
  existing guards before a handoff.
- Native file pickers remain system dialogs, owned by main's existing actions. Do not auto-hide
  Settings on blur. Verify dialog ownership and foreground behavior on Windows and macOS; if main's
  Dock window is an unsuitable parent, add one narrow dialog-parent integration rather than
  granting the accessory the main window's full capability set.
- Quick Tour is currently a normal Live workspace flow. Keep that prerequisite explicit and reuse
  its existing transition/eligibility logic; do not build a separate Dock tour. Crash-report prompts
  retain their current normal-window restoration policy in this iteration.
- A new settings session begins only after fresh state and readiness acknowledgement. Actions carry
  session/request identity; draft actions also identify their draft. Reject expired-session or
  wrong-draft actions, prevent duplicate destructive submissions, and report success/error before
  advancing the UI. Refresh and reconcile on stale state rather than replaying mutations blindly.
- Initial position follows the Dock monitor, fits its available area, and supports scrolling at
  large Interface Size. Reuse frontend `webviewScale` conversion and native geometry conventions.
  Avoid applying macOS accessory ordering or full-screen rules without including the new host.
- Main remains the owner through presentation changes. Preserve existing Dock-entry editor guards;
  opening editors from an already docked Settings window is a separate supported path. Do not
  discard drafts to make entering/exiting/hiding Dock succeed. Test exit, suspension, tray hiding,
  and monitor loss so drafts never become inaccessible. If a draft cannot be presented after a
  transition, refuse before mutation rather than silently unmounting it.

## Resource policy

- Add at most one native WebView per workbench for this feature, created on first use rather than
  startup or Dock entry. Reopening reuses it; feature count does not increase the window count.
- On close, unmount inactive content, stop its view-specific subscriptions/observers/animation, and
  stop routine Settings snapshot publication. Keep only the minimal readiness/reopen mechanism.
  Main-owned update operations may continue under their existing lifecycle.
- Initially keep the lightweight hidden host for fast reopening, matching current accessory reuse.
  Hiding does not promise memory reclamation. Revisit destruction only if measurements justify it,
  after authoring and busy lifetimes are independent of presentation.
- Send Settings state on meaningful changes, never the capture-frame or history stream. Send only
  the data required by the active flow; exclude unrelated diagnostics and drafts from other windows.
- Do not add a general window manager or consolidate all existing accessories as a prerequisite.

## Entry points and automation

Introduce one main-owned open/focus Settings action with optional section. Route the normal gear,
Dock gear, tray Settings, supported Settings shortcut, status actions, and About/update-settings
navigation through it. It chooses the host from the current form while preserving existing busy
and blocking-editor checks. Repeated opening focuses rather than toggles a draft away.

UI Navigation registrations belong to the persistent owner/coordinator, with presentation readiness
and section focus acknowledged by the active host. Register only one logical surface per flow.
Continue serving Agent Control from main; update Draft Control, UI targets, pointer geometry, and
visual capture so a successful navigation response corresponds to the visible accessory. Remove
Dock authoring rejections only when the corresponding presentation and settlement path works.

Follow `docs/agent-control/README.md` synchronization requirements for changed public surfaces,
including capability/schema/manifest declarations where applicable, mappings, docs, and contract
tests. Regenerate derived documentation through tooling. No new public command is required merely
to add the gear; existing navigation commands should gain accurate Dock availability.

## Implementation sequence

1. Extract shared Settings content and necessary owner/controller code while retaining normal
   presentation and behavior. Separate Feedback business state and editor bodies from their
   draggable/dialog frames only as needed. Validate normal-mode parity before adding a window.
2. Prove the accessory boundary with Settings sections, a native file-dialog round trip, and a
   complete Theme create/preview/save/cancel/discard flow on Windows and macOS. This is a development
   checkpoint, not a partially exposed Settings release. Resolve focus, portal, preview, and typing
   synchronization here before expanding the adapter.
3. Complete all reachable Settings paths, including Profile authoring, Feedback, library transfer,
   configuration actions, updates, and explicitly normal-only flows. Add the Dock gear and unified
   entry points once these paths can settle visibly without losing state.
4. Complete automation parity, platform/resource verification, and user documentation. Record an ADR
   with implementation for choosing a separate persistent Settings host over the smaller shared
   Dock editor. This proposal is historical design, not a statement of shipped behavior.

## Validation and acceptance

- Shared-content tests assert the same controls, order, availability, values, and business callbacks
  through both adapters. Exercise real business behavior rather than snapshotting duplicated JSX.
- Integration coverage includes clean and dirty drafts blocking scene operations before any
  mutation; preview cancel restoration; stale sources; rapid typing followed by Save; duplicate or
  stale accessory actions; delayed readiness; and close/reopen while asynchronous work completes.
- Verify every entry point selects the active host, including tray, shortcut, status, and Agent
  Control section navigation. Cover busy/error states, dropdown settlement, and nested Escape.
- On Windows and macOS compare Agent Control screenshot pixels for unchanged normal presentation
  before/after extraction and inspect Dock settings, authoring, dropdown, and confirmation surfaces.
  Check top/bottom Dock, small displays, DPI/Text size/Interface Size, monitor changes, native dialogs,
  application switching, full-screen behavior, and Dock exit/hide/suspend. Linux retains normal-mode
  coverage and must not create a Dock Settings accessory.
- Measure the same build/scenario before and after: fresh Dock; first Settings open; closed after
  warmup; 30 open/close and editor cycles; and an idle interval after closure. Record native window
  count, process-tree memory, CPU, frame responsiveness, and capture drop counters. Window count must
  remain bounded, and resources must stabilize after warmup; investigate sustained growth rather
  than treating the old per-WebView estimate as a pass threshold. Use existing leased capture tools
  for hardware checks, never a parallel ad-hoc player.
- Update matching user chapters and any changed Agent Control contracts with implementation. Use
  focused tests during implementation and `npm run check:changes` after the final intended commit
  before push/merge. This proposal itself changes no runtime behavior or capture-layer code.

## Alternatives considered

- **Put Settings into `dock-editor`:** saves a WebView, but couples long-lived authoring to blur
  dismissal, content measurement, anchoring, and transient-menu focus. Not recommended.
- **Copy Settings and mount another SettingsProvider:** creates separate state/effects and invites
  persistence and shortcut-registration conflicts. Rejected.
- **Use a separate native Settings window in both forms:** would simplify host count conceptually,
  but changes ordinary-mode UX and resource usage without being necessary for this feature. Defer.
- **Create a window per editor:** easy to add incrementally, but increases renderer cost and focus
  relationships with each feature. Rejected.
- **Expand or overlay the Dock's main window:** entangles settings with reserved-edge geometry and
  risks covering other applications with a large transparent surface. Rejected.

The main remaining implementation uncertainty is cross-platform focus and native dialog ownership,
followed by the amount of controller extraction needed for complete authoring. Validate these with
the vertical slice above. No runtime performance improvement is claimed by this design review.
