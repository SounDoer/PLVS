# Theme Visual Review Policy

Date: 2026-09-26

## Context

Theme analysis measures WCAG contrast references, PLVS color separation, surface hierarchy, and
Intensity-stop separation. The first Theme V2 policy surfaced these findings continuously in the
editor, required built-in Themes to have no findings, and blocked Community publication for the
covered WCAG contrast findings. That made useful review measurements behave like authoring rules
and pushed color choices toward passing a small deterministic matrix rather than the complete
rendered Theme.

## Decision

- Keep every existing visual-analysis target and calculation unchanged.
- Treat every visual-analysis result as advisory review. It never blocks local save, a built-in
  Theme, Community publication, or Semantic Gallery generation.
- Keep malformed documents, unsupported versions, registry incompatibility, compiler failures,
  and incomplete publication assets as blocking errors.
- Remove visual findings from the live Core, Palettes, and Advanced editing flow. Calculate and show
  them on the Theme Preview's Visual Review page, with measured values, recommended targets,
  standards where applicable, affected consumers, roles, and navigation back to the relevant
  editor control.
- Community assessment remains explicit: `eligible` is true after strict validation, `blockers` is
  empty, and `scope` is `visualReviewOnly`. Findings remain in the assessment's `warnings` array.
- Semantic Gallery reports retain targets and pass/fail observations as evidence, but tests verify
  the completeness and shape of those measurements rather than requiring every observation to
  pass.

## Non-goals

- This does not lower or rename WCAG reference targets.
- This does not claim WCAG conformance for PLVS, a built-in Theme, or a Community Theme.
- This does not weaken portable Theme validation, compiler validation, or publication artifact
  integrity.

## Acceptance

- Editing a Draft with a visual finding shows no live warning banner or per-role warning marker.
- Opening Theme Preview exposes the findings on Visual Review and can return to the affected role.
- A valid low-contrast portable Theme remains eligible for Community publication while retaining
  its measured finding and WCAG reference.
- Built-in and Semantic Gallery tests do not fail solely because a visual target is missed.
