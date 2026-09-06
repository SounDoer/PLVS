# Theme Control

Status: Implemented public contract

Theme Control is the only Agent Control owner of Appearance and Theme authoring. It covers System
mode, fixed selection, built-in and custom Theme discovery, and custom Theme lifecycle operations.
Pack sharing remains the separate [Library Transfer](libraries.md) contract.

## Commands

```powershell
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
```

The wire methods are `theme.list`, `theme.inspect`, `theme.describe`, `theme.select`,
`theme.followSystem`, `theme.create`, `theme.update`, `theme.rename`, `theme.duplicate`,
`theme.delete`, and `theme.reorder`. There is no `activate` alias and no Appearance write through
Settings Control.

Typical PowerShell calls are:

```powershell
plvs-cli theme select plvs-light --expected-revision 12 --json
plvs-cli theme follow-system --expected-revision 13 --json
plvs-cli theme duplicate plvs-dark "Dark Copy" --expected-revision 14 --json
plvs-cli theme create .\studio-theme.json --expected-revision 15 --json
Get-Content .\studio-theme.json -Raw | plvs-cli theme update custom-1 - --expected-revision 16 --json
```

## Inspection and discovery

`theme inspect` reports Appearance independently of the library:

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

In System mode, `selectedThemeId` is null and `resolvedThemeId` is the effective `plvs-dark` or
`plvs-light`. An operating-system color-scheme change can change only the resolved ID and does not
increment the revision.

`theme list` returns the same Appearance plus compact summaries. Built-ins appear first in registry
order, followed by custom Themes in persisted order:

```json
{
  "revision": 24,
  "appearance": {
    "mode": "system",
    "selectedThemeId": null,
    "resolvedThemeId": "plvs-dark"
  },
  "themes": [
    { "id": "plvs-dark", "name": "Dark", "kind": "builtin", "colorScheme": "dark" },
    { "id": "plvs-light", "name": "Light", "kind": "builtin", "colorScheme": "light" },
    { "id": "custom-1", "name": "Studio", "kind": "custom", "colorScheme": "dark" }
  ]
}
```

`theme describe <id>` accepts either kind and returns the complete normalized Theme V2 authoring
document with `kind`, `active`, and custom-library `index` (`null` for a built-in). It never exposes
compiled tokens, CSS variables, generated CSS, or editor state.

## Theme V2 authoring document

`create` and `update` read one complete UTF-8 JSON document from a file or `-` for stdin:

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
    "interface": { "presetId": null, "critical": "#f94144" }
  },
  "overrides": {}
}
```

The document must omit `id`: create generates it and update takes it from the command line. The
document is strict and complete, not JSON Patch. `version` must be 2; `name` must trim to non-empty;
`colorScheme` is `light` or `dark`; all required core and palette members must be present. Override
keys must name public compiler roles, colors must be valid CSS colors, intensity stops must be
ordered from 0 through 1, and a non-null palette `presetId` must match that palette's canonical
values. Unknown fields and compiler failures are returned together as `invalidTheme` issues rather
than normalized into a different document.

Examples:

```powershell
plvs-cli theme create theme.json --expected-revision 18 --json
Get-Content theme.json -Raw | plvs-cli theme update custom-1 - --expected-revision 19 --json
```

`reorder` instead reads a JSON array containing every current custom Theme ID exactly once:

```json
["custom-2", "custom-1"]
```

## Selection and mutation semantics

- `select` enters Fixed mode with an existing built-in or custom Theme.
- `follow-system` enters System mode and clears the fixed selection.
- `create` appends a generated-ID custom Theme and selects it in Fixed mode.
- `update` completely replaces a custom document in place; `rename` changes only its trimmed name.
- `duplicate` accepts a built-in or custom source, appends a named custom copy, and selects it.
- `delete` accepts only custom Themes. If it deletes the selected Theme, Appearance stays Fixed and
  selects built-in Light or Dark according to the deleted Theme's `colorScheme`.
- `reorder` changes only custom display order and requires an exact permutation.

Built-ins are selectable, describable, and duplicable, but cannot be updated, renamed, deleted,
reordered, imported over, or exported. Names need not be unique. Update, rename, and reorder
preserve IDs and Appearance. Identical selection, update, rename, and order results are successful
no-ops.

Every mutation returns `dryRun`, `revision`, boolean `changed`, reserved `warnings`, a
command-specific `plan`, and projected compact `state` containing Appearance and Theme summaries.
Create and duplicate plans set `selectCreated: true`; real execution includes the generated Theme,
while dry-run deliberately allocates no ID. Delete plans include the deleted Theme and an active
Theme's same-scheme `fallbackThemeId`.

## Revision, persistence, and editors

Every mutation requires `--expected-revision`. Theme revision identity includes Appearance mode and
fixed selection, custom Theme order, and every complete normalized custom Theme V2 document. It
excludes built-in constants and the environmentally resolved System Theme. GUI and CLI operations
therefore participate in the same optimistic-concurrency boundary.

A command that changes both Settings and Themes settles both React owners, increments the single
global revision once, and flushes persistence once before success. No-op and dry-run do neither.
Dry-run still performs request, document, compiler, revision, permission, and editor validation.

An open Theme Editor blocks `select`, `follow-system`, `create`, `update`, `rename`, `duplicate`, and
`delete`, including dry-runs, before any draft, state, preview, notification, ID, or persistence
change. The failure is `editorActive` with `editors: ["theme"]`. List, inspect, and describe do not
block. Reorder and append-only import remain allowed and must leave the open draft unchanged. Other
open editors do not invoke this Theme-specific guard.

## Library Transfer boundary

Theme export and import are documented in [Library Transfer](libraries.md). Export stays custom-only;
requesting a built-in ID returns `themeNotExportable`. Import stays append-only: it never selects or
overwrites a Theme and remains allowed while the Theme Editor is open. This differs intentionally
from Theme Control authoring commands.

## Errors

- `themeNotFound`, `themeNotMutable`, `themeNotExportable`, `invalidTheme`, and
  `invalidPermutation` exit 3. `invalidTheme.details.issues` contains stable JSON paths.
- `revisionConflict` and `editorActive` exit 4.
- `persistenceFailed` exits 1 and reports `stateCommitted: true` plus the resulting revision when
  visible state changed before the flush failed.

Malformed JSON and unreadable input files are CLI-side `invalidArguments` failures and never reach
the running app.
