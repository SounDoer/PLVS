# Agent Control Semantic Editor Drafts Design

**Date:** 2026-10-09

**Status:** Proposed for review

**Scope:** Theme Editor and Loudness Profile Editor draft inspection and control; reusable boundary
for future blocking editors

## Summary

Add a closed, semantic `editor-draft` command family to Agent Control. It operates only on the
currently mounted Theme or Loudness Profile editor in one selected workbench, through that editor's
React-owned business controller. It can inspect the current in-memory authoring document, apply a
strict set of editor-specific operations, use history actions the product already supports, and
finish an explicit discard flow that was first opened through the existing `ui cancel` action.

It is not keyboard automation, a DOM API, JSON Patch, an arbitrary object-path setter, a generic
React-state bridge, or a persistence authoring shortcut. Draft operations never Save, select a
library item, dirty a Preset, resolve a stale-source conflict, or write a store or file.

The proposed public surface is:

```text
plvs-cli editor-draft describe <theme|loudness-profile> --json
plvs-cli editor-draft inspect <theme|loudness-profile> <surface-id> --json
plvs-cli editor-draft patch <theme|loudness-profile> <surface-id> <file|-> \
  --expected-revision <n> --expected-ui-generation <n> --expected-draft-generation <n> --json
plvs-cli editor-draft undo theme <surface-id> \
  --expected-revision <n> --expected-ui-generation <n> --expected-draft-generation <n> --json
plvs-cli editor-draft redo theme <surface-id> \
  --expected-revision <n> --expected-ui-generation <n> --expected-draft-generation <n> --json
plvs-cli editor-draft discard <theme|loudness-profile> <surface-id> \
  --decision-surface-id <surface-id> --expected-revision <n> \
  --expected-ui-generation <n> --expected-draft-generation <n> --json
```

The wire methods are `editorDraft.describe`, `editorDraft.inspect`, `editorDraft.patch`,
`editorDraft.undo`, `editorDraft.redo`, and `editorDraft.discard`.

`ui show` remains navigation-only. `ui cancel` remains the sole way to request normal editor
dismissal. `editor-draft discard` is not a shortcut around that path: it is available only after
`ui cancel` has mounted the exact editor's real discard confirmation, and it invokes that mounted
decision's existing confirm-discard callback. There is still no generic Confirm command.

## Goals

1. Let an authorized agent inspect the real draft that the user sees and the fields the editor
   supports.
2. Let an agent create deterministic dirty drafts through semantic business actions for guided
   authoring and visual review.
3. Detect manual typing, another agent request, a replacement editor, a changed decision surface,
   and durable-state races before mutation.
4. Preserve existing preview, validation, history, stale-source, blocking-editor, Save, Cancel, and
   persistence behavior.
5. Give future blocking editors a small controller contract without making arbitrary React state
   remotely writable.
6. Support an Agent-Control-only review sequence that opens, edits, proves blocking, screenshots,
   requests Cancel, explicitly confirms discard, and verifies no durable change.

## Non-goals

- Generic `type`, key, click, selector, coordinate, focus, or accessibility automation.
- Arbitrary object paths, JSON Patch, JavaScript expressions, reducer actions, component props, or
  React state.
- Save, Send, Delete, import, export, library-conflict resolution, or a generic confirmation API.
- Editing a persisted Theme/Profile without opening its real editor. Existing Theme and Loudness
  Profile Control already own direct persisted authoring.
- Exposing half-typed input text that has not yet committed to the editor controller.
- Manufacturing stale drafts, library races, invalid intermediate controls, open color pickers,
  drag states, or other screenshot-only component internals in the public product contract.
- Giving Loudness Profile drafts undo/redo merely because Agent Control wants it. That editor has
  no product history feature today.

## Current implementation inventory

### Shared blocking and navigation boundary

`BlockingEditorsContext` counts open draft-style editors. Theme registers `theme`; Loudness Profile
registers `loudnessProfile`. Registration is based on the editor being open, not dirty. Preset
apply/save/update and Dock entry call the shared scene guard before mutation.

UI Navigation already supplies the first two concurrency boundaries:

- one workbench is selected by the CLI's existing `--instance` routing;
- each mounted editor lifetime has an opaque `surfaceId`;
- UI actions require global `revision` and process-local `uiGeneration`;
- Theme/Profile `ui show` uses the GUI's existing begin-create/begin-edit paths;
- `ui cancel` calls `requestDismiss`, so a clean draft closes and a dirty draft opens the real
  discard confirmation;
- the nested `ConfirmDialog` is inspectable but currently exposes Cancel only.

`uiGeneration` advances for mounted-surface and low-frequency semantic changes, including the
clean/dirty and stale boundaries. It deliberately does not advance for every character or committed
field edit. That makes it unsuitable as the sole lost-update token for draft authoring.

### Theme Editor

The owner is `useThemeEditor`, assembled by `useCustomThemeSettings`.

| Concern | Current behavior |
| --- | --- |
| Draft identity | `authoring { mode, sourceId, draftId }`; edit reuses the Theme ID, create modes mint a transient custom ID |
| Baseline | Structured clone retained in `baselineRef` |
| Dirty | Full document comparison with the baseline |
| Preview | Every accepted edit publishes through `setPreviewTheme`; Cancel restores the previous active Theme and finishes preview |
| History | Past/future stacks; adjacent actions with the same key coalesce for 500 ms; visible Undo/Redo buttons already exist |
| Supported business edits | Name, appearance, six Core colors, Core reset, simple palette colors, intensity stops, palette presets, public advanced-role overrides, section override reset |
| Save | Normalizes the whole document, updates/creates through Theme library planners, and reports a library conflict if an edited source became stale |
| Cancel | Clean dismissal cancels immediately; dirty dismissal opens confirmation; confirmation calls the same `cancel` owner and restores preview |
| Stale | `syncSource` compares the current saved source with the original baseline without replacing the draft |
| Blocking | `useBlockingEditor("theme", editor.isEditing)` and a direct controller guard for Theme library actions |

Important consequences:

- the controller already has semantic field functions and real history;
- history and the draft live in refs as well as React state, so a command can read and update the
  latest committed draft without stale-render races;
- current history has no public generation and no atomic multi-operation entry point;
- Theme override persistence accepts more shapes than the visible editor. Agent Control must expose
  only editor-visible roles and the role's visible `auto`, `color`, or allowed `reference` modes,
  not every legacy/persistence representation.

### Loudness Profile Editor

The owner is `LoudnessProfileContext`; `LoudnessProfileEditor` still owns several document transforms
and passes them to the provider through a generic `editDraft(mutate)` callback.

| Concern | Current behavior |
| --- | --- |
| Draft identity | `authoring { mode, sourceId, draftId }`; create and edit mint a separate transient draft ID |
| Baseline | Edit retains `baseDocument`; create has only its initial document |
| Dirty | Any `editDraft` call sets `dirty: true`, even if the transform is a semantic no-op |
| Preview | The draft outranks the persisted active selection for all readers; nothing is written until Save |
| History | None |
| Supported visible edits | Name, Reference LUFS, add/update/remove/reorder rules |
| Save | Normalizes the rule document; create/update uses library planners; edit restores prior active selection; stale edit reports a conflict |
| Cancel | Drops only the in-memory overlay; dirty dismissal first opens confirmation |
| Stale | Settings-store subscription compares the latest source with `baseDocument`; source deletion is stale |
| Blocking | `useBlockingEditor("loudnessProfile", draft != null)` and provider-level library guards |

Before exposing Profile patching, the visible editor transforms must move behind named provider
operations. Keeping a remotely supplied mutation function or adding an Agent-only document setter
would violate the semantic boundary.

## User scenarios and product boundary

### Public product scenarios

1. **Guided Theme authoring.** Open Customize for a built-in Theme, inspect the derived draft,
   apply named Core/palette/override operations, review the live preview, and leave Save to the user.
2. **Guided Profile authoring.** Open a Profile draft, set its name and reference, add or refine
   explicit delivery rules, and leave the real editor open for review.
3. **Controlled correction.** Inspect `draftGeneration`, apply a small atomic patch, and use Theme's
   real Undo/Redo without reaching into its history stack.
4. **Safe abort.** Request normal Cancel. If PLVS asks to discard, explicitly confirm only that exact
   editor decision and observe the editor and preview disappear.
5. **Blocking proof.** Create a real dirty draft, attempt Preset or Dock scene operations, and prove
   they fail before any mutation while the draft remains intact.
6. **Visual review.** Arrange an editor only through Agent Control, capture it with exact tokens,
   discard through the normal confirmation, and compare durable state with the initial snapshot.

These have lasting user value: they support collaborative authoring, remote guidance, reproducible
review, and safe automation rather than only repository screenshots.

### Development-only scenarios

Keep the following out of public commands:

- forcing a source Theme/Profile to change or disappear so a draft becomes stale;
- holding or replaying persistence notifications to create a precise race;
- opening a color picker, rename sub-editor, Select menu, drag reorder gesture, tooltip, validation
  bubble, or half-typed numeric input;
- injecting an invalid draft the visible business controller would reject;
- exposing raw history entries, refs, baseline documents, reducer actions, or preview internals;
- bypassing the first `ui cancel` step to discard directly;
- confirming any non-draft decision.

If deterministic stale/conflict screenshots are needed, extend the development-identity fixture
catalogue with closed owner-backed cases. Such fixtures must remain absent from capabilities,
public help, schemas, and installed builds.

## Reusable editor-draft controller contract

Each supported blocking editor registers one adapter for its mounted surface lifetime:

```text
kind
surfaceId
draftId
inspect() -> projected draft snapshot
describe() -> closed supported operations and enums
planPatch(document, currentSnapshot) -> next snapshot or issues
commitPatch(plan) -> owner-observed result
undo?()
redo?()
confirmDiscard?(decisionSurfaceId)
```

The adapter is not a generic setter. `planPatch` accepts only that editor kind's schema and
`commitPatch` calls its controller's named transaction function. The visible GUI operations use the
same transaction helpers, so Agent Control cannot acquire a second implementation of Theme/Profile
semantics.

Registration is tied to the UI surface lifetime rather than only the blocking-editor string.
`theme` is enough to refuse a Preset, but not enough to prove which Theme editor an agent inspected.

## Commands and results

### `editor-draft describe`

This read-only query does not require an open editor. It returns the closed patch operation schema,
current option catalogues, supported actions, and constraints for one kind:

- Theme Core keys and color rules;
- palette kinds and current preset IDs;
- editor-visible advanced role IDs, allowed modes, and reference choices;
- Profile metric IDs, operators, severities, precision, and Reference bounds;
- history support (`undo`/`redo` true for Theme, false for Loudness Profile).

The description is derived from the product registries, not copied lists. It never returns internal
React function names or persistence-only Theme roles.

### `editor-draft inspect`

This is a read-only query for the exact `kind + surfaceId` in the selected workbench. It returns:

```json
{
  "revision": 44,
  "uiGeneration": 10,
  "draftGeneration": 3,
  "editor": {
    "kind": "theme",
    "surfaceId": "ui-opaque",
    "draftId": "custom-opaque",
    "intent": "customize",
    "sourceId": "plvs-dark",
    "dirty": true,
    "stale": false,
    "canSave": true,
    "canUndo": true,
    "canRedo": false
  },
  "document": {
    "name": "Dark Custom",
    "colorScheme": "dark",
    "core": {},
    "palettes": {},
    "overrides": {}
  }
}
```

The actual Theme document contains the complete supported Core, palette, and override values. The
Profile document contains name, Reference LUFS, and the ordered rules. Internal document IDs,
history entries, baseline copies, resume selection, preview restore targets, and refs are omitted.

This explicit command is allowed to return authored draft values. `ui inspect` remains
privacy-minimal and continues to redact them.

### `editor-draft patch`

Patch input is a strict document containing a non-empty `operations` array. Unknown fields,
unknown operations, duplicate/conflicting operations, invalid values, and an empty or oversized
batch are rejected together before the owner is called. A batch is one atomic draft transaction,
one `draftGeneration` increment, and, where history exists, one Undo entry.

Theme operations are closed to:

```text
setName { name }
setColorScheme { colorScheme }
setCoreColor { key, color }
resetCore {}
setPaletteColor { palette: status|frequency|interface, key, color }
setIntensityStops { stops: [{ position, color }, ...] }
applyPalettePreset { palette, presetId }
setOverrideColor { roleId, color }
setOverrideReference { roleId, sourceRoleId }
clearOverride { roleId }
clearOverrides { roleIds }
```

`resetCore`, palette preset application, and override clearing are the same named semantics already
visible in the Theme Editor. Override roles/modes/references must be present in the editor-visible
Theme Role Registry entry. Intensity stops are complete and ordered, start at 0, end at 1, and use
the same color validation as the editor document.

Loudness Profile operations are closed to:

```text
setName { name }
setReferenceLufs { value: number|null }
addRule { rule: { metricId, op, value?, severity } }
updateRule { index, patch: { metricId?, op?, value?, severity? } }
removeRule { index }
reorderRules { order: [index, ...] }
```

Changing a rule's metric clears its value unless the same operation supplies a new valid value,
matching the visible editor. Reorder requires an exact permutation. Numeric values use the same
display precision as the editor. A rule may deliberately omit its value and remain an empty row.

The planner applies operations in array order to a private snapshot, validates the complete result,
then calls one owner transaction. It never runs some operations and fails later. A semantic no-op
returns `changed: false` and advances no generation.

### `editor-draft undo` and `redo`

The initial public history actions are Theme-only because Theme already presents and owns this
history. The exact editor must advertise `canUndo` or `canRedo`. A successful action advances
`draftGeneration` once and may advance `uiGeneration` if dirty or another public UI descriptor
crosses a boundary.

Loudness Profile returns `draftActionUnavailable`. Adding Profile history later is a product change:
the visible editor and controller should gain it together before Agent Control advertises it.

### `editor-draft discard`

This is the only destructive action in the family, and its preconditions are intentionally stronger
than patch/history:

1. the caller previously invoked public `ui cancel` for the exact editor surface;
2. the editor is still mounted, dirty, and at the expected `draftGeneration`;
3. the exact `decisionSurfaceId` is the current top nested confirmation;
4. that decision is registered as `discardDraft` and linked to the same editor kind/surface;
5. revision and UI generation still match;
6. the mounted decision exposes the editor owner's current confirm-discard callback.

Only then does the command invoke that callback and wait until both decision and editor surfaces are
absent. It does not call `cancelDraft`, clear a ref, restore preview directly, or accept a generic
confirmation target. A clean draft has no decision and continues to close entirely through
`ui cancel`.

This narrowly supersedes the earlier statement that public Agent Control can never confirm a dirty
editor discard. UI Navigation itself still cannot confirm anything, and all other nested/event
decisions remain non-confirmable.

## Three concurrency domains

### Global `revision`

Protects durable state used to interpret the authoring session: library sources, Appearance,
Profile selection, workbench scene, and other Agent Control state. Draft operations require the
current revision but never increment it because they write no durable state.

### Process-local `uiGeneration`

Protects mounted surface topology and low-frequency public UI facts. It advances when the editor or
discard decision mounts/unmounts, the editor changes clean/dirty or stale boundary, or supported UI
actions change. It still does not advance for every committed field edit.

### Surface-local `draftGeneration`

Protects the in-memory authoring document and history cursor. It:

- starts at `0` for each newly mounted editor draft lifetime;
- is scoped to the exact `surfaceId` and cannot be reused after reopen;
- advances once for every changed semantic controller transaction, whether initiated by the GUI or
  Agent Control;
- advances once for Undo or Redo;
- does not advance for a rejected edit, semantic no-op, page change, pointer/drag position, preview
  paint, half-typed uncommitted field, or discard-dialog open/close;
- never contributes to or impersonates the global revision.

The first patch commonly changes clean to dirty, so both `draftGeneration` and `uiGeneration`
advance. Later patches commonly advance only `draftGeneration`. An Undo returning to baseline may
advance both again. Every result returns all three current tokens.

`draftGeneration` must be incremented inside the editor owner transaction, not inferred by the
Agent Control bridge, so visible GUI edits and remote edits participate in the same concurrency
domain.

## Validation and execution order

Every mutating request is serialized with other actions for the selected workbench and checks:

1. public method and strict request schema;
2. selected workbench routing (already enforced by the transport);
3. current global revision;
4. current UI generation;
5. exact editor kind and surface lifetime;
6. current draft generation;
7. absence of an unrelated/nested decision (`discard` requires the linked decision instead);
8. stale state;
9. editor-specific operation support and complete projected-document validity;
10. owner commit and bounded observation of the expected generation/document.

Token and identity checks happen before semantic no-op detection. A replay with the generation from
before a successful command therefore conflicts rather than being reported as a harmless no-op.

## Conflict, idempotency, and failure semantics

- `revisionConflict`: durable state changed after inspection; no draft action runs.
- `uiGenerationConflict`: mounted/low-frequency UI changed; no draft action runs.
- `draftGenerationConflict`: a GUI or agent semantic edit/history action changed the draft; no
  draft action runs.
- `draftSurfaceNotFound`: no exact mounted editor adapter matches kind and surface ID.
- `draftKindMismatch`: the surface exists but belongs to another supported editor kind.
- `draftStale`: the source document changed or disappeared. Public patch/undo/redo refuse; inspect,
  `ui cancel`, and exact discard remain available. Reopen or let the visible conflict workflow
  resolve authorship rather than adding an `allow-stale` bypass.
- `draftBusy`: another draft action is pending or an unrelated/nested decision is on top.
- `invalidDraftPatch`: all independently discoverable schema/operation issues are returned; no
  owner function runs.
- `draftActionUnavailable`: history/action is not supported or currently unavailable.
- `draftDecisionMismatch`: discard decision is missing, stale, not topmost, or not linked to the
  exact editor.
- `draftNotSettled`: the owner accepted a change but the expected draft observation did not settle
  in time. It reports `stateCommitted: true` plus current tokens; inspect before any retry.

There is no automatic retry. Concurrent requests are serialized: the first valid generation wins
and later requests with the same generation conflict. If a response is lost after commit, a replay
with the original generation conflicts, preventing double Undo, double rule insertion, or a second
discard. The caller inspects and reconciles.

## Persistence, preview, and Save boundary

Patch/history changes only the existing in-memory draft and its normal live preview:

- Theme continues to publish through `setPreviewTheme` and restore through `finishThemePreview`;
- Profile continues to outrank the active selection only while its draft exists;
- no store patch, local notification, library planner commit, persistence flush, preset dirtying,
  revision increment, Save, or conflict resolution occurs;
- `editor-draft discard` restores/drops through the same owner callback as the visible confirmation;
- a later user Save remains exactly the editor's existing Save behavior.

Tests must observe persistence through the public owner/store boundary and a real desktop restart,
not across a Vite reload.

## Public versus development-only capability

### Public

- derived editor schema/options (`describe`);
- exact current draft values and state (`inspect`);
- closed semantic patch operations;
- Theme's existing Undo/Redo;
- exact linked discard confirmation after normal `ui cancel`;
- capability discovery for supported editor kinds/actions.

### Development identity only

- deterministic stale/source-deletion/race setup;
- invalid intermediate or half-typed fields;
- open subcontrols and pointer/keyboard interaction states;
- raw controller/history/baseline inspection;
- synthetic external library writes;
- any fixture-only populated scene whose only value is screenshot coverage.

Dirty drafts are not fixtures. They are a normal consequence of public semantic patching and are
required to prove real blocking behavior.

## Capabilities and schema synchronization

The public manifest is the command source of truth. Implementation must update together:

- `src/agentControl/commandManifest.json` and test fixtures;
- frontend protocol normalization and closed editor-specific schemas;
- capabilities (`features.editorDraft` and the six wire methods);
- React draft registry/adapters and Agent Control bridge;
- Rust CLI parser, forwarding, help, completion, text rendering, and offline schema projection;
- generated Agent Control command reference;
- `docs/agent-control/README.md`, a new `editor-drafts.md`, Theme/Profile family pages, and
  `docs/user/cli.md`;
- contract tests that derive allowed fields/options from product registries.

No generated document is hand-edited.

## TDD seams proposed for approval

Per the repository TDD workflow, implementation should not start until these behavioral seams are
confirmed:

1. **Schema/planner seam:** strict Theme/Profile operation documents produce an independently
   asserted next authoring document or complete issues, with no React/store side effects.
2. **Editor-owner seam:** GUI and Agent operations use the same named controller transactions;
   draft generation, preview, dirty, stale, and Theme history are observed through the public hook/
   context API.
3. **Mounted-lifetime seam:** exact kind/surface/draft generation and linked discard decision are
   enforced without reaching into component state.
4. **Agent Control seam:** manifest, protocol, capabilities, bridge, Rust CLI, schema, and errors
   agree, and no command advances durable revision or persistence.
5. **Scene-safety seam:** real Preset/Dock operations refuse before mutation while the edited draft
   remains intact.
6. **Desktop workflow seam:** public commands alone complete open -> inspect -> patch -> blocking
   proof -> screenshot -> `ui cancel` -> exact discard -> durable restoration verification.

## Decisions

1. Use a separate `editor-draft` family; do not add values to `ui show` or mutate through UI
   Navigation.
2. Require kind, exact editor `surfaceId`, revision, UI generation, and draft generation for every
   mutation.
3. Put `draftGeneration` in the editor owner and increment it for GUI and Agent semantic commits.
4. Make a patch batch atomic and one history transaction.
5. Expose only operations the visible editor understands; persistence-only shapes stay private.
6. Publish Theme Undo/Redo because the product already owns them; do not invent Profile history.
7. Refuse stale draft mutation instead of adding an override flag.
8. Permit exact discard only after normal `ui cancel` mounted the linked decision; keep generic
   Confirm impossible.
9. Keep stale/race/invalid/subcontrol manufacturing in development-only fixtures.
10. Never advance global revision for draft or preview state.
