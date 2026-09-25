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
finish saving. The update package downloads before that interruption. A refusal or timeout cancels
the update; a successful update closes the workbench set and restores it after relaunch. If the
installer fails after peer workbenches have already closed, PLVS relaunches the current version so
the saved set is restored instead of leaving those workbenches closed. If the coordinator itself
disappears while workbenches are waiting at the save barrier, they resume any capture that the
barrier stopped.

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
own themes. A custom theme keeps its Dark or Light appearance beside its name; **Core** holds the
main identity colors, **Palettes** controls shared data scales, and **Advanced** contains optional
per-interface and per-module overrides. Advanced roles stay on **Auto** unless you customize them,
and can be searched or reset to Auto a section at a time.

The built-in Light and Dark themes are tuned independently: each keeps opaque Workspace, panel,
control, muted, and selected surfaces distinct, and uses scheme-appropriate text and feedback
contrast. Measurement colors keep the same meanings in both appearances even when their exact
values differ.

The editor reports visual warnings such as weak contrast or colors that are hard to distinguish.
Warnings do not block saving a local theme: expand the summary to review the affected roles and
jump to a relevant control. **Open Theme Preview** shows controlled overview and module scenes from
the current unsaved draft without changing Workspace data or layout.

## History and dialogue detection

**History Length** sets how far back history panels can be scrolled: 30, 60, 120, or 240 minutes.
Shortening it drops older rows without restarting the measurement. **Dialogue Detection** chooses the
engine behind the [dialogue readouts](dialogue-gated-loudness.md).

## Channels

Rename channel labels and choose the channel layout; see [Multichannel](multichannel.md).

## Import, export, and reset

Export **Loudness Profiles**, **Presets**, and **Themes** from their Library rows. **Import Shared
Item…** accepts any of their shared file types and chooses the right review from the file's document
kind. **Everything** uses one configuration file instead: importing it replaces your whole setup
and restarts PLVS rather than merging. These operations move configuration only, never measurement
data. With several workbenches open, PLVS first checks every workbench for an open draft, stops
capture and saves before replacing shared data; the workbench where you chose Import receives the
instance-owned fields. **Reset PLVS to Default** uses the same coordinated restart and restores a
fresh installation.

For a one-item file, use **Export** on the saved Loudness Profile, Preset, or custom Theme itself.
The Settings Library rows retain multi-select export for sharing several Items together.

If storage fails or PLVS exits during that replacement, the incomplete import is rolled back. A
recovery journal completes that rollback automatically the next time the target workbench opens,
before its saved state is shown.

New Loudness Profile exports use a strict portable format intended for sharing between installations
and through the Community Catalogue. Every exported rule must have a threshold, and a Profile must
contain a reference or at least one complete rule; PLVS reports an export error instead of silently
dropping unfinished content. Older `.plvsloudness` files remain importable.

New Preset exports use the same strict sharing boundary. A `.plvspreset` file carries the public
Workspace layout, module controls and axes, presentation choices, and Dock layout without local
panel IDs, monitor identity, window position, source/device selection, measurements, or history.
If a Preset selects a custom Loudness Profile, the file bundles that Profile as a dependency and
keeps the reference attached when both are imported. Import adds the content to the Library but
does not apply it. When you later apply the Preset, PLVS adapts optional Dock, reserved-space,
Glass, display-size, and channel choices to the current machine without rewriting the saved Library
item. Older Preset pack files remain importable.

Before a shared file is added, the import review lists each Item as **Add**, **Already in your
library**, or **Import as a copy**, shows bundled Loudness Profile dependencies, and calls out safe
adaptations such as collision renaming or a missing legacy dependency. Confirming the review is the
only step that writes to the Library.

Import only adds saved Library content, so it remains available while a Theme or Loudness Profile
draft is open and never discards that draft. After a single Item is imported, PLVS offers a separate
**Use Theme**, **Use Profile**, or **Apply Preset** action. That follow-up uses the same safety rules
as the normal Library controls; if it is refused, the successfully imported Item stays in the
Library.

With several workbenches open, Library changes appear in each one. A changed Theme, Loudness
Profile, or Preset does not silently replace the snapshot already active in another workbench; that
workbench keeps measuring with its current snapshot until you explicitly apply a selection.
If two workbenches edit the same Library item, the second save never overwrites the first silently:
choose **Reload** for the committed version or **Save as Copy** to preserve the local edit under a
new ID. An open Theme or Loudness Profile editor keeps its local draft and shows a warning as soon
as PLVS observes that its saved source changed elsewhere.

A `.plvstheme` file carries portable Theme authoring choices rather than device-local state. It
keeps the Theme's name, Dark/Light scheme, Core and Palette colors, and Advanced customizations;
local IDs and the palette preset originally used to choose those colors are not part of the shared
Theme. PLVS still imports older Theme pack files. If any Theme entry is damaged or incompatible,
the import reports the problem and adds nothing instead of silently skipping that entry.

Community Theme pages offer **Copy Theme** as the primary action and **Download .plvstheme** as a
secondary option. Both deliver the same canonical portable Theme document. In PLVS, press
**Ctrl+V** on Windows or **Command+V** on macOS anywhere outside a text field, or choose **Paste** on
the Theme row in Settings. PLVS opens the normal Theme import review before adding anything; it
never activates or overwrites a Theme just because it was pasted. A copied or downloaded Theme is
recognized by its content: if an identical Theme, including its name, is already in your library,
the review says so and nothing is added. Downloaded `.plvstheme` files use the same **Import** action
as PLVS-exported Theme pack files.

The website's **Community** section contains a small maintainer-curated collection of Loudness
Profiles, Presets, and Themes. Downloads use the same one-item formats and open the same import
review described above. Catalogue metadata does not make a downloaded Item active, replace a
Library entry, or bypass PLVS's compatibility checks.

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
