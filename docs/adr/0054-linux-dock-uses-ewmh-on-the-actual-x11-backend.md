# ADR 0054: Linux Dock Uses EWMH on the Actual X11 Backend

Date: 2026-11-05

## Context

Linux previously disabled Dock everywhere because native Wayland lacks a common cross-desktop
positioning and work-area contract. Ubuntu's GNOME compositor does not advertise Layer Shell.
However, a Wayland session can run PLVS as an XWayland client. On Ubuntu 24.04 / GNOME 46,
an XWayland Dock's EWMH strut reduced the work area of both X11 and native Wayland applications.
A GTK3 Dock containing WebKitGTK also rendered successfully in this configuration.

## Decision

Discover the actual GDK display backend and required EWMH atoms after GTK initializes. Enable Dock
on supported X11/XWayland clients, independently of `XDG_SESSION_TYPE`. Send that capability in
the immutable boot snapshot to all renderers. Native Wayland remains unsupported; changing a
frontend platform allowlist alone must never enable it.

Keep the shared Dock business functions, geometry, scene guards, persistence, and Agent Control.
Add a Linux native boundary for GTK window type hints and EWMH struts. Reserve only the main strip,
using root coordinates and the horizontal range of its display work area. Reuse per-monitor/edge
reservation leases. Clear the reservation before suspension or exit and restore the normal type
before normal-window geometry. The compositor releases a dead X client's reservation.

Do not promise Above Full Screen from an ordinary above-window hint. Linux keeps this control
unavailable until native full-screen behavior has an implementation and acceptance evidence.
Reject reservation on vertically interior monitor edges, where root-edge struts could reserve
unrelated screen space; overlay mode remains usable there.

## Consequences

Ubuntu users can use Dock without a GNOME extension or changing their desktop session. Native
Wayland PLVS windows remain unsupported. A future Layer Shell implementation needs a separate
surface lifecycle and desktop coverage; it cannot be enabled by detecting Wayland alone.

The Linux adapter must be tested for toolbar/editor focus, scale and display changes, reserved
height previews, suspension, restart, and crash cleanup. Remote-desktop acceptance identifies
the actual session and does not stand in for local multi-monitor and full-screen acceptance.
