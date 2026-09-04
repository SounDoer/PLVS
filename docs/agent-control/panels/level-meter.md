# Level Meter Panel Control

Status: Implemented.

## Public controls

Fields, types, units, defaults and bounds are generated from the schema:
[`../generated/panel-levelMeter.md`](../generated/panel-levelMeter.md). This page carries the
behaviour that a schema cannot state.

## Validation and availability

- Peak and RMS use `levelRangeDbfs`; Momentary and Short-term use `loudnessRangeLufs`. Both ranges
  are always returned so an agent can preconfigure a later mode.
- `playbackMax` is effective for RMS, Momentary, and Short-term, but not Peak.
- `floatingValue` is effective for Momentary and Short-term.
- `tpMaxMarker` is effective for Peak.
- Updating a dormant mode-specific field is valid and returns `currentlyInactive` when that field is
  touched and remains inactive in the final state.

## Analysis

Level Meter does not need a panel-specific analysis request status.

## Reset and exclusions

Reset restores the generated defaults. It does not clear TP Max or other measurements and does not alter
the active Profile.
