# Editor Draft Control

Editor Draft Control safely inspects and changes the in-memory document owned by a currently open
Theme Editor or Loudness Profile Editor. It is an authoring-session API: Patch, Undo, Redo, and Discard never Save a document, change the selected library
item, dirty a Preset, or write persistence. Explicit Save commits the exact draft through its existing
editor owner, including the GUI's selection and Preset effects.

Use `editor-draft describe <theme|loudness-profile>` to discover the closed operation vocabulary.
The Theme description is derived from the Core keys, palette presets, and editor-visible Theme Role
Registry entries. The Profile description is derived from ruleable metrics and their display
precision. Arbitrary object paths, React state, DOM selectors, clicks, and keystrokes are not
accepted.

## Exact session identity

`editor-draft inspect <kind> <surface-id>` requires the opaque editor `surfaceId` returned by UI
Navigation. It returns the complete supported authored document, dirty/stale state, history
availability, and three independent concurrency tokens:

- `revision` covers durable public application state;
- `uiGeneration` covers the mounted surface stack and public UI descriptors;
- `draftGeneration` covers accepted semantic changes inside this one editor lifetime.

Opening an editor starts its draft generation at zero. A changed atomic Patch or successful
Undo/Redo advances it once. A semantic no-op advances nothing. Draft changes do not impersonate a
durable write, so they do not advance the global revision. Closing and reopening creates a new
surface identity; a retained ID can never address the replacement editor.

Every mutation requires exact expected values for all three tokens. They are checked before no-op
detection, so replaying a request whose response was lost conflicts instead of inserting a rule or
undoing twice. A stale source draft remains inspectable and dismissible, but Save, Patch, Undo, and Redo
return `draftStale`.

## Atomic semantic patches

`editor-draft patch` reads a strict JSON document with a non-empty `operations` array (at most 64
entries). Operations are applied in order to a private copy and the complete document is validated
before the editor owner is called once. Unknown fields, invalid values, duplicate targets, and
conflicting reset/preset/field operations reject the whole batch as `invalidDraftPatch`; no prefix
is applied.

Theme operations cover name, appearance, Core colors/reset, supported palette colors/stops/presets,
and editor-visible color/reference overrides. Loudness Profile operations cover name, Reference
LUFS, and add/update/remove/reorder rules. Changing a rule metric clears its old value unless that
same operation supplies a replacement, matching the visible editor.

Theme exposes Undo and Redo because the visible Theme Editor owns history. Loudness Profile does
not; attempting those actions returns `draftActionUnavailable`.

## Cancel and exact discard

Cancel remains a UI Navigation operation. Call `ui cancel` for the editor first. A clean editor
closes normally; a dirty editor mounts its real nested discard confirmation and leaves the draft
and preview intact.

Only then may `editor-draft discard` name both the original editor surface and that linked decision
surface. The command verifies the decision is topmost, still belongs to the exact editor, and the
three generations are current, then invokes the confirmation's existing callback. There is no
generic Confirm command, and another confirmation can never be invoked through this family.

Stable family errors include `editorDraftNotFound`, `editorDraftKindMismatch`,
`draftGenerationConflict`, `draftStale`, `invalidDraftPatch`, `draftActionUnavailable`,
`draftDecisionNotFound`, `draftNotDirty`, and `draftNotSettled`, in addition to shared revision/UI
conflicts. `draftNotSettled` means the owner may already have accepted the change; inspect the exact
editor and reconcile, and never retry with old tokens.

## Save the reviewed draft

`editor-draft save <theme|loudness-profile> <surface-id>` requires `--json` and all three expected
tokens. It is an action and accepts neither `--dry-run` nor a force/conflict-resolution option.
The exact editor must be topmost; a nested confirmation or other surface blocks Save.

The owner rechecks its current source before committing, validates the complete document, then
uses the same create/update, selection, preview, and editor-close behavior as the visible Save
button. Stale or deleted sources return `draftStale` without closing the draft or synthesizing a
library-conflict decision. An invalid or unavailable Save returns `draftActionUnavailable`.
Theme create/customize/duplicate saves a custom Theme; editing retains its existing ID. Profile
create selects the new Profile; Profile edit restores the selection captured when editing began.

Success returns `action: "editorDraft.save"`, `status: "completed"`, `changed`, `revision`,
`uiGeneration`, `kind`, the original `surfaceId`, `savedId`, and the saved `document` without its ID.
Success means the library change was observed, the original editor and its blocking registration
closed, and changed durable state was flushed. `changed` describes durable changes: saving an
unchanged existing document still closes the editor but does not flush or advance revision.
There is no new draft generation after Save because that draft lifetime has ended.

A committed Save whose UI/library settlement times out uses `commitNotObserved`, including
`stateCommitted`, `savedId`, `revision`, and whether the rescue flush persisted the write.
A flush failure is `persistenceFailed` with `stateCommitted: true`, `savedId`, and committed revision.
Inspect the saved resource and UI after either error; never blindly repeat Save. A lost-response
replay cannot save a replacement editor using the old surface ID or tokens. This command does not
provide a generic Save/Confirm operation for other UI surfaces.
