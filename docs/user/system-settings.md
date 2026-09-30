# System Settings

Everything for making PLVS fit into how you work day to day.

Opening Settings softly blurs and dims the workbench behind it while the Settings drawer stays
opaque and clear.
The drawer keeps a single border along its inner edge against the workbench. Floating menus and
dialogs retain their full outlines and shadows.

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

On Windows 11, the outer system window outline follows the window chrome: it is visible by default
and hidden in chromeless views. Native shadows, rounded corners, and window resizing remain
available in normal windows. Older Windows versions keep their default outline behaviour.

**Interface Size** scales the whole interface. **Appearance** follows the system theme by default or
uses a fixed theme. Light and Dark ship built in, and the theme editor lets you build and save your
own themes. A custom theme keeps its Dark or Light appearance beside its name; **Core** holds the
main identity colors, **Palettes** controls shared data scales, and **Advanced** contains optional
per-interface and per-module overrides. Advanced roles stay on **Auto** unless you customize them,
and can be searched or reset to Auto a section at a time. Most are colours; bounded visual values
such as the Spectrum area's Upper and Lower fill opacity appear as percentage controls in the same
module section and are saved with the Theme.

**Advanced → Interface → Primary Text** also supplies ordinary text on panels, raised surfaces,
neutral controls, and selected surfaces. Text on solid Accent, Success, Warning, and Danger areas
has separate controls.

**Advanced → Interface → Border Color** sets one opaque colour for ordinary interface separators
and control outlines, including input fields. It does not change chart Grid or Guides colours;
these follow the plot surface by default and retain their per-module Advanced controls. Older
themes preserve an authored border's appearance against Panel Surface and any inherited Grid
colours when imported or loaded. Input outlines now share the ordinary Border colour.

Workspace panels use their surface colour, rounded corners, and spacing without permanent outer
outlines or lines below their titles. Header, Footer, and the File analysis summary also omit outer
outlines. The gaps between panels remain draggable: their resize line appears on hover and stays
highlighted during a drag, then disappears when idle. Workspace and Dock resize lines use opaque
Border Color on hover or keyboard focus and Accent while dragging. Dock resize lines also
disappear when idle. Panel-location outlines use opaque Accent. Panel-location and drag-target highlights
still appear when needed. Input fields retain their
existing boundary cues. Hover colours are generated as opaque colours; disabled controls retain
their reduced opacity. These interaction rules do not add Theme Editor settings.
Panel title-bar buttons use opaque secondary text by default, with primary text and a subtle
background on hover, matching the header toolbar. Disabled buttons retain reduced opacity.
When reordering Presets, Loudness Profiles, profile rules, or Dock modules, the dragged row has
a 1px opaque Accent outline and its grip stays in primary text colour until the drag ends.

Imports and edits from another workbench refresh the Theme Library without replacing this
workbench's applied Theme. Switch away and select the Theme again to apply its updated version.
While the Theme editor is open, your unsaved draft remains visible; external changes mark an
existing draft as stale. **Cancel** restores this workbench's applied Theme, rather than applying
the peer edit or keeping the preview of an unselected Library item.

The built-in Light and Dark themes are tuned independently: each keeps opaque Workspace, panel,
control, muted, and selected surfaces distinct, and uses scheme-appropriate text and feedback
contrast. Measurement colors keep the same meanings in both appearances even when their exact
values differ.

**Open Theme Preview** shows controlled overview and module scenes from the current unsaved draft
without changing Workspace data or layout. The module scenes include representative optional Grid
lines and always-visible Vectorscope guides so their resolved colours can be reviewed. Its
Spectrum, Stereo Map, and classic Waveform examples show their Theme-owned fill opacity, and the
overview includes ordinary, selected, and disabled controls. These are illustrative scenes; use the
real panels to judge geometry and data-dependent rendering. The
**Visual Review** page reports recommended contrast,
color-separation, surface, and Intensity targets and can jump back to an affected control. These
findings are advisory: they do not interrupt editing or block saving, built-in Themes, or Community
publication. Invalid Theme structure and unsupported versions remain errors.
Module findings use the final overridden colours and link to the corresponding module control.

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
item. Older Preset pack files remain importable. Module settings left at their defaults are not
written into the file, so an earlier PLVS version can still import it unless the Preset changes a
setting that version does not have.

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
and workspace identifiers so the matching per-process log can be diagnosed. See the
[Privacy Policy](https://plvs.soundoer.com/privacy/) for the exact contents, retention and
deletion-request details. Feedback and crash-report prompts also link to that policy before any
diagnostics are sent.

## Agent Control

**Agent Control** lets `plvs-cli` inspect and change the running app; see
[Command Line](command-line.md). It is off until you enable it.

## Licenses

Every package includes a `licenses` folder containing the third-party notices, the complete PLVS
MIT License and the license texts referenced by the notices. Portable users can open that folder
directly beside `plvs.exe`; in a macOS app bundle it is under `Contents/Resources/licenses`.
