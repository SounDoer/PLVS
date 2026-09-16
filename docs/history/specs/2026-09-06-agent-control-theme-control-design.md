# Agent Control Theme Control — Design

Date: 2026-09-06
Status: Draft for discussion

## 1. Goal

Make Theme Control the single public CLI owner of both Theme selection and Theme-library authoring.
A caller must be able to inspect the current appearance, follow the operating system, select a
built-in or custom Theme, inspect Theme V2 documents, and create, replace, rename, duplicate,
delete, reorder, export, and import custom Themes without learning PLVS persistence keys or
compiled token internals.

The family extends the implemented `theme list/export/import` Library Transfer surface. Transfer
continues to provide append-only sharing; Theme Control owns appearance and authoring.

## 2. Scope

In scope:

- moving the complete public Appearance contract out of Settings Control;
- current appearance inspection, fixed Theme selection, and Follow System;
- full normalized Theme V2 inspection;
- create, update, rename, duplicate, delete, and reorder for custom Themes;
- duplication/customization of built-in Themes;
- strict public authoring validation followed by the existing Theme V2 normalization/compiler
  boundary;
- revision guards, dry-run, persistence settlement, and Theme Editor blocking;
- the existing append-only `list/export/import` commands.

Out of scope:

- changing the GUI placement of Appearance or the Theme picker;
- changing `plvs:settings`, `plvs:themes`, Theme V2, compilation, runtime preview, or migration
  formats merely to match the CLI family boundary;
- editing an open GUI draft or opening/closing the Theme Editor from the CLI;
- partial JSON Patch updates to individual colors, palettes, stops, or overrides;
- exposing resolved CSS variables, generated CSS, canvas colors, or editor widget state;
- configuring custom light/dark mappings for Follow System;
- batch mutation of several Themes.

## 3. Public ownership decision

Theme Control is the only public CLI write surface for appearance. The current public
`settings update` field named `appearance` is removed rather than retained as an alias.
`settings describe` and `settings inspect` also stop reporting Appearance, so the CLI does not
present one concept under two families.

This is an intentional breaking contract adjustment:

- a Settings patch containing `appearance` fails as an unknown control;
- Settings documentation and generated reference output no longer include Appearance;
- Theme Control documentation becomes the discovery point for current and available Themes;
- no compatibility alias, warning period, or hidden second write path is added.

This changes only the Agent Control boundary. The GUI may continue to show Appearance in Settings,
and the underlying React state and persistence keys remain where they are. Configuration Transfer
also continues to carry appearance as part of the complete application setup.

## 4. Existing semantic owners

Theme behavior currently spans several owners:

- `useThemeSettings` owns `appearance`, `themeId`, system preference resolution, document
  application, and Settings persistence;
- `useCustomThemeSettings` composes picker actions, Theme Editor state, custom-library refresh,
  and active-Theme deletion fallback;
- `useThemeEditor` owns draft/preview/save/cancel behavior and generates custom IDs;
- `customThemesRepo` owns normalized custom Theme storage and order;
- `themeRegistry`, `themeSchema`, the V1 migration boundary, and the compiler define which Themes
  are usable and how authoring documents become runtime output.

Agent Control must not write `settingsStore` or `themesStore` behind these React owners. Extract one
pure decision layer shared by the GUI composition and Agent Control, then commit its plans through a
Theme controller owned by the existing hooks.

The intended split is:

1. pure planners strictly validate an operation and project Theme library plus Appearance state;
2. the Theme controller commits the plan through React and the existing repositories;
3. Agent Control owns JSON-RPC validation, optimistic concurrency, settlement, and response
   envelopes.

## 5. Public commands

```text
plvs-cli theme list --json
plvs-cli theme inspect --json
plvs-cli theme describe <id> --json
plvs-cli theme select <id> --expected-revision <n> --json [--dry-run]
plvs-cli theme follow-system --expected-revision <n> --json [--dry-run]
plvs-cli theme create <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli theme update <id> <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli theme rename <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli theme duplicate <id> <name> --expected-revision <n> --json [--dry-run]
plvs-cli theme delete <id> --expected-revision <n> --json [--dry-run]
plvs-cli theme reorder <file|-> --expected-revision <n> --json [--dry-run]
plvs-cli theme export <--all|--ids <id,...>> --json [--out <file>]
plvs-cli theme import <file|-> --expected-revision <n> --json [--dry-run]
```

Wire methods are:

```text
theme.list
theme.inspect
theme.describe
theme.select
theme.followSystem
theme.create
theme.update
theme.rename
theme.duplicate
theme.delete
theme.reorder
theme.export
theme.import
```

There is no `theme activate` alias. `select` matches Loudness Profile Control and the GUI picker;
`follow-system` names the distinct mode transition without pretending `system` is a Theme ID.

## 6. Queries

`theme inspect` reports appearance independently of library size:

```json
{
  "revision": 24,
  "appearance": {
    "mode": "fixed",
    "selectedThemeId": "custom-1",
    "resolvedThemeId": "custom-1"
  }
}
```

In System mode, `selectedThemeId` is `null` and `resolvedThemeId` is the currently effective
`plvs-dark` or `plvs-light`. An operating-system color-scheme change can change only
`resolvedThemeId`; as today, that environmental change does not increment the global control
revision.

`theme list` becomes the compact discovery query for both built-ins and custom Themes:

```json
{
  "revision": 24,
  "appearance": {
    "mode": "fixed",
    "selectedThemeId": "custom-1",
    "resolvedThemeId": "custom-1"
  },
  "themes": [
    { "id": "plvs-dark", "name": "Dark", "kind": "builtin", "colorScheme": "dark" },
    { "id": "custom-1", "name": "Studio", "kind": "custom", "colorScheme": "dark" }
  ]
}
```

Built-ins appear first in registry order, followed by custom Themes in persisted display order.
The existing transfer-oriented list currently exposes only custom entries; this richer result is an
intentional Theme Control contract change. Export remains custom-only, and asking it to export a
built-in ID returns `themeNotExportable`.

`theme describe <id>` accepts a built-in or custom ID and returns the complete normalized Theme V2
authoring document plus `kind`, `active`, and the custom-library `index` (`null` for built-ins).
It never returns compiled output.

## 7. Authoring document

Create and update read one complete UTF-8 JSON Theme V2 authoring document without an `id`:

```json
{
  "version": 2,
  "name": "Studio",
  "colorScheme": "dark",
  "core": {
    "workspace": "#101114",
    "surface": "#191b20",
    "text": "#f4f4f5",
    "interfaceAccent": "#f59e0b",
    "primaryData": "#38bdf8",
    "secondaryData": "#c084fc"
  },
  "palettes": {
    "status": {
      "presetId": null,
      "good": "#34d399",
      "warning": "#fbbf24",
      "critical": "#f97373"
    },
    "intensity": {
      "presetId": null,
      "stops": [
        { "position": 0, "color": "#000004" },
        { "position": 1, "color": "#fcffa4" }
      ]
    },
    "frequency": {
      "presetId": null,
      "low": "#ff2d3d",
      "mid": "#fb923c",
      "high": "#356dff"
    },
    "interface": {
      "presetId": null,
      "critical": "#f94144"
    }
  },
  "overrides": {}
}
```

Identity belongs to the command and semantic owner:

- create mints a custom ID;
- update takes the target ID from the command line and preserves it;
- duplicate takes its source ID from the command line and generates a new custom ID;
- a document cannot claim an ID that conflicts with the operation target.

Strict validation rejects unknown fields and incomplete structures before calling the current
normalizer. It validates the complete Theme V2 authoring shape, name limits, color scheme, opaque
core and palette colors, ordered intensity stops, palette preset IDs, override kinds, role IDs,
references, effects, and all existing numeric bounds. The compiler then validates registry
compatibility, including override roles and references. Silent migration or repair is appropriate
for persisted/imported legacy data, not for a newly authored Control request.

`colorScheme` is editable through a complete create/update document even though the current GUI
does not expose a direct switch. It is part of the public V2 authoring model and affects deletion
fallback. Update remains a complete replacement, not JSON Patch.

## 8. Mutation semantics

| Command         | Theme-library effect                                                             | Appearance effect                                                                                          |
| --------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `select <id>`   | none                                                                             | enter Fixed mode and select the built-in or custom Theme                                                   |
| `follow-system` | none                                                                             | enter System mode and clear the fixed selection                                                            |
| `create`        | append a generated-ID custom Theme                                               | select the created Theme in Fixed mode                                                                     |
| `update`        | replace a custom document in place                                               | preserve mode and selection                                                                                |
| `rename`        | replace only the trimmed custom name                                             | preserve mode and selection                                                                                |
| `duplicate`     | append a generated-ID copy of a built-in or custom Theme under the supplied name | select the copy in Fixed mode                                                                              |
| `delete`        | remove a custom Theme                                                            | if selected, remain Fixed and select built-in Light or Dark according to the deleted Theme's `colorScheme` |
| `reorder`       | exact permutation of custom IDs                                                  | preserve mode and selection                                                                                |

Built-ins are selectable, describable, and duplicable. They are not updateable, renameable,
deleteable, reorderable, import targets, or exportable library entries.

Names are not unique. IDs remain stable across update, rename, and reorder. Missing IDs are errors,
including delete of an already absent custom Theme. An update or rename whose normalized result is
identical is a successful no-op.

The reorder document is a JSON array containing every current custom Theme ID exactly once.
Missing, duplicated, built-in, foreign, and extra IDs produce `invalidPermutation` and no mutation.

## 9. Mutation results and dry-run

All mutations return the common result shape:

```json
{
  "dryRun": false,
  "revision": 25,
  "changed": true,
  "warnings": [],
  "plan": {},
  "state": {
    "appearance": {
      "mode": "fixed",
      "selectedThemeId": "custom-1",
      "resolvedThemeId": "custom-1"
    },
    "themes": []
  }
}
```

Command-specific plan data includes:

- select/follow-system: previous and resulting Appearance;
- create: normalized authoring document and `selectCreated: true`; only the real result contains
  the generated Theme;
- update/rename: resulting complete Theme;
- duplicate: source summary, resulting name, and `selectCreated: true`; only the real result
  contains the generated Theme;
- delete: deleted Theme and, when active, the fixed built-in fallback ID;
- reorder: ordered custom Theme IDs.

All mutations require `--expected-revision` and accept `--dry-run`. Dry-run runs the same validation,
compiler, permission, and editor checks but performs no React update, repository write,
notification, ID allocation, runtime publication, or revision increment. Create and duplicate
dry-runs therefore do not fabricate IDs.

## 10. Revision and settlement

The current transfer-only Theme signature contains only custom IDs and names. Theme Control must
replace it with a stable signature containing:

- Appearance mode and selected fixed Theme ID;
- custom Theme order;
- every complete normalized custom Theme V2 authoring document.

Built-in documents are application constants and do not enter dynamic revision identity. System
`resolvedThemeId` is environmental and also remains outside revision identity.

GUI and Agent Control create, update, rename, duplicate, delete, reorder, select, and Follow System
changes increment the single global revision and wake `app.wait`. One command increments it once
even when both Settings and Themes stores change.

Commands touching both stores settle the Theme repository view and Appearance owner before
returning, then flush persistence once. The implementation must explicitly notify same-context
Theme subscribers when a write occurs outside their owning hook; a disk write alone is not an
observed UI commit.

No-op and dry-run return without persistence and retain the current revision. A persistence failure
after a visible commit returns `persistenceFailed` with `stateCommitted: true` and the resulting
revision.

## 11. Theme Editor blocking

An open Theme Editor blocks `select`, `follow-system`, `create`, `update`, `rename`, `duplicate`, and
`delete`, whether or not its draft is dirty. These operations can replace the draft source, change
the preview/restore target, or create competing saved state.

`list`, `inspect`, and `describe` never block. `reorder` remains allowed because it changes only
custom display order. Append-only `theme import` retains its current non-blocking behavior because
it neither selects nor overwrites a Theme. Neither operation may alter the open draft.

Every blocked mutation returns `editorActive`, includes `editors: ["theme"]`, and is tested to have
performed no state, repository, preview, notification, or ID mutation before refusal. Other draft
editors do not block Theme-specific operations.

## 12. Errors

- `themeNotFound` — the requested built-in or custom ID is absent; exit 3.
- `themeNotMutable` — a built-in was targeted by update, rename, or delete; exit 3.
- `themeNotExportable` — export was asked to include a built-in; exit 3.
- `invalidTheme` — strict authoring or compiler validation failed; `details.issues` carries stable
  JSON paths; exit 3.
- `invalidPermutation` — reorder is not an exact custom-ID permutation; exit 3.
- `revisionConflict` — expected revision is stale; exit 4.
- `editorActive` — the Theme Editor is open; exit 4.
- `persistenceFailed` — committed state could not be flushed; exit 1.

Malformed local JSON and unreadable files remain CLI-side `invalidArguments` failures.

## 13. Acceptance criteria

- Appearance is absent from every Settings Control query, schema, patch, example, and generated
  reference, while the GUI and configuration profile behavior remain unchanged.
- `theme inspect/select/follow-system` fully cover the removed Settings contract.
- list and describe make both built-in and custom Themes discoverable without exposing compiled
  output.
- built-ins have immutable permissions but can be duplicated into custom Themes.
- create and duplicate select their generated Theme; update and rename preserve Appearance.
- deleting the active custom Theme uses the GUI's same-scheme built-in fallback.
- strict create/update validation rejects unknown or silently repairable input.
- every relevant editor-blocking test asserts both refusal and pre-refusal immutability.
- GUI and Agent Control mutations participate in the strengthened revision identity.
- cross-store mutations produce one global revision and one persistence flush.
- all commands appear in capabilities, help, protocol tests, and public documentation.
- focused tests and `npm run check` pass.

## 14. Decisions recorded and proposed

Confirmed during planning:

1. Appearance moves completely out of Settings Control; no second entry point or compatibility
   alias remains.
2. Theme selection uses `theme select <id>` and Follow System uses a separate
   `theme follow-system` command.

This draft additionally proposes:

1. create/update authoring documents omit `id`;
2. `colorScheme` is writable in the complete CLI authoring document;
3. create and duplicate select the generated Theme, matching GUI creation;
4. delete of the active custom Theme remains Fixed and falls back by its light/dark scheme;
5. reorder and append-only import remain allowed while the Theme Editor is open;
6. create and duplicate dry-runs return no proposed ID.
