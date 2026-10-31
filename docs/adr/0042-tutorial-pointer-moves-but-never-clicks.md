# ADR 0042: The Tutorial Pointer Moves but Never Clicks

**Status:** Accepted

**Date:** 2026-10-31

## Context

PLVS tutorials are recorded unattended through Agent Control. A viewer needs to see a pointer travel
to each control before it is operated, and hover feedback, hover tips and the chart hover probe only
appear when a real pointer rests on an element. Agent Control already performs every operation
through the application's own business functions and deliberately exposes no click, selector or
coordinate API, because a generic input path can reach Delete, Send or Install and cannot be
guarded semantically.

Recording already captures the system pointer on Windows and macOS. Nothing moved it.

## Decision

Agent Control may move the operating-system pointer, and nothing else. `pointer move` takes a
target that a mounted component declared by name, resolves it inside the main WebView and moves the
pointer to its centre along an eased path. It never presses or releases a button, scrolls, or sends
a key. The state change that follows is a separate, ordinary Agent Control command.

Windows moves the pointer with `SetCursorPos`. macOS warps it with `CGWarpMouseCursorPosition` and
posts a mouse-moved event so the WebView sees hover; posting requires Accessibility trust and is
silently dropped without it. Linux advertises no pointer movement.

## Alternatives

- **A synthetic pointer drawn in the edit.** It needs no system access, but every hover effect would
  have to be recreated by hand, and the drawn pointer and the real UI can disagree.
- **Injected clicks.** The simplest way to drive a tutorial, rejected because injected input lands
  wherever the system sends it: on 2026-10-12 injected clicks reached other applications. It would
  also bypass every semantic guard Agent Control relies on.

## Consequences

- A pointer move takes the user's pointer, so the command is for unattended recording.
- Targets are named by the components that own them; the vocabulary grows with the UI and never
  accepts labels or coordinates.
- Press-and-hold and drag gestures are reproduced by commands, with the pointer travelling over the
  same area.
