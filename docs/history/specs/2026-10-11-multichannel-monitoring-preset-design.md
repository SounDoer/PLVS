# Multichannel Monitoring Preset and Theme Preview — design

Date: 2026-10-11
Status: approved and implemented

## Problem

The Sharesets Theme gallery currently publishes two complete Workspace views, a semantic Theme
overview, and individual Spectrum and Spectrogram views. The two individual panels enlarge data
colours that are already visible in the Workspace, while the gallery does not show how a Theme
behaves with more than two channels.

PLVS also has no official Sharesets Preset aimed at multichannel monitoring. The existing Stereo
Overview is intentionally dense and uses a stereo fixture. A Theme-only screenshot layout would
therefore duplicate a useful product configuration without making that configuration available to
users.

## Decision

Create an official **Multichannel Monitoring** Preset, then use the same portable Preset document
as the layout source for a new Theme preview scene. The Preset does not store or change the source
channel layout. Its copy describes a workspace optimised for common multichannel sources; the
deterministic Theme preview renders it with a 5.1 fixture.

The Theme public preview contract will ultimately contain four images, ordered as follows:

1. Workspace
2. Multichannel Monitoring
3. Snapshot
4. Theme Colors

The contract change follows approval of the Multichannel Monitoring composition rendered with PLVS
Dark and PLVS Light.

The third review revision uses one 1280×800 viewport throughout, narrows Level Meter to 38% of the
width, adds Spectrum below Waveform, and places equal-width Vectorscope and Stats panels in the
lower row. Waveform centroid and Spectrum grid are disabled to reduce visual noise. Vectorscope
uses Lissajous so the scene differs from the default Workspace's Polar Level view. The deterministic
5.1 fixture gives every channel a distinct, readable level while driving the right channel into the
Critical zone. This revision was approved for the public Theme contract and Sharesets catalogue.

## Preset scope

The Preset contains exactly five panels:

- Level Meter
- Waveform
- Spectrum
- Stats
- Vectorscope

It does not include Loudness, Spectrogram, or Stereo Map. Spectrum adds a compact frequency-domain
check without duplicating the complete default Workspace. The remaining exclusions preserve the
space needed to read channel balance.

The Preset is source-adaptive:

- Level Meter and Waveform show every channel reported by the current source.
- Spectrum and Vectorscope use the first available pair, normally L/R.
- Stats uses the source's resolved loudness layout and the current Loudness Profile, if any.
- Applying the Preset does not select a channel layout or create channels that the source does not
  have.

The Preset sets Loudness Profile to Off and carries no profile dependency. There is no universal
delivery target implied by a multichannel layout; users select the appropriate Profile separately.
Peak Level Zones remain meaningful because their Warning and Critical thresholds belong to the
panel control rather than to a Loudness Profile.

The Catalogue description must say that it is optimised for common 5.1 and 7.1 monitoring rather
than claiming support is limited to, or guaranteed only for, those layouts. Very high channel
counts remain valid but naturally make individual Waveform lanes and Level Meter bars denser.

## Layout

The layout is an asymmetric workbench rather than a uniform grid:

```text
┌──────────────────────┬──────────────────────────────────────────┐
│                      │                 Waveform                 │
│                      ├──────────────────────────────────────────┤
│     Level Meter      │                 Spectrum                 │
│                      ├─────────────────┬────────────────────────┤
│                      │   Vectorscope   │         Stats          │
└──────────────────────┴─────────────────┴────────────────────────┘
```

Initial split weights:

- outer horizontal split: Level Meter `0.38`, right group `0.62`;
- right vertical split: Waveform `0.31`, Spectrum `0.31`, lower group `0.38`;
- lower horizontal split: Vectorscope `0.50`, Stats `0.50`.

At a 1280 px capture width this keeps the full-height Level Meter as the primary visual anchor but
gives the three right-side rows enough width for detailed data. The taller lower row fits every
selected Stats value and keeps the Vectorscope useful. The review capture target is uniformly
1280×800.

A uniform grid is rejected because it gives equal visual weight to unequal tasks and makes the
multichannel Level Meter too short.

## Panel settings

### Level Meter

- Mode: Peak
- Bar Colors: Level Zones
- Playback Max: Off
- Floating Value: Off
- TP Max: On
- Peak range: −60 to 0 dBFS
- Warning: −6 dBFS
- Critical: −1 dBFS

Level Zones intentionally complements the Gradient Level Meter already shown in the normal Theme
Workspace. The 5.1 fixture should place channels across Safe, Warning, and Critical levels so all
three Theme status colours are visible without fabricating UI state in the renderer.

### Waveform

- Window: 60 seconds
- Frequency Color: On
- Spectral Centroid: Off

The 5.1 scene therefore exercises six channel labels and lanes as well as the Theme's Frequency
palette. At the initial split, six and eight lanes should remain individually legible. Twelve and
sixteen channels are density checks, not composition targets for the public screenshot.

### Spectrum

- Channel Pair: first available pair, normally L/R
- View: Combined
- Max Mode: Decay
- Peak Labels: On
- Grid: Off
- Speed: 25%
- Tilt: 4.5 dB/octave
- Smoothing: Off
- Range: −90 to 0 dB
- Frequency range: 20 Hz to 20 kHz

This is a compact diagnostic view rather than a substitute for the full Spectrum-focused scene.
Peak labels and decay make the smaller panel informative at a glance.

### Stats

Show these values in canonical order:

- Momentary
- Short-term
- Integrated
- Momentary Max
- Short-term Max
- Loudness Range
- PSR
- PLR
- True Peak Max
- Correlation
- Side / Mid

Dialogue metrics remain hidden because the deterministic preview source is not a dialogue analysis
example. The panel must fit without an initial scrollbar at the capture viewport.

### Vectorscope

- Channel Pair: first available pair, normally L/R
- Mode: Lissajous
- Max Hold: Off

The selected pair remains explicit in the panel controls. Lissajous is intentionally different from
the default Workspace's Polar Level view and remains legible in the equal-width lower row. The
Preset must clamp safely when the source has fewer channels or exposes a different layout, using
the existing panel-control path.

## Deterministic 5.1 fixture

The repository's attributed stereo preview track remains the source. The fixture command uses the
bundled FFmpeg sidecar to create a temporary, deterministic 5.1 derivative before sending it
through PLVS's production file-analysis pipeline:

- L and R retain the original left and right channels;
- C is a fixed attenuated L+R sum;
- LFE is a fixed attenuated low-pass sum;
- Ls and Rs are fixed attenuated and delayed derivatives of the corresponding front channels.

The exact matrix, gains, filters, delays, source hash, and recipe version are part of the fixture
identity. The derived multichannel audio is not committed. The checked-in JSON stores the analysed
result and provenance needed to regenerate it.

The fixture generator must accept an explicit standard layout and emit a variable-length channel
label list. It must not infer 5.1 merely from an arbitrary six-channel file passed by a caller. The
public scene uses the standard order `L, R, C, LFE, Ls, Rs`.

The initial frame must deliberately contain useful differences between channel levels. If the
derived mix does not naturally place channels in all three Level Zones, tune the deterministic
matrix or select another stable analysis time; do not overwrite analysed peak values in the
preview renderer.

## Shared source and drift prevention

The downloadable Preset and the Theme preview scene must resolve from the same canonical portable
Preset document. The implementation may place that document in a shared source module or generate
one representation from the other, but it must not maintain two hand-authored layouts.

A contract test compares the Catalogue artifact's portable Preset item with the document embedded
in the Theme preview plan. A layout or control change therefore updates both surfaces or fails the
gate.

The Preset and Theme review surfaces both use a 1280×800 viewport. The Theme scene includes the full
application shell so it remains visually comparable with the existing Workspace and Snapshot
images.

## Theme preview contract

The approved implementation:

- advance the Theme preview contract version;
- require only Workspace, Multichannel Monitoring, Snapshot, and Theme Colors;
- stop generating and copying the individual module PNGs;
- update the fixed detail-gallery order and labels;
- regenerate and seal all ten Theme preview sets before publication.

The existing per-module Theme Preview inside PLVS remains the place for detailed module review.
Public Sharesets images are selected for user evaluation and comparison, not for exhaustive
renderer enumeration.

## Visual prototype acceptance

The visual review rendered PLVS Dark and PLVS Light at 1280×800 and checked that:

- all six Level Meter labels, values, bars, and the TP Max marker are readable;
- Safe, Warning, and Critical are all visible without one colour dominating the image;
- all six Waveform lanes have distinguishable height and labels;
- Spectrum axes, peak labels, and the full 20 Hz–20 kHz range remain legible;
- Stats shows the selected rows without an initial scrollbar or clipped units;
- the Lissajous trace and diagonal guides remain centred and readable;
- panel titles and actions do not truncate at the proposed widths;
- the Light scene does not become visually top-heavy due to the large Level Meter surface;
- the same split weights remain credible on both review surfaces.
