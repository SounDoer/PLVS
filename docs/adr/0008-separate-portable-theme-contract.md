# ADR 0008: Separate portable Theme documents from persisted and compiled state

## Status

Accepted (2026-09-24)

## Context

The first Theme pack format copied PLVS's persisted custom-Theme object directly into a sharing
envelope. That made local IDs and palette-preset provenance look like public Theme content, tied the
file to the current persistence shape, and let malformed entries disappear during normalization.
It also left future desktop, CLI, website, and repository validators without one stable artefact to
agree on.

Persistence, sharing, and rendering have different compatibility needs. Persistence must read old
local records. A shared Theme must preserve authoring meaning across installations. Rendering needs
the complete compiler output, including private recipes and bindings that are not author input.

## Decision

- Define a standalone `plvs-theme` document with independent `formatVersion` and
  `semanticsVersion` fields.
- Include only the Theme name, color scheme, Core colors, literal Palette values, and explicit
  public Advanced overrides. Omit local IDs, palette-preset provenance, recipes, dependencies,
  resolved roles, CSS variables, Canvas keys, and native bindings.
- Canonicalize field order, normalized colors, and override order before serialization. Compute
  content identity as SHA-256 of that canonical UTF-8 JSON.
- Use the same pure converter and strict validator for GUI and Agent Control transfer. Validation
  reports path-addressed issues and rejects the whole Theme pack when any Theme is invalid.
- Store the source installation's merge ID beside, not inside, the portable document in Theme Pack
  V2. Import assigns that ID locally through the existing merge rules and restores palette
  `presetId` fields as `null`.
- Continue reading Theme Pack V1 through the persistence migration boundary, but reject unreadable
  entries instead of silently dropping them. Loudness and Preset pack versions do not change.

## Consequences

- A Theme's portable identity is stable across local ID changes and palette-preset selection.
- Re-export after import reproduces the same canonical Theme document and content hash.
- Palette preset names remain editor convenience rather than required shared semantics.
- New portable fields or changed meaning require explicit format or semantics evolution; they
  cannot ride implicitly on a persistence migration.
- Pack V1 remains import-compatible, while new `.plvstheme` exports use Theme Pack V2.

## Verification

Contract tests cover provenance-free export, strict validation, import/re-export round trips,
canonical serialization and SHA-256 identity, Pack V1 compatibility, Pack V2 conversion, duplicate
source IDs, and merge equality that ignores preset provenance.
