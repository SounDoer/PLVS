# Theme History Data — design

Date: 2026-10-11
Status: approved for implementation

## Problem

PLVS changes the colours of Primary and Secondary traces while the user views a Snapshot, but the
current model describes those colours as module-specific Snapshot roles. Loudness, Spectrum,
Waveform, Vectorscope, and Stereo Map can therefore change colour, while palette-driven modules
such as Level Meter and Spectrogram continue to use their Live palettes unchanged.

The model has three consequences:

- a Theme that wants one coherent historical-data family repeats the same Advanced override across
  several modules;
- Snapshot appearance is coupled to individual renderers rather than to the shared data state;
- Status, Intensity, and Frequency palettes have no defined historical-state treatment.

The Theme editor deliberately exposes colours rather than rendering parameters. Adding authored
lightness, chroma, hue, opacity, or transform-strength controls would make the editor and portable
Theme format more complicated than the problem requires.

## Product principles

1. Snapshot is a product action and visible mode. History is the Theme system's name for the
   non-Live data state used while a Snapshot is selected.
2. History is a second axis applied to existing data semantics. It does not replace Primary versus
   Secondary, Safe versus Warning versus Critical, Intensity, or Frequency meaning.
3. Automatic derivation must provide a coherent result. Visual Review findings are advisory; they
   do not define the desired appearance.
4. PLVS Dark and PLVS Light remain complete zero-Advanced-override base Themes.
5. Advanced exists for intentional exceptions, not for repeating one global choice per module.
6. Theme authoring remains colour-first. Product-owned recipes may derive colours, but numeric
   transform controls are not part of the editor.

## Terminology and scope

The product UI continues to say **Live** and **Snapshot**. If the Theme Preview gains a state
switch, those are its labels. There is no user-facing setting named History Treatment.

Internally, `history` identifies the resolved data-state family. It applies only while a historical
Snapshot is selected (`selectedOffset >= 0`). It does not apply to Paused Live, Max Hold,
Reference, Selection, file analysis, or an unselected history window.

Colour remains reinforcing information. The existing SNAP transport state, selected position, and
other non-colour cues continue to identify the mode.

## Authoring model

Core and Palettes keep their current authored fields. No tone, colourfulness, hue-shift, opacity,
or transform-strength setting is added.

Advanced replaces the narrow Transport section with a top-level **Live & Snapshot** section. It
contains the two shared solid-colour roles alongside the existing Live and Snapshot transport
indicators:

| Role ID                  | Editor label      | Purpose                                             |
| ------------------------ | ----------------- | --------------------------------------------------- |
| `data.history.primary`   | History Primary   | Primary data while viewing a selected Snapshot      |
| `data.history.secondary` | History Secondary | Secondary data while viewing a selected Snapshot    |

Both shared roles support Auto and Custom direct colour selection. Module History roles inherit
them. Each module keeps its History exception in its own Advanced section, placed directly after
the corresponding Live role rather than inside another nested group. Its mode says **Follow History
Primary**, **Follow History Secondary**, or **Custom** rather than the ambiguous **Auto**. For
example, Spectrum is ordered Primary Trace, Primary History, Secondary Trace, Secondary History,
then Grid.

This keeps the Advanced page flat: global state defaults and transport indicators are together,
while a module-specific exception stays where an author looks for that module. Labels always
include History so they cannot be mistaken for Live Primary or Secondary colours.

PLVS Dark and PLVS Light use Auto. A Theme such as Mono may set the two global History colours
without repeating the choice across every trace module.

## Automatic derivation

History derivation is product-owned and compiled with the Theme. It is not calculated independently
inside components.

One product concept does not require one mathematical transform for every colour family:

- **Primary and Secondary data:** derive a visibly distinct colour using available perceptual
  lightness headroom. The recipe must reverse direction near white or black rather than clipping.
  A small chroma reduction and hue change may be used where they preserve the Theme's identity.
- **Status palette:** preserve Safe, Warning, and Critical hue meaning and ordering. History may
  adjust tone and chroma but must not rotate the semantic hues into different meanings.
- **Intensity palette:** transform the complete stop list while preserving stop positions and the
  perceptual low-to-high ordering.
- **Frequency palette:** preserve the separation and Low, Mid, and High ordering.
- **Monochrome data ink:** derive History ink for Spectrogram 2D and uncoloured 3D modes as well as
  the colourized Intensity lookup table.

The former fixed `L + 0.12`, `C - 0.006`, `H + 36 degrees` recipe remains a useful candidate for
ordinary trace colours, but it is not a universal scheme rule. In particular, direction must not
be selected solely from Dark versus Light appearance. Mono Dark, Mono Light, PLVS Dark, PLVS
Light, and Night Circuit are the minimum visual calibration set.

## Resolution and rendering

The Theme compiler publishes both Live and History data families, including derived Status,
Intensity, Frequency, and monochrome-data values. Components select a compiled family from their
surface's Snapshot state; they do not transform colours locally. Snapshot state is surface-local:
selecting history in the main workspace must not recolour a Dock that continues to display Live
data.

This applies equally to:

- CSS and SVG trace tokens;
- Canvas selectors;
- the Level Meter gradient;
- unjudged Level Meter Momentary and Short-term bars, which use the corresponding History data
  colours instead of Status zones;
- the Spectrogram 2D lookup table;
- the Spectrogram 3D WebGL lookup table.

Lookup tables are built when the resolved Theme changes, not per frame. Interface surfaces, text,
axes, and grids do not change merely because Snapshot is selected.

## Theme Preview and visual review

Theme Preview gains a **Live / Snapshot** preview-state switch. It is a preview control, not a
stored Theme option. Snapshot preview must exercise at least trace data, Level Meter Status colours,
and the Spectrogram Intensity palette.

Visual Review continues to report contrast and colour-separation findings as references. It does
not add overrides or define a pass/fail quality gate. Final approval uses the rendered module and
workspace scenes.

## Status Palette and Level Meter

Status remains the shared measurement-state palette. Level Meter is its largest visual consumer,
but the same Safe, Warning, and Critical meanings also serve Vectorscope correlation, Stereo Map
ranges, Waveform ranges, Stats values, and Live activity.

No separate Meter Palette is introduced. Existing `level.safe`, `level.warning`, and
`level.critical` overrides are reviewed as follows:

- remove values identical to the Status palette;
- prefer the Status palette when a small difference has no visible purpose;
- retain a module override only when the large Meter rendering demonstrably needs a calibrated
  exception.

## Compatibility

Changing automatic History resolution changes Theme meaning even when authored colours do not
change. The implementation therefore advances Theme semantics, migrates readable older documents,
and preserves explicit Advanced choices.

The migration must give an existing Theme an inspectable result rather than silently interpreting
the same semantics version through a new recipe. Sharesets artefacts and deterministic previews
are regenerated under the new semantics before publication.

Existing module Snapshot overrides migrate to the corresponding module History roles. Repeated
values may be consolidated into the two shared roles only when doing so preserves the resolved
appearance; distinct explicit module choices remain Custom and editable in that module's section.

## Verification

Implementation is complete only when:

- PLVS Dark and PLVS Light still contain no Advanced overrides;
- one global History override reaches every inheriting trace module;
- Level Meter and both Spectrogram renderers switch to compiled History palettes;
- colourized, monochrome, 2D, and 3D Spectrogram modes all switch coherently;
- a Live Dock remains Live while the main workspace displays a Snapshot;
- Live, Paused Live, Max Hold, Reference, Selection, and file analysis retain their intended
  non-History treatment;
- Theme Preview shows equivalent Live and Snapshot scenes;
- the five calibration Themes are reviewed at module and workspace scale;
- redundant Level Meter overrides are removed without an unintended visual change;
- portable Theme migration, deterministic compilation, and Sharesets preview hashes are covered
  by tests.
