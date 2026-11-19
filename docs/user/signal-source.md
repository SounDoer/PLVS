# Signal Source

Open **Sources** in the toolbar to choose any kind of input — you pick a signal, not an
underlying API. The footer and system tray show the selected source as
`Output · name`, `Input · name`, or `Application · name`.
If you make another selection while PLVS is checking a source, the latest selection takes priority.
If the source switches but PLVS reports a save error, choose that source again to retry saving
without restarting the measurement.

## Automatic

Binds to your system's current default output and follows it when the default changes. A good
default for most sessions.
Outputs with the same name and format are tracked separately. If a device-list refresh fails,
PLVS keeps the last successful list and waits for a confirmed change before treating a source as disconnected.

## System playback

Monitor whatever your system is currently playing, with no virtual audio routing. On Windows this
uses WASAPI loopback; on macOS it uses the native system-audio tap available on macOS 14.2 and later.
On macOS, starting while the selected output is completely idle is supported; PLVS wakes the device
silently and releases that temporary wake-up as soon as capture begins.

On Linux, PLVS uses the output's monitor source through PulseAudio or PipeWire's PulseAudio
compatibility service (`pipewire-pulse`). **Automatic** follows the default output's monitor; if
that monitor is unavailable, capture reports an error instead of switching to a microphone.
Physical inputs use the same audio service. Direct ALSA capture and per-application capture are not
yet supported on Linux. See [Getting Started](getting-started.md#linux) for the Linux package.

ASIO drivers bypass the Windows audio mixer, so loopback cannot hear them. Set your DAW's audio
system to WASAPI, or route an ASIO setup through a virtual audio cable such as VB-Cable to a
WASAPI-visible device.

System output monitoring follows the system's speaker configuration: Stereo shows and measures two
channels, while 5.1 shows and measures six, even if the interface exposes additional device tracks.
All panels and measured-source recordings use that same signal. Changing the system speaker
configuration starts a fresh measurement. See [Multichannel](multichannel.md).

On Windows, a complete L/R stereo mix supplied by the audio engine can be monitored even when
the output retains a surround configuration that includes L/R, such as during spatial sound
changes. PLVS measures the supplied mix rather than reconstructing separate surround channels.

## Physical input

Monitor a microphone or line input directly.

## Application

Meter one running audio application instead of the complete system mix.

- **Windows** needs build 20348 or later. Applications using ASIO or WASAPI exclusive mode bypass
  this capture path.
- **macOS** 14.2 or later lists applications currently connected to Core Audio, groups an
  application's helper processes with it, and captures through the current default output device.

PLVS recognises the application again when it restarts and reconnects to it.
While the selected application is unavailable, Sources and the Tray keep the application
selection and show **Selected Application Unavailable**.

## Long source lists

Outputs, Inputs, and Applications are grouped into collapsible sections with source counts. The
picker scrolls when the available sources do not fit on screen. The system tray's **Source**
submenu offers the same source groups, including running applications.

## When capture is interrupted

If you select **Stop** while capture is starting, Live shows **Stopping…** until the native
capture has stopped.

PLVS tells you instead of showing stale readings. A stalled stream, dropped audio, or a changed
default output is shown as a notice. On Windows, when a system audio change such as toggling Spatial
Sound invalidates the device, PLVS rebuilds the stream and starts a fresh measurement automatically.

If an input or output you selected by name disconnects, PLVS stops measuring, keeps your selection,
and shows **Source Disconnected** in Status. Reconnect the device or choose another in **Sources**,
then select **Start** to begin a fresh measurement.
