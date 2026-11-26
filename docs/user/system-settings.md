# System Settings

Everything for making PLVS fit into how you work day to day.

In the normal window, opening Settings softly blurs and dims the workbench behind it while the Settings drawer stays
opaque and clear.
The drawer keeps a single border along its inner edge against the workbench. Floating menus and
dialogs retain their full outlines and shadows.

In Dock, **Settings** in the expanded toolbar opens the same controls in a separate window without
leaving Dock or restarting capture. Its width follows the same Interface Size setting as the normal
drawer. After closing, its window stays ready for one minute after pending operations finish, then
releases its resources. Reopening within that minute reuses it. Saved Items export uses that window. Theme and Loudness Profile editors and Feedback open in
a separate, draggable authoring window with their ordinary rounded surfaces and content sizes.
If a Dock Settings action times out, reopen Settings to check its current state before retrying.
Closing an authoring flow destroys its native window after the existing save/cancel decision settles.
In both modes, Theme and Loudness Profile editors keep short pages compact and limit long pages to
600 CSS pixels or 80% of the available height, whichever is smaller. Available height means the
application viewport in the normal window and the editor's monitor in Dock. Long content scrolls
inside the editor while its title, tabs, and Save / Cancel controls remain visible.
In both modes, opening Theme Preview temporarily hides the Theme editor without dimming the
background. Closing Preview restores the editor with its draft, selected page, scroll position, and
position intact. In Dock, Preview temporarily expands the same authoring window and closing it
restores the editor's window bounds; it adds no extra WebView. Preview remains modal. Unsaved-change
confirmation dialogs retain their usual dimming.
Scroll restoration also waits for the Dock window to finish returning from Preview size, including
when the editor was scrolled to the end of a long page.
Switching between Dock and the normal window preserves the open editor, unsaved draft, and Theme
Preview. Clicking another application leaves authoring open; Close or Escape uses the
current surface's normal close or cancel rules, including unsaved-draft confirmation. Updates and
import review use their existing accessories, temporarily hiding Settings until the flow finishes.
**Quick Tour** returns to the normal window before starting.

## Control feedback

Settings rows move their controls below the label when the text and controls need more room.

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
the saved workbench set. If a change fails to save, Settings shows an error and PLVS restores the
saved login setting. If PLVS cannot read or apply **Open at Login** at startup, **Retry** checks
the system setting and reapplies the saved preference when one exists. **Close Behavior** chooses whether closing the window keeps PLVS running in the system tray or quits it.
In **Close PLVS?**, the main button shows the selected action, **Quit** or **Minimize to Tray**.
Choosing **Don't Ask Again** updates **Close Behavior** in Settings.
Before either action, PLVS finishes saving pending settings. If saving fails, the window stays open
and offers **Retry** or **Cancel**.
If PLVS cannot hide or quit the window after saving, the close dialog offers the same retry.
Quitting waits for capture and File cancellation to settle before checking whether measurement is
still active. A completed stop does not require a second Quit; a newly started measurement blocks exit.

Quitting one additional workbench removes it from the next restore set. If a workbench crashes, its
saved workspace remains recoverable instead of being treated as an intentional removal.
An open draft blocks Quit from the window and Tray. If Quit fails after removing a workbench from
the restore set, PLVS attempts to restore its previous place.
An unresolved Library conflict also blocks Quit, updates and scene replacement until you choose
Reload or Save as Copy. Dock entry checks again after any queued window operation finishes, so an
editor opened during that wait remains protected.

With several workbenches open, only the current coordinator checks for and installs application
updates. Before installation, every workbench must have no open draft editor, stop capture and
finish saving. The update package downloads before that interruption. A refusal or timeout cancels
the update; a successful update closes the workbench set and restores it after relaunch. If the
installer fails after peer workbenches have already closed, PLVS relaunches the current version so
the saved set is restored instead of leaving those workbenches closed. If the coordinator itself
disappears while workbenches are waiting at the save barrier, they attempt to resume any capture
that the barrier stopped. If the source cannot restart, the workbench leaves the save barrier and
reports the capture error. A workbench that is installing an update refuses a new request to
prepare for shutdown from another workbench.
If preparation expires, measurement resumes, or a draft opens before a workbench closes, it
refuses the old close request. If the final save fails before any workbench is told to close,
PLVS stays open and reports the error. When an operation is canceled, workbenches that are still
open can resume even if another workbench has already closed.

PLVS also keeps one system Tray. On Windows and macOS, left-clicking its icon shows or hides the
main window, while right-clicking opens the menu. On Linux, the desktop's AppIndicator host
opens the native menu and controls submenu placement, appearance and dismissal. Source groups
open as submenus in the native menu. The menu includes
**Show** and **Hide** on all three platforms.
On Windows and macOS, the Tray menu follows the current Theme and Interface Size. It fits its visible
options and scrolls when they exceed the available space. **Locate**, **Show** / **Hide**,
**Start** / **Stop**, Source and Preset selection leave the menu open. **Show** and **Hide**
update when the Workbench completes the action. Quitting another
Workbench removes its entry while the menu stays open. Opening Settings, checking for updates,
and opening a new Workbench dismiss the menu. Quitting the Workbench that owns the Tray or
quitting PLVS closes its menu.
On Windows and macOS, selecting a Workbench expands its controls in place. **Source** and **Preset** open
beside those controls. Source groups such as **Output**, **Input**, **Applications**, and **Mixes** (when available) start
collapsed and expand when selected. Long lists scroll inside the side menu. Selecting a Source
or Preset keeps its menu open. Press **Esc** to close the side menu, then again to collapse the
Workbench controls, then once more to dismiss the Tray menu.
Agents can inspect the menu on all three platforms and operate the PLVS panel on Windows and
macOS using [Tray Control](cli.md#commands).
**Settings…** brings the owning workbench forward and opens Settings. In Dock mode, it shows the
Settings window while keeping Dock active.

With one workbench open, its window, Start / Stop, Source, Preset and Settings controls appear
directly in the Tray menu. With several open, each workbench's Source-derived name appears directly
at the top level. Its submenu begins with **Locate** and ends with **Quit Workbench**. **Locate**
brings the selected workbench forward and briefly lights its inside edge in its theme's accent
colour, even with **Hide Window Frame** enabled. The outline and glow fade together. With reduced
motion enabled, the outline appears briefly and stays static. A visible Dock strip lights up in
place. A hidden workbench or a minimized window is restored. Source and Preset show that
workbench's choices and current selection, and Settings opens in that workbench. **New Workbench** is available at
the top level with one or several workbenches open. It opens another with **Automatic** selected
and its Transport **Stopped**. Update actions and **Quit PLVS** also remain at the top level.
**Show** brings the selected workbench to the front, restoring it if minimized. A workbench with
an open editor or dialog refuses to quit and comes to the front so you can finish or close what is
open first. **Quit PLVS** flushes and closes the complete
workbench set; quitting one workbench does not close its peers. PLVS checks again for open
editors before closing prepared workbenches. If a remote Quit Workbench fails before closing,
PLVS attempts to restore its previous capture state and place in the restore set.
If Live capture is still starting or changing devices, coordinated quit can be retried after
the transition finishes. The same applies when preparing to install an update.
On macOS, the application menu's **Quit PLVS** command (⌘Q) also quits the complete workbench set.
After **Quit Workbench** succeeds, its Tray entry is removed immediately. If only one workbench
remains, its controls return to the top level. A refused quit keeps the workbench in the menu.
Tray actions use the latest workbench state, including when background status changes while the
menu is open.

The Tray also offers **Check for Updates…** when updates are enabled for the running app identity.
It opens Settings at the version and update status row and starts a manual check, even when
automatic checking is off. The menu shows
checking or retry status, **Update Available: vX.Y.Z…**, **Downloading Update…**, or
**Update Ready: vX.Y.Z…** as appropriate. When an update is known, selecting its entry opens the
existing update details instead of installing immediately. In Dock mode, details use the existing
update accessory; a hidden Dock is shown first. Portable copies retain the manual download flow,
and Preview has no update entry. During installation or restart, Settings and update entry points
are disabled along with window hiding, preset switching and quitting.

## Updates

Near the bottom of Settings, the version, update status, and action appear below the two update
preferences. **Quick Tour** and **Feedback** share the first footer row. **Docs**, **Sharesets**,
and **Releases** are on the second row and open in your browser.
The question-mark icon beside **Auto Download Updates** explains download availability, the **Auto Check for Updates**
dependency, and installation confirmation on hover or keyboard focus. The version status row shows
background download progress, a ready package, or a failed download. A failed replacement download
does not erase an older verified ready package. Update details use **What’s New in vX.Y.Z** for a
single release and **What’s New Since vX.Y.Z** for notes covering multiple releases since the
installed version. The title and actions appear while the release notes load. If formatting is
unavailable, the notes are shown as plain text.
**Auto Check for Updates** controls startup and twelve-hour checks. **Auto Download Updates** requires checking to be enabled. Turning checking off also turns downloading
off; turning checking back on leaves downloading off. When there is no known update, **Check**
starts a manual check even if automatic checking is off. If the check fails, **Try Again** repeats
it. With **Auto Download Updates** on, a check also downloads a newer version in the background.
When there is a known update, **View Update** opens its details. Preferences are shared across
workbenches and are not imported from a configuration profile.

Turning automatic downloading off cancels background work and removes the staged update. If update
details are open, **Update and Restart** downloads the package again on request. If cancellation
reports an error, PLVS checks whether the package is still ready to install. When installation finds
a missing or damaged package, **Update and Restart** can download it again. With **Auto Download
Updates** on, a later check can also download the same version again. A manual update you have
explicitly confirmed is separate from this preference. Installed Windows, macOS
and stable Ubuntu `.deb` copies support verified local staging; Portable copies use the
release-page download instead.
Preview does not offer the updater. On macOS, automatic updates are unavailable on a read-only
volume such as a mounted DMG; Settings shows the reason directly below **Auto Download Updates** so you can
move PLVS to Applications and reopen it. A protected directory on a writable volume can still use
the system authorization flow.

On Ubuntu, **Update and Restart** uses the system Polkit prompt and a small package-owned installer;
PLVS never collects an administrator password. The installer authenticates the package again,
checks its version, package name and architecture, and asks APT to install it without downloading
or removing other packages. Canceling the prompt, a missing authorization service, or a dependency
problem reopens PLVS and keeps the verified package for retry. Update details retain the manual
release download when the installed package predates this support or system tools are missing.

Downloaded updates are offered on a later fresh launch. **Skip This Time** or closing details keeps
the package without installing it. Details keep their selected version even if another check
finishes, with one exception: when details offer an already downloaded package and automatic
downloading finds a newer version, details switch to the newer version, which replaces the older
package. If the selected version is still downloading, details show its progress and temporarily
disable **Update and Restart**. When verification finishes, **Update and Restart** becomes available.
If that package has been replaced or removed,
confirmation fails safely and asks you to reopen details. A previously downloaded package can be
installed without another network check.
If a background check fails while those cached details are open, the offline installation remains
available; the check failure does not replace the installation status in the dialog.
An unavailable update feed does not mean installation failed. With no known update, Status shows
**Update Check Failed** and offers a check retry; a successful check clears that condition. A known
update remains available when a later check fails. Download and installation failures retain their
own recovery status.

The startup offer never stops another workbench to gain permission: if a peer starts before you
confirm, installation is deferred. A manual update still uses the workbench-wide save and editor
guards described above. New workbenches are prevented from opening while the confirmed installer
owns the installation. If another workbench has not closed within five minutes, the update is
not installed and PLVS reopens. If an installation is interrupted, for example by a power loss,
the next launch opens the version that is still installed and reports the interrupted attempt.
Failed attempts do not automatically retry on the next launch.
Reopening the failed version's update details shows the previous installation error. Failed update
details keep **Retry** as the primary action and also offer **Download Manually**. The manual action
opens that exact version's immutable GitHub Release page in the system browser; it does not close
PLVS, choose an installer or install anything automatically.

On macOS, PLVS 0.22.0 and 0.22.1 cannot complete an automatic update because their copied update
helper loses the application bundle's Developer ID signature. If you are running either version,
download the current DMG from GitHub Releases and replace PLVS in Applications once. PLVS 0.22.2
and later copy the complete signed application bundle for the helper, so later updates can again be
installed from update details.

On Windows, an automatic update from PLVS 0.22.0, 0.22.1 or 0.22.2 can fail with "The requested
operation requires elevation" (os error 740) because Windows mistakes their copied update helper for
an installer. If you see this error, download the current `x64-setup.exe` from GitHub Releases and
run it once; it installs for the current user and does not need administrator rights. Later
versions declare that they run without elevation, so their updates install from update details.

## Keyboard shortcuts

PLVS provides three configurable shortcuts: **Start / Stop** (`CmdOrCtrl+1`),
**Live / Snapshot** (`CmdOrCtrl+2`), and **Clear** (`CmdOrCtrl+3`). Select a shortcut to record
a replacement, press Delete or Backspace while recording to remove it, or use Reset to restore its
built-in key and turn Global off. PLVS rejects bare keys, reserved combinations, and combinations
already assigned to another configurable action. If the default key is in use by another action,
Reset keeps the current binding and shows the conflict.

Each row has its own **Global** switch. An enabled action works even when PLVS is not focused; its
ordinary shortcut continues to work whenever PLVS is focused. When several PLVS workbenches are
open, the coordinator registers each global combination once and sends the action to the workbench
that was focused most recently. Clear acts on the source shown in that workbench. Saved changes also update what the coordinator runs for
combinations it already registered. A registration error affects only that row. If a combination
becomes unavailable, you can choose another one or toggle **Global** to try registering it again.
Shortcut changes appear after they save. If another workbench changes the shortcuts while you are
editing, the affected row reports the conflict so you can try again.

## Appearance

On Windows 11, the outer system window outline follows the window chrome: it is visible by default
and hidden in chromeless views. Native shadows, rounded corners, and window resizing remain
available in normal windows. Older Windows versions keep their default outline behaviour.

**Interface Size** scales the whole interface. Settings, editors, confirmation and import/export
dialogs, feedback, update details, and status lists adjust their widths with the selected size.
Menus fit their content within size-aware limits. Dock windows follow the same widths and remain
bounded by their monitor; the Dock strip layout remains independent. **Appearance** follows the system theme by default or
uses a fixed theme. Light and Dark ship built in, and the theme editor lets you build and save your
own themes. The first time you open the editor in a window, it may briefly show a loading message.
PLVS bundles Inter for interface text and JetBrains Mono for changing numeric readouts,
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
Advanced opens with every role group collapsed. **Live & Snapshot** contains the shared History
Primary and History Secondary data colours plus the two transport indicators. A module's History
exception remains flat in that module's group, directly after its corresponding Live role; Auto is
shown as **Follow History Primary** or **Follow History Secondary** there.

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
The icons at the end of a row in the Presets, Loudness Profile, Theme, module, and file history
lists appear together when the pointer or keyboard focus is on that row; Delete turns red on hover.
When reordering Presets, Loudness Profiles, profile rules, Dock panels, or Stats and File Summary
metrics, pressing the grip immediately draws a 1px Accent outline around the row. Neighboring rows
slide aside as you drag. Release the grip to apply the new order.

Imports and edits from another workbench refresh the Theme Library without replacing this
workbench's applied Theme. Switch away and select the Theme again to apply its updated version.
Changing a different Library item keeps the applied Theme in place.
While the Theme editor is open, your unsaved draft remains visible; external changes mark an
existing draft as stale. **Cancel** restores this workbench's applied Theme, rather than applying
the peer edit or keeping the preview of an unselected Library item.

The built-in Light and Dark themes share the same orange Accent and Primary Data, blue Secondary
Data, Interface and Status semantic colours, Frequency palette, and Intensity scale. Their neutral
shell colours are tuned independently; in both, panels are the lighter surface on a darker
Workspace, and the raised, control, and muted surfaces step away from the panel.
Feedback messages, solid chips, and buttons use the Interface Palette colours directly. Loudness
Momentary follows Primary Data and Short-term follows Secondary Data; selected Snapshot traces use
the shared History Primary and History Secondary colours. The Live indicator follows Status
Critical, while the Snapshot indicator follows History Primary. Core Primary and Secondary Data
carry the clear History colour change. Status, Frequency, and Intensity palettes share one subtle
automatic treatment that changes only lightness toward the panel; it does not rotate palette hues
or create a separate Level Meter colour family. Both Level Meter Gradient and Level Zones therefore
continue to follow the Level Meter's Status colours in Snapshot. Per-module Advanced overrides
remain available for an intentional trace exception; the built-in Light and Dark themes use none.
Measurement colors therefore keep the same meanings and visual identity in both appearances.

**Open Theme Preview** shows controlled overview and module scenes from the current unsaved draft
without changing Workspace data or layout. Use its **Live / Snapshot** switch to compare the two
data states; the switch is not saved in the Theme. The module scenes include representative optional Grid
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

**History Length** sets how far back Live history panels can be scrolled: 30, 60, 120, or 240
minutes. Changing it clears the current Live measurement, exits Snapshot, and starts the measurement
clock again while capture continues. File Mode is unaffected. **Dialogue Detection** chooses the
engine behind the [dialogue readouts](dialogue-gated-loudness.md) in Live and in File Mode when the
File toolbar's **Dialogue Detection** button is on. When Live uses dialogue detection, changing
the engine starts a fresh measurement with the new engine. If PLVS cannot apply the engine,
it reports the failure in Status Notices and keeps the previous setting. File analyses keep
the detection settings they started with.

## Import, export, and reset

**Saved Items** exports selected Loudness Profiles, Presets, or Themes and imports any of their
shared file types, choosing the right review from the file's document kind. **Complete Setup** uses
one configuration file instead: importing it replaces your whole setup and restarts PLVS
rather than merging. These operations move configuration only, never measurement data. With several
workbenches open, PLVS first checks every workbench for an open draft, stops capture and saves before
replacing shared data; the workbench where you chose Import receives the instance-owned fields.
An incomplete configuration file is refused before any Workspace or Library data changes.
When overwriting an export, PLVS replaces the existing file after the new contents are fully written.
**Reset PLVS to Default** uses the same coordinated restart and restores a fresh installation.
The local Agent Control switch keeps its current setting.
Complete Setup includes the workbench's last normal window placement and the placement stored in
local Presets.

For a one-item file, use **Export** on the saved Loudness Profile, Preset, or custom Theme itself.
In Dock, a failed Loudness Profile export appears in **Status Notices**.
In the Settings **Saved Items** exporter, choose a type, then select the Items to export together.
If an Item disappears from the Library, PLVS asks you to review the selection. If writing the file
fails, the exporter keeps your selection so you can retry. Each file can contain up to 256 Items and
be at most 2 MiB. Select fewer Items if an export exceeds either limit.

If storage fails or PLVS exits before the shared configuration commits, other workbenches keep
their saved Library. The next time the importing workbench opens, its recovery journal restores
its previous local settings. PLVS preserves recovery snapshots from older versions under the
application data directory in `multi-instance/transactions/` with a `.legacy-*.json` suffix.

If the configuration saves but PLVS cannot restart, the toolbar's **Status Notices** show
**Restart Required**. Open the notice and choose **Restart PLVS** to finish with the saved
configuration. In Dock, use the Status menu in the expanded toolbar.

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
only step that writes to the Library. A Preset and its bundled Loudness Profiles are saved together
in one operation. **Import Complete** lists the Items and their results directly under the title.
Each Item is marked **Added**,
**Already in your library**, or **Imported as a copy**. If the Library changed during review, open
the import again to refresh the review. Using an existing Item also checks whether the reviewed
content still matches. If it changed, the review refreshes before you choose what to apply.

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
new ID. If saving reports an error after creating the copy, press **Save as Copy** again to finish
saving that same copy. An open Theme or Loudness Profile editor keeps its local draft and shows a
warning as soon as PLVS observes that its saved source changed elsewhere. **Reload** preserves
other pending Workspace settings, such as custom channel names.
If an item changes while you are deleting it, choose **Reload** to see the saved version before
deciding whether to delete it again.

A `.plvstheme` file carries portable Theme authoring choices rather than device-local state. It
keeps the Theme's name, Dark/Light scheme, Core and Palette colors, and Advanced customizations;
local IDs and the palette preset originally used to choose those colors are not part of the shared
Theme. PLVS still imports older Theme pack files. If any Theme entry is damaged or incompatible,
the import reports the problem and adds nothing instead of silently skipping that entry.

A Theme, Preset, or Loudness Profile copied as text can be pasted straight into PLVS: press
**Ctrl+V** on Windows or **Command+V** on macOS outside a text field. In Dock mode, first focus the Dock strip, toolbar, editor, or Settings window; the import review opens in a separate window. The text is the
same content as the shared file, so anything **Import** accepts can also be pasted. PLVS opens the
normal import review before adding anything; it never applies or overwrites an Item just because
it was pasted. A copied or
downloaded Theme is recognized by its content: if an identical Theme, including its name, is
already in your library, the review says so and nothing is added. For a single existing Item, choose
**Use Theme**, **Use Profile**, or **Apply Preset** to use it directly, or **Done** to close the
review. Single `.plvstheme` files use
the same **Import** action as PLVS-exported Theme pack files.

## Sharesets

Open **Sharesets** in the Settings footer to browse all resources in your system browser.
The **Browse** action beside the Presets or Loudness Profile popover title opens that category
directly. In Settings, choose **Fixed Theme** to reveal **Browse Themes** below the Theme row;
it opens the Themes category. Browsing does not change your current setup or discard an editor draft.

In Docs, the chapter navigation underlines the current chapter. Select a chapter to jump directly
to it without a scrolling animation.
Docs and Privacy show a **Back to Top** arrow beside the reading column after you scroll past the
first screen. On narrow screens it sits at the bottom right. Select it to return immediately to
the top navigation.

On narrow screens, the PLVS homepage, Docs, Privacy, and Sharesets navigation show a three-line menu icon
next to **Download**. Select it to reveal **Sharesets**, **Docs**, and **GitHub**. Select the
close icon, click outside the navigation, or press Escape to close the menu.

The PLVS homepage showcases selected Presets and Themes. Use **Sharesets** in the top
navigation to browse and download resources.

The [Sharesets](https://plvs.soundoer.com/sharesets/) offers curated Themes, Presets, and
Loudness Profiles. Choose a category, search by name or description, and optionally narrow the
results by Tag under **Filters**. The selected tag remains visible when Filters is closed.
**Clear All** resets the category, search, and tag. Open an Item for its previews, contents,
compatibility details, author, and release history. The initial collection is authored by PLVS;
public submissions are not open. Theme pages display the same descriptive tags as their listing
cards beneath the summary, and show up to four selected previews. Select a thumbnail to switch images, or select the
large image to enlarge it in place. Use the arrow controls to browse and Close, Escape, or the
background to dismiss it. Usage instructions, details, and release history are shown on the page.
When a Theme has multiple releases, **Current** appears beside the current release number.
Use the download action near the title for that release. Older published releases have
**Download v…** text links alongside their version information.
Loudness Profiles use generated rule summaries instead of screenshots, on both catalogue cards
and detail pages. Each summary shows the reference loudness and the first three rules, with a
remaining-rule count when needed. The lower **Details** section shows every rule, grouped by
metric, with labels on the left and conditions and Warn or Fail outcomes on the right.
Comparisons use `>` (greater than) and `<` (less than). Values
come directly from the Profile definition. The built-in **PLVS Default** page is marked **Included with
PLVS** and omits download, import, file, and release controls. Downloadable Profiles retain those
controls and their release history.
Profiles based on published standards or platform guidance also show a **Sources** section. Each
entry identifies the publisher, document, version or edition when available, an official link, and
how that source maps to the Profile. A source link documents the curator's interpretation; it does
not mean the publisher endorses or certifies PLVS.
Preset pages show the workspace preview alongside the description, tags, copy and download
actions and import instructions. Select the preview to enlarge it in place; a single preview needs no
thumbnail strip. **Details** lists workspace panels, module names and Dock status, plus file
information and saved display settings. Loudness Profile shows its included name or **Off**;
applying a Preset with **Off** turns off the active Profile. Expand each row under **Panel Settings**
to inspect saved controls and axes for that panel. Omitted controls use PLVS defaults. Bundled
Loudness Profiles show their complete rules below the panel settings. Older published releases use text download
links in **Release History**, as on Theme pages. The built-in **PLVS Default** Preset page is marked
**Included with PLVS** and omits download, import, file, and release controls. On every resource
detail page, release history appears last, after all resource information and settings.
On narrow screens, **Menu** exposes the website navigation on both listing and detail pages;
**Download** remains visible.

Sharesets Items require PLVS 0.20.0 or later. The line beside the resource Release number shows its
minimum app version. Items that use panel orientation controls require PLVS 0.21.0 or later.
**Requires upcoming PLVS** means the saved content needs a feature that has not yet been assigned a
stable release.
For **Meter Bridge**, Release 2 pairs horizontal Peak and RMS meters with vertical Momentary and
Short-term meters. PLVS 0.20.0 users can download Release 1 from **Release History**.
Resource releases track changes to the saved content. Refreshing screenshots for the current
interface does not change the resource's release number or download, and does not require importing
an existing Library item again.

For an Item that is not already included with PLVS, download its `.plvstheme`, `.plvspreset`, or
`.plvsloudness` file, then open **Settings → Saved Items → Import…**. Review what will be added and
confirm. Importing adds to the
Library; applying the Item is a separate action. You can also use **Copy Theme**, **Copy Preset**,
or **Copy Profile** on the Item's page and paste into PLVS outside a text field to open the same
review. An identical Item already in your Library is recognized instead of being added again.

Sharesets previews use fixed example measurements, not your audio. A Theme gallery shows the
first-run Workspace, the 5.1 **Multichannel Monitoring** scene, a measurement Snapshot, and Theme
Colors. The Workspace and Snapshot use the Panel Settings saved as the PLVS Default Preset, with the
editable **PLVS Default** Loudness Profile active. Example verdict colours do not certify a delivery
standard; review a downloaded Profile's rules against your own requirements before using it.

Items do not update automatically. A withdrawn release loses its download actions; its history and
withdrawal reason remain visible. If every release is withdrawn, the Item leaves browsing and search
while its detail page remains available.

## Crash reports and feedback

If the terminal that launched PLVS disconnects its output, PLVS continues running and keeps
writing its local log files.

**Ask to Send Crash Reports** follows **Close Behavior** near the top of Settings.
PLVS saves crash reports locally. With this option enabled, it asks before sending
one after a crash; with it off, PLVS never asks and sends nothing. Turning it on does not ask about reports
saved while it was off until the next launch. With several workbenches open, only the current coordinator asks; choosing
**Later** keeps the report saved, and PLVS asks again at the next launch or when another workbench
becomes coordinator. **Don't Ask Again**, to the left of **Later**, discards this report and turns
off future prompts.
Feedback diagnostics are attached only when you choose to include them. Audio
samples are never attached. In a multi-workbench run, local crash records include random instance
and workspace identifiers so the matching per-process log can be diagnosed. See the
[Privacy Policy](https://plvs.soundoer.com/privacy/) for the exact contents, retention and
deletion-request details. Feedback and crash-report prompts also link to that policy before any
diagnostics are sent.
If the feedback connection stops responding, PLVS reports that delivery could not be confirmed
and keeps the draft available.

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

**Agent Control** lets AI clients and command-line tools inspect and change the running app. See
[Agent Control](agent-control.md) for both connection methods. It is off until you enable it.
Enabling it also makes `plvs-cli` available by name in a new terminal. Windows uses your user
`PATH` and macOS uses a link
in `/usr/local/bin` that may require administrator authorization. When enabled, UI Navigation can
open Settings or exact Panel Settings, begin Theme/Profile authoring, and open an unsent Feedback
draft. Exact Close and Cancel operations use the same visible UI paths. They cannot save, send,
confirm, or silently discard a draft; dirty cancellation opens a separate discard decision.
Agent Control can respond to choices in currently open dialogs. The Send choice submits Feedback
or a pending crash report. Temporary dialogs and editors use
a separate UI generation so automation can detect visible changes without treating them as saved
settings changes.

While Agent Control is on, two copy actions can appear under the switch. Hover over either question
mark or focus it with the keyboard for help.

- Under **MCP Setup**, **Copy** puts this installation's MCP connection details and a setup prompt
  on the clipboard. Paste the whole prompt into your AI client. It can register the server or help
  you complete setup in the conversation. See
  [Connect an AI Client with MCP](agent-control.md#connect-an-ai-client-with-mcp). After a call
  reaches PLVS, **MCP Setup** can show the last client's name and when it was used. PLVS keeps that
  information only in memory until it quits.
- Under **Prompt Starter**, select **Copy**, paste the prompt into your AI chat, and add your
  request. It tells the agent to inspect PLVS before it acts, using `plvs-cli` or the MCP tools.

## Licenses

Every package includes a `licenses` folder containing the third-party notices, the complete PLVS
MIT License and the license texts referenced by the notices. Portable users can open that folder
directly beside `plvs.exe`; in a macOS app bundle it is under `Contents/Resources/licenses`.

From v0.21.0, packages also include `COMPONENT-NOTICES.txt` with the original dependency notices
and version-specific source links, and `NATIVE-NOTICES.txt` for native libraries and models,
including the corresponding FFmpeg source and build-script download. These additional files are
not included in v0.20.0 packages. Third-party components retain their own licenses.

The retired Selected Surface theme setting is no longer shown or evaluated for contrast. Existing
themes still import; obsolete selection-surface overrides are discarded without changing the
remaining colors. Intensity palette position sliders retain focus while moving a stop and show
progress within the stop’s permitted movement range.
