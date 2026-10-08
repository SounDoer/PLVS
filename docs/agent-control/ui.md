# UI Navigation

UI Navigation opens, locates, focuses, inspects, and safely closes temporary PLVS surfaces through
their existing React behavior. It expresses user intent; it is not a general click API and exposes
no DOM selectors, coordinates, form setters, or generic confirmation operation.

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

## Inspection and targets

`ui inspect` reports transient presentation state for one running workbench: its process-local
`uiGeneration`, window form and visibility, active blocking-editor IDs, and a privacy-minimal list
of registered surfaces. Each surface has an opaque `surfaceId`, semantic kind and target, origin,
supported close/cancel actions, and only the state needed to navigate it safely. Draft field values,
feedback text, diagnostics, DOM details, geometry, and other authored content are never returned.

This is intentionally separate from `app.inspect`. The application snapshot owns durable product
state and the global `revision`; `ui inspect` owns temporary presentation state. Callers normally
retain both tokens before navigation.

The public `show` targets are:

- `settings` opens Settings and selects one of `behavior`, `shortcuts`, `appearance`, `analysis`,
  `channels`, `transfer`, `agent-control`, or `about`;
- `panel-settings` opens the settings surface for the exact `panelId` in the selected workbench;
- `theme-editor` starts or focuses `create`, `edit`, `customize`, or `duplicate` authoring and may
  select the `core`, `palettes`, or `advanced` page;
- `loudness-profile-editor` starts or focuses `create` or `edit` authoring;
- `feedback` opens or focuses a blank, unsent Feedback draft.

Settings is unavailable in Dock form. Panel Settings follows the current form instead of changing
it: in a normal window it may activate the containing Workspace tab through the existing Workspace
business operation, in Fullscreen it accepts only the currently rendered Panel, and in Dock it
accepts only a Dock Panel ID and opens the existing Dock editor accessory. A normal Workspace Panel
ID is never treated as a Dock Panel ID, or the reverse.

Every CLI request is scoped to one Agent Control instance. With several workbenches running, use
`instances` and the global `--instance <instance-id>` option. Surface IDs and UI generations belong
only to that selected instance and must not be reused with another workbench.

## Two concurrency tokens

`revision` and `uiGeneration` protect different facts:

- `expectedRevision` protects the durable state used to resolve the target, such as Panel identity,
  tab membership, and window form;
- `expectedUiGeneration` protects temporary intent, such as which dialog or editor is currently
  open.

`uiGeneration` is an unsigned process-local counter that resets when PLVS restarts. It advances
once when a public UI surface mounts or unmounts, its semantic target changes, or another
low-frequency navigation fact changes. It does not advance for typing, hover, pointer movement,
animation frames, raw scroll position, tooltips, measurement frames, or update progress ticks.
Transient UI changes do not advance the global revision.

`ui show`, `ui close`, and `ui cancel` require both expected tokens. A mismatch fails before the requested
transition. If revealing Panel Settings activates another Workspace tab, that durable Workspace
change follows the existing business path and advances the global revision normally; the resulting
UI transition also advances `uiGeneration`.

## Show, settlement, and idempotency

`show` may reveal and focus the selected workbench, activate a supported Panel tab through its
existing business function, mount or retarget the requested surface, and focus its semantic
section. It never invokes Save, Send, Confirm, Delete, Reset, Import, Export, Install, Restart, or
Apply, and it accepts no form values.

A successful command waits for the requested component to mount and commit its semantic target,
then for stable non-zero bounds across the render barrier. It returns `changed`, `action`, the
current `revision` and `uiGeneration`, the exact `surface`, and compact UI state. A bounded failure
is `uiNotSettled`; inspect before deciding whether to retry.

Repeating an exact settled target is idempotent. The command may reassert best-effort window focus,
but returns `changed: false` and advances neither token. Selecting another Settings section or
Panel is a real presentation change and advances `uiGeneration` once.

An existing blocking editor is never discarded to satisfy navigation. A matching target may be a
no-op; otherwise the request fails without closing or replacing the editor. Event-driven or nested
decision surfaces likewise remain authoritative and can block navigation.

For authoring, identity includes the mode and source Theme/Profile ID; Theme identity also includes
the requested page. Create/customize/duplicate may create a transient draft and preview, but no
library item exists and no persistence occurs until the user visibly chooses Save. A different
authoring identity fails with `editorActive` and leaves the current draft untouched. Editors and
Feedback block scene replacement immediately when open, before they become dirty.

## Exact close and cancel

`ui close <surface-id>` requires the opaque ID returned by `ui inspect` or `ui show`. It operates
only on that mounted surface and invokes the same Close or Escape intent as the component. It does
not fall back to the topmost surface after a race, bypass draft handling, or call a lower-level
state setter. If the surface disappeared, the result is `uiSurfaceNotFound`; cleanup tools may
inspect and treat absence of the surface they opened as already clean.

`ui cancel <surface-id>` invokes the exact surface's current Cancel or Escape intent. Clean editors
close normally. Dirty editors open their real discard confirmation and keep the draft until the
user chooses what to do; Agent Control cannot confirm discard. Feedback Cancel closes the unsent
draft without reading diagnostics or sending a request.

Real update, crash-report, close-confirmation, library-conflict, transfer, and nested discard/reset
decisions appear in `ui inspect` only after their actual owner mounts them. They have
`origin: event` or `origin: nested`, redact payloads and authored values, and advertise only a safe
Close/Cancel action when the visible UI permits it. Busy phases advertise no dismissal. There is no
public command to synthesize these surfaces and no generic Save, Send, Confirm, Install, Import,
Export, Apply, or Retry operation.

## Errors

Stable UI Navigation errors are:

- `uiGenerationConflict` for a stale UI token;
- `uiSurfaceNotFound`, `uiTargetNotFound`, and `uiTargetNotVisible` for exact surface or semantic
  target failures;
- `surfaceUnavailable` when the current build, platform, or window form cannot host the target;
- `uiActionUnavailable` when a surface does not expose the requested close/cancel intent;
- `uiConflict` for an active blocking editor or decision surface;
- `uiBusy` for a real non-dismissible phase;
- `uiNotSettled` when the bounded component-owned render barrier is not observed.

Existing `revisionConflict` and Panel errors retain their normal meanings. A failure never silently
closes a surface, discards a draft, or retries with newer tokens.

## Screenshot orchestration

Screenshots optionally accept `--expected-ui-generation`. It is checked with optional
`--expected-revision` after render settlement and before capture allocation. A stale token creates
no artifact. This supports deterministic UI review without external UI automation:

```powershell
$ui = plvs-cli ui inspect --json | ConvertFrom-Json
$shown = plvs-cli ui show settings --section appearance `
  --expected-revision $ui.result.revision `
  --expected-ui-generation $ui.result.uiGeneration --json | ConvertFrom-Json

plvs-cli visual screenshot --target main `
  --expected-revision $shown.result.revision `
  --expected-ui-generation $shown.result.uiGeneration `
  --out .\settings-appearance.png --json

plvs-cli ui close $shown.result.surface.surfaceId `
  --expected-revision $shown.result.revision `
  --expected-ui-generation $shown.result.uiGeneration --json
```

Scenario tools should restore durable state through the owning Agent Control families, close only
the exact surfaces they opened, and verify final state with both `inspect` and `ui inspect`.

## Visual walkthrough tooling

The repository's ordinary product-surface walkthrough uses only `plvs-cli`:

```powershell
npm run ui:walkthrough -- --manifest scripts/ui-walkthrough/product-surfaces.example.json --out-dir artifacts/ui-walkthrough
```

Copy the example and replace its explicit workbench instance ID. The checked manifest accepts one
semantic UI target per scenario, contained screenshot outputs, optional bounded Settings/View
patches, and an exact declaration of every durable field touched. The runner refuses a pre-existing
surface, blocking editor, event decision, missing capability, undeclared field, arbitrary command,
shell string, selector, generic confirmation, or output path escape. It writes temporary mutation
documents in a private directory, dismisses only the surface it opened, restores in reverse order,
and records success or bounded failure evidence in `report.json`. The checked product manifest also
analyzes a deterministic stereo WAV through Transport Control, captures the populated File-analysis
workspace, removes the temporary session, and verifies that the original source lifecycle was
restored.

Settings, normal or Dock Panel Settings, clean Theme/Profile drafts, blank Feedback, and ordinary
Workspace/Dock captures belong on this path. Event-only Update, Crash Report, Close Confirmation,
and Library Conflict screenshots use the development-identity event-fixture protocol described in
the implementation contract. A fixture establishes only the legal production scene; inspection,
capture, and dismissible recovery still use this public UI Navigation contract. Library Conflict is
non-dismissible and therefore uses an exact private reset token.

The fixture protocol is deliberately not a public `ui show` family and is absent from public
capabilities, help, completion, schema, and packaged CLIs. See `CONTRIBUTING.md` for the real desktop
and exact pixel-comparison workflow. Other exceptional states need a new closed, owner-backed
fixture and contract tests; they must not introduce selectors, arbitrary input, or React/store
mutation. The isolated community-preview renderer may continue to use Playwright because it renders
a browser preview application, not the running PLVS workbench.
