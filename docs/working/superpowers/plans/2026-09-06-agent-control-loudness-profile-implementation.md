# Agent Control Loudness Profile Control — Implementation Plan

> Draft plan. Do not implement until the paired design is approved.

**Goal:** Implement `describe/select/create/update/rename/delete/reorder` for Loudness Profiles while
keeping `LoudnessProfileProvider` as the only mutation owner and preserving GUI selection, Preset,
draft, revision, and persistence semantics.

**Architecture:** Add one pure library planner shared by the provider and Agent Control. The provider
owns commits; the bridge owns JSON-RPC validation, optimistic concurrency, settlement, and response
envelopes. Strengthen the Profile signature before exposing mutations.

**Tech stack:** React 19, JavaScript ESM, Vitest, Rust CLI parser, Tauri Agent Control.

**Spec:**
`docs/working/superpowers/specs/2026-09-06-agent-control-loudness-profile-design.md`

---

### Task 1: Freeze document validation and pure planning

**Files:**

- Create: `src/lib/loudnessProfileLibrary.js`
- Create: `src/lib/loudnessProfileLibrary.test.js`
- Modify: `src/lib/loudnessProfileNormalize.js` only if a normalization primitive must be exported

- [ ] Define `LoudnessProfileDocumentError` and strict authoring validation for name, reference,
  ruleable metric IDs, operators, optional finite values, severity, and unknown fields.
- [ ] Return all detectable `{ code, path, message }` issues in stable document order.
- [ ] Implement pure planners for select, create, update, rename, delete, and reorder. Inject
  `makeId` into real create planning; do not allocate an ID for dry-run.
- [ ] Make delete project both the Profile state and Preset list, including
  `affectedPresetIds`, Off fallback, and dirty behavior.
- [ ] Ensure planners never mutate their inputs and use normalized documents in equality checks.
- [ ] Cover valid, invalid, no-op, selection-preserving, exact-permutation, duplicate-ID, and
  multi-Preset deletion cases.

Run:

```powershell
npx vitest run src/lib/loudnessProfileLibrary.test.js src/lib/loudnessProfileNormalize.test.js
```

Expected: all tests pass.

Commit:

```text
feat(loudness-profile): add shared library mutation planners
```

---

### Task 2: Route GUI operations through the shared planner

**Files:**

- Modify: `src/hooks/LoudnessProfileContext.jsx`
- Modify: `src/hooks/LoudnessProfileContext.test.jsx`

- [ ] Replace the private deletion-reference rewrite with the planner's projected Preset state.
- [ ] Route current `select`, `saveDraft`, `removeProfile`, and `reorderProfiles` behavior through
  the shared planner without changing UI-visible behavior.
- [ ] Add command-grade provider methods for create, update, rename, delete, select, and reorder.
  Each accepts or returns a plan; none bypasses the provider's `stateRef` and React state.
- [ ] Expose a Profile-specific draft guard. It blocks select/create/update/rename/delete but not
  reorder, list, describe, or append-only import.
- [ ] Keep create selecting the new Profile, edit preserving its captured selection, and delete
  cleaning Preset references.
- [ ] Add tests proving the existing GUI paths and the new command-grade paths produce identical
  Settings and Preset store states.
- [ ] Add explicit tests that every blocked operation refuses before Settings or Presets mutate.

Run:

```powershell
npx vitest run src/hooks/LoudnessProfileContext.test.jsx src/hooks/usePresets.test.jsx
```

Expected: all tests pass with no changed GUI semantics.

Commit:

```text
refactor(loudness-profile): share mutation semantics with external control
```

---

### Task 3: Strengthen revision identity and multi-store settlement

**Files:**

- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `docs/agent-control/libraries.md`

- [ ] Replace the summary-only Loudness signature with a stable signature of active selection,
  order, reference, and complete ordered rules.
- [ ] Verify a GUI selection, rule edit, rename, create, delete, and reorder each bump the global
  revision; a semantic no-op does not.
- [ ] Add a settlement path capable of awaiting both the Profile owner and Presets for create,
  select, and delete while producing one global revision.
- [ ] Preserve `stateCommitted: true` reporting when persistence fails after settlement.
- [ ] Update the Library Transfer documentation: `activeId` and Profile content now participate in
  revision identity even though transfer import still never changes selection.

Run:

```powershell
npx vitest run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: external and command-driven changes have the same revision behavior.

Commit:

```text
refactor(agent-control): track complete loudness profile state
```

---

### Task 4: Add read and mutation protocol contracts

**Files:**

- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/appSnapshot.js`
- Modify: `src/agentControl/appSnapshot.test.js`

- [ ] Add `loudnessProfile.describe/select/create/update/rename/delete/reorder` to capabilities.
- [ ] Validate exact parameter allowlists and required `expectedRevision` for every mutation.
- [ ] Keep authoring-document semantic validation out of the envelope parser; the parser checks a
  plain object and the shared planner reports `invalidProfile` issues.
- [ ] Normalize `dryRun` consistently with existing mutations.
- [ ] Validate describe/select/delete/update/rename IDs as non-empty strings; accept literal Off
  only for select.
- [ ] Validate reorder as an array at the protocol layer and as an exact permutation in the planner.

Run:

```powershell
npx vitest run src/agentControl/protocol.test.js src/agentControl/appSnapshot.test.js
```

Expected: valid requests normalize exactly once and unknown fields fail at their own JSON path.

Commit:

```text
feat(agent-control): define loudness profile control protocol
```

---

### Task 5: Implement bridge reads and mutations

**Files:**

- Modify: `src/App.jsx`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`

- [ ] Pass the complete Loudness Profile controller from `App.jsx`, replacing the current
  list-only bridge input while keeping compact library transfer helpers working.
- [ ] Implement describe from normalized persisted Profiles, including `active` and `index`.
- [ ] For each mutation: check revision, check the Profile-specific draft guard, compute one pure
  plan, return early for dry-run/no-op, register all settlements, commit through the provider,
  await settlement, then flush once.
- [ ] Re-plan real create after the provider returns the generated ID, following the existing
  Preset save pattern; dry-run must not invent an ID.
- [ ] Map planner issues to `invalidProfile`, `invalidPermutation`, or
  `loudnessProfileNotFound` with stable paths and details.
- [ ] Return compact resulting state so scripts need no immediate follow-up list.
- [ ] Test every mutation's success, dry-run, no-op, stale revision, editor refusal, persistence
  failure, and result envelope.
- [ ] For delete, assert affected Preset IDs are reported and no Settings or Preset mutation occurs
  before a refusal or validation failure.

Run:

```powershell
npx vitest run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: all existing and new bridge tests pass.

Commit:

```text
feat(agent-control): control loudness profile library
```

---

### Task 6: Add CLI parsing and file/stdin inputs

**Files:**

- Modify: `src-tauri/src/cli_control.rs`
- Modify: `src-tauri/src/doctor.rs` only if the public-family inventory changes shape

- [ ] Extend the existing `loudness-profile` family parser without creating a second top-level
  family or alias.
- [ ] Parse describe/select/rename/delete as scalar commands.
- [ ] Read create/update authoring documents and reorder arrays from a file or `-` using the shared
  CLI JSON document reader and UTF-8 BOM behavior.
- [ ] Require `--json` for every running-app command and `--expected-revision` for every mutation.
- [ ] Accept `--dry-run` only on mutations; reject export/import flags on editing commands.
- [ ] Add root/family help and request-building tests for every form and malformed input class.
- [ ] Verify `invalidProfile`, `invalidPermutation`, and `loudnessProfileNotFound` map to exit 3.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_control --no-fail-fast
```

Expected: all CLI parser, request, help, and exit-code tests pass.

Commit:

```text
feat(cli): add loudness profile editing commands
```

---

### Task 7: Publish the approved contract

**Files:**

- Create: `docs/agent-control/loudness-profiles.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/agent-control/libraries.md`
- Modify: `docs/cli.md`
- Modify: `docs/working/agent-control-cli-roadmap.md`
- Modify: `scripts/cliDocumentationContract.test.js`
- Modify: `CHANGELOG.md`

- [ ] Move the approved command, authoring, result, dry-run, revision, editor, and error contracts
  from the working spec into the public Agent Control documentation.
- [ ] Clearly distinguish Control from append-only Library Transfer.
- [ ] Add copyable PowerShell examples for file and stdin authoring.
- [ ] Mark Loudness Profile editing complete in the roadmap and make Theme editing next.
- [ ] Add documentation contract assertions for the command family.

Run:

```powershell
npx vitest run scripts/cliDocumentationContract.test.js
```

Expected: the published CLI surface and documentation remain in sync.

Commit:

```text
docs(agent-control): document loudness profile control
```

---

### Task 8: Final verification

- [ ] Run focused frontend and Rust tests from Tasks 1–7.
- [ ] Run `npm run check`.
- [ ] Start the real desktop app, create a temporary Profile through the CLI, update it, select Off,
  reorder it, and delete it; inspect the UI after every command.
- [ ] Save a temporary Preset that references the Profile, dry-run delete, verify
  `affectedPresetIds`, then delete and verify the Preset reference becomes Off.
- [ ] Open the Loudness Profile editor and verify select/create/update/rename/delete return
  `editorActive` while reorder and append-only import retain their specified behavior.
- [ ] Remove all temporary Profiles and Presets through normal commands.

No capture smoke or soak is required: this plan does not touch `src-tauri/src/audio`, `dsp`, or
`engine`.

Final implementation commit is unnecessary if every task commit is already clean and complete.

## Review checklist before implementation

- [ ] Confirm the three proposed decisions in the paired spec.
- [ ] Confirm full-replacement update rather than JSON Patch.
- [ ] Confirm the strengthened revision semantics are acceptable for existing `list/import` users.
- [ ] Confirm Profile-specific blocking rather than the global scene-operation guard.
- [ ] Confirm create dry-run returns no proposed ID.

