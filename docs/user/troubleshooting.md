# Troubleshooting

## <span id="system-output-speaker-layout"></span> PLVS can’t monitor this output

If Status says the system speaker configuration is incomplete or unavailable, or
that the speaker mapping does not match the captured stream, PLVS could not
start monitoring that output.

1. Open **Sources** in PLVS and select a different output, such as your computer's
   built-in speakers. Play some audio and check whether the meter moves.
2. If the meter works, switch back to the original output. If the error returns,
   check that device's speaker settings.

- **Windows:** Open **Sound** by running `mmsys.cpl`. In **Playback**, select the
  device and choose **Configure**, if available. Select the layout that matches
  your speakers. If the error started after a spatial sound change, try turning
  spatial sound off and selecting the output again.
- **macOS:** In **Audio MIDI Setup**, select the output and open **Configure Speakers**.
  Check that each speaker is assigned to the physical output you use.
- **Linux:** In your system sound settings, select the output and check its
  profile. Choose a profile that matches the connected speakers.

If you need to measure a microphone or line input, select it under **Inputs** in
**Sources**.

## <span id="audio-capture"></span> Audio capture won’t start or stops

Play audio and check that you can hear it through the output you want to measure.
In **Sources**, select that output explicitly. **Automatic** follows the system
default, which can change when you connect headphones or unplug an interface.

If the meter stopped after a device disconnected, reconnect it and select it
again. For application capture, confirm the app is still running and playing
audio. For more platform-specific checks, see [Signal Source](signal-source.md).

## <span id="audio-dropped"></span> Audio was dropped

Some audio did not reach the analyzer. Integrated Loudness, Loudness Range
(LRA), and maximum readings may be affected. If the warning keeps appearing,
try closing any apps using a lot of CPU. Use **Clear** and repeat the measurement
once capture is stable.

## <span id="channel-layout-unknown"></span> Channel layout is unknown

PLVS is receiving audio, but it could not identify the channel roles. Loudness
uses channels 1 and 2 until the layout is set. True Peak Max still covers every
captured channel.

Select **Open Settings** in Status and use **Channels** to set the layout or
assign the roles that match your source. See [Multichannel](multichannel.md) for
details.

## <span id="file-open-analysis"></span> A file won’t open or analyze

Check that the original file still exists and plays in another app. For a file on
a network drive or in cloud storage, copy it to a local folder and open that copy
in PLVS. If a file has several audio tracks, try selecting the track you want
again when you open it.

If **Reanalyze** or **Restore History** fails after the original file moved,
return it to its previous location or open it from its new location as a new
result. See [File Mode](file-mode.md) for how results and history are stored.

## <span id="file-analysis-stop"></span> File analysis won’t stop

Check the file's status in **Files**. If it is still analyzing, try **Stop**
again. If it stays stuck, capture diagnostics before restarting PLVS so the
report includes the failed stop. Reopen the file after restarting if you still
need to analyze it.

## <span id="file-report"></span> A report won’t export or copy

Select a completed result. When saving a report or exporting statistics, try
a new filename in a local folder you can write to. If you are replacing an
existing CSV, close it in your spreadsheet app first. If copying a report fails,
try saving it to a file. If saving a single report fails, try copying it and
pasting into a text editor. See [File Mode](file-mode.md) for export options.

## <span id="dialogue-detection"></span> Dialogue Detection failed

A detector error affects dialogue-derived measurements. Use the regular
loudness readings if you need to continue measuring. In Live, turn off
**Dialogue Detection** and start a fresh measurement if needed. In File Mode,
turn it off before reanalyzing the file if you need a result without dialogue
measurements. When sending diagnostics, include the detector and error code
shown in Status. See [Dialogue-Gated Loudness](dialogue-gated-loudness.md).

## <span id="dock"></span> Dock controls or the main window won’t open

If PLVS restored the main window, continue there and try entering Dock again.
If the strip is visible, open its toolbar and try **Restore Window**. If the
display was disconnected, reconnect it or try Dock on a connected display.

If **Reserve Screen Space** fails, use Dock as an overlay while you check the
selected display. On macOS, also check PLVS in **System Settings → Privacy &
Security → Accessibility** before enabling it again. If a resize, layout reset
or **Above Full Screen** change fails, check the current layout before retrying.
See [Workspace](workspace.md#dock) for platform-specific Dock behavior.

## <span id="update"></span> An update won’t check or install

For **Update Check Failed**, check your internet connection and select
**Check Again**. For **Update Failed**, select **View Update Details** to see
which step failed and retry when offered. If installation still fails or you
use the Windows portable package, use **Download Manually** or get the matching
package from [GitHub Releases](https://github.com/SounDoer/PLVS/releases).

## <span id="preset"></span> A Preset won’t apply or save

Read the message in Status first. If PLVS asks you to finish an open edit,
save or cancel it before retrying. A Dock Preset needs Live mode and a
platform where Dock is available. For a Preset that fails to apply in Dock,
restore the main window and check the current layout before trying again.
If saving or applying still fails, send diagnostics with the Preset name,
whether it came from a Shareset, and the action you tried.

## Send diagnostics

If the issue persists, reproduce it, open **Feedback** in PLVS, and select
**Attach Diagnostics**. Include your operating system and PLVS version, the
device or application you selected in **Sources**, and what you were doing
when the message appeared.
