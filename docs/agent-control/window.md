# Window Control

Window Control reads the main window and changes what a user changes about it outside Settings: its
size, its position and monitor, Maximize / Restore / Minimize, and whether it is shown. Window
chrome belongs to [View Control](view.md) and the Dock strip to [Dock Control](dock.md).

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

## Inspection

`window inspect` reports the window form (`normal` or `dock`), whether the window is visible, whether
it is maximized or minimized, the current `monitor` ID, its `position` as the CSS-pixel offset of its
top-left corner from that monitor's work-area origin, its inner size in CSS pixels, the webview's
device pixel ratio, and the current monitor's work area in CSS pixels. `monitors` lists every
connected monitor's ID and work-area size in its own CSS pixels: the choices `window move` accepts.
Monitor IDs are the same names Dock Control uses, read again for every request. A screenshot of the `main` target has the inner size multiplied
by the device pixel ratio.

## Size

`window resize --width --height` sets the normal window's inner size in integer CSS pixels, from 320
through 7680, keeping its top-left corner where it is. It uses the same native bounds path that
restores a Preset's window: a maximized window is restored first, the size is applied in the order
that stays correct across monitors with different scale factors, and the result is saved as the
window's remembered bounds.

A size whose window, including its frame, would not fit the current monitor's work area fails with
`windowSizeUnavailable` before anything changes. It is never silently shrunk, so a screenshot or
recording taken afterwards has the requested size. Dock has no resizable window; the request fails
with `dockActive`. Requesting the current size returns `changed: false` without touching the window.
The command settles when the webview reports the requested size, within one pixel for fractional
scale factors, and fails with `uiNotSettled` otherwise.

## Position

`window move --monitor --x --y` places the window's top-left corner at a CSS-pixel offset from the
named monitor's work-area origin, the same coordinate `window inspect` reports. The window keeps its
CSS inner size, so on a monitor with another scale factor its physical size follows that factor. It
uses the bounds path `window resize` uses: a maximized window is restored first and the result is
saved as the window's remembered bounds.

A monitor that is not connected fails with `monitorNotFound`. A position at which the window,
including its frame, would leave that monitor's work area fails with `windowPositionUnavailable`
before anything changes; it is never clamped elsewhere. A minimized window fails with
`windowMinimized`; show it first. Dock fails with `dockActive`. The current position returns
`changed: false`. The command settles when the window reports that monitor and offset, within one
pixel, and fails with `uiNotSettled` otherwise.

## Maximize, Restore and Minimize

`window maximize`, `window unmaximize` and `window minimize` do what the title bar's buttons do,
through the same native window calls; the window remembers the result as it does after a click.
Each returns `changed: false` when the window is already in that state. A hidden window fails with
`windowHidden`, and Maximize or Restore of a minimized window fails with `windowMinimized`: use
`window show`, which brings a minimized window back. Dock fails with `dockActive`. Each settles when
the window reports the new state and returns the full inspection.

## Visibility

`window hide` and `window show` are the tray's Hide and Show. Hide saves pending state first, as the
tray does, and fails with `busy` while an update is installing. In Dock, Hide suspends the strip
and Show restores it. Show also brings a visible but minimized or covered window forward, so it
always acts; `changed` reports whether visibility itself changed.

## Revision

Window commands leave the global revision unchanged: window geometry and visibility are not part
of `app.inspect`. The actions still require `--expected-revision`, so they are refused when the app
changed since the caller last looked, and they have no dry run.
