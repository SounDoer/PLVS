# Default Theme Redesign

Date: 2026-10-04
Status: Implemented in the working tree; awaiting the owner's visual verification

## Objective

Redesign the built-in Dark and Light Themes after the Theme role refactors exposed weak surface
hierarchy and legibility. The style direction stays (orange Primary Data, blue Secondary Data).
Built-in Themes keep authoring no Advanced overrides, so anything the Core Colors and Palettes
cannot express is a recipe change; recipe changes were explicitly allowed for this project.

## Method

The neutral ladder was decided by eye, one variable at a time, from comparison sheets of real
application captures (Agent Control screenshots of a deterministic stereo File fixture, plus the
Theme Preview overview). The owner then delegated the remaining layers with the instruction to
decide them conservatively. The rule applied to the delegated layers: change only what has an
externally grounded defect, and leave purely aesthetic judgements untouched and listed below.

The numbers recorded here describe what was chosen. None of them become Visual Review checks;
Visual Review keeps its existing WCAG-based checks and separation heuristics unchanged.

"Distance" is OKLab distance; "contrast" is WCAG contrast against the panel surface.

## Decisions

### Neutral ladder (chosen by the owner)

| Item                          | Dark                                                                        | Light                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Workspace                     | `#070707` (unchanged)                                                       | `#e9e5e2` (was `#fbf8f5`)                                                 |
| Panel (Core Surface)          | `#1c1c1c` (was `#151515`)                                                   | `#fdf9f6` (was `#f5f1ee`)                                                 |
| Workspace to panel distance   | 0.098 (was 0.067)                                                           | 0.060 (was 0.020)                                                         |
| Muted, raised, control        | `#222222`, `#252525`, `#323232`; distance 0.038 to raised, 0.091 to control | current recipe: `#f8f4f1`, `#f6f2ef`, `#eae6e3`; distance 0.021 and 0.057 |
| Border and grid               | current recipe                                                              | current recipe                                                            |
| Secondary and annotation text | current recipe                                                              | current recipe                                                            |

Light changes direction: the panel becomes the lightest surface and the Workspace the darker
ground, as in Dark. This is an input change only.

Dark needs larger automatic steps for muted, raised and control than the previous 2% / 3% / 8% mix
toward text. The recipes now use scheme-specific fractions: 2.8% / 4.2% / 10.3% in Dark, unchanged
in Light.

### Feedback and activity foreground (delegated)

Feedback messages and the Live and Snapshot indicators repeated the solid-fill colour of the
Interface Palette, which measured about 3:1 on the Dark panel (2.88:1 for Danger on the new panel)
although they are text. They now use a `feedback` recipe that keeps hue and chroma and tones
lightness to 5.5:1 against the panel. Solid fills keep the authored colour. See ADR 0020.

### Deliberately unchanged (delegated)

- Interface Accent, Primary and Secondary Data, the Status, Frequency and Intensity palettes.
  Every existing contrast check passes on the new panels, and no external standard calls for a
  change.
- Data and Status separation. Primary Data orange sits between Warning amber and Critical red
  (distance about 0.10, lower under colour-vision simulation). Fixing it means moving the brand hue
  or the conventional status hues, which is a style decision rather than a defect repair.
- In Light, Interface Accent and Primary Data are nearly the same colour (distance 0.03), and
  Frequency Low is close to Critical (0.047).
- The muted Level Meter gradient in Light. Its Warning stop is a dark yellow, which is brown at any
  lightness that keeps Stats text above 4.5:1.

## Results

- Visual Review reports no findings for either built-in. The two Light Stats findings that existed
  before the redesign (Warning 4.43:1, Critical 4.41:1) are resolved by the lighter panel (4.75:1
  and 4.73:1).
- Six frozen custom Theme documents were recompiled before and after. On Auto, Dark Themes change
  muted, raised and control by two to five 8-bit steps; both schemes change the five feedback and
  activity roles. No other role changes, including for V1-migrated Themes. No document migration is
  needed and the semantics version is unchanged.
- `npm run check` passed: 430 frontend test files / 4,915 tests, production build, Rust formatting,
  Clippy and tests.

## Not qualified

- Real popovers, menus and the Settings drawer: Agent Control cannot open them. The raised surface
  was judged from the Theme Preview dialog only.
- Feedback text in the real application (export completion, unavailable audio, Live recording):
  seen only in the Theme Preview.
- Glass and reduced Surface Opacity, high channel counts, other display scales, macOS, and native
  menus. Dock was captured stopped at 56, 82 and 160 CSS px for both schemes but not reviewed with
  live audio.

## Evidence

Local, uncommitted artifacts:

- `artifacts/theme-redesign/`: comparison sheets, variant documents and the scripts that produced
  them (`01-surfaces` to `05-feedback`).
- `artifacts/theme-gallery/before-*` and `after-*`: semantic gallery, product gallery and frozen
  custom Theme compilations before and after; `after-dock/` holds the Dock captures.
