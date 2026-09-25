# Community Portable Content V1

Date: 2026-09-25  
Status: Approved implementation contract; Loudness Profile slice implemented first

## Relationship to earlier records

This record supplies the exact portable-content decisions left open by
`2026-09-22-community-sharing-foundation-design.md` and
`2026-09-22-community-pack-catalog-and-preview-design.md`. The Theme contract is already frozen by
`2026-09-23-theme-system-model-design.md`; this record does not redesign it.

The immediate objective is one strict Pack V2 boundary shared by desktop transfer, Agent Control,
the CLI and future Community CI. Pack V1 remains a tolerant read-only compatibility path.

## Versioned layers

Each layer has an independent version:

- Pack `version` describes the envelope and dependency graph. The current version is `2`.
- Item `formatVersion` describes the JSON authoring shape.
- Item `semanticsVersion` describes the meaning of stable metric, module, control and role IDs.

An application version is diagnostic metadata only. It never substitutes for these versions.

## Shared Pack V2 envelope

The only top-level fields are:

```json
{
  "app": "PLVS",
  "kind": "loudness-pack",
  "version": 2,
  "createdWith": { "appVersion": "0.17.0" },
  "items": [],
  "dependencies": []
}
```

`createdWith` is optional; every other field is required. `items` is non-empty. `dependencies` is
empty for Loudness Profile and Theme packs. Preset packs may contain one
`loudness-profile` dependency group. Unknown fields are errors in V2.

Item IDs are pack-local merge identities. They contain 1–128 ASCII characters, begin with an
alphanumeric character, and otherwise contain only alphanumerics, `.`, `_` or `-`. The reserved
object-property names `__proto__`, `prototype` and `constructor` are invalid. IDs are unique within
their primary or dependency group.

New exports contain no `exportedAt`. Canonical files use UTF-8 without a BOM, two-space indentation
and a final newline.

## Defensive limits

The shared implementation will enforce these limits before or during parsing:

| Boundary                      |                     Limit |
| ----------------------------- | ------------------------: |
| Encoded Pack                  |                     2 MiB |
| JSON nesting depth            |                        32 |
| Primary Items                 |                       256 |
| Dependency groups             |                         1 |
| Items in one dependency group |                       256 |
| Item ID                       |      128 ASCII characters |
| Item name                     |  64 Unicode scalar values |
| Panel title                   | 128 Unicode scalar values |
| Loudness rules per Profile    |                       128 |
| Workspace panels              |                        64 |
| Workspace layout depth        |                        32 |

The existing 256 KiB public Workspace-layout limit remains in force inside a Portable Preset. A
limit breach is an error; strict V2 parsing never truncates content.

## Portable Loudness Profile V1

The canonical id-free document is:

```json
{
  "kind": "plvs-loudness-profile",
  "formatVersion": 1,
  "semanticsVersion": 1,
  "name": "Broadcast",
  "referenceLufs": -23,
  "rules": [{ "metricId": "truePeak", "op": ">", "value": -1, "severity": "fail" }]
}
```

`referenceLufs` is `null` or a finite number from -70 through 0. Every rule has a stable known
ruleable Stats metric ID, `>` or `<`, a finite numeric threshold and `warn` or `fail`. Publication
rejects incomplete rules rather than omitting them. A Profile with `referenceLufs: null` and no
rules is semantically empty and cannot be exported or published.

The item ID appears beside this document inside a Pack and is not part of content identity. Import
allocates or remaps the local ID before producing the stored `{ id, name, referenceLufs, rules }`
shape.

Pack V1 import continues through the tolerant persistence normalizer and reports compatibility
repairs when warning plumbing lands. New exports use Pack V2 and strict validation.

## Portable Preset V1

The canonical id-free document contains:

- `kind: "plvs-preset"`, `formatVersion: 1`, `semanticsVersion: 1` and `name`;
- `workspace`, expressed with artefact-local panel keys, public module IDs, semantic controls,
  semantic axes and the public layout tree;
- required `presentation` values for Focus View, Always On Top, Glass and panel opacity;
- a discriminated `dock` value;
- `loudnessProfile.dependencyId`, which is null for Off or resolves inside the Pack.

It excludes device/source selection, window bounds, monitor identity, active/dirty state,
measurements, history contents and offsets, fullscreen, File paths, editor drafts, the active Theme
and all internal store wiring.

Import converts the portable document to a saved local Preset without applying it. It allocates new
panel IDs, rewrites the layout, axes and control maps, remaps the bundled Profile dependency, and
preserves supported intent. Unknown required modules or controls are errors.

Apply is a separate plan against live runtime capabilities. Unsupported optional Dock, reserve
space or Glass behavior, channel clamping and size constraint produce warnings containing requested
and effective values. Apply still passes through the existing scene-operation and blocking-editor
guards before mutation.

## Validation checkpoints

The shared pure boundaries are:

```text
validatePublishablePack(pack)
planPackImport(pack, localLibraries, appCapabilities)
planPresetApply(preset, runtimeCapabilities)
```

Every issue contains `severity`, stable `code`, JSON `path`, a human `message`, and optional
structured `details`. Programs classify by code, never message text.

Publish Validation additionally requires exactly one primary Item, rejects unused dependencies and
applies the family-specific publication policy. Import Planning computes add/skip/copy outcomes and
ID remapping without writing. Apply Planning resolves machine-dependent adaptations immediately
before the user-requested scene mutation.

## Compatibility and rollout

- New Theme and Loudness Profile exports use Pack V2.
- New Preset exports remain Pack V1 until Portable Preset V1, dependency validation and Apply Plan
  land as one coherent slice.
- All three families continue to read Pack V1.
- A newer Pack, format or semantics version is refused before mutation.
- Desktop, Agent Control and CLI must consume the same converters and validators.
- The deterministic Preview Runtime and static Catalogue begin only after all three Item families
  have strict publication validation.
