# Dock Sizing

**Date:** 2026-07-14
**Status:** Implemented.

## Goal

Make Dock sizing user-adjustable before module-by-module visual refinement:

- the strip height is adjustable from its inner screen edge;
- adjacent Dock panels can be resized from their divider;
- sizing survives restart and Dock preset round-trips;
- resizing remains predictable across edges, monitors, and DPI scales.

This extends, rather than rewrites, the implemented v1 design in
`2026-07-11-dock-mode-design.md`, where adjustable sizing was intentionally
deferred.

## Height contract

| Property                  | Decision                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Unit                      | Logical (DPI-independent) pixels                                                             |
| Minimum                   | 56                                                                                           |
| Default / legacy fallback | 72                                                                                           |
| Maximum                   | 160                                                                                          |
| Handle                    | Inner screen edge: bottom Dock uses its top edge; top Dock uses its bottom edge              |
| Pointer interaction       | Continuous window-only preview; commit AppBar reservation and persistence on pointer release |
| Keyboard interaction      | Arrow keys change 4px; Shift+Arrow changes 16px                                              |
| Reset                     | Double-click the height handle to restore 72px                                               |
| Editor interaction        | Height resize is disabled while an accessory editor is open                                  |

Rust remains the single owner of Dock window geometry. `dockState.height`
stores the logical height and defaults to 72 when absent. Rust clamps every
input before converting it to physical pixels. On Windows, AppBar overlay and
reserved-space positioning use the same resolved height.

Dock presets capture `height`; legacy presets without it retain the current
height when applied. Entering Dock without an explicit preset height uses the
persisted Rust value.

### Height presentation tiers

Dock modules resolve the clamped height into three presentation tiers. These
tiers change composition only; metric selection, ordering, and measurement
semantics remain unchanged.

| Tier     | Height  | Presentation                                                              |
| -------- | ------- | ------------------------------------------------------------------------- |
| Compact  | 56-63   | Existing densest layout                                                   |
| Standard | 64-119  | Existing horizontal layout                                                |
| Expanded | 120-160 | Richer vertical composition where the module has height-specific readouts |

The frontend follows the pointer's preview height immediately, including tier
changes. Preview height is render-only: the persisted Dock height, accessory
geometry version, preset dirty state, and AppBar reservation update only when
the resize is committed.

In Expanded mode, Level global readouts, Loudness M/ST/I, and Stats metrics
use a shared two-line label plus value-and-unit treatment. Loudness places its
history above a three-column readout footer. Vectorscope places a square scope
above a full-width correlation rail and axis. Level's `PK` remains a detector
mode label; only `L` and `R` identify meter channels.

## Panel width contract

Each Dock panel instance has an optional persisted logical-pixel basis keyed by
`panelId`. Module registry entries define `minWidth`, `defaultWidth`,
`maxPreferredWidth`, and `growthPolicy`.

- `minWidth` is the hard rendering floor needed to keep the module usable.
- `defaultWidth` is the initial and double-click reset width.
- `maxPreferredWidth` caps user-resized and persisted preferred widths. It is
  not a rendered CSS maximum: a flexible panel may still render wider when it
  absorbs otherwise unused strip space.
- `growthPolicy` is either `fixed` or `flexible`. Fixed panels retain their
  preferred width; flexible panels share unused strip width.

- Dragging a divider changes only the two adjacent visible panels.
- The pair's total width remains constant during a drag.
- Neither panel may cross its module `minWidth`.
- Neither panel's preferred basis may cross its module `maxPreferredWidth`.
- No horizontal scrollbar is introduced.
- Flexible panels may absorb unused strip width after explicit bases are
  applied, including beyond `maxPreferredWidth`; fixed panels retain their
  basis.
- A double-click resets the adjacent pair to module defaults.
- Arrow keys move the divider by 4px; Shift+Arrow moves it by 16px.
- Resizing is disabled while an accessory editor is open.
- Adding a panel uses its module defaults. Removing a panel removes its size.
- Reordering a panel moves its size with its stable `panelId`.
- On a narrower monitor, rendering clamps and redistributes locally without
  overwriting the saved preferred bases.

Panel bases are stored under `workspaceStore.dock.panelSizesById`. Dock presets
capture the same map. Legacy persisted layouts and presets normalize to an
empty map and therefore use registry defaults.

## Interaction appearance

Resize handles are visually quiet until hover or keyboard focus. They use
separator semantics and remain independently operable from module content.
The existing module boundary remains visible when the handle is idle.

## Testing and validation

- Rust unit tests: height clamping/defaulting/serialization and physical strip
  geometry at multiple scale factors.
- Frontend unit tests: Dock state normalization, height IPC, preset capture and
  apply, panel-size normalization, adjacent resize and reset.
- Component tests: correct handle orientation, pointer resize, keyboard resize,
  and editor-open suppression.
- Manual Windows validation: top/bottom, reserve-space on/off, restart,
  monitor switch, preset round-trip, and rapid resize without AppBar drift.
