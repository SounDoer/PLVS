# ADR 0044: The Dock Stays Above Full-Screen Windows by Default

**Status:** Accepted

**Date:** 2026-11-02

## Context

On Windows the Dock strip is a topmost AppBar. Shell lowers its own taskbar when a full-screen
window takes the display but only notifies other AppBars through `ABN_FULLSCREENAPP`. On
2026-10-12 PLVS began handling that notification so the strip stepped behind full-screen video and
borderless full-screen games, as the taskbar does.

A user then asked whether PLVS stays visible over full-screen applications and whether Dock can
still reserve space there. Someone who parks meters in a Dock wants them resident; stepping aside
hid them exactly while another application filled the screen. Meanwhile the normal window with
**Always on Top** already stays above borderless full-screen windows.

## Decision

The strip stays above full-screen windows by default. An **Above Full Screen** switch in Dock
**Views** restores stepping aside. The switch is part of the Preset scene, like every other Views
option, and is stored in the Rust-owned `dockState` with a default of on.

Shell reports full-screen windows only on transitions, so PLVS keeps the last report and derives
the yield from it and the switch. A change therefore applies while a full-screen window is open.

Portable Presets write the field only when it is off, so Presets that leave it on stay readable by
earlier releases; the rule for adding portable Preset fields is in `docs/website-and-sharesets.md`.

Windows ships first. macOS needs the strip to join another application's full-screen Space, which
is a separate experiment; until then the value is stored there without effect.

## Alternatives

- **Keep stepping aside.** Matches the taskbar, but hides the meters precisely when a user who chose
  Dock wants them.
- **A global preference outside Presets.** Smaller to build, but every other option in the same menu
  is part of the scene, and a menu that mixes the two cannot be explained.
- **Reserve space for full-screen windows.** Not possible: a full-screen window covers the whole
  display by definition and ignores the work area that **Reserve Space** shrinks. Resizing another
  application's full-screen window would fight that application and break its full-screen state.

## Consequences

- Upgrading Windows users see the strip over full-screen windows; the release notes must say so.
- The strip covers an edge of a full-screen window instead of pushing it aside.
- Exclusive full-screen applications bypass desktop composition, and no topmost window appears over
  them.
- The default cannot change later without a portable Preset format change, because an omitted
  field means on.
