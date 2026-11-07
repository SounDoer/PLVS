# ADR 0056: Linux Prefers X11 for Dock Discoverability

Date: 2026-11-07

## Context

ADR 0054 enables Dock on capable X11/XWayland backends. GTK's default backend order nevertheless
starts PLVS as a native Wayland client on GNOME Wayland. Ordinary desktop launches therefore hide
the Dock selector even when that desktop offers a capable XWayland server. Requiring a terminal
environment override leaves the supported feature undiscoverable.

## Decision

Before Tauri initializes GTK, use GDK's backend preference API to request `x11,wayland,*`. Prefer
X11/XWayland, allow Wayland fallback when X11 is unavailable, and respect explicit `GDK_BACKEND`
settings. Do not change process environment variables or force an X11-only launch.

Keep ADR 0054's actual-backend capability checks and native Wayland refusal. Displaying an enabled
Dock selector on native Wayland would expose an operation the backend cannot perform.

## Consequences

Desktop, autostart, and development launches share the same default without packaging wrappers.
Users can still choose native Wayland explicitly. The Linux Dock smoke must clear inherited
backend overrides, verify default Dock availability and capture the normal Views menu, then
verify refusal in an explicitly selected Wayland instance.
