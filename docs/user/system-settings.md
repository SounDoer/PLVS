# System Settings

Everything for making PLVS fit into how you work day to day.

Opening Settings softly blurs and dims the workbench behind it while the Settings drawer stays
opaque and clear.
The drawer keeps a single border along its inner edge against the workbench. Floating menus and
dialogs retain their full outlines and shadows.

## Control feedback

Ordinary dropdowns and setting fields are transparent with hidden borders at rest. Hovering shows
a contrasting neutral background without revealing the border. Opening, editing, or using
keyboard focus adds the border. A focus ring appears around the focused control only while you move
between controls with Tab; shortcuts and pointer use never show it. Single- and multi-choice checks use the
accent color. Expanded dropdown options use the same neutral highlight for pointer and keyboard
navigation. Dark / Light selection in the Theme Editor uses a neutral selected background.

Settings-page transfer actions such as Export and Import use the same transparent base and neutral
hover feedback as toolbar actions. The final confirmation action inside a dialog remains filled.

Switch thumbs gain a subtle border on hover or keyboard focus. Slider thumbs use a neutral
hover fill and an accent fill while dragging or holding an adjustment key. Sliders without an
adjacent value show a value tooltip during hover, focus, and dragging; those with a visible value
do not duplicate it. Disabled controls are dimmed and do not show interaction feedback.

Numeric and color text fields commit on Enter or when focus leaves. Escape cancels the draft.
Invalid required numeric entries restore the valid value rather than becoming zero. Loudness
Profile rule fields retain their special empty value, meaning the bound is not judged. Color
picker gestures and sliders still preview immediately, except analysis parameters that commit
when adjustment finishes.

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

PLVS also keeps one system Tray. Left-clicking its icon shows or hides the main window, while
right-clicking opens the menu. On macOS, **Show Window** or **Hide Window** in that menu provides the
same control. Its **Workbenches** submenu uses Source-derived names and can show, start, stop or
quit a specific running workbench. **Quit PLVS** flushes and closes the complete workbench set;
quitting one workbench does not close its peers.

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
own themes. PLVS bundles Inter for interface text and JetBrains Mono for changing numeric readouts,
so their layout does not depend on fonts installed on the computer. A custom theme keeps its Dark
or Light appearance beside its name; **Core** holds the
main identity colors, **Palettes** controls shared data scales, and **Advanced** contains optional
per-interface and per-module overrides. Advanced roles stay on **Auto** unless you customize them,
and can be searched or reset to Auto a section at a time. Advanced exposes color customization,
not fill-opacity controls. Defaults remain 20% / 2% for Spectrum, 20% for Stereo Map, and 12% for
classic Waveform. Fill opacity is fixed by the app and is not stored in or exported with Themes.
Palette stop positions, the theme name, and Dark / Light appearance remain editable.
Core Colors can be reset together to the built-in defaults for the Theme's current Dark or Light
appearance; the reset is recorded as one undoable edit.
Inferno, Viridis, and Magma use eleven evenly sampled anchors from their standard Matplotlib color
maps; Monochrome needs only its black and white endpoints. Selecting a palette stores an editable
snapshot in the Theme, so later app updates do not recolor a saved custom Theme. After you edit the
Intensity stops, that Custom version remains available while you compare other presets; **Reset
Custom** is the explicit action that discards it. **Add Stop** sits after the stop list.
Status, Frequency, and Interface each offer one **PLVS** palette shared by Dark and Light. Changing
Dark / Light appearance does not rewrite an already selected palette. Their preset dropdowns stay
hidden because there is only one choice; after you customize one of these palettes, **Reset to
PLVS** restores it after an inline confirmation. Reset actions stay in place while defaults are
active, but appear dimmed and cannot be armed until there is something to restore.

**Advanced → Interface → Primary Text** also supplies ordinary text on panels, raised surfaces,
neutral controls, and selected surfaces. Text on solid Accent, Success, Warning, and Danger areas
has separate controls.
Advanced opens with every role group collapsed. The **Transport** group controls the Live and
Snapshot indicators in transport controls; panel snapshot traces remain under their module groups.

**Advanced → Interface → Border Color** sets one opaque colour for ordinary interface separators
and control outlines, including input fields. It does not change chart Grid or Guides colours;
these follow the plot surface by default and retain their per-module Advanced controls. Older
themes preserve an authored border's appearance against Panel Surface and any inherited Grid
colours when imported or loaded. Input outlines now share the ordinary Border colour.
**Advanced → Interface → Effects → Focus Ring** controls the outline shown while navigating with
Tab. Its Auto value follows Interface Accent; pointer use does not show this outline.

Workspace panels use their surface colour, rounded corners, and spacing without permanent outer
outlines or lines below their titles. Header, Footer, and the File analysis summary also omit outer
outlines. The gaps between panels remain draggable: their resize line appears on hover and stays
highlighted during a drag, then disappears when idle. Workspace and Dock resize lines use opaque
Border Color on hover or keyboard focus and Accent while dragging. Dock resize lines also
disappear when idle. Panel-location outlines use opaque Accent. While moving a Workspace panel, its
prospective space is shown with a translucent Accent fill and no separate outline, leaving the panel
beneath visible. Directional placement and tab insertion share the same unframed two-line hint. The
preview itself identifies the dragged panel; invalid areas show a brief pointer label instead. Input
fields retain their
existing boundary cues. Hover colours are generated as opaque colours; disabled controls retain
their reduced opacity. Automatic borders use scheme-specific contrast so Dark and Light preserve
the same visible state hierarchy. These interaction rules do not add Theme Editor settings.
Panel title-bar buttons use opaque secondary text by default, with primary text and a subtle
background on hover, matching the header toolbar. Disabled buttons retain reduced opacity.
When reordering Presets, Loudness Profiles, profile rules, or Dock modules, the dragged row has
a 1px opaque Accent outline and its grip stays in primary text colour until the drag ends.

Imports and edits from another workbench refresh the Theme Library without replacing this
workbench's applied Theme. Switch away and select the Theme again to apply its updated version.
While the Theme editor is open, your unsaved draft remains visible; external changes mark an
existing draft as stale. **Cancel** restores this workbench's applied Theme, rather than applying
the peer edit or keeping the preview of an unselected Library item.

The built-in Light and Dark themes share the same orange Accent and Primary Data, blue Secondary
Data, Interface and Status semantic colours, Frequency palette, and Intensity scale. Their neutral
shell colours are tuned independently; in both, panels are the lighter surface on a darker
Workspace, and the raised, control, and muted surfaces step away from the panel.
Feedback messages, solid chips, and buttons use the Interface Palette colours directly. Loudness
Momentary follows Primary Data and Short-term follows Secondary Data; their snapshot traces use the
matching Primary and Secondary Snapshot colours. The Live indicator follows Status Critical, while
the Snapshot indicator follows the same Primary Snapshot colour used by panels.
Measurement colors therefore keep the same meanings and visual identity in both appearances.

**Open Theme Preview** shows controlled overview and module scenes from the current unsaved draft
without changing Workspace data or layout. The module scenes include representative optional Grid
lines and always-visible Vectorscope guides so their resolved colours can be reviewed. Its
Spectrum, Stereo Map, and classic Waveform examples show their fixed fill opacity, and the
overview includes ordinary, selected, and disabled controls. These are illustrative scenes; use the
real panels to judge geometry and data-dependent rendering. The
**Visual Review** page reports recommended contrast,
color-separation, surface, and Intensity targets and can jump back to an affected control. These
findings are advisory: they do not interrupt editing or block saving, built-in Themes, or
sharing. Invalid Theme structure and unsupported versions remain errors.
Module findings use the final overridden colours and link to the corresponding module control.

## History and dialogue detection

**History Length** sets how far back history panels can be scrolled: 30, 60, 120, or 240 minutes.
Shortening it drops older rows without restarting the measurement. **Dialogue Detection** chooses the
engine behind the [dialogue readouts](dialogue-gated-loudness.md).

## Channels

Rename channel labels and choose the channel layout; see [Multichannel](multichannel.md).

## Import, export, and reset

**Saved Items** exports selected Loudness Profiles, Presets, or Themes and imports any of their
shared file types, choosing the right review from the file's document kind. **Complete Setup** uses
one configuration file instead: importing it replaces your whole setup and restarts PLVS
rather than merging. These operations move configuration only, never measurement data. With several
workbenches open, PLVS first checks every workbench for an open draft, stops capture and saves before
replacing shared data; the workbench where you chose Import receives the instance-owned fields.
**Reset PLVS to Default** uses the same coordinated restart and restores a fresh installation.

For a one-item file, use **Export** on the saved Loudness Profile, Preset, or custom Theme itself.
The Settings **Saved Items** exporter retains multi-select export for sharing several Items of one
type together.

If storage fails or PLVS exits during that replacement, the incomplete import is rolled back. A
recovery journal completes that rollback automatically the next time the target workbench opens,
before its saved state is shown.

New Loudness Profile exports use a strict portable format intended for sharing between installations.
Every exported rule must have a threshold, and a Profile must contain a reference or at least one
complete rule; PLVS reports an export error instead of silently dropping unfinished content. Older
`.plvsloudness` files remain importable.

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

A portable Theme document copied as text can be pasted straight into PLVS: press **Ctrl+V** on
Windows or **Command+V** on macOS anywhere outside a text field, or choose **Paste** on the Theme row
in Settings. PLVS opens the normal Theme import review before adding anything; it
never activates or overwrites a Theme just because it was pasted. A copied or downloaded Theme is
recognized by its content: if an identical Theme, including its name, is already in your library,
the review says so and nothing is added. Single `.plvstheme` files use the same **Import** action
as PLVS-exported Theme pack files.

## Crash reports and feedback

PLVS saves crash reports locally. With **Ask To Send Crash Reports** enabled, it asks before sending
one after a crash. Feedback diagnostics are attached only when you choose to include them. Audio
samples are never attached. In a multi-workbench run, local crash records include random instance
and workspace identifiers so the matching per-process log can be diagnosed. See the
[Privacy Policy](https://plvs.soundoer.com/privacy/) for the exact contents, retention and
deletion-request details. Feedback and crash-report prompts also link to that policy before any
diagnostics are sent.

**Attach Diagnostics** includes a timestamped app and window-state snapshot, recent Dock operations,
and up to 500 log lines from the current run. The operation timeline can include the previous
recorded run, so recovering the window or restarting PLVS does not necessarily erase the evidence.
It records Dock entry/exit, height changes, screen-space reservation, hiding/restoring the strip,
and detected changes to screen geometry or scaling. A drag is summarized as one operation rather
than a stream of mouse movements. Window coordinates and native sizes are physical pixels; the
frontend snapshot separately reports its viewport and WebView scale.

Choose **View Diagnostics** to inspect the exact attachment before sending. **Refresh Diagnostics**
collects a new snapshot. Missing, failed or timed-out sections are marked explicitly; a partial
snapshot can still be sent. Size limits may shorten the log and timeline, with counts recorded in
the attachment. Diagnostics do not include audio, screenshots, complete settings, or custom names
in the structured snapshot. Free-form log messages can still include device labels.

## Agent Control

**Agent Control** lets `plvs-cli` inspect and change the running app; see
[Command Line](command-line.md). It is off until you enable it. When enabled, UI Navigation can
open Settings or exact Panel Settings, begin Theme/Profile authoring, and open an unsent Feedback
draft. Exact Close and Cancel operations use the same visible UI paths. They cannot save, send,
confirm, or silently discard a draft; dirty cancellation leaves the real discard decision to the
user. Real event dialogs are observable but cannot be fabricated. Temporary dialogs and editors use
a separate UI generation so automation can detect visible changes without treating them as saved
settings changes.

## Licenses

Every package includes a `licenses` folder containing the third-party notices, the complete PLVS
MIT License and the license texts referenced by the notices. Portable users can open that folder
directly beside `plvs.exe`; in a macOS app bundle it is under `Contents/Resources/licenses`.

The retired Selected Surface theme setting is no longer shown or evaluated for contrast. Existing
themes still import; obsolete selection-surface overrides are discarded without changing the
remaining colors. Intensity palette position sliders retain focus while moving a stop and show
progress within the stop’s permitted movement range.
