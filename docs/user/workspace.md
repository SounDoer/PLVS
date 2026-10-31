# Workspace

Arrange panels into the layout your session needs.

## Multiple workbenches

Multiple workbenches are supported on Windows and macOS. On macOS, launching PLVS again while a
workbench is visible opens another workbench; launching it while all PLVS windows are hidden brings
an existing workbench forward instead.

Launch PLVS again when you need to meter another Source. Each additional workbench opens Stopped
with Automatic selected, so its Transport looks and behaves like the first workbench without
starting capture by itself. Press **Start** to meter the default output, or choose another Source
first. It then keeps its own Source, layout, active Preset, active Loudness Profile, Theme, window
position and Dock state. There is no workbench naming or profile-creation step: PLVS uses the
selected Source as the operating-system window and target name, adding `(2)`, `(3)` and so on while
identical Source names are running.

Saved Presets, Themes and Loudness Profiles remain one shared Library, so importing or saving an
item makes it available to every workbench without automatically applying it to their active
measurement.

## Split layout

Drag panel edges to resize, and split or merge panes to change which meters are visible at once.
When moving a panel, PLVS fills the space it will occupy after you release the pointer and labels the
placement direction. Dropping on a panel title adds it as a tab; moving outside a valid panel shows
**No Drop Target** and leaves the layout unchanged.

## Panels and presets

The **Panels** menu adds panels, including a second instance of a meter you want to watch two ways
at once. The **Presets** menu saves and switches between whole layouts. When none exist yet, name
your first Preset in the create field and select **Add**. The selected Preset shows as modified
while anything it restores differs from the current layout, and the mark clears as soon as you
return to the same settings.

Toolbar configuration entries such as Loudness Profile, Views, and Presets remain neutral while
closed, even when their configuration is active. Hover and an open menu use the same neutral
background and brighter icon. Inspect the menu for the selected configuration and modified state.
The same convention applies in Dock. Direct feature toggles retain their on/off indication;
Dock window placement and screen reservation are configured in Views.
Both states use the same neutral icon color at rest, without a persistent highlight.

## Status Notices

The top toolbar groups current measurement warnings, operation errors and update state into one
status entry. It names the highest-priority condition and shows a count when several are active.
Hover for a short explanation; click for the full list, including affected readings and available
actions. Click outside or press Escape to close the list. Resolved conditions disappear; the list
is not a notification history. The footer keeps Source, Loudness and Preset information.

In Dock, the toolbar button in the right control column shows a status icon while closed. Open the
toolbar to see the summary, then click it for the same list in a floating window toward the inside
of the screen. Capture interruptions and failures of enabled dialogue detection show the toolbar
automatically. Channel-layout limits, screen-space reservation failures and update state do not.
Opening Settings from the list returns Dock to the normal window first.

An unknown channel layout means loudness uses channels 1–2 only until you set a layout in Settings.
This condition and **Audio Dropped** appear in the shared status list rather than inside individual
panels. Metric threshold colors remain attached to their readings.

## Snapshot

Click any point on a history chart to freeze every meter at that moment, then return to live with one
click. Useful for inspecting a peak you only heard go by.

The default **Live / Snapshot** shortcut (`CmdOrCtrl+2`) freezes the latest retained Live
moment when history exists, or returns an active Snapshot to the Live edge. It does not start or
stop capture. The default **Start / Stop** shortcut (`CmdOrCtrl+1`) changes only the Live
capture lifecycle, so a Snapshot stays selected while capture starts or stops in the background.
Both actions are silent no-ops for a FILE Source; Start / Stop is also a no-op during an in-progress
start or stop, and Live / Snapshot is a no-op before Live history exists.

## Views

The Views menu pares the window down for monitoring: **Always on Top**, **Hide Panel Headers**, **Hide Axes & Labels**,
**Hide Window Frame**, **Auto-hide Controls**, **Surface Opacity**, and **Glass**. The **Dock** selector
below these controls offers **Off**, **Top**, and **Bottom** on Windows and macOS. Surface Opacity changes
the transparency of Workspace, panel, and Dock fills; text, measurement data, states, focus rings,
controls, and borders remain opaque for legibility.

On macOS, setting **Surface Opacity** to 0 also removes the native window shadow. This prevents
AppKit from drawing shadow-shaped outlines around the remaining opaque text and meter graphics;
raising Surface Opacity above 0 restores the normal window shadow.

On Windows 11, **Hide Window Frame** also hides the outer system window outline; turning it off restores
the system outline. **Auto-hide Controls** also uses a chromeless window, so the outline stays hidden
while that mode is enabled. Normal windows retain their native shadow in either mode.

**Hide Panel Headers** hides each Workspace panel's title, tabs and action row. **Hide Axes & Labels**
hides chart scales and channel/mode labels, including L/R, M/ST and Vector correlation tick numbers.
Readings, Stats metric names, hover information and graph reference geometry remain visible. Both
switches default to Off in Workspace. Dock has no Panel Headers and offers only Hide Axes & Labels,
defaulting to Off. Each surface remembers its annotation choice; switching surfaces does not copy
or reset it. Hidden labels give their space back to the plot.

## Axis Labels

Axis labels use the same collision rules in the workspace and Dock. Labels are measured at the
current text size, including their positions when tucked against an edge. When space is tight,
lower-priority text is hidden without changing the range, tick positions, grid, or plotted data.
Labels return when space becomes available.

- Peak and RMS dBFS axes prioritize the 0 dB reference, then range endpoints, then intermediate labels.
- LUFS, spectrum amplitude, and frequency axes prioritize endpoints. Frequency labels retain their
  logarithmic positions; zero has no automatic priority on these axes.
- Time axes prioritize the newest end of the visible window, including in Snapshot and reversed views.
- Stereo Map's M/S Ratio and Mono Loss modes prioritize their 0 dB reference.
- Fixed channel labels and correlation labels such as L/R and -1/0/+1 stay together, with a readable
  minimum size reserved for the complete group.

Live readout markers and loudness target lines keep their existing behavior; their own label
avoidance does not add extra axis ticks.

## Dock

The Dock toolbar offers **Sources** for the same live device/application selection as the normal
window. **Views** groups **Hide Axes & Labels**, **Dock: Off / Top / Bottom**, and **Reserve Space**
where supported. Select **Off** to restore the normal window. Sources and Views open beside the strip;
opening either does not restart capture. Panel settings remain accessible through the panel editor.

On Windows and macOS, Dock parks a slim, always-on-top meter strip against the top or bottom edge of
the screen, so the meters stay visible while you work in another app. A narrow column at the right
end of the strip holds three buttons, top to bottom: Start/Stop (Return to Live during a Snapshot),
the toolbar arrow, and Return to Normal Window (two outward arrows). The buttons are matching rounded chips; Start/Stop is tinted by its state. The arrow points to where the
toolbar opens and flips once it is open. The Dock toolbar lets you clear the session, switch the
Loudness Profile, edit which modules the strip shows, and manage Presets. Dock omits the timecode
and Ready label. Returning to the normal window preserves capture and history. The
toolbar closes when you click the arrow again, press Escape, or click anywhere outside PLVS; moving
the pointer over the strip never opens or closes it. While PLVS is showing an error, the toolbar
stays open until the error clears. On macOS, controls respond to the first click when switching
between the strip, toolbar, and editor windows, including the arrow that closes the toolbar.
Dock is unavailable on Linux, where the Dock selector is hidden; Wayland does not provide the
cross-desktop positioning and work-area contract this window form requires.
On Windows, the strip can also reserve its screen space so
maximised windows do not cover it. On macOS, it starts as an overlay within the monitor work area,
leaving room for the menu bar and system Dock. Enable **Reserve Space** in Dock **Views**
to automatically move or shrink the active application's window away from the strip. Grant PLVS
**Accessibility** access in System Settings → Privacy & Security, then enable the action again.
Without permission, Dock remains an overlay.

macOS avoidance waits for the window to settle after dragging or resizing. It affects standard,
resizable foreground windows primarily on the Dock's display; full-screen, minimized and unsupported
windows are skipped. An application's minimum window size may prevent avoidance. This feature does
not change the system work area or make the strip appear over native full-screen Spaces.
Turning reservation off, hiding Dock or quitting PLVS restores windows that remain where PLVS placed
them. Later user moves are preserved. After an abnormal exit, the next launch attempts guarded
recovery when Accessibility permission is available; unresolved windows retain local recovery data.

On Windows, the strip steps aside for full-screen windows the way the taskbar does. A full-screen
video or a borderless full-screen game on the Dock's display covers the strip, with or without
**Reserve Space**; the strip returns when that window leaves full screen or another window
takes the foreground. A full-screen window uses the whole display, so it cannot be made to leave
room for the strip. To watch the meters next to a video, keep the player in a maximised window —
with **Reserve Space** on, it stops at the strip.

Hover a Stats
readout or an icon-only Dock action for the same themed explanation shown in the normal workspace.

Dock's module-width and height resize lines stay hidden while idle, appear in Border Color on
hover or keyboard focus, and use Accent while you hold and drag them, matching Workspace split lines.
Drag the strip's inner edge to adjust its height; the outer edge stays anchored to the screen,
and the new height is saved when you release the pointer. Height starts at 150 CSS pixels. The
minimum fits three rows of Stats at the current **Interface Size**: 80 CSS pixels at the default
size, more at larger sizes. When the panels are wider than the screen, the minimum also leaves
room for the horizontal scrollbar. A strip shorter than the new minimum grows to it. The strip can grow up to the current display's available space minus room for the toolbar
and editor.
Oversized heights are fitted again when entering Dock on another display or restoring it.

Dock text follows **Interface Size**, using the same readout and label sizes as the normal
workspace. Resizing the strip changes the available chart space and spacing, not the font size.
Stats labels leave room for descenders, including the “g” in **Dlg Rng** and **Dlg Cov**,
with a normal label line height. The strip's minimum height accounts for the full row height.
The toolbar and panel settings also follow the selected text size. Stats adapts its columns and
rows to the available space and text size, with scrolling when all selected readings cannot fit.
Stats automatically reserves enough width for three rows of its selected readings at the current
text size. Stats fills as many readable columns as its width permits, then wraps into additional rows.
Changing Dock height keeps both panel widths and Stats columns stable; it changes the space around
the readings and whether vertical scrolling is needed.
Automatic width measures the selected labels and reserves a stable five-character
numeric column. All cells share the same label and numeric widths. Dialogue Coverage's activity dot
sits inside its row before the label, matching the normal Stats panel, without extending beyond
the column's left edge. Live value changes do not
change column widths. Channel-layout warnings do not take space from the three rows.
Dragging a divider beside Stats sets a manual preference; double-click that divider to restore
automatic sizing. A narrow display can still require vertical scrolling inside Stats.
The initial layout places Stats, Level Meter, Loudness, Waveform, Spectrogram, Spectrum,
Stereo Map and Vectorscope from left to right. Stats starts at 400 CSS pixels, with three columns
and five rows at the default Interface Size. Level Meter and Vectorscope start at 180 CSS pixels
each. The five timeline and frequency plots share the remaining width equally, starting from a
common 180-pixel preferred width;
Level Meter joins them when its bars run horizontally. Vertical Level Meter and Vectorscope retain
their preferred widths. There is no fixed 360-, 420-, or 960-pixel limit on widening a panel.

The five time/frequency plots and horizontal Level Meter start with a 180-pixel minimum, increased
for larger axis text. Vertical Level Meter reserves space for each channel's reading, and
Vectorscope reserves its correlation ticks. On short Peak/RMS Level Meters, the 0 dB reference label takes
priority over a nearby range-end label such as +3 so their text does not overlap; the range is unchanged.
Automatic Stats has priority when space is tight,
but can shrink once other panels reach their minimums. If all minimums exceed the display width,
the panel row scrolls horizontally; the toolbar button stays visible outside that row.

Hover readouts use the same layout rules in Dock and the workspace. They appear above axes with
an opaque background. Short panels arrange fields horizontally and wrap whole readings when
needed. If space is still insufficient, lower-priority details are omitted with an ellipsis;
Waveform reports the number of omitted channels. Text size stays unchanged, and hover readouts
do not introduce their own scrollbar or intercept chart gestures.
Loudness hover readings use the matching Momentary and Short-term trace colors, including their
snapshot colors when inspecting a snapshot.
Stereo Map hover values follow the curve's mode-specific colors, while Max Hold follows the
hold line's primary color. Frequency and unavailable readings stay neutral. Spectrum and Stereo
Map use crosshairs and readouts without an extra hover dot.

Dragging a divider starts from the displayed widths and changes only the adjacent pair on screen.
Double-clicking restores the pair's module defaults. Display and text-size changes fit saved
preferences without overwriting them, so returning to a wider display restores the preferred
layout. Reset Layout restores the default modules, order, widths, controls, and 150-pixel Dock height,
while preserving the selected edge, monitor, and space reservation. Saved layouts and heights otherwise
keep their existing values.

Spectrum shares the normal panel's range zoom/pan, press-and-hold smoothing, and Max Hold
contour-click reset. Grid, Peak Labels and hover readouts remain available at every Dock height. X/Y axes follow **Hide Axes & Labels** in Views.

Stereo Map also shares the normal panel's Grid, hover readout, frequency zoom and pan, and
click-to-Snapshot / double-click-to-Live gestures. Its axes and Position channel labels follow **Hide Axes & Labels**. Mono input shows the same explanatory message as the normal panel.
Vectorscope can be narrowed to a minimum based on **Interface Size**, reserving readable correlation
ticks when labels are shown, or reference markers and spacing when hidden. Changing Dock height does not change this minimum.
Existing preferred widths are preserved; drag a divider to reclaim unused side space.
Vectorscope uses the normal panel layout at every Dock height: the plot above the correlation
rail, without a separate numeric readout. It shares Lissajous Hold Slow,
Polar Sample persistence, and Polar Level Max Hold with the normal panel. Hold the Lissajous
plot to slow its display; click Polar Level to clear Max Hold. These gestures do not enter Snapshot.
Both panels display the shared Snapshot selection, and their settings remain independent of
normal workspace instances.
Dock keeps its own layout and panel settings, using the same Spectrum chart and interactions as
the workspace.

Click the Spectrum plot to enter Snapshot. Double-click the plot or use the right control area's
Return to Live action to return to live readings. Snapshot does not open the toolbar automatically.
The snapshot is shared by all Dock panels, and capture continues in the background. Switching between Dock and the normal window preserves the selected snapshot. A view
without retained data at that time shows an empty state instead of falling back to live data.
Loudness, Spectrogram and Waveform share the normal panels' renderers, settings and history
interactions, with X/Y axes controlled by Views. Loudness has no extra Dock readouts. Spectrogram offers 2D
and 3D at every height. Their Time Range is linked to the workspace by default, so switching forms
preserves the window and offset. Unlink Time Range to keep that Dock panel's own range; normal
panels with an unlinked range remain independent. Snapshot selection is shared regardless of linking.

Level Meter uses the same settings and layout in both forms, including Vertical or Horizontal
Orientation. Stats shows each reading on one line, label beside value, at every height. It fills
readable columns across the available width and wraps additional readings into rows; when the
height cannot fit those rows, scroll within Stats to see the remaining readings. No selected
metric is dropped. The separate Timecode module has been removed; transport actions remain in the
right control area, and the timecode is available in the normal window. Saved layouts automatically
discard old Timecode instances.

When several PLVS workbenches use Dock, only one can reserve a particular monitor edge on Windows,
or a particular monitor on macOS.
A second Dock on that same edge remains visible as an overlay and does not disturb the existing
reservation.
Top and bottom edges are independent on Windows. macOS allows one avoidance owner per display,
so two workbenches cannot resize and restore the same application window in competing orders.

The separate update window fits its content height; long release notes scroll.

When an update is available, downloading, ready, or has failed, a dot appears on the toolbar arrow
(red after a failure), and the toolbar shows the state in words beside its tools, for example
**Update Ready · v0.22.0** or **Downloading Update · 45%**. Clicking it opens the details in a
separate window, reusing the normal release notes and confirmation
actions. A failed installation also offers **Download Manually** on the left, while **Cancel** and
**Retry** stay on the right. Closing details keeps Dock active. The toolbar and any open settings editor retain their
state, and the strip keeps its width and height. Returning to the normal window transfers the same
selected update to its normal dialog. If the update window cannot open,
PLVS restores the normal window with the same details or unsaved update preferences.

### Frequency Linking

Dock Spectrum, Spectrogram and Stereo Map share the Workspace frequency range by default.
Their Frequency Range rows offer the same link toggle as ordinary panels. Changes from a linked
panel affect the group even when axes and labels are hidden. Unlinking keeps the visible range;
linking again adopts the shared range. Level and correlation ranges remain independent.

## Persistence

Your layout, presets, and view choices are remembered and restored the next time you open PLVS.
Measurement history is not: each launch starts a new session.
