# Sharesets Preset Catalogue Plan

Date: 2026-10-12  
Status: draft for content review

## Goal

Grow the official Sharesets Preset catalogue from its built-in starting point and one specialised
multichannel layout into a small set of recognisable workflows. Each Preset should save setup time,
demonstrate a meaningful PLVS capability, and remain useful after the screenshot that introduced
it.

This is a content plan, not an implementation plan. Exact split weights, control values, copy, and
release order remain subject to visual prototypes.

## Current baseline

The catalogue currently has two complementary anchors:

| Preset                  | Job                                | Strength                                    | Deliberate limit                                 |
| ----------------------- | ---------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| Default                 | General first-run monitoring       | Included eight-panel product starting point | Dense; no single review task is dominant         |
| Multichannel Monitoring | Source-adaptive 5.1/7.1 monitoring | Makes channel balance the visual anchor     | Uses only the first pair for pair-based analysis |

Together they cover source shape, but not the focused jobs users repeatedly assemble from those
sources. The next Presets should be organised around a question the user is trying to answer rather
than around another generic arrangement of all modules.

## Content principles

1. **One Preset, one question.** A title and summary should say what the workspace helps the user
   decide: stereo safety, spectral problems, delivery readiness, or persistent background
   monitoring.
2. **Prefer workflow differences over cosmetic differences.** A new entry should differ from an
   existing entry in at least two substantial dimensions: panel selection, repeated-panel use,
   panel settings or axes, presentation, Dock, or Loudness Profile dependency.
3. **Keep Themes orthogonal.** Presets do not carry a Theme. Catalogue copy and screenshots must not
   imply that importing a Preset changes appearance.
4. **Keep Sources orthogonal.** Presets do not select a device, file, channel count, or channel
   layout. Pair-based controls use the first available pair and adapt through the existing import
   and apply paths.
5. **Use dependencies only when they define the job.** A Preset may bundle a Loudness Profile when
   the target is essential to the workflow. It should not bundle a profile merely to make a
   reference line appear in the screenshot.
6. **Do not clone the Loudness Profile catalogue.** Spotify, Apple Podcasts, EBU R 128, and other
   Profile entries should not each receive a near-identical Preset. A workflow Preset can point the
   user toward choosing the appropriate Profile separately unless one specific interpretation is
   fundamental to the Preset.
7. **Publish only visually proven layouts.** Every candidate needs a production-rendered prototype
   at its contract viewport. A Dock-enabled Preset also needs its required Dock preview.

## Proposed first collection

### 1. Stereo Field Check — first priority

**Question:** Is the stereo image stable, balanced, and safe when reduced toward mono?

This is the strongest next entry because it is useful with the existing stereo fixture, looks
materially different from Default, and demonstrates that a workspace can contain multiple
instances of the same module with different settings.

Provisional composition:

- a large M/S Spectrum with Max Decay;
- a Polar Level Vectorscope with Max Hold;
- Stereo Map panels for Correlation and Mono Loss;
- a compact Stats panel showing Correlation, Side / Mid, True Peak Max, Integrated Dynamics, and
  Integrated Loudness;
- first available channel pair throughout;
- Loudness Profile Off, Dock Off, normal presentation.

The visual hierarchy should make the M/S Spectrum and Vectorscope primary. The two Stereo Map views
are compact comparisons, not full-width history charts. The Preset should not claim to prove mono
compatibility by itself; it surfaces the indicators used to investigate it.

Suggested tags: `Stereo`, `Imaging`, `Mono Compatibility`, `M/S`, `Analysis`.

### 2. Spectral Inspection — first priority

**Question:** Where is the tonal imbalance, resonance, or low-frequency buildup?

This candidate should exploit independent axes and repeated Spectrum panels instead of becoming a
smaller copy of Default.

Provisional composition:

- a full-band Spectrum from 20 Hz to 20 kHz with Max Decay and moderate octave smoothing;
- a low-frequency Spectrum with an unlinked, narrowed range such as 20–250 Hz, Max Hold, and Peak
  Labels;
- a 2D Spectrogram with a useful noise-floor range;
- a frequency-coloured Waveform for time context;
- optional compact Level Meter only if the prototype needs a persistent amplitude reference;
- Loudness Profile Off, Dock Off, normal presentation.

The two Spectrum panels need explicit titles such as **Full Spectrum** and **Low End** so their
purpose survives export and import. The prototype should test whether the low-frequency view needs
its own level range as well as its own frequency range.

Suggested tags: `Spectrum`, `Spectrogram`, `Low End`, `Tonal Balance`, `Analysis`.

### 3. Dock Essentials — second priority

**Question:** What is the smallest useful always-visible monitoring strip while working elsewhere?

This is the first official Preset whose defining behaviour is Dock rather than Workspace. It
demonstrates a capability that neither existing Preset covers and automatically exercises the
Preset Dock preview contract.

Provisional Dock composition:

- Timecode;
- Level Meter;
- Loudness;
- compact Stats limited to Integrated, Short-term, True Peak Max, Correlation, and Side / Mid;
- Vectorscope or Stereo Map only if the 1280 px prototype remains readable.

Provisional behaviour:

- Dock enabled at the bottom edge;
- Reserve Screen Space off, because reservation is platform- and permission-sensitive;
- a conservative strip height and preferred widths that fit the full composition at 1280 px;
- Loudness Profile Off;
- the saved Workspace remains a simple, credible fallback rather than an unrelated dense layout.

The title should avoid promising a delivery standard. A later focused Dock Preset can bundle a
Profile if real use shows that distinction is valuable.

Suggested tags: `Dock`, `Compact`, `Always Visible`, `Monitoring`.

### 4. Dialogue Delivery Review — later, fixture-dependent

**Question:** Is speech landing at the intended loudness and remaining consistent over time?

Provisional composition:

- a large Loudness history with Momentary, Short-term, and Reference layers;
- a dialogue-focused Stats panel showing Dialogue Coverage, Dialogue Integrated, Dialogue Range,
  Dialogue Offset, Integrated, Loudness Range, and True Peak Max;
- a Waveform for programme structure;
- a Peak Level Meter with TP Max;
- optional compact Spectrum if the prototype still gives the dialogue metrics enough space;
- an explicitly bundled speech-oriented Loudness Profile, tentatively AES77 Streaming Speech.

This candidate must not ship against the current generic stereo preview fixture. That fixture does
not provide useful dialogue measurements, so its most important Stats rows render as unavailable.
Publication requires a deterministic, attributable speech fixture whose production analysis yields
stable, non-empty dialogue values. The Preset name and copy should also avoid implying that one
profile is universal for podcasts, broadcast, games, and other speech delivery contexts.

Suggested tags: `Dialogue`, `Speech`, `Loudness`, `Delivery`, `Quality Control`.

## Release sequence

### Wave 1 — focused analysis

Prototype **Stereo Field Check** and **Spectral Inspection** together. They use the existing stereo
fixture, have no dependency packaging, and test the two most valuable content patterns: repeated
modules and independent axes.

Approve each independently. A weak prototype should not block the other candidate.

### Wave 2 — form factor

Prototype **Dock Essentials** after the first two establish the content-review rhythm. Review both
the Workspace and Dock images and verify that applying it remains safe on Windows and macOS after
the existing machine adaptations.

### Wave 3 — targeted delivery

Create and approve the speech fixture before finalising **Dialogue Delivery Review**. Treat the
fixture, bundled Profile choice, and copy interpretation as one review unit; otherwise the visual
and the claimed workflow can drift apart.

## Explicit deferrals

- **One Preset per streaming platform or broadcast standard.** This would mostly duplicate the
  Loudness Profile catalogue and make later rule updates harder to explain.
- **One Preset per channel layout.** Presets do not select the source layout, and Multichannel
  Monitoring already adapts across common layouts.
- **Theme-and-layout combinations.** Presets do not carry Themes; combining them in catalogue copy
  would teach the wrong product model.
- **Transparent or Glass showcase Presets.** Those presentation choices are machine- and
  background-sensitive and do not define an audio workflow.
- **A maximal “everything” workspace.** The built-in Default Preset already covers broad discovery.
- **A 3D Spectrogram showcase as its own Preset.** It is visually distinctive but needs a durable
  user question before it earns a catalogue entry.

## Prototype acceptance

Every candidate must pass these content checks before artifact authoring:

- the job can be stated in one sentence without naming the panel arrangement;
- the layout is legible at the exact public preview viewport;
- panel titles and settings explain repeated module instances;
- the deterministic fixture produces meaningful data in every primary panel;
- the Preset does not silently imply a Theme, Source, channel layout, or delivery target it does not
  own;
- selected controls are intentional rather than untouched defaults presented as curation;
- applying the Preset through the normal import and apply path needs no manual repair;
- Catalogue description, tags, details, artifact, and preview all agree;
- source validation and immutable-history checks pass before publication.

## Decisions needed after first prototypes

1. Whether **Stereo Field Check** needs both Correlation and Mono Loss Stereo Map panels, or one
   history panel plus a larger Vectorscope is clearer.
2. Whether **Spectral Inspection** should focus only on low end or keep the broader name and include
   both full-band and low-frequency views.
3. Whether **Dock Essentials** includes a spatial module at 1280 px or stops at four compact modules.
4. Whether **Dialogue Delivery Review** should bundle AES77 Streaming Speech or stay profile-neutral
   and ask the user to select a target after import.

## Next planning step

Build review-only portable documents for Stereo Field Check and Spectral Inspection, generate their
production previews outside the published catalogue paths, and compare them beside Default.
The review should settle composition and naming before listing JSON, release artifacts, or sealed
preview records are added.
