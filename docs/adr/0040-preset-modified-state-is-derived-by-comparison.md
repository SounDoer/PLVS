# ADR 0040: The Preset modified state is derived by comparison

## Status

Accepted (2026-10-27).

## Context

The active Preset shows a modified mark when the scene no longer matches it. It was a persisted
`dirty` flag set by every mutation path that touches a snapshot field and cleared by Apply, Save
and Update. About twenty call sites set it, and nothing compared state. Changing a value and
changing it back left the Preset modified, and every native move or resize marked it, so
minimising and restoring the window, with identical bounds, made the Preset modified with no
visible change. Each new snapshot field also needed its own hand-placed mark, and a missed one
failed silently.

## Decision

`dirty` is computed, not stored: the active Preset is modified exactly when the current scene,
projected through the same rules Apply uses to restore a Preset, differs from the Preset projected
the same way. Fields Apply does not restore are not compared: absent optional fields of an older
Preset, the strip layout and Dock presentation of a Dock-disabled Preset, and window bounds of a
Dock-enabled one. Both sides go through today's normalizers.

Window bounds take part and are compared exactly, from the bounds Rust persists and emits, which
already exclude minimised and docked states. A channel selection rewritten by the device clamp
still reads as modified, because the live selection really differs from the stored one.

Keeping the flag and fixing its call sites was the obvious simpler choice. It was rejected because
the defect is structural: a flag records that a setter ran, not that the scene differs, so it cannot
clear on a return to the Preset's values. It also stays correct only while every future mutation
path remembers to set it.

## Consequences

- A comparison runs on every relevant state change, including each pointer move of a drag. Its cost
  must be measured; the fallback is deferring it, not reintroducing marks.
- The comparison must follow Apply. A field added to the snapshot, or a change to what Apply
  restores, must change the projection in the same commit, guarded by apply-then-clean round-trip
  tests.
- Floats such as split ratios and axis viewports compare exactly, so dragging back to approximately
  the same place stays modified.
- A destructive device clamp keeps making the Preset modified until it is fixed separately.
- Stored `dirty` values from earlier versions are ignored.
