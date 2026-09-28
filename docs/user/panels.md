# Panels

Eight meter panels read the same signal at once. Each panel's settings menu holds the options listed
here.

| Panel       | What it shows                                                                          |
| ----------- | -------------------------------------------------------------------------------------- |
| Level Meter | Per-channel level bars                                                                 |
| Loudness    | Momentary and Short-term loudness history                                              |
| Stats       | Configurable numeric readouts                                                          |
| Spectrum    | FFT-based real-time analyzer                                                           |
| Spectrogram | Time-frequency history                                                                 |
| Vectorscope | Phase and correlation of a channel pair                                                |
| Stereo Map  | Stereo image across the frequency spectrum                                             |
| Waveform    | Per-channel amplitude envelope over the session history                                |

Line traces, reference guides, event markers, and max-hold outlines use their resolved Theme
colours directly. Filled areas and time-, level-, or energy-based fades can still use transparency
when it carries measurement meaning.

## Level Meter

Shows every channel individually, as **Peak**, **RMS**, **Momentary**, or **Short-term**. It can show
a True Peak Max marker driven by the active [Loudness Profile](loudness-profiles.md); click the
readout to reset the maximum.

The bar colours belong to levels, not to the bar's height, so zooming the scale never changes the
colour of a level. In Peak and RMS, **Warning / Critical** sets where the bar turns fully warning and
fully critical colour, blending below each (defaults: Peak −6 / −1 dBFS, RMS −18 / −9 dBFS). These
zones are a reading aid for headroom, not a compliance check: the Peak bars show sample peak, while
delivery limits are judged on true peak by the True Peak Max marker and Stats. In
Momentary and Short-term the colours come from the active Loudness Profile's upper limits on that
metric or its Max; with no such rule the bar shows the metric's Loudness curve colour, because
nothing is judging it. The Dock's level strip uses the same colours, with its own Warning / Critical
in its settings.

## Loudness

Momentary and Short-term LUFS curves over time, following ITU-R BS.1770 measurement with EBU R128
gating conventions. The reference line comes from the active Loudness Profile.

## Stats

Numeric readouts you choose and reorder: Momentary, Short-term, Integrated, Momentary Max,
Short-term Max, Loudness Range, Short-term Dynamics, Integrated Dynamics, True Peak Max, Correlation,
Side/Mid, and the dialogue readouts described in
[Dialogue-Gated Loudness](dialogue-gated-loudness.md). The active Loudness Profile colours readouts
that breach its rules.

## Spectrum

An FFT-based real-time analyzer with a fixed reference view: per-band level in the dBFS domain,
aligned with common DAW practice rather than IEC 61260 filter-bank metrology. View it **Combined**,
as **L / R**, or as **M / S**; add a maximum trace that **Decays** or **Holds**; adjust tilt, octave
smoothing, and speed. Hover to read frequency and musical note.

## Spectrogram

Frequency content over time, as a **2D Heatmap**, **3D Lines**, or **3D Surface**, coloured by your
theme. Choose the channel, tilt, smoothing, and level floor.

## Vectorscope

Phase and correlation between a pair of channels, defaulting to Front L/R. Display it as
**Lissajous**, **Polar Sample**, or **Polar Level**, with an optional max hold.

## Stereo Map

Stereo image plotted across the frequency spectrum, so you can see where the width lives. Switch
between **Position**, **Correlation**, **Mono Loss**, and **M/S Ratio**, and hold the maximum to
compare against what came before.

## Waveform

A DAW-style per-channel amplitude envelope over the session history. Optionally colour it by
frequency content and show the spectral centroid.

## Reading history

Every chart can be zoomed, panned, and scrubbed, with a live hover probe. How far back history goes
is set by **History Length** in [System Settings](system-settings.md).
