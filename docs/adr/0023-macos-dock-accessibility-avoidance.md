# ADR 0023: macOS Dock uses opt-in Accessibility avoidance

## Status

Accepted

## Context

Windows Shell AppBar registration changes the available work area. AppKit exposes a read-only
`NSScreen.visibleFrame`; no public equivalent for registering an arbitrary third-party reserved
strip was found. Overlay Dock alone can cover the host application's controls.

## Decision

On macOS, Reserve Screen Space is an explicitly enabled Accessibility window-management service.
It fits the foreground application's standard window into the remaining visible area on the
Dock's monitor. It does not promise Windows AppBar behavior or support native full-screen Spaces.
Only the foreground window is considered, avoiding changes to hidden windows and other Spaces.

The service uses public AX attributes. AppKit display snapshots are taken on main, while bounded
AX requests and recovery-journal I/O run on a serial queue. A short poll waits for stable geometry
and mouse release instead of continuously fighting a drag or relying on application-specific AX
notification completeness. Failed fits are rolled back and suppressed until geometry changes.
An application can impose a minimum size even after an AX setter reports success.

PLVS checks permission under its own identity and requests it only after an explicit enable action.
Boot does not prompt. A process lease owns each monitor; journals are written before external
window changes. Normal exit/suspension and crash recovery restore only unchanged geometry in the
same process incarnation. Ambiguous or subsequently changed windows are never guessed.

Unlike Windows, top and bottom cannot have independent macOS avoidance owners on one display.
Otherwise one owner can resize a frame already changed by the other; exiting them in reverse
orders would invalidate the first journal and leave the second owner's saved intermediate size.
A single display owner prevents that restoration dependency.
If permission loss prevents restoration, the live owner retains its lease until recovery succeeds
or it exits; another workbench cannot take over while the first still owns recoverable frames.

## Consequences

The feature works without private WindowServer APIs but requires user-granted Accessibility access.
Avoidance has a brief settling delay, some applications cannot fit, and native fullscreen is outside
the contract. Recovery is guarded and best effort: a crash between native setters, a changed title
after a crash, unavailable permission or a closed/replaced host can prevent automatic restoration.
Recovery data is local to the application identity and contains window titles and geometry.

The Windows Shell implementation remains unchanged. The shared reserve-space field means the
platform service is enabled, not that every external window can be resized successfully.
