# ADR 0017: Opaque interface borders and independent grids

## Status

Accepted

## Context

Border previously supplied a colour effect with fixed scheme alpha, while Input used a separate
fixed effect. Advanced Border Color therefore did not mean the final visible colour, and could not
control input outlines. Grid inherited the Border source colour, so changing interface decoration
also changed measurement guides. Adding separate opacity and input-border controls would increase
authoring complexity without improving those responsibilities.

## Decision

Ordinary Border is an opaque colour shared by input outlines and interface separators. Auto
flattens the former scheme effect onto resolved Panel Surface. Grid instead derives its neutral
colour independently from Panel Surface; module Grid and Guides overrides remain available.
Shadow retains its colour effect and compiler-owned alpha. This supersedes ADR 0005 only for the
Border effect and its dependency relationship with Grid.

Semantics 3 makes the changed meaning explicit while leaving the document formats unchanged.
Existing Semantics 2 Border overrides are flattened onto their resolved Panel Surface, and their
inherited module Grid colours become explicit overrides. Existing Grid colours and references are
preserved. The migration runs through the ordinary import/persistence ingress, not a second runtime.

Workspace panels omit permanent outer outlines and title underlines. Their surface, spacing, and
rounded corners establish grouping; resize dividers and temporary location/drag highlights retain
their interaction meaning. This does not require every input field to lose its boundary cues.

## Consequences

- Theme Editor gains no opacity or separate Input Border setting.
- A Border edit cannot recolour automatic Grid or Guides.
- One opaque border has a predictable colour, but its contrast varies across surfaces. Migration
  preserves its appearance on Panel Surface, not every former alpha composite on every background.
- Input outlines intentionally adopt the shared border. Migrated themes can carry explicit Grid
  overrides; Reset to Auto opts into the independent Grid rule.
- Panel layouts must be visually checked in both schemes, including compact and translucent views.
