# Signal Source

One dropdown covers every kind of input — you pick a signal, not an underlying API.

## Automatic

Binds to your system's current default output and follows it when the default changes. A good
default for most sessions.

## System playback

Monitor whatever your system is currently playing, with no virtual audio routing. On Windows this
uses WASAPI loopback; on macOS it uses the native system-audio tap available on macOS 14.2 and later.

ASIO drivers bypass the Windows audio mixer, so loopback cannot hear them. Set your DAW's audio
system to WASAPI, or route an ASIO setup through a virtual audio cable such as VB-Cable to a
WASAPI-visible device.

## Physical input

Monitor a microphone or line input directly.

## Application

Meter one running audio application instead of the complete system mix.

- **Windows** needs build 20348 or later. Applications using ASIO or WASAPI exclusive mode bypass
  this capture path.
- **macOS** 14.2 or later lists applications currently connected to Core Audio, groups an
  application's helper processes with it, and captures through the current default output device.

PLVS recognises the application again when it restarts and reconnects to it.

## Long source lists

Outputs, Inputs, and Applications are grouped into collapsible sections with source counts. The
picker scrolls when the available sources do not fit on screen.

## When capture is interrupted

PLVS tells you instead of showing stale readings. A stalled stream, dropped audio, or a changed
default output is shown as a notice. On Windows, when a system audio change such as toggling Spatial
Sound invalidates the device, PLVS rebuilds the stream and starts a fresh measurement automatically.
