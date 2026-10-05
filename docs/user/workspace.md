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

## Modules and presets

The **Modules** menu adds panels, including a second instance of a meter you want to watch two ways
at once. The **Presets** menu saves and switches between whole layouts. When none exist yet, name
your first Preset in the create field and select **Save**.

Toolbar configuration entries such as Loudness Profile, Views, and Presets remain neutral while
closed, even when their configuration is active. Hover and an open menu use the same neutral
background and brighter icon. Inspect the menu for the selected configuration and modified state.
The same convention applies in Dock. Direct feature toggles retain their on/off indication;
Reserve Screen Space uses a solid top divider when enabled and a dashed top divider when disabled.
Both states use the same neutral icon color at rest, without a persistent highlight.

## Snapshot

Click any point on a history chart to freeze every meter at that moment, then return to live with one
click. Useful for inspecting a peak you only heard go by.

## Views

The Views menu pares the window down for monitoring: **Always on Top**, **Compact Panels**,
**Hide Chrome**, **Auto-hide Controls**, **Surface Opacity**, and **Glass**. Surface Opacity changes
the transparency of Workspace, panel, and Dock fills; text, measurement data, states, focus rings,
controls, and borders remain opaque for legibility.

On macOS, setting **Surface Opacity** to 0 also removes the native window shadow. This prevents
AppKit from drawing shadow-shaped outlines around the remaining opaque text and meter graphics;
raising Surface Opacity above 0 restores the normal window shadow.

On Windows 11, **Hide Chrome** also hides the outer system window outline; turning it off restores
the system outline. **Auto-hide Controls** also uses a chromeless window, so the outline stays hidden
while that mode is enabled. Normal windows retain their native shadow in either mode.

## Dock

On Windows, Dock parks a slim, always-on-top meter strip against the top or bottom edge of the
screen, so the meters stay visible while you work in another app. Hovering the strip shows a header
for switching the Loudness Profile and editing which modules the strip shows. The strip can also
reserve its screen space so maximised windows do not cover it. Hover a Stats readout or an icon-only
Dock action for the same themed explanation shown in the normal workspace.

Dock's module-width and height resize lines stay hidden while idle, appear in Border Color on
hover or keyboard focus, and use Accent while you hold and drag them, matching Workspace split lines.

When several PLVS workbenches use Dock, only one can reserve a particular monitor edge. A second
Dock on that same edge remains visible as an overlay and does not disturb the existing reservation.
Top and bottom edges are independent.

## Persistence

Your layout, presets, and view choices are remembered and restored the next time you open PLVS.
Measurement history is not: each launch starts a new session.
