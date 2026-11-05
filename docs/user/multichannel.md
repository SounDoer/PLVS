# Multichannel

PLVS follows your source's channel layout, with a manual choice when needed.

## Automatic layout detection

Mono, stereo, LCR, quad, 5.0, 5.1, 7.0, and 7.1 are recognised from the channel count when native
mappings are unavailable.

For live device capture, PLVS reads Windows speaker positions or macOS speaker assignments when
available. A complete mapping supplies the channel labels and loudness weights in the source's
actual channel order. Manual choices take priority. Windows application capture uses its explicitly
requested capture format.

A speaker assignment does not change the stream channel count. For example, a 16-channel interface
configured for stereo speakers can still supply 16 captured channels. PLVS labels the assigned
channels **L** and **R**, keeps the other channels visible, and explains incomplete mappings in the
channel-layout status. Unspecified channel roles are not treated as unused or automatically added
to loudness. Automatic assignments belong to the current capture session, not your saved manual
settings; Snapshot retains the assignments at the recorded time.

Before capture starts, panels use an assumed stereo layout and show the placeholder channels as
**L** and **R**. Once capture reports the real topology, its detected or selected labels take over.

## Manual layouts

Choose the layout under **Channels** in [System Settings](system-settings.md). Standard layouts from
mono through 9.1.6 are available. Assign a role to an individual channel when a source uses a
different channel order; the layout then shows **Custom** until you choose a standard layout again.
When only one standard layout applies, its name is shown as text. The layout chooser appears when
there are multiple standards to choose from, or when a Custom or unknown layout can be replaced.

When PLVS cannot identify a complete layout, it says so, and loudness uses channels 1 and 2 only until you set
one. The toolbar status entry explains this condition in both normal and Dock modes, without
occupying space inside Stats or Loudness. Channels above 8 are never guessed from the count alone.

## Per-panel behaviour

- **Level Meter** shows every channel individually.
- **Loudness** uses BS.1770 channel weighting for the detected or selected layout, excluding LFE.
- **True Peak Max** covers every channel.
- **Spectrum**, **Spectrogram**, **Vectorscope**, and **Stereo Map** let you choose which channel or
  channel pair to view. If the current source lacks the channels you chose, the panel shows the
  first available ones and the setting reads **(Unavailable)**; your choice is kept and comes back
  when you switch to a source that has those channels.

Channel labels can be renamed under **Channels** in Settings.
