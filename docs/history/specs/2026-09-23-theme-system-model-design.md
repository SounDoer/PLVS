# Theme System Model Design

Date: 2026-09-23  
Status: Active design discussion

## Purpose

This record captures decisions made while reviewing the Theme System Audit. It is intentionally
incremental: unresolved areas remain open until they have been discussed, and implementation does
not begin merely because a decision is recorded here.

## Confirmed decisions

### Portable Theme contract

- A portable Theme preserves stable authoring semantics, not cross-platform pixel identity.
- Portable content contains authoring intent: color scheme, Core Colors, Palette values, and
  explicit public Advanced overrides.
- Recipe implementations, dependency graph edges, CSS variables, Canvas selector keys, and native
  bindings are application internals and are not serialized as authoring content.
- Document-shape versioning and semantic-compilation versioning are separate concerns.
- An application must not silently reinterpret a Theme within its declared semantic compatibility
  range. Moving to a new semantic model requires explicit conversion or an incompatibility result.
- Palette preset provenance is advisory metadata, not canonical content, validity, or identity.
- Gallery evidence records its exact application version, platform, dimensions, and data fixture
  separately from the Theme document.

### Public role boundary

- Advanced overrides may be portable, but only for an explicit allowlist of stable semantic roles.
- A public override role must be understandable without renderer knowledge, have a real visible
  production consumer, retain meaning across renderer implementations, identify its affected
  surface in the editor, and have representative gallery coverage.
- Authoring inputs, public semantic roles, internal derived roles, and renderer bindings are
  distinct layers.
- Internal derived roles such as shared data recipes are not serialized merely because they exist
  in the registry.
- CSS variables, Canvas selector keys, and native adapters are bindings and are never public Theme
  fields.
- Future placeholders and roles without consumers are not exposed in Advanced or the portable
  contract.

### Core authoring model

- Retain the six existing Core Color concepts; do not add Border, Grid, Snapshot, or other derived
  colors to Core.
- Expose the Theme's Dark or Light appearance explicitly alongside the Core Colors. Appearance is
  a compilation and native-surface choice, not a color inferred from the six values.
- The editor labels are `Workspace`, `Surface`, `Text`, `Accent`, `Primary Data`, and
  `Secondary Data`.
- The persisted field remains `core.interfaceAccent`; simplifying its editor label does not rename
  the schema field.
- `Surface` is the authoring seed for panels, popovers, neutral controls, and muted regions. Its
  label remains concise; its description explains that derived surfaces need not use the exact
  input value.
- `Text` means the primary foreground for text and icons. Secondary and annotation foregrounds are
  derived. Its public meaning does not include every internal use of the value as a calculation
  pole.
- `Accent` covers primary actions, selected controls, and focus indicators, and does not affect
  measurement data.
- Accent and Primary Data remain independent even when a built-in Theme assigns them the same
  color.
- Primary Data is the main measurement emphasis. Secondary Data is an independent comparison,
  channel, or side color; it is distinct from a companion color derived from Primary Data.
- The exact surface-ladder recipe and contrast-content recipes for colored backgrounds remain open
  for the later Interface and recipe review.

## Open areas

The next area is the Palette authoring model: Status, Intensity, Frequency, and the current
single-color Interface group.
