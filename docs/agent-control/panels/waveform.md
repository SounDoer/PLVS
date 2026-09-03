# Waveform Panel Control

Status: Approved design; pending implementation

## Public controls

```json
{
  "frequencyColor": false,
  "frequencyBandsHz": { "lowMid": 200, "midHigh": 2000 },
  "centroid": false
}
```

## Validation and availability

- `frequencyBandsHz` is atomic. Both values are integers and must satisfy
  `20 <= lowMid < midHigh <= 20000`.
- When `frequencyColor` is false, the frequency split controls are hidden in the GUI and do not
  affect the display. Updating them is still valid so an agent can preconfigure Frequency Color.
- If `frequencyBandsHz` is touched and Frequency Color remains off in the final state, the result
  includes `currentlyInactive` with reason `frequencyColorOff`.
- Updating the bands in the same patch that enables Frequency Color does not warn.
- Merely turning Frequency Color off does not emit a warning about untouched stored bands.

The time axis is read-only within Panel Control and writable through
[`../axes.md`](../axes.md).

## Analysis

Frequency Color and Centroid independently request the same global `spectralWaveform` analysis. The
analysis is active if either feature on any relevant surface needs it, and not requested when none
does. It is one shared boolean request rather than a keyed request family.

Panel description and application inspection report the panel's demand separately from the shared
runtime:

```json
{
  "analysis": {
    "spectralWaveform": {
      "requestedByPanel": true,
      "runtime": "active"
    }
  }
}
```

`requestedByPanel` is true when this panel enables Frequency Color or Centroid. `runtime` is
`active` when any relevant panel requests the shared analysis and `notRequested` otherwise. A panel
may therefore report false/active when another panel is the requester. Application runtime also
provides one global Spectral Waveform summary.

## Reset

Reset restores the values above and the default linked time-axis state. If this panel was the final
requester, shared spectral Waveform analysis becomes unrequested. Reset does not clear Waveform
history or change the shared Workspace time range.
