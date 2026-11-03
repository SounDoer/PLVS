# ADR 0046: A Filling Dock Strip Refuses Activation

**Status:** Accepted

**Date:** 2026-11-02

## Context

Over a full-screen window the Windows strip lays out against the whole monitor
([ADR 0045](0045-dock-full-screen-fills-the-edge-and-hides-instead-of-lowering.md)). When a real
mouse click made any PLVS window the foreground window, Shell ended full screen and showed the
taskbar, so the strip moved up to stay clear of it and moved back when the user returned to the
full-screen window. Users saw the strip jump on their first click.

Shell does not react this way to a focus change made by `SetForegroundWindow`, which is why scripted
checks missed it. Intercepting `WM_MOUSEACTIVATE` had no effect: the click lands in WebView2's
window, which activates the strip by another path.

## Decision

While the strip fills a full-screen monitor, the strip and the Dock toolbar are not focusable, set
through Tauri so its own bookkeeping of the window style keeps `WS_EX_NOACTIVATE`. Clicks on the
meters, on Start / Stop and on toolbar buttons reach the WebView without a PLVS window becoming the
foreground window, so Shell keeps full screen and the strip stays at the edge.

A toolbar opened this way has no focus to lose, and the full-screen window keeps the foreground, so
neither a blur nor a foreground change follows when the user clicks that window again. While the
strip fills and the toolbar shows, a low-level mouse hook reports any button press outside PLVS's
windows; a `SetWinEventHook` on `EVENT_SYSTEM_FOREGROUND` reports a switch such as Alt+Tab. The
frontend then closes the toolbar, and any open editor, without consulting the pages' own focus
state: WebView2 can report focus in a window that was never activated, and a window refusing
activation never sees the blur that would clear it. The mouse hook is installed only for that span
and reads only where a press lands.

The editors keep normal activation because they take text. Opening one may bring the taskbar back
and move the strip until the user returns to the full-screen window: Shell reacts only when the
foreground leaves the full-screen window itself, so it does not happen when another application
already had the foreground.

## Alternatives

- **Refuse activation in the editors too.** Gives up keyboard input in them.
- **Leave a toolbar opened over full screen open until its entry is clicked again.** Differs from
  the toolbar's behaviour everywhere else, which users read as a fault.
- **Keep filling while PLVS has focus and raise the strip over the taskbar.** Races Shell showing the
  taskbar, and hides the taskbar while the user works in PLVS.
- **Accept the jump.** Matches Shell's rule but makes the most common interaction, clicking the
  meters, move the strip.

## Consequences

- The strip and toolbar cannot take keyboard focus while the strip fills. Their controls are
  pointer-only and PLVS's shortcuts are global, so nothing depends on it.
- For as long as a toolbar shows over a full-screen window, PLVS observes where mouse buttons are
  pressed anywhere on the desktop.
- A Tauri change to the window's extended style while the strip fills would drop the flag until the
  next fill. Nothing changes those styles while docked; leaving Dock ends the fill first.
