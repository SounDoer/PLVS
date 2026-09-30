# ADR 0019: Fixed chart fill composition

## Status

Accepted. Supersedes ADR 0018 and the theme-owned fill-opacity decisions in ADRs 0011, 0012, and 0014.

## Decision

Spectrum upper/lower fill opacity, Stereo Map fill opacity, and classic Waveform fill opacity are
fixed rendering constants: 20% / 2%, 20%, and 12%, respectively. Workspace, Dock, and Theme Preview
share these constants through `src/lib/chartFill.js`. Theme colors remain configurable.

Remove the four fill roles, numeric override kind, editor controls, and numeric compiler machinery.
Do not retain a migration or compatibility path: these theme authoring capabilities were introduced
on September 28, 2026, after the latest public release, v0.17.0 (September 24). The underlying fill
effects predate that release; their defaults remain unchanged. Normal unknown-role validation rejects
the unpublished overrides.

Theme authoring covers colors, references, effects, palettes and their stop positions, and appearance.
Panel display settings such as Stereo Map Energy Fade Strength remain independent of theme authoring.
