# Multichannel

PLVS follows your source's channel layout, with a manual choice when needed.

## Automatic layout detection

Mono, stereo, LCR, quad, 5.0, 5.1, 7.0, and 7.1 are recognised automatically from the channel count.

## Manual layouts

Choose the layout under **Channels** in [System Settings](system-settings.md). Standard layouts from
mono through 9.1.6 are available, and **Custom** lets you assign a role to each channel — for example
when a source uses a different channel order.

When PLVS cannot identify a layout, it says so, and loudness uses channels 1 and 2 only until you set
one. Channels above 8 are never guessed from the count alone.

## Per-panel behaviour

- **Level Meter** shows every channel individually.
- **Loudness** uses BS.1770 channel weighting for the detected or selected layout, excluding LFE.
- **True Peak Max** covers every channel.
- **Spectrum**, **Spectrogram**, **Vectorscope**, and **Stereo Map** let you choose which channel or
  channel pair to view.

Channel labels can be renamed under **Channels** in Settings.
