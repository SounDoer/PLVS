# macOS Dock Toolbar Hover Before the First Click

## Failure

The Dock toolbar showed no hover tips until it had been clicked. Normal mode worked. The
previous tooltip cleanup fixed retained React state but did not address native event delivery.
The attempted mouse-move fallback was discarded after the same failure persisted.

`set_dock_accessories` showed the toolbar without making it key. A disposable AppKit/WebKit probe
using the production presentation bridge reproduced zero page mouse-move events with a non-key
toolbar and nonzero events after making the nonactivating Panel key. No click was sent. This is
consistent with [WebKit's inactive-window mouse-event policy](https://bugs.webkit.org/show_bug.cgi?id=187545).

## Change

On macOS only, the existing show-once focus path now makes the toolbar key. The Panel remains
nonactivating. Repeated updates of a visible toolbar retain editor focus. Windows retains its
existing focus policy, including the full-screen activation restrictions in ADR 0046.

The native probe is part of `scripts/smoke-macos-dock-lifecycle.mjs`. It delivers mouse movement
through WebKit's native tracking-area owner rather than posting system input, so it needs no
Accessibility grant. It checks initial hover, reopening, preserving editor focus, and retaining
the foreground application. It does not simulate physical pointer movement or prove native
full-screen Space behavior.

## Validation

The debug Dev bundle builds successfully; the focused frontend/documentation tests (69), Rust
accessory tests (2), and Rust formatting pass. All 23 packaged native lifecycle scenarios pass,
including the hover probe and real idle-retirement deadlines.

Agent Control screenshots from the running Dev app independently confirm Settings hover without
clicking, disappearance when moving back to the strip, a clean toolbar after closing/reopening,
and a new Panels tip on pointer movement after reopening. These are actual PLVS pixels, separate
from the disposable WebKit probe. Native probe output, lifecycle results, and screenshots are
saved under `artifacts/dock/2026-11-07-toolbar-hover/`.
