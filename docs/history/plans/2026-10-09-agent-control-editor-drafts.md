# Agent Control Semantic Editor Drafts — Implementation Plan

> Proposed implementation plan. Confirm the six behavioral seams in the linked design before the
> first failing test or product-code change.

**Goal:** Safely inspect and modify the real Theme and Loudness Profile editor drafts through a
closed semantic Agent Control family, with exact concurrency, normal Cancel/discard behavior, and
no implicit persistence.

**Architecture:** Editor owners gain a shared semantic transaction boundary and surface-local draft
generation. A mounted-draft registry binds that owner to the exact UI surface. A manifest-backed
`editor-draft` CLI family validates closed Theme/Profile operations, invokes only the registered
owner, and returns revision, UI generation, and draft generation. Exact discard is allowed only for
the linked real decision created by `ui cancel`.

**Spec:**
`docs/history/specs/2026-10-09-agent-control-editor-drafts-design.md`

## Delivery rules

- Work on `main`; do not create a branch or worktree without user approval.
- This planning commit changes no product code.
- After design and test-seam approval, work one red -> green vertical slice at a time. Do not write
  all protocol tests before the first owner path exists.
- Tests assert behavior through the six approved seams, not private refs, state setters, or
  component implementation.
- Every draft mutation must enter a React editor owner transaction also used by the visible GUI.
- Never write stores/files, call Theme/Profile persisted-library commit functions, Save, or generic
  Confirm from the new family.
- Never hand-edit `docs/agent-control/generated/`; regenerate with `npm run docs:agent-control`.
- Before each commit run `npm test` plus frontend checks; add Rust checks for CLI changes. Run
  `npm run check` before final delivery/push.
- Preserve a changed draft after an uncertain settlement failure and require inspection; do not
  roll back speculatively.

## Approved seams required before implementation

1. strict schema/planner;
2. editor owner/controller;
3. mounted editor and linked decision lifetime;
4. manifest/protocol/bridge/CLI contract;
5. blocking scene-operation safety;
6. real desktop authoring and restoration workflow.

## Phase 1 — Owner foundations and generation

### Slice 1: Theme draft generation through the existing owner

**Red first**

- opening any Theme draft starts `draftGeneration` at `0`;
- one changed visible semantic edit advances it once;
- coalesced color edits still advance per accepted controller transaction while preserving the
  existing single history grouping behavior;
- semantic no-op/rejected edit does not advance it;
- Undo/Redo advances it once and preserves preview, dirty, and history availability;
- Cancel/reopen creates a new surface lifetime and resets generation without reusing the old
  adapter.

**Green**

- add generation to `useThemeEditor` beside the synchronous draft/history refs;
- introduce one internal atomic Theme operation reducer/transaction;
- make existing named GUI functions delegate to that transaction without changing component props
  or visible behavior;
- keep scheduled preview publication and history coalescing semantics intact;
- expose a controller snapshot/transaction API to the later registry, not its refs.

**Focused checks:** `useThemeEditor`, `useCustomThemeSettings`, Theme Editor component tests.

### Slice 2: Lift Profile operations into its owner

**Red first**

- named owner actions reproduce visible name, Reference, add/update/remove/reorder behavior;
- changing a metric clears the old threshold unless the same semantic operation supplies a new one;
- rule precision, empty values, order, preview, and dirty behavior match the current component;
- semantic no-op stays clean and does not advance generation;
- create and edit start at generation `0`; each changed owner transaction advances once;
- there is no Profile Undo/Redo capability.

**Green**

- move Profile document transforms from `LoudnessProfileEditor` to named
  `LoudnessProfileContext` actions;
- replace public `editDraft(mutate)` component usage with those named callbacks;
- retain a create baseline as well as the existing edit `baseDocument` for correct dirty
  comparison;
- calculate dirty by semantic baseline equality instead of unconditionally setting it true;
- add owner-local `draftGeneration` and a single atomic operation transaction;
- preserve Save selection restoration, stale reconciliation, preview precedence, and Cancel.

**Focused checks:** Profile context and editor component tests.

Commit after the first two slices pass:

```text
refactor(editors): establish semantic draft transactions
```

## Phase 2 — Closed schemas and pure planners

### Slice 3: Derive editor descriptions from product registries

**Red first**

- Theme description exactly covers Core keys, palette kinds/presets, and editor-visible advanced
  roles/modes/references;
- it excludes hidden roles and persistence-only override shapes;
- Profile description exactly covers ruleable metric order, labels/units/precision, Reference
  bounds, operators, and severities;
- history support is Theme true/Profile false;
- registry changes make the contract test fail rather than silently drift.

**Green**

- create `src/agentControl/editorDraftSchema.js` (or the nearest naming consistent with existing
  schema builders);
- derive option sets from `themeSchema`, `palettePresets`, `themeRoleRegistry`,
  `loudnessProfileCatalog`, and `statsCatalog`;
- export description builders and strict issue helpers for protocol/docs reuse.

### Slice 4: Theme patch planner

**Red first**

- accept every closed Theme operation with independent worked expected documents;
- reject unknown/extra fields, invalid keys/colors/stops/presets/roles/references, duplicate or
  conflicting operations, empty batches, and invalid final compilation;
- apply operations in order to a clone and report all independently discoverable issues;
- prove planner purity and no partial owner call;
- prove reset/preset/override behavior matches the existing GUI functions.

**Green**

- implement strict normalization and a pure Theme operation planner;
- reuse product validators and registries instead of restating constants;
- produce one immutable transaction plan and one stable action key for history.

### Slice 5: Profile patch planner

**Red first**

- cover set name/reference, add/update/remove/reorder rules, empty rules, metric-change threshold
  clearing, precision, and exact permutation;
- reject out-of-range indices, conflicting index operations, invalid metrics/operators/severities,
  Reference bounds, unknown fields, and invalid final documents;
- prove the expected values come from explicit spec examples rather than recomputing with the
  implementation.

**Green**

- implement strict Profile normalization and planner on a private snapshot;
- return the same stable issue structure used by persisted Profile authoring where applicable;
- keep Profile history unsupported.

Commit after schema/planner slices pass:

```text
feat(agent-control): define semantic editor draft schemas
```

## Phase 3 — Mounted draft registry and exact discard

### Slice 6: Bind controllers to exact editor surfaces

**Red first**

- register one adapter for Theme/Profile only while its real UI surface is mounted;
- inspect requires exact kind and surface ID and returns current committed document/tokens;
- closing and reopening invalidates the old surface and generation;
- StrictMode duplicate mount/unmount cannot drop a live adapter;
- a GUI edit is immediately visible with the advanced generation;
- two workbenches cannot resolve one another's IDs.

**Green**

- add an editor-draft registry beside, but separate from, UI Navigation;
- have `useUiSurface` return/provide its opaque ID to the matching editor adapter registration;
- store only owner functions and projected snapshots, never duplicate draft state;
- serialize mutations per workbench.

### Slice 7: Link the real discard decision

**Red first**

- `ui cancel` on dirty Theme/Profile opens the ordinary nested confirmation and leaves the draft;
- the decision projection identifies only its semantic purpose and exact editor link;
- generic `ui close/cancel` still cannot confirm it;
- exact draft discard calls the current mounted confirm callback and observes both surfaces gone;
- wrong/stale/non-top decision IDs, changed draft generation, clean drafts, another editor, and
  another confirmation all refuse without mutation;
- preview and blocking registration remain until successful confirmation.

**Green**

- extend `ConfirmDialog` with an optional closed semantic decision descriptor/action registration;
- Theme/Profile pass `discardDraft`, kind, and editor surface identity;
- register confirm only in the editor-draft registry; do not add `confirm` to public UI Navigation
  actions;
- implement exact discard settlement through the existing owner `confirmDiscard` callbacks.

Commit after registry slices pass:

```text
feat(editors): bind drafts to exact ui lifetimes
```

## Phase 4 — Public Agent Control family

### Slice 8: Describe and inspect end to end

**Red first**

- manifest/protocol accept only exact describe/inspect grammar and reject unknown fields/kinds;
- capabilities advertise methods and `features.editorDraft` from the manifest;
- inspect returns all three tokens, exact identity/state, and complete supported draft document;
- `ui inspect` remains value-redacted;
- no open/wrong/replaced editor returns stable errors;
- Rust CLI JSON/text/schema/help/completion agree with frontend spelling.

**Green**

- add manifest entries and fixtures;
- add frontend protocol normalization and bridge dispatch;
- add capabilities projection;
- add Rust parser/forwarder and human-readable output;
- keep queries free of expected-token arguments.

### Slice 9: Patch tracer bullet — Theme name

**Red first**

- exact current tokens change the Theme name through the owner, make the draft dirty, publish
  preview, advance draft/UI generations as specified, leave revision/persistence unchanged, and
  create one Undo entry;
- stale revision/UI/draft generation, wrong surface/kind, stale draft, or nested decision refuses
  before owner call;
- replay of the old generation conflicts;
- no-op checks tokens first and then leaves generations unchanged.

**Green**

- connect the Theme planner to the mounted adapter and bridge;
- add bounded owner-observation settlement and `draftNotSettled` details.

### Slice 10: Complete Theme operations and history

- add one red/green operation at a time: appearance, Core, reset, palette color, intensity stops,
  palette preset, override color/reference/clear;
- then add Undo and Redo through the same exact token/lifetime checks;
- verify an atomic multi-operation batch is one generation and one history entry;
- verify the original GUI operations still behave identically.

### Slice 11: Profile patch operations

- add one red/green operation at a time through the Profile owner;
- test precise rule-index conflicts and exact reorder permutations;
- verify Profile reports history unavailable;
- preserve active selection and persisted library while preview readers follow the draft.

### Slice 12: Exact discard command

- require the linked mounted decision and all three current tokens;
- call only the registered confirm-discard action;
- return final absent surfaces and tokens;
- prove no generic or non-draft confirmation can be invoked;
- prove clean drafts remain a `ui cancel`-only path.

Commit after the public family slices pass:

```text
feat(agent-control): control semantic editor drafts
```

## Phase 5 — Blocking, conflicts, and request behavior

### Slice 13: Scene-operation safety integration

For both editors, create a real dirty draft through `editorDraft.patch`, then attempt:

- Preset apply;
- Preset save/update;
- Dock entry;
- Theme/Profile library operations that the open editor specifically blocks.

Assert refusal occurs before every workspace, selection, preset, preview, notification,
persistence, or revision change. Assert the exact draft document/generation remains intact.

### Slice 14: Concurrency and settlement matrix

Cover:

- GUI edit racing an Agent patch;
- two Agent patches with the same generation;
- an external source update causing revision/UI/stale transitions;
- source deletion;
- allowed reorder/import while a draft is open;
- a lost-response replay;
- a replacement editor surface;
- discard confirmation opened/canceled/reopened;
- owner commit accepted but bridge observation timed out.

The first accepted semantic transaction wins. Uncertain commits preserve the draft and report
current tokens for inspection.

Commit after safety/conflict slices pass:

```text
test(agent-control): prove editor draft safety
```

## Phase 6 — Public documentation and generated reference

### Slice 15: Publish the synchronized contract

**Files expected:**

- create `docs/agent-control/editor-drafts.md`;
- update `docs/agent-control/README.md` family table and synchronization guidance;
- update `docs/agent-control/ui.md` with the narrow linked-discard exception while preserving
  navigation-only `show`;
- update `docs/agent-control/themes.md` and `loudness-profiles.md` with transient authoring links;
- update `docs/user/cli.md` commands, tokens, errors, and workflow;
- update command-manifest/public-surface documentation tests;
- regenerate `docs/agent-control/generated/`.

Document the three generations, exact lifetime, patch schemas, stale refusal, no persistence,
Theme-only history, linked discard, multi-workbench scope, errors, and recovery after uncertain
settlement.

Commit:

```text
docs(agent-control): document semantic editor drafts
```

## Phase 7 — Real desktop verification and walkthrough adoption

### Windows development workflow

Run the real Tauri app and, using only `desktop:control` in the second terminal:

1. choose the exact workbench instance;
2. capture initial `inspect`, Theme/Profile describe data, Preset state, and `ui inspect`;
3. `ui show theme-editor --mode customize` with both tokens;
4. inspect the exact draft and retain `draftGeneration`;
5. apply a multi-operation Theme patch and verify dirty state, preview pixels, unchanged global
   revision, and expected draft/UI generations;
6. attempt Preset apply and Dock entry; verify refusal and byte-for-byte unchanged draft;
7. capture the editor with expected revision/UI generation;
8. invoke `ui cancel`, inspect the linked nested discard decision, then invoke exact
   `editor-draft discard`;
9. verify the editor, decision, blocking registration, and preview are gone and initial durable
   Theme/Appearance/Preset state is unchanged;
10. repeat for a Profile create draft with Reference and multiple rule operations;
11. restart PLVS and inspect `plvs-settings.json`/public families to prove neither discarded draft
    persisted;
12. run concurrent/stale-token and two-workbench isolation checks.

Do not use Vite reload as persistence evidence.

### Walkthrough tooling

- extend the declarative UI walkthrough schema with closed editor-draft operations and declared
  original/final durable fields;
- sequence show -> draft inspect -> patch -> blocking proof -> screenshot -> ui cancel -> linked
  discard -> final equality;
- prohibit raw command strings, selectors, arbitrary patch objects, and generic confirm;
- preserve screenshot/report evidence on token or settlement failure;
- use development-only fixtures only for stale/race/invalid/subcontrol scenes.

### Cross-platform and full gate

- run focused Vitest suites after every slice;
- run Rust CLI tests and `npm run rust:check` for CLI phases;
- run `npm test`, `npm run format:check`, `npm run lint`, and `npm run typecheck` before each
  frontend commit;
- run `npm run docs:agent-control`, `npm run smoke:agent-control`, and `npm run check` before final
  delivery;
- repeat the semantic editor workflow on macOS when an available host can run the desktop app.

No capture/audio/DSP directory should change, so capture smoke and soak are not required.

## Final acceptance

- public discovery, manifest, protocol, capabilities, bridge, CLI, schemas, generated docs, and
  living docs agree;
- Theme/Profile draft values are available only through explicit exact draft inspection, not
  `ui inspect`;
- every GUI and Agent semantic edit advances the same surface-local generation;
- every mutation checks revision, UI generation, draft generation, kind, and surface lifetime;
- patch batches are closed, atomic, semantic, and owner-backed;
- Profile has no hidden Agent-only history;
- stale drafts are inspectable/cancelable/discardable but not remotely editable;
- `ui show` remains navigation-only and `ui cancel` still opens the real discard decision;
- only the exact linked draft decision can be confirmed, never a generic decision;
- dirty drafts continue to block scene operations before mutation;
- no patch/history/discard writes persistence, dirties a Preset, or advances global revision;
- real Windows walkthrough completes using only Agent Control and leaves durable state identical;
- macOS verification and the full gate pass before release integration.
