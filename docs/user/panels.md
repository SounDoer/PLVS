# Panels

Eight meter panels read the same signal at once. Each panel's settings menu holds the options listed
here.

Single-choice settings open floating dropdown menus, like System Settings, without moving the
rows below them. Use the arrow keys to navigate, Enter to select, or Escape to dismiss the menu.
Channel choices retain their group headings, including All Pairs, in one scrollable menu.
Multi-choice layers, metric ordering, and other detailed editors continue to expand within the panel.

| Panel       | What it shows                                           |
| ----------- | ------------------------------------------------------- |
| Level Meter | Per-channel level bars                                  |
| Loudness    | Momentary and Short-term loudness history               |
| Stats       | Configurable numeric readouts                           |
| Spectrum    | FFT-based real-time analyzer                            |
| Spectrogram | Time-frequency history                                  |
| Vectorscope | Phase and correlation of a channel pair                 |
| Stereo Map  | Stereo image across the frequency spectrum              |
| Waveform    | Per-channel amplitude envelope over the session history |

Line traces, reference guides, event markers, and max-hold outlines use their resolved Theme
colours directly. Filled areas and time-, level-, or energy-based fades can still use transparency
when it carries measurement meaning.

## Level Meter

Shows every channel individually, as **Peak**, **RMS**, **Momentary**, or **Short-term**. It can show
a True Peak Max marker driven by the active [Loudness Profile](loudness-profiles.md); click the
readout to reset the maximum. Scale labels close to a marker fade out so the reading stays legible.

**Bar Colors** chooses what the colours mean. **Gradient** (the default) is appearance only: one
green-to-red ramp over the visible bar, in every mode, that zooms with the scale and ignores the
Loudness Profile. **Level Zones** colour by level, with a hard change at each threshold, so a level
keeps its colour at any zoom. In Peak and RMS, **Warning / Critical** sets the zones (defaults: Peak
−6 / −1 dBFS, RMS −18 / −9 dBFS); they are a reading aid for headroom, not a compliance check,
because the Peak bars show sample peak while delivery limits are judged on true peak by the True
Peak Max marker and Stats. In Momentary and Short-term the zones come from the active Loudness
Profile's upper limits on that metric or its Max; with no such rule the bar shows the metric's
Loudness curve colour, because nothing is judging it. The readout markers follow the Profile under
either option. The Dock's level strip has the same Bar Colors and its own Warning / Critical in its
settings.

## Loudness

Momentary and Short-term LUFS curves over time, following ITU-R BS.1770 measurement with EBU R128
gating conventions. The two curves use equal line weights and are distinguished by the Theme's
Primary and Secondary Data colours. Where layers overlap, Momentary is drawn above Short-term,
which is drawn above the reference line. The reference line comes from the active Loudness Profile.
**Grid** adds horizontal guides at the visible loudness-axis ticks and is off by default.

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

**Grid** adds horizontal level guides and vertical frequency guides at the visible axis ticks. It
is off by default and follows the same pan and zoom ranges as the axes.

Spectrum area fills use a fixed opacity gradient from 20% at the top to 2% at the bottom. The same
pair applies to Primary, Secondary, and Snapshot fills in Workspace and Dock.

## Spectrogram

Frequency content over time, as a **2D Heatmap**, **3D Lines**, or **3D Surface**, coloured by your
theme. Choose the channel, tilt, smoothing, and level floor.

In **3D Lines** and **3D Surface**, **Grid** shows the floor grid. The same setting is shared by both
3D modes, is hidden in 2D Heatmap, and is off by default.

In 3D Lines, the mathematically edge-on 0° and 180° azimuths receive a one-degree render-only camera
offset. The saved angle and control value stay unchanged, while the tiny offset prevents the
frequency and height directions from collapsing together and preserves the normal level colour and
opacity gradient. Adjacent angles and 3D Surface are unaffected.

## Vectorscope

Phase and correlation between a pair of channels, defaulting to Front L/R. Display it as
**Lissajous**, **Polar Sample**, or **Polar Level**, with an optional max hold.

The axes, diagonals, rings, and other orientation marks are always-visible measurement guides, not
an optional Grid setting.

In **Polar Sample**, **Persistence** controls how long the recent sample trail remains visible. It
defaults to 400 ms, ranges from 0 to 1000 ms in 50 ms steps, and updates the display immediately.
Samples fade linearly from the Theme's full Trace colour to transparent over that interval; 0 ms
shows only the newest samples. A captured Snapshot uses the full Snapshot colour without an
age-based fade. The setting is hidden in Lissajous and Polar Level, where it has no effect.

Lissajous **Hold Slow** keeps its fixed phosphor-style trail. Persistence is a Polar Sample display
choice only: changing it does not restart analysis or create another history.

## Stereo Map

Stereo image plotted across the frequency spectrum, so you can see where the width lives. Switch
between **Position**, **Correlation**, **Mono Loss**, and **M/S Ratio**, and hold the maximum to
compare against what came before.

Each mode has its own **Grid** choice, off by default. Switching modes restores that mode's choice;
the guides follow the visible frequency and value axes. With Grid off, no standalone zero line is
drawn.

**Energy Fade Strength** controls how strongly quiet frequency bands recede. It defaults to 75%:
lower values make quiet but valid bands easier to see, 0% gives every band above the analysis gate
full visibility, and 100% restores the original full-strength energy fade. It changes the display
immediately without restarting analysis or creating another history.

In **Position**, **Color Blend** controls how wide the transition is between the Secondary and
Primary channel colours. It defaults to 50%, blending from position -0.5 through +0.5. At 0% the
colours switch sharply at centre; at 100% they blend across the complete -1 through +1 range. The
setting is hidden in the other modes, where it has no effect.

Stereo Map uses a fixed 20% fill opacity across all four modes, live data, Snapshot data, and Dock. It affects only
the area beneath the curve; the curve keeps the energy-adjusted opacity and Hold stays fully opaque.

## Waveform

A DAW-style per-channel amplitude envelope over the session history. Optionally colour it by
frequency content and show the spectral centroid.

Waveform has no optional Grid and does not draw a centre reference line.

Waveform uses a fixed 12% envelope fill opacity while **Frequency Color** is off, shared by
Workspace, Dock, Live, and Snapshot. The outline remains opaque. Frequency Color continues to use a fully opaque body so
its Low, Mid, High, and Neutral colours do not change with the background; Spectral Centroid is
unaffected.

## Reading history

Every chart can be zoomed, panned, and scrubbed, with a live hover probe. How far back history goes
is set by **History Length** in [System Settings](system-settings.md).

Crosshair and latest-time edge guides use Secondary Text at 60% opacity. Off-window selection
edge lines use the selection color at 60%. Their directional fading bands remain unchanged.
