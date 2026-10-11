# ADR 0025: Model Snapshot appearance as a History data state

## Status

Accepted

## Context

Theme Semantics 4 gave trace modules Primary and Secondary Snapshot colours. Those roles solve the
immediate trace-rendering case but make Snapshot appearance a set of module colours rather than a
state of the data. Palette-driven Level Meter and Spectrogram rendering consequently has no
Snapshot treatment, and a Theme that wants one historical-data family repeats the same Advanced
choice across several modules.

A general user-authored colour transform would remove that repetition, but it would also introduce
lightness, chroma, hue, opacity, or transform-strength parameters into an editor intentionally
limited to final colours. A complete second set of Status, Intensity, and Frequency palettes would
avoid transform controls at the cost of doubling Theme authoring.

## Decision

The Theme system models selected Snapshot rendering as a derived `history` data state applied to
the existing data semantics.

- Product UI continues to call the modes Live and Snapshot. History is an internal Theme term.
- History applies only while a historical Snapshot is selected. Paused Live, Max Hold, Reference,
  Selection, and file analysis do not inherit it merely because they retain or inspect data.
- The Theme compiler owns History derivation for solid data colours and Status, Intensity, and
  Frequency palettes. DOM, SVG, Canvas, and WebGL consumers select compiled values and do not
  derive colours locally.
- Automatic recipes may differ by semantic family. Status preserves Safe, Warning, and Critical
  meaning; Intensity and Frequency preserve their ordering and separation. One universal colour
  transform is not required.
- Advanced groups the shared History Primary and History Secondary direct colour roles with the
  transport indicators under Live & Snapshot. Module-level History exceptions remain flat in the
  module sections, immediately follow their Live counterparts, and explicitly say whether they
  follow a shared role or are Custom.
- Core and Palettes gain no numeric treatment, opacity, or transform controls. Theme Preview may
  switch between Live and Snapshot, but that switch is not persisted in the Theme.
- PLVS Dark and PLVS Light remain zero-Advanced-override Themes and use automatic History values.
- Status remains the shared measurement-state palette. Level Meter does not gain a separate
  palette solely to customise its Snapshot appearance.
- A change to automatic History meaning requires a Theme semantics version and migration rather
  than reinterpretation under an existing version.

This supersedes the Snapshot-specific parts of ADR 0021. ADR 0021's separation of measurement
status, transport activity, interface feedback, and paired Primary and Secondary data remains in
force.

## Consequences

- Palette-driven modules participate in Snapshot appearance without requiring a second authored
  palette.
- Theme authors can define one Primary and Secondary historical-data family without repeating it
  for every trace module.
- The editor remains colour-first, while automatic recipes carry more responsibility and require
  cross-module visual verification.
- Snapshot state remains identifiable without colour through the product's existing status and
  selection cues.
- History lookup tables must be compiled or cached on Theme changes so Snapshot rendering adds no
  per-frame colour transformation.
- Snapshot appearance is selected per display surface. A Live Dock is not recoloured merely because
  the main workspace is viewing a Snapshot.
- Published Theme appearance depends on semantics versioning and regenerated deterministic
  Sharesets previews when the contract changes.
