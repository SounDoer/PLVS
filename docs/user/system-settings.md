# System Settings

Everything for making PLVS fit into how you work day to day.

## Startup and closing

**Open at Login** launches PLVS when you sign in. It is one shared preference when several
workbenches are open; the current coordinator owns the operating-system registration and restores
the saved workbench set. **Close
Behavior** chooses whether closing the window keeps PLVS running in the system tray or quits it.
Before either action, PLVS finishes saving pending settings. If saving fails, the window stays open
and offers **Retry** or **Cancel**.

Quitting one additional workbench removes it from the next restore set. If a workbench crashes, its
saved workspace remains recoverable instead of being treated as an intentional removal.

With several workbenches open, only the current coordinator checks for and installs application
updates. Before installation, every workbench must have no open draft editor, stop capture and
finish saving. A refusal or timeout cancels the update; a successful update closes the workbench
set and restores it after relaunch.

PLVS also keeps one system Tray. Its **Workbenches** submenu uses Source-derived names and can show,
start, stop or quit a specific running workbench. **Quit PLVS** flushes and closes the complete
workbench set; quitting one workbench does not close its peers.

## Global shortcut

Record a **Global Shortcut** for Clear, which works even when PLVS isn't focused. When several PLVS
workbenches are open, PLVS registers the shortcut once and sends Clear to the workbench that was
focused most recently.

## Appearance

**Interface Size** scales the whole interface. **Appearance** follows the system theme by default or
uses a fixed theme. Light and Dark ship built in, and the theme editor lets you build and save your
own themes.

## History and dialogue detection

**History Length** sets how far back history panels can be scrolled: 30, 60, 120, or 240 minutes.
Shortening it drops older rows without restarting the measurement. **Dialogue Detection** chooses the
engine behind the [dialogue readouts](dialogue-gated-loudness.md).

## Channels

Rename channel labels and choose the channel layout; see [Multichannel](multichannel.md).

## Import, export, and reset

Export and import **Loudness Profiles**, **Presets**, and **Themes** individually, or **Everything**
in one file. Importing Everything replaces your whole setup and restarts PLVS rather than merging.
This moves configuration only, never measurement data. With several workbenches open, PLVS first
checks every workbench for an open draft, stops capture and saves before replacing shared data; the
workbench where you chose Import receives the instance-owned fields. **Reset PLVS to Default** uses
the same coordinated restart and restores a fresh installation.

With several workbenches open, Library changes appear in each one. A changed Theme, Loudness
Profile, or Preset does not silently replace the snapshot already active in another workbench; that
workbench keeps measuring with its current snapshot until you explicitly apply a selection.
If two workbenches edit the same Library item, the second save never overwrites the first silently:
choose **Reload** for the committed version or **Save as Copy** to preserve the local edit under a
new ID.

## Crash reports and feedback

PLVS saves crash reports locally. With **Ask To Send Crash Reports** enabled, it asks before sending
one after a crash. Feedback diagnostics are attached only when you choose to include them. Audio
samples are never attached. In a multi-workbench run, local crash records include random instance
and workspace identifiers so the matching per-process log can be diagnosed. Open
[Privacy](https://plvs.soundoer.com/privacy/) at the bottom of
Settings for the exact contents, retention and deletion-request details.

## Agent Control

**Agent Control** lets `plvs-cli` inspect and change the running app; see
[Command Line](command-line.md). It is off until you enable it.

## Licenses

Choose **Licenses** at the bottom of Settings to open the third-party notices installed with PLVS.
The same `licenses` folder contains the complete PLVS MIT License and the license texts referenced
by the notices. Portable users can also open that folder directly beside `plvs.exe`; in a macOS app
bundle it is under `Contents/Resources/licenses`.
