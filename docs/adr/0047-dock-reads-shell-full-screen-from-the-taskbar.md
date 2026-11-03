# ADR 0047: The Dock Reads Shell's Full-Screen State From the Taskbar

**Status:** Accepted

**Date:** 2026-11-03

## Context

[ADR 0045](0045-dock-full-screen-fills-the-edge-and-hides-instead-of-lowering.md) starts a
full-screen report from Shell's `ABN_FULLSCREENAPP` and repeats a z-order check while it stands.
Shell's notification follows Shell's own state, which changes only when the foreground moves, and
that left the strip out of step with the taskbar it replaces:

- Entering Dock, or moving it to another monitor, after a full-screen window took that monitor:
  Shell sends nothing, so the strip never filled.
- A window from the neighbouring display reaching over one corner of the full-screen window: the
  z-order check stepped the strip back while Shell kept the taskbar hidden, leaving a band of the
  full-screen window below the strip.
- Opening a PLVS editor: Shell ended full screen and showed the taskbar, while the full-screen
  window was still the first window below PLVS's own.

A z-order check alone cannot tell these apart from the cases it must follow. Clicking PLVS over a
full-screen window to enter Dock ends Shell's full screen with the same z-order.

## Decision

Where a Shell taskbar shows on the Dock's monitor, Shell's state read from that taskbar decides:
Shell drops the taskbar's topmost style and moves it under the full-screen window for exactly as
long as it treats the monitor as full screen, wherever the foreground goes on other monitors. The
strip fills, or hides, while the taskbar there is not topmost.

- Starting to watch, which covers entering and resuming Dock and moving it to another monitor or
  edge, looks once: a full-screen window first in the z-order and a lowered taskbar start a report
  without a notification. The look does not run after Shell's "gone", when the taskbar may not be
  topmost yet.
- While a report stands, the 500 ms check follows the full-screen window until it closes, hides or
  stops covering the monitor, and steps the strip back whenever the taskbar is topmost again.
- On a monitor without a taskbar, Shell's notification and the z-order decide as before.

## Alternatives

- **Notifications and the z-order alone.** Leaves the three cases above wrong.
- **`SHQueryUserNotificationState`.** Describes the foreground application, not a monitor.
- **Poll Shell's state for as long as Dock is on.** Catches every change, but keeps a timer running
  for hours with nothing on screen to follow; Shell notifies every change that starts full screen.

## Consequences

- PLVS depends on Shell's observable handling of its taskbars, not on a documented contract,
  observed on Windows 11 23H2. A Windows release that kept the taskbar topmost over full-screen
  windows would make the strip step back from them within 500 ms of each report on monitors with a
  taskbar; the `dock full-screen window covered` log line right after a report marks it.
- A full-screen window covered by another window when Dock starts watching is not found until Shell
  next reports full screen.
