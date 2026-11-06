# Multichannel

PLVS follows your source's channel layout, with a manual choice when needed.

## Automatic layout detection

Mono, stereo, LCR, quad, 5.0, 5.1, 7.0, and 7.1 are recognised from the channel count when native
mappings are unavailable.

For system output monitoring, PLVS follows the selected output's configured speakers on Windows,
macOS and Linux. Stereo produces two monitored channels; 5.1 produces six; 7.1 produces eight.
The interface may expose more physical channels than the speaker configuration uses. PLVS extracts
only the assigned speaker channels and places recognised layouts in standard channel order, without
mixing them together. For example, a 16-channel interface configured as Stereo produces **L** and
**R**, even when the system assigns those speakers to device channels 3 and 4.

On Windows, if the audio engine supplies a complete, explicitly mapped L/R stereo stream while
the output retains a surround speaker configuration that includes L/R, PLVS monitors that stereo
stream. This can occur when changing spatial sound settings. It measures the supplied stereo mix,
not separate surround channels or spatial audio objects. This does not select the first two
channels of a wider device stream.

Every panel, loudness and dialogue analysis, True Peak Max, measured-source recording and exported
session data use this same monitored signal. Screen recordings retain their stereo AAC encoding
from the monitored source. True Peak Max covers every monitored channel, including
LFE, rather than other device tracks outside the selected system speaker configuration. Physical
inputs and files keep their own source channel count.

PLVS reads Windows speaker masks, macOS speaker assignments, or Linux PulseAudio/PipeWire channel
maps. Assignments belong to the capture session rather than saved manual settings. A system mapping
change starts a fresh measurement, including when the speaker count stays the same. Snapshot keeps
the preceding session's recorded labels. If the system speaker configuration cannot be established
safely, capture reports an error instead of silently selecting a stereo pair or measuring unrelated
tracks. A configured channel with an unsupported role remains visible with an unknown-layout warning.
Windows application capture uses its explicitly requested capture format.

## Manual layouts

Choose the layout under **Channels** in [System Settings](system-settings.md). Standard layouts from
mono through 9.1.6 are available. Manual layouts describe roles within the monitored signal; they do not expand it to additional
device channels. Assign a role to an individual channel when a source uses a
different channel order; the layout then shows **Custom** until you choose a standard layout again.
When only one standard layout applies, its name is shown as text. The layout chooser appears when
there are multiple standards to choose from, or when a Custom or unknown layout can be replaced.

When PLVS cannot identify a complete layout, it says so, and loudness uses channels 1 and 2 only until you set
one. The toolbar status entry explains this condition in both normal and Dock modes, without
occupying space inside Stats or Loudness. Channels above 8 are never guessed from the count alone.

## Per-panel behaviour

- **Level Meter** shows every monitored channel individually.
- **Loudness** uses BS.1770 channel weighting for the detected or selected layout, excluding LFE.
- **True Peak Max** covers every monitored channel.
- **Spectrum**, **Spectrogram**, **Vectorscope**, and **Stereo Map** let you choose which channel or
  channel pair to view. If the current source lacks the channels you chose, the panel shows the
  first available ones and the setting reads **(Unavailable)**; your choice is kept and comes back
  when you switch to a source that has those channels.

Channel labels can be renamed under **Channels** in Settings.
