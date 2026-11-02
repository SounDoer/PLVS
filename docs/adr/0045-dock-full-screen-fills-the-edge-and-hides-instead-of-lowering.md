# ADR 0045: The Dock Fills the Edge Over Full Screen and Hides Instead of Lowering

**Status:** Accepted

**Date:** 2026-11-02

## Context

[ADR 0044](0044-dock-stays-above-full-screen-windows.md) keeps the Windows strip above full-screen
windows by default, with **Above Full Screen** off restoring the older behaviour of stepping
behind them. Two problems surfaced in use:

- Over a full-screen window the strip stayed where the work area put it, one taskbar height above
  the display edge, so a band of the full-screen window showed below it.
- With the switch off, the strip stepped behind by moving to the bottom of the z-order, which drops
  its topmost style. Windows silently refuses to return a window to the topmost band unless its
  process is in the foreground, and when a full-screen window closes PLVS usually is not. The strip
  then stayed behind every window until Dock was re-entered.

Shell's `ABN_FULLSCREENAPP` was also unreliable as the only signal: it reports full-screen windows on
other monitors, and never reports one gone to a registration made while it was open.

## Decision

While a full-screen window owns the Dock's monitor:

- With **Above Full Screen** on, the strip lays out against the whole monitor instead of the work
  area. Shell's reservation is unchanged; only the window moves, and open accessories move with it.
- With it off, the strip is hidden and shown again afterwards. It never leaves the topmost band.

Shell's notification is a cue to look. A report starts only when the first ordinary window in the
z-order on the Dock's monitor, looking past PLVS's own windows, click-through overlays and
always-on-top windows that do not cover the monitor, covers that monitor. Shell's "gone" always
ends a report, and the same check repeats every 500 ms while one stands.

## Alternatives

- **Restore the topmost style by activating the strip.** Windows allows it from the foreground, but
  taking focus from the user's application on every full-screen exit is worse than the bug.
- **Detect full screen from the foreground window.** Focusing the strip itself would then end the
  report, while Shell keeps the taskbar hidden; the strip would jump under the pointer.
- **Trust our own check over Shell's "gone".** A maximized window over an auto-hidden taskbar covers
  the monitor without being full screen, and would keep a hidden strip hidden.

## Consequences

- While hidden, the strip reports itself not visible to `window inspect` and diagnostics, and its
  WebView stops painting until it returns.
- Another always-on-top AppBar on the same edge, if one stays above full-screen windows too, can
  overlap the strip while it fills the edge.
- Suspending Dock while the strip is hidden shows it for an instant before suspension hides it.
