# ADR 0051: Dock Accessories Use Bounded Idle Retention

**Status:** Accepted

**Date:** 2026-11-05

Supersedes the indefinite Settings retention in
[ADR 0050](0050-dock-authoring-preserves-floating-editor-presentation.md). Its shared presentation,
main-owned drafts, ordered actions, and immediate authoring retirement remain in use.

## Context

Creating every accessory on first Dock entry and keeping it for the entire process lifetime makes
later interactions fast but retains renderers after returning to the ordinary window. Optimized
Windows measurements found three retained accessory renderers after using Settings and exiting
Dock. Immediate destruction on every close would instead charge frequent interactions for repeated
renderer startup and introduce races with pending edits and rapid form changes.

## Decision

Prepare the toolbar on Dock entry. Prepare the shared panel host only when its first panel is
requested. While Dock remains active, retain both for reuse. After Dock exits, allow a 60-second
warm interval, then retire both hosts. Re-entry cancels the timer. Serialize preparation with
retirement and re-evaluate any request received while a lifecycle operation was in flight.

The native retirement command checks the actual Dock flag and destroys both hosts in one UI-thread
operation. A stale request after native Dock re-entry is refused. Recreated hosts must complete the
existing readiness/render/measurement handshake before becoming visible.

Settings uses the same ordered idle acknowledgement as authoring, followed by a 60-second warm
interval. Start that interval only after outstanding business actions acknowledge completion.
Reopening cancels it. Authoring still retires immediately when idle. State, drafts, persistence,
and audio ownership remain in main; retiring a presentation does not stop capture or discard edits.

## Consequences

- Short reopen/re-entry sequences keep their existing warm hosts.
- Never opening a Dock panel avoids its renderer, and extended ordinary-window use releases idle
  Dock toolbar, panel, and Settings hosts.
- A later first use creates a new renderer and pays its startup cost. Geometry and focus continue
  through the normal readiness handshake rather than showing incomplete content.
- Resource reclamation by the browser runtime is asynchronous; no fixed immediate RAM saving is
  promised. Optimized desktop acceptance must confirm renderer counts and actual process memory.
- Update and Import retain their existing lifetimes until separately measured and reviewed.
