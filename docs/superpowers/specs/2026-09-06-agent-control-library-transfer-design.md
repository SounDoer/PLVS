# Library Transfer Control — design

Date: 2026-09-06

Status: Proposed

Phase A of the App Control work that follows Dock Control. It exposes the three library
export/import operations the Settings panel already offers — Loudness Profiles, Presets and
Theme — through App Control, and creates the `theme` and `loudnessProfile` command families that
later Theme Control and Loudness Profile Control will grow into.

Phase B (whole-configuration `app config export / import / reset`) is deliberately not in this
document. See [Out of scope](#out-of-scope).

## Why

Two gaps, one shape.

`docs/agent-control/settings.md` places the Theme library and the Loudness Profile library outside
Settings Control and defers each to a future command family. Neither family exists, so today no
command can even name a theme or a loudness profile, and `app.inspect` reports neither library.

Meanwhile the GUI grew per-library export and import (`src/transfer/`, landed 2026-09-05). Those
operations have settled semantics, a pure planner, and a two-step confirm — a shape that maps onto
App Control's existing dry-run contract almost without translation. Exposing them is the cheapest
way to open both missing families, and it gives an agent the one thing it currently cannot do at
all: move a preset, theme or loudness profile between machines without a human at a file dialog.

## Command surface

```powershell
plvs-cli app preset list --json                                    # exists, unchanged
plvs-cli app preset export --all --out <file> --json
plvs-cli app preset export --ids <id[,id...]> --out <file> --json
plvs-cli app preset import <file|-> --expected-revision <n> --json [--dry-run]

plvs-cli app theme list --json
plvs-cli app theme export --all --out <file> --json
plvs-cli app theme export --ids <id[,id...]> --out <file> --json
plvs-cli app theme import <file|-> --expected-revision <n> --json [--dry-run]

plvs-cli app loudness-profile list --json
plvs-cli app loudness-profile export --all --out <file> --json
plvs-cli app loudness-profile export --ids <id[,id...]> --out <file> --json
plvs-cli app loudness-profile import <file|-> --expected-revision <n> --json [--dry-run]
```

JSON-RPC methods are `preset.export` / `preset.import`, `theme.list` / `theme.export` /
`theme.import`, and `loudnessProfile.list` / `loudnessProfile.export` / `loudnessProfile.import`.

### Naming

The CLI family is `loudness-profile`; the RPC method prefix is `loudnessProfile`. Neither casing
has a clean precedent — CLI families are all single lowercase words today, and `MODULE_CATALOG`
mixes `levelMeter` with `stereo-map` — so this picks kebab-case for the shell and camelCase for the
wire, which is what each side already does elsewhere. `loudness` alone is rejected: it collides with
the Loudness *panel* module, and `app loudness list` next to `app panel describe loudness-1` would
read as the same subject.

## Read commands

`theme.list` returns the custom Theme library only:

```json
{ "revision": 13, "themes": [{ "id": "theme-a", "name": "Studio" }] }
```

Built-in themes are not library entries, cannot be exported, and are already enumerated by
`settings describe` as Appearance choices. `theme.list` does not restate them.

`loudnessProfile.list` returns the library and the current selection:

```json
{ "revision": 13, "profiles": [{ "id": "p-1", "name": "EBU R128" }], "activeId": "p-1" }
```

`activeId` is null when the selection is Off. It is reported, never written, by this family.

Both mirror `preset.list`'s `{ id, name }` summaries deliberately: detail belongs to a future
`describe` in each family, not to `list`.

`preset.list` is unchanged.

## Export

Export is a read. It takes no `--expected-revision`, accepts no `--dry-run`, does not increment the
revision, and does not write persistence.

The result carries the pack document itself:

```json
{
  "revision": 13,
  "pack": {
    "app": "PLVS",
    "kind": "theme-pack",
    "version": 1,
    "exportedAt": "2026-09-06T00:00:00Z",
    "items": []
  }
}
```

`--out <file>` makes the CLI write the pack to that path, following `plvs-cli doctor --out`. The
success envelope still goes to stdout, but `result` becomes `{ "revision": 13, "out": "<path>" }` —
`pack` and `out` never appear together, so a script can tell which it got without inspecting sizes.
**The frontend never performs file IO for these commands.** A CLI
caller's path is relative to the caller's working directory, not the app's, and the app's own file
access for this feature is a user-driven save dialog. Rust reads and writes; the frontend only
produces and consumes documents.

`--all` and `--ids` are mutually exclusive and one is required. An id in `--ids` that is not in the
library fails with `themeNotFound` / `presetNotFound` / `loudnessProfileNotFound`, listing every
missing id at once. It does not silently export the subset that matched: the GUI cannot produce an
unknown id because it exports from checkboxes, so this is a CLI-only failure mode and must be
explicit, per the existing rule that agent commands never silently repair input.

A preset pack additionally bundles the Loudness Profiles its presets refer to, exactly as the GUI
does. That bundling rule stays in `src/transfer/`, shared (see [Shared logic](#shared-logic)).

## Import

Import is merge-only and append-only, unchanged from the GUI: nothing local is overwritten, nothing
is deleted, and no selection moves. `src/transfer/libraryAdapters.js` states this as its own
contract — `active`, `activeId`, `dirty` and `settings.themeId` are left exactly as they were — and
this family inherits it rather than restating it.

The input is a whole pack document, read from a file or `-` (stdin), the same way `workspace apply`
and `preset reorder` take documents.

The result extends the standard mutation shape with the import plan:

```json
{
  "dryRun": false,
  "revision": 14,
  "changed": true,
  "warnings": [],
  "plan": {
    "items": [
      { "sourceId": "t-1", "finalId": "t-1", "name": "Studio", "disposition": "added" },
      { "sourceId": "t-2", "finalId": "t-9", "name": "Night (2)", "disposition": "duplicated" },
      { "sourceId": "t-3", "finalId": "t-3", "name": "Warm", "disposition": "skipped" }
    ],
    "loudnessProfiles": []
  },
  "state": { "themes": [{ "id": "t-1", "name": "Studio" }] }
}
```

- `plan.items` is `planPackImport`'s `itemPlan` verbatim. `plan.loudnessProfiles` is its
  `profilePlan`, present only for `preset.import`, and empty for a pack that bundled none.
- `disposition` is `added`, `skipped` (same id, identical content) or `duplicated` (same id,
  different content — a fresh id is minted and the name gets a ` (2)` suffix).
- `state` is the resulting library in the same shape that family's `list` returns, so a caller never
  has to follow a successful import with a `list`.

`--dry-run` is the GUI's review step. `planPackImport` is already a pure function that computes the
whole answer without touching a store, so a dry run is the real code path minus the `append` call —
not a parallel simulation. It returns the identical `plan`, leaves `revision` at its current value,
and writes nothing.

An import whose every item is `skipped` is a successful no-op: `changed: false`, no revision
increment, no persistence write, no notification. This follows the existing no-op contract.

## Revision, dirty, and inspect

A library import that adds at least one entry increments the global revision once, regardless of how
many entries it added, through the existing `bumpControlRevision`. Export, dry runs, no-op imports
and every `list` leave it alone.

This is the first time the Theme and Loudness Profile libraries enter revision semantics at all;
until now neither was public state. Their entry is limited to what `list` reports.

The bump must come from a state signature the bridge watches, not from the import handler, so that a
GUI import bumps the revision exactly as an agent import does — "equivalent user and agent mutations
follow the same rule". The Preset library already works this way (`presetStateSignature`); the two
new libraries need the same treatment, which means the bridge has to receive the custom Theme
library as a prop the way it already receives `loudnessProfiles`.

**Import never marks the active Preset dirty.** The dirty flag tracks the working scene, and a
library merge changes no scene state — it does not even move a selection. This is not a judgement
call layered on top of the adapters; it is what the adapters already do.

**`app.inspect` is unchanged.** It keeps reporting the compact `{ activeId, dirty }` Preset
relationship and gains no theme or loudness-profile library. Callers use the `list` commands, the
same division `preset.list` already established.

## Blocking editors

Library import is **allowed** while the Theme Editor or the Loudness Profile Editor is open, and
does not call `assertSceneOperationAllowed`.

Two reasons. The guard exists because scene operations destroy an open draft; an append-only merge
that touches no selection cannot. And the GUI already permits it — the Settings panel's Import
buttons are disabled only on `packBusy`, never on editor state — so refusing here would make the CLI
stricter than the button it mirrors, for no protective gain.

The adjacent hazard — a library written from outside the owning React state leaving a stale list on
screen, because `plvs:themes` and `plvs:settings` do not notify their own context — is already
closed: the adapters call `notifyLocal()`, `useThemeSettings.js:92` and `LoudnessProfileContext.jsx:66`
subscribe, and `eef93f67` covered both. This family inherits that by writing through
`getAdapter().append()` and nothing else. What still needs a test is that it does; see
[Testing](#testing).

## Shared logic

A hard constraint on this work: the GUI and App Control run one implementation, not two.

The RPC handlers call `packShape.js`, `mergeIntoLibrary.js` and `libraryAdapters.js` — the same
modules `usePackTransfer.js` calls — and restate none of: the pack envelope, the merge and renaming
rules, the preset-to-profile bundling rule, or the three libraries' container shapes.

`usePackTransfer.js` keeps only what is genuinely GUI: file dialogs, transient status text, and the
two-step review overlay.

One extraction is required rather than optional. The preset pack's profile bundling currently lives
inside `usePackTransfer.exportSelection` — it resolves `referencedProfileIds` against the loudness
adapter before calling `buildPack`. That is pack-format logic sitting in a React hook, and the export
handler needs the same rule. Move it into `src/transfer/` as a pure `collectPackItems(type, ids)`
that both callers use. Nothing else needs extracting: `parsePack` and `planPackImport` are already
pure and already the whole of the import decision.

## Contract guard

`PACK_KINDS` in `packShape.js` is the list of libraries that have a pack format. A fourth entry
added there without a matching command family would leave the CLI quietly one library short, with
every existing test green — the same failure mode the four existing App Control guards were built to
remove.

Add `src/agentControl/libraryTransferContract.test.js`: every `PACK_KINDS` entry has `list`, `export`
and `import` methods registered, and every registered library method names a `PACK_KINDS` entry. It
fails in both directions.

## Errors

Reuses the existing envelope and codes. New:

- `themeNotFound`, `loudnessProfileNotFound` — an id in `--ids` is not in that library. Details list
  every missing id. `presetNotFound` already exists and is reused for preset export.
- `invalidPack` — the document is not a valid pack for this family. The reason is the error
  `message`, passed through from `PackValidationError` verbatim; those messages already distinguish
  "not a PLVS file", "this is a whole configuration file", "this is a *different library's* file",
  "missing a version" and "made by a newer version of PLVS", and they are written for a person who
  received a shared file. This paragraph originally put the reason in `details.issues` as well; the
  implementation carries no `details` for this code, because a second copy of the same sentence is
  not a second piece of information. `libraries.md` documents the shipped behaviour.

`revisionConflict`, `persistenceFailed` and `commandFailed` behave as they do everywhere else.

## Out of scope

Named so the omissions are decisions rather than gaps:

- **Whole-configuration `app config export / import / reset`.** Phase B, its own spec. It relaunches
  the app, which needs a response semantics that no command in the v1 envelope has yet.
- **Create, update, delete, duplicate and rename** in the `theme` and `loudnessProfile` families.
  Those are Theme Control and Loudness Profile Control. This spec opens the families and fixes their
  shape; it does not fill them.
- **`describe`** for themes and loudness profiles. `list` is what export needs.
- **Selecting** a theme or loudness profile. Appearance already belongs to Settings Control; the
  loudness selection belongs to a later slice.
- **Replace or overwrite import modes.** Import stays merge-only. A pack is a sharing artefact.
- **Built-in themes in `theme.list`.**
- **Library state in `app.inspect`.**

## Testing

Vitest beside the source, `/** @vitest-environment jsdom */` on anything that renders React or
touches a persistence store, and the repo's bare-`getBy*` idiom rather than `jest-dom` matchers.

- `planPackImport` and `parsePack` already have coverage; this work adds none there.
- Handler tests per family: export `--all` and `--ids`, unknown id, import add/skip/duplicate,
  dry-run writes nothing, no-op import does not bump the revision, preset import remaps bundled
  profiles.
- The contract guard above.
- **Do not re-test `notifyLocal`.** `eef93f67` closed that loop and covered it in
  `libraryAdapters.test.js` and `LoudnessProfileContext.test.jsx`, and `useThemeSettings.js:92`
  subscribes to `themesStore`. What is worth one test is that this family writes through
  `getAdapter().append()` rather than reaching a store directly: render the theme library's owner,
  dispatch a theme import through the bridge with the editor open, and assert both that the rendered
  list shows the imported theme and that the open draft is unchanged. One family is enough — the
  adapters are what differ, and they already have their own coverage.
- Rust: `cli_app.rs` argument parsing and method mapping for the nine new commands, in the style of
  `parses_and_builds_preset_read_commands`; `--all`/`--ids` mutual exclusion; `--out` handling.

## Documentation

- New `docs/agent-control/libraries.md` — one page, because the three libraries share one mechanism
  and splitting it would triple the restatement.
- `docs/agent-control/presets.md` — remove "Individual Preset import/export remains outside this
  command family."
- `docs/agent-control/settings.md` — the Theme library and Loudness Profile library exclusions now
  point at this family rather than at an unbuilt one.
- `docs/agent-control/README.md` — command list, implementation status, and the guard table gains the
  contract test above.
- `docs/cli.md` and the `plvs-cli app --help` text.
- No `generated/` page: these commands have no field schema, so there is nothing for the schema
  builders to render.
