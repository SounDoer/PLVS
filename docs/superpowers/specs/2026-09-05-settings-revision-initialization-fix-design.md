# Settings Revision Initialization Fix

Date: 2026-09-05
Status: Approved

## Problem

Settings revision tracking currently waits for both autostart and clear-shortcut capability
hydration. If either capability stays unavailable, unrelated Settings changes are applied but never
advance the global revision, wake waiters, or settle a `settings.update` request.

## Design

Track Settings in three independent parts:

1. ordinary settings, which are meaningful from the first render;
2. `openAtLogin`, which begins tracking after autostart hydration;
3. `clearShortcut`, which begins tracking after shortcut hydration.

The first ready value of each capability-owned field establishes its baseline without advancing
revision. Later changes advance revision normally. Capability readiness never gates ordinary
Settings tracking.

Settlement remains based on the complete normalized Settings signature. A successful update to an
ordinary setting therefore settles even while either optional capability is unavailable.

## Tests

- Keep the existing assertion that initial capability hydration does not advance revision.
- With autostart permanently unready, update `interfaceSize`; assert success, revision `1`, one
  persistence flush, and the changed final state.
- With clear-shortcut permanently unready, repeat the same assertion for `closeBehavior`.
- Verify a revision waiter is released by an ordinary Settings change under partial capability
  readiness.

Run the focused bridge suite and the complete merge gate.
