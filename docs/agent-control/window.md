# Window Control

Window Control reads the main window and changes the two things about it a user changes outside
Settings: its size and whether it is shown. Position, monitor placement, maximize and window chrome
stay out of scope; chrome belongs to [View Control](view.md) and the Dock strip to
[Dock Control](dock.md).

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

## Inspection

`window inspect` reports the window form (`normal` or `dock`), whether the window is visible, whether
it is maximized, its inner size in CSS pixels, the webview's device pixel ratio, and the current
monitor's work area in CSS pixels. A screenshot of the `main` target has the inner size multiplied
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

## Visibility

`window hide` and `window show` are the tray's Hide and Show. Hide saves pending state first, as the
tray does, and fails with `busy` while an update is installing. In Dock, Hide suspends the strip
and Show restores it. Show also brings a visible but minimized or covered window forward, so it
always acts; `changed` reports whether visibility itself changed.

## Revision

All four commands leave the global revision unchanged: window geometry and visibility are not part
of `app.inspect`. The three actions still require `--expected-revision`, so they are refused when
the app changed since the caller last looked, and they have no dry run.
