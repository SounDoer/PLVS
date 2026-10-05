# ADR 0021: Align automatic Theme role semantics

## Status

Accepted

## Context

The built-in Theme redesign separated measurement status, transport activity, interface feedback,
and paired data series more clearly. The former automatic relationships made Live and Snapshot
transport indicators variants of the Interface Palette, contrast-toned Interface feedback away
from its authored seed, and treated Loudness Short-term as a special companion of Primary Data.
Those relationships no longer matched the product meanings shown by the panels or the editor.

Changing an automatic role dependency changes the meaning of a Theme document even when its Core,
Palette, and Advanced fields are unchanged. Semantics 3 shipped in PLVS 0.18.0, so the redesigned
relationships require a new semantics version rather than silently changing that contract.

## Decision

Theme Semantics 4 defines these automatic relationships:

- Loudness Momentary uses Primary Data and Short-term uses Secondary Data. Their snapshot roles use
  the matching Primary and Secondary Snapshot families.
- Live transport activity uses Status Critical. Snapshot transport activity uses Primary Snapshot,
  the same state family used by panel snapshot traces.
- Interface feedback uses the authored Interface Success, Warning, and Danger colours directly.
  Solid Interface controls and feedback foregrounds therefore share one seed value.
- Dark and Light use the same snapshot transformation and shared measurement and interface palette
  seeds. Scheme-specific Core neutral colours and content colours remain independent.

Semantics 1, 2, and 3 documents remain readable through the normal persistence and import ingress.
Migration preserves every explicit Advanced override and opts automatic roles into the Semantics 4
relationships. Portable Theme format remains version 1 and now emits Semantics 4. Its first
compatible PLVS release is assigned only during release preparation.

This supersedes ADR 0020. Feedback is no longer automatically toned to a contrast target; Visual
Review reports contrast findings without changing the authored colour.

## Consequences

- Existing custom Themes keep explicit author choices but can render different Auto colours after
  migration. The semantics-version change makes that difference inspectable.
- The Theme editor does not need a separate companion colour or independently authored transport
  palette.
- Shared Dark/Light palette seeds can trade contrast for consistent identity. Visual Review remains
  advisory, and Theme authors can use Advanced overrides when a particular surface needs a
  different foreground.
- Community publication remains blocked for Semantics 4 until its shipping version is recorded in
  the central compatibility mapping.
