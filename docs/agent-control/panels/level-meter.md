# Level Meter Panel Control

Status: Approved design; pending implementation

## Public controls

```json
{
  "mode": "peak",
  "playbackMax": false,
  "floatingValue": false,
  "tpMaxMarker": false,
  "levelRangeDbfs": { "min": -60, "max": 3 },
  "loudnessRangeLufs": { "min": -64, "max": 0 }
}
```

## Validation and availability

- `mode` is `peak`, `rms`, `momentary`, or `shortTerm`.
- Peak and RMS use `levelRangeDbfs`; Momentary and Short-term use `loudnessRangeLufs`. Both ranges
  are always returned so an agent can preconfigure a later mode.
- `levelRangeDbfs` is atomic, bounded by -60 and 3, and has a minimum span of 12 dB.
- `loudnessRangeLufs` is atomic, bounded by -64 and 0, and has a minimum span of 12 LU.
- `playbackMax` is effective for RMS, Momentary, and Short-term, but not Peak.
- `floatingValue` is effective for Momentary and Short-term.
- `tpMaxMarker` is effective for Peak.
- Updating a dormant mode-specific field is valid and returns `currentlyInactive` when that field is
  touched and remains inactive in the final state.

## Analysis

Level Meter does not need a panel-specific analysis request status.

## Reset and exclusions

Reset restores the values above. It does not clear TP Max or other measurements and does not alter
the active Profile.
