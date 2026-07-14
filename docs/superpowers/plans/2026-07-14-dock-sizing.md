# Dock Sizing Implementation Plan

**Goal:** Implement the approved Dock height and per-panel width contracts in
`docs/superpowers/specs/2026-07-14-dock-sizing-design.md`.

## Slice 1: Adjustable Dock height

- Extend Rust `DockStateRecord` with backward-compatible logical `height`.
- Route height through `enter_dock`, overlay geometry, AppBar reservation, and
  a dock-only `set_dock_height` command.
- Add the IPC seam and `useDockMode` mirrored state/actions.
- Add the inner-edge resize handle with pointer, keyboard, and reset behavior.
- Capture/apply height in Dock presets.
- Add Rust, hook, IPC, preset, and component tests.

## Slice 2: Adjustable panel widths

- Add registry sizing metadata for every Dock module.
- Normalize `panelSizesById` with layout additions/removals and legacy data.
- Persist size preferences in `workspaceStore.dock` and Dock presets.
- Render adjacent separator handles and implement local pair resizing, keyboard
  adjustment, and pair reset.
- Preserve flexible-module growth while honoring explicit bases and minimums.
- Add layout, hook, preset, registry, and component tests.

## Verification

- Run targeted Vitest suites while implementing each slice.
- Run Rust formatting, Clippy, and tests after native changes.
- Run the full `npm run check` gate.
- Manually verify top/bottom Dock, Reserve space, restart, monitor switch,
  Level/Spectrum resizing, and Dock preset round-trip.
