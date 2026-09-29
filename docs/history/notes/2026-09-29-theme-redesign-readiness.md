# Theme redesign readiness cleanup

Date: 2026-09-29

## Scope and audit correction

This pass prepares the existing Theme V2 system for a future Dark/Light redesign. It does not
retune built-in colours, change the portable format, or move product geometry into themes.

The initial audit incorrectly classified retained active Theme documents after a peer Library
refresh as stale-state bugs. Commit `548eafe1` and the existing `useSettings.rtl.test.jsx` contract
show that retaining a workbench's applied snapshot is deliberate multi-instance isolation. That
contract was preserved. The actual repair separates the applied snapshot from editor preview:
Library refreshes cannot overwrite an open preview, and Cancel restores the applied selection
instead of leaving the preview of an unselected Library item active.

## Changes

- Ordinary panel, raised, control, and selected-surface text inherits the resolved Primary Text
  role. Solid Accent/Success/Warning/Danger content remains independent.
- Theme settings owns the effective applied document plus temporary preview. The effective
  document also supplies native Dark/Light appearance. Save, Cancel, and editor teardown release
  preview ownership; refused Save retains it.
- Visual Review checks final module trace/Snapshot pairs, overridden data colours, Stats text,
  and ordinary content surfaces. A finding links to the role involved in its calculation.
- Gallery and editor share contrast/separation definitions and colour metrics. Gallery retains
  effect alpha instead of drawing an opaque Border, and its Warning chip uses Interface colours.
- Theme Preview shows Spectrum gradient fill, Stereo Map fill, classic Waveform fill, and actual
  button variants. Its local scheme and derived hover colours follow the draft.
- Current built-in output snapshots replace the V1-plus-exceptions comparison. Frozen V1 output
  and migration tests remain independent. The no-overrides policy for built-ins is unchanged.
- Runtime colour conversion no longer imports the frozen shadcn preset catalogue. Layout no
  longer runs colours through a parser, and unused chart token aliases were removed.
- Product Gallery includes classic Waveform and Stereo Map Position/M/S fill cases, restores all
  changed panel controls, and resets controls/axes between theme passes. Unexecuted focused
  review cases are explicitly reported as `notCaptured` rather than implying coverage.

## Evidence

`npm run check` passed: 420 frontend test files / 4,840 tests, production build, Rust formatting,
Clippy, and workspace unit/integration/doc tests. One Rust test remains ignored by the existing
suite. `git diff --check` also passed. No capture-engine code changed.

Local artifacts are under `artifacts/theme-readiness/` (not committed):

- `before/builtin-resolved.json`: complete pre-change built-in compiler output. Both final
  compiled built-ins are exactly equal to this baseline, including CSS, Canvas, and native output.
- `before/semantic/` and `after/semantic/`: semantic contact sheets and colour-vision aids.
- `semantic-border-pixels.json`: alpha verification. At pixel (40, 180), Dark's antialiased border
  changed from RGB 138/138/138 to 32/32/32 while adjacent panel pixel (41, 180) stayed 21/21/21.
  Light's corresponding edge changed from 122/120/119 to 233/229/226 while its adjacent panel
  stayed 245/241/238. This is the intended correction from opaque to compiled effect alpha.
- `before-product/` and `final-product/`: Windows Agent Control captures using the deterministic
  stereo File fixture. The final runner verified restoration of theme selection, source,
  file-session list, axes, and changed panel controls.
- `pixel-comparison.json`: 17 of 30 shared captures are pixel-identical, including Level Meter,
  Loudness, Stats, Vectorscope, Waveform, and Stereo Map panel examples. Spectrum, Spectrogram,
  and some composite captures differ; these captures include time-dependent rendering and the
  runner now resets scene state between themes. This is not evidence of universal pixel identity.
- `preview/`: both schemes' Overview, hovered Primary control, Modules, and Visual Review,
  captured with the existing isolated Community Preview renderer. No browser errors occurred.
- `dock/`: both schemes at 56, 82, and 160 CSS px through Agent Control. These are stopped-Live
  surface captures, not audio-data qualification. Original height, enabled state, and selection
  were restored.

The broader check now reports two existing Light Stats contrast findings: Warning Value 4.430:1
and Critical Value 4.407:1 against a 4.5:1 target. Their colours were left for the upcoming design.
Dark has no findings in the current check set. Zero warnings does not mean complete visual coverage.

The repeatable review workflow and remaining focused matrix are documented in `CONTRIBUTING.md`.
Other OS/display scales, Glass, high channel counts, and the complete native menu/editor matrix
were not qualified by this local pass.
