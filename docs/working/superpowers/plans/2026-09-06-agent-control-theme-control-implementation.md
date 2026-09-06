# Agent Control Theme Control — Implementation Plan

> Draft plan. Do not implement until the paired design is approved.

**Goal:** Make `theme` the sole CLI owner of Appearance and add complete Theme inspection,
selection, creation, replacement, duplication, deletion, and ordering while preserving GUI draft,
preview, fallback, revision, and persistence behavior.

**Architecture:** Extract pure Theme operation planners shared by the GUI and Agent Control. Keep
React hooks as commit owners, Theme V2 as the authoring boundary, and the bridge responsible for
protocol validation, concurrency, settlement, and result envelopes. Remove Appearance from the
Settings Control contract in the same release slice.

**Tech stack:** React 19, JavaScript ESM, Vitest, Rust CLI parser, Tauri Agent Control.

**Spec:**
`docs/working/superpowers/specs/2026-09-06-agent-control-theme-control-design.md`

---

### Task 1: Freeze strict Theme authoring validation and pure planners

**Files:**

- Create: `src/theme/themeLibrary.js`
- Create: `src/theme/themeLibrary.test.js`
- Modify: `src/theme/themeSchema.js` only to export reusable schema primitives
- Modify: `src/theme/compileTheme.js` only if compiler validation needs a structured issue adapter

- [ ] Define strict Control-authoring validation for a complete Theme V2 document without `id`.
- [ ] Reject unknown fields, incomplete palettes, invalid colors/stops/preset IDs/overrides, and
      compiler-incompatible roles or references with stable `{ code, path, message }` issues.
- [ ] Keep legacy migration outside the Control-authoring path; newly authored input must not be
      silently upgraded or repaired.
- [ ] Implement pure planners for select, Follow System, create, update, rename, duplicate, delete,
      and reorder over normalized custom-library plus Appearance state.
- [ ] Inject ID generation only for real create/duplicate; dry-run planning must not allocate.
- [ ] Encode built-in permissions and same-color-scheme deletion fallback in the planner.
- [ ] Ensure every planner is immutable and compares normalized semantic content for no-op.
- [ ] Cover valid, invalid, no-op, built-in, missing-ID, exact-permutation, fallback, and generated-ID
      cases.

Run:

```powershell
npx vitest run src/theme/themeLibrary.test.js src/theme/themeSchema.test.js src/theme/compileTheme.test.js
```

Expected: strict Control documents and every projected transition are frozen before integration.

Commit:

```text
feat(theme): add shared theme control planners
```

---

### Task 2: Route GUI Theme operations through one controller

**Files:**

- Modify: `src/theme/customThemesRepo.js`
- Modify: `src/theme/customThemesRepo.test.js`
- Modify: `src/hooks/useThemeSettings.js`
- Modify: `src/hooks/useThemeSettings.test.jsx`
- Modify: `src/hooks/useCustomThemeSettings.js`
- Modify: `src/hooks/useCustomThemeSettings.test.jsx`
- Modify: `src/hooks/useThemeEditor.js`
- Modify: `src/hooks/useThemeEditor.test.js`

- [ ] Expose one command-grade Theme controller for current Appearance, built-ins, ordered custom
      documents, editor state, planners, and commit operations.
- [ ] Route picker selection, Follow System, create/save, edit/save, rename, duplicate, delete, and
      reorder behavior through the shared planner without changing visible GUI semantics.
- [ ] Keep `customThemesRepo` a persistence adapter rather than a second semantic owner.
- [ ] Ensure external commits update React immediately and use `notifyLocal()` only where the
      existing store ownership requires it.
- [ ] Preserve Theme Editor draft publication, Save, Cancel, undo/redo, and restore-target behavior.
- [ ] Expose the Theme-specific editor guard before every conflicting mutation.
- [ ] Test that GUI and command-grade operations produce identical Theme and Settings store states.
- [ ] Test refusal before repository, Appearance, preview, notification, or ID mutation.

Run:

```powershell
npx vitest run src/hooks/useThemeSettings.test.jsx src/hooks/useCustomThemeSettings.test.jsx src/hooks/useThemeEditor.test.js src/theme/customThemesRepo.test.js
```

Expected: all GUI behavior remains intact behind one reusable mutation owner.

Commit:

```text
refactor(theme): share gui semantics with external control
```

---

### Task 3: Move Appearance out of Settings Control

**Files:**

- Modify: `src/agentControl/settingsControl.js`
- Modify: `src/agentControl/settingsControl.test.js`
- Modify: `src/agentControl/settingsControlContract.test.js`
- Modify: `src/agentControl/publicSurfaceDocs.test.js`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`

- [ ] Remove `appearance` from `PUBLIC_FIELDS`, Settings snapshots, schema, availability, patch
      validation, planning, changed paths, and bridge application.
- [ ] Make a Settings update containing `appearance` fail as an unknown control with no mutation.
- [ ] Remove Theme options and Theme Editor state from Settings-only context where no longer used.
- [ ] Keep underlying GUI settings state, persistence, Configuration Transfer, and app snapshot
      assembly unchanged where they are not part of Settings Control.
- [ ] Update contract tests so Settings read/describe/update agree on the reduced public surface.
- [ ] Add a regression test proving Theme operations, not Settings, are the only public appearance
      mutation path.

Run:

```powershell
npx vitest run src/agentControl/settingsControl.test.js src/agentControl/settingsControlContract.test.js src/agentControl/publicSurfaceDocs.test.js src/agentControl/useAgentControlBridge.test.jsx
```

Expected: Appearance is no longer discoverable or writable through Settings Control.

Commit:

```text
refactor(agent-control): move appearance into theme control
```

---

### Task 4: Strengthen Theme revision identity and settlement

**Files:**

- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `docs/agent-control/libraries.md`

- [ ] Replace the ID/name-only Theme signature with Appearance mode/fixed selection, custom order,
      and complete normalized Theme V2 documents.
- [ ] Exclude environment-only `resolvedThemeId` changes under Follow System from revision identity.
- [ ] Verify GUI select, Follow System, create, update, rename, duplicate, delete, and reorder each
      increment the global revision; semantic no-ops do not.
- [ ] Add settlement capable of awaiting both Theme-library and Appearance owners while producing
      one global revision.
- [ ] Flush persistence once after every committed command and preserve `stateCommitted: true` on
      post-commit failure.
- [ ] Update the transfer documentation to explain the strengthened revision even though import
      remains append-only and selection-preserving.

Run:

```powershell
npx vitest run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: GUI and external Theme changes share one concurrency identity and settlement contract.

Commit:

```text
refactor(agent-control): track complete theme state
```

---

### Task 5: Add Theme Control protocol and capabilities

**Files:**

- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/appSnapshot.js`
- Modify: `src/agentControl/appSnapshot.test.js`

- [ ] Add `theme.inspect/describe/select/followSystem/create/update/rename/duplicate/delete/reorder`
      to capabilities while preserving existing list/export/import entries.
- [ ] Validate exact parameter allowlists and require `expectedRevision` for every mutation.
- [ ] Keep semantic Theme validation in the shared planner; the protocol layer validates only JSON
      envelope and coarse input types.
- [ ] Normalize `dryRun` consistently with existing mutations.
- [ ] Validate scalar IDs/names as bounded non-empty strings and reorder input as an array.
- [ ] Add coverage guards tying advertised commands to request validation and bridge handlers.

Run:

```powershell
npx vitest run src/agentControl/protocol.test.js src/agentControl/appSnapshot.test.js
```

Expected: the full Theme family is advertised and every request shape is exact.

Commit:

```text
feat(agent-control): define theme control protocol
```

---

### Task 6: Implement Theme queries and mutations in the bridge

**Files:**

- Modify: `src/App.jsx`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/transfer/libraryAdapters.js` only if list/export views need to be separated explicitly

- [ ] Pass the complete Theme controller from `App.jsx` instead of assembling behavior from custom
      Theme records and Settings fields.
- [ ] Implement `inspect`, richer built-in-plus-custom `list`, and normalized `describe`.
- [ ] Keep export/import custom-only even though list and describe include built-ins.
- [ ] For every mutation: check revision and Theme-specific editor state, plan once, return early for
      dry-run/no-op, register all settlements, commit through the controller, await, then flush once.
- [ ] Allocate IDs only during real create/duplicate and return the actual created document.
- [ ] Map planner/compiler failures to stable Theme error codes and JSON paths.
- [ ] Return resulting Appearance and compact Theme summaries so scripts need no immediate query.
- [ ] Test success, dry-run, no-op, stale revision, permissions, editor refusal, persistence failure,
      same-context refresh, and result envelopes for every command.

Run:

```powershell
npx vitest run src/agentControl/useAgentControlBridge.test.jsx src/transfer/libraryAdapters.test.js
```

Expected: Theme Control operates only through the live app owners and observes durable settlement.

Commit:

```text
feat(agent-control): control theme library and appearance
```

---

### Task 7: Add Rust CLI parsing and file/stdin inputs

**Files:**

- Modify: `src-tauri/src/cli_control.rs`
- Modify: `src-tauri/src/doctor.rs` only if the public-family inventory changes shape

- [ ] Extend the existing `theme` family parser; add no top-level aliases.
- [ ] Parse inspect/describe/select/follow-system/rename/duplicate/delete as scalar forms.
- [ ] Read create/update Theme documents and reorder arrays from file or `-` using the common JSON
      reader and UTF-8 BOM behavior.
- [ ] Require `--json` for every running-app command and `--expected-revision` for every mutation.
- [ ] Accept `--dry-run` only on mutations and reject transfer-only flags on Control commands.
- [ ] Update root and family help plus request-building, malformed-input, and flag-matrix tests.
- [ ] Map Theme semantic failures to the documented process exit codes.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_control --no-fail-fast
```

Expected: every public command builds the intended wire request and malformed local input never
reaches the app.

Commit:

```text
feat(cli): add theme control commands
```

---

### Task 8: Publish the new family boundary

**Files:**

- Create: `docs/agent-control/themes.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/agent-control/libraries.md`
- Modify: `docs/agent-control/settings.md`
- Modify: `docs/cli.md`
- Modify: `docs/working/agent-control-cli-roadmap.md`
- Modify: the Settings reference generator that owns `docs/agent-control/generated/settings.md`
- Modify: `scripts/cliDocumentationContract.test.js`
- Modify: `CHANGELOG.md`

- [ ] Publish commands, Theme V2 authoring, permissions, results, dry-run, revision, editor, and
      error contracts from the approved spec.
- [ ] Remove Appearance from Settings prose, examples, generated reference, and documentation
      assertions without editing generated output by hand.
- [ ] Distinguish Theme Control from custom-only append/export Library Transfer.
- [ ] Add copyable PowerShell examples for selecting, following System, duplicating a built-in, and
      file/stdin authoring.
- [ ] Mark Theme editing and the Settings-to-Theme boundary change complete in the roadmap.
- [ ] Record the intentional breaking CLI adjustment in the changelog.

Run:

```powershell
npm run docs:agent-control
npx vitest run scripts/cliDocumentationContract.test.js src/agentControl/publicSurfaceDocs.test.js
```

If the repository exposes a differently named documentation generator, use that script rather than
editing `docs/agent-control/generated/` manually.

Expected: public docs expose exactly one Appearance family and generated references match code.

Commit:

```text
docs(agent-control): publish theme control
```

---

### Task 9: Final verification

- [ ] Run all focused frontend and Rust tests from Tasks 1–8.
- [ ] Run `npm run check`.
- [ ] Start the real desktop app and inspect System mode through `theme inspect` and `theme list`.
- [ ] Select each built-in Theme, then return to Follow System; verify GUI and resolved appearance.
- [ ] Duplicate a built-in, update and rename the copy, reorder it, then delete it and verify the
      same-scheme fixed fallback.
- [ ] Create a temporary complete V2 Theme from file and update it through stdin.
- [ ] Open the Theme Editor and verify blocked mutations return `editorActive` without changing the
      draft; verify reorder and append-only import retain the approved non-blocking behavior.
- [ ] Verify `settings describe/inspect` omit Appearance and `settings update` rejects it.
- [ ] Remove all temporary Themes through normal commands and restart the app before trusting the
      persisted file, because Vite reload can rewind the boot-time persistence cache.

No capture smoke or soak is required: this plan does not touch `src-tauri/src/audio`, `dsp`, or
`engine`.

Final implementation commit is unnecessary if every task commit is already clean and complete.

## Review checklist before implementation

- [ ] Confirm all six proposed decisions in the paired spec.
- [ ] Confirm Appearance is removed from Settings queries as well as mutation.
- [ ] Confirm richer `theme list` includes built-ins while transfer export stays custom-only.
- [ ] Confirm full-document replacement instead of JSON Patch.
- [ ] Confirm Theme-specific blocking and the reorder/import exceptions.
- [ ] Confirm create/duplicate dry-runs return no proposed ID.
- [ ] Confirm the breaking contract requires no compatibility period.
