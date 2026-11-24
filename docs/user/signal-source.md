# Signal Source

Open **Sources** in the toolbar to choose any kind of input — you pick a signal, not an
underlying API. An **Input** or **Output** row selects the device. The footer and system tray
show the selected source as
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

A macOS **Multi-Output Device** is measured through the first device in its list, which carries
the same audio at its real level. Measuring the Multi-Output Device itself would read too low
when that first device has more than two channels. An **Aggregate Device** combines several
devices into one wider output; PLVS cannot measure it yet and asks you to select one of the
devices it combines.

On Linux, PLVS uses the output's monitor source through PulseAudio or PipeWire's PulseAudio
compatibility service (`pipewire-pulse`). **Automatic** follows the default output's monitor; if
that monitor is unavailable, capture reports an error instead of switching to a microphone.
Physical inputs use the same audio service. Direct ALSA capture and per-application capture are not
yet supported on Linux. See [Getting Started](getting-started.md#linux) for the Linux package.

ASIO drivers bypass the Windows audio mixer, so loopback cannot hear them. See
[DAW playback on Windows](#daw-playback-on-windows) for ways to measure a DAW.

System output monitoring follows the system's speaker configuration: Stereo shows and measures two
channels, while 5.1 shows and measures six, even if the interface exposes additional device tracks.
All panels and measured-source recordings use that same signal. Changing the system speaker
configuration starts a fresh measurement. See [Multichannel](multichannel.md).

On Windows, a complete L/R stereo mix supplied by the audio engine can be monitored even when
the output retains a surround configuration that includes L/R, such as during spatial sound
changes. PLVS measures the supplied mix rather than reconstructing separate surround channels.
If a Spatial Sound change invalidates the live system playback stream, PLVS attempts to reopen
the output and starts a fresh measurement when capture resumes. If Windows invalidates the
replacement stream during another change, PLVS waits briefly before retrying, then shows an error
if the stream keeps failing.

## Encoded and spatial audio

PLVS measures the PCM audio that the operating system delivers to the selected output. Spatial
audio that is rendered on the computer is measured as that rendered result: for example Apple
Music spatial audio, Windows Sonic or Dolby Atmos for Headphones, or a player that decodes Dolby
Atmos to 5.1 or 7.1. Headphone modes produce a stereo mix; a multichannel output receives one
channel per configured speaker.

PLVS cannot measure audio that never passes through the system mix as PCM:

- ASIO and WASAPI exclusive-mode playback on Windows, for both system playback and Application
  sources. See [DAW playback on Windows](#daw-playback-on-windows).
- Dolby Atmos, DTS or other encoded streams sent unchanged to a receiver over HDMI or S/PDIF. The
  receiver decodes them, so the computer holds no speaker channels to meter. On Windows such
  playback usually takes the output exclusively and PLVS reports that
  [another app has exclusive use of the output](troubleshooting.md#output-in-use).
- Individual audio objects. PLVS meters speaker channels and does not decode or render object
  or scene-based audio.

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

## DAW playback on Windows

A DAW that plays through an ASIO driver, or through WASAPI in exclusive mode, sends its audio
straight to the interface without passing through the Windows audio mixer. PLVS cannot hear that
audio from the output, and selecting the DAW under **Applications** shows silence. Use one of these
routes instead:

- **WASAPI shared mode.** Set the DAW's audio system to WASAPI or Windows Audio with exclusive
  mode turned off. PLVS can then measure the output or the DAW as an Application source. Latency
  is usually higher than with ASIO.
- **The interface's loopback input.** Many professional audio interfaces can return their
  playback mix as an extra recording input, often named Loopback. Turn it on in the interface's
  control software if needed, then select it under **Inputs** in **Sources**. The DAW keeps
  using ASIO.
- **A virtual audio device.** Send the DAW's output to a virtual device that Windows can see,
  such as VB-Cable or VoiceMeeter's virtual ASIO driver, and select that device in **Sources**.

On macOS, DAWs play through Core Audio, so system playback and Application sources can measure
them without extra routing.

## Mixes on Windows

In the normal window, choose **Add Mix** at the bottom of **Sources**. Check applications,
channels from one input device, or both. You can save a Mix with a single application or a
single input channel. Under **Output**, you can select one stereo playback device on its own
or with channels from one input device. Output and application selections cannot be saved together.
PLVS generates a name from the selection. Use the pencil to enter your own name.
**Save** adds the Mix under **Mixes** and selects it for the current Workbench.
You can also select a saved Mix under **Mixes** in the Dock toolbar's **Sources** menu or in the
system Tray's **Source** submenu for your Workbench.

PLVS sums the sources into one stereo signal for measurement. A mono input goes to both sides at
−3 dB per side. When several channels are checked, PLVS adds them at unity gain before placing
the result at the center. The output keeps its left and right channels. If the selected input
is already audible through the selected output or an application in the Mix, PLVS counts that
input twice. If one source goes away, capture can continue with the others while
PLVS waits for it to return. The Live transport clock continues while capture remains running,
even during gaps without audio. The Mix row shows unavailable members. Applications with no
current audio can stay selected.
**Status Notices** identifies unavailable members. After they return, **Incomplete Mix
Measurement** indicates that Integrated and Max include the incomplete intervals. Clear or a new
measurement clears that indication.

In the normal window, hover over or focus a Mix row to reveal its Edit and Delete controls.
Changing the members or input channels of the active Mix starts a new measurement. Renaming it
keeps the current measurement. Saved mixes are available to Workbenches
on the same installation. Each Workbench remembers its own Source selection independently of Presets.

## Long source lists

Outputs, Inputs, and Applications are grouped into collapsible sections with source counts. The
picker scrolls when the available sources do not fit on screen. Application rows show a single
name. Hover or focus a row to see its window title when it adds context. The system tray's
**Source** submenu offers the same source groups, including running applications.

## When capture is interrupted

If you select **Stop** while capture is starting, Live shows **Stopping…** until the native
capture has stopped.

PLVS tells you instead of showing stale readings. A stalled stream, dropped audio, or a changed
default output is shown as a notice. On Windows, when a system audio change such as toggling Spatial
Sound invalidates the device, PLVS rebuilds the stream and starts a fresh measurement automatically.

If an input or output you selected by name disconnects, PLVS stops measuring, keeps your selection,
and shows **Source Disconnected** in Status. Reconnect the device or choose another in **Sources**,
then select **Start** to begin a fresh measurement.
