# Vectorscope Panel Control

Status: Approved design; pending implementation

## Public controls

```json
{
  "channelPair": { "x": 0, "y": 1 },
  "mode": "lissajous",
  "maxHold": false
}
```

## Validation and availability

- `channelPair.x` and `channelPair.y` are integer channel indices within the current topology,
  with `x < y`.
- Every distinct pair is valid. Common pairs may be sorted first in the UI, but the API does not
  limit callers to that shortlist.
- Invalid or reversed pairs are rejected; the API does not swap or clamp them.
- Before topology detection, PLVS exposes assumed stereo L/R.
- `mode` is `lissajous`, `polarSample`, or `polarLevel`.
- `maxHold` is only effective in `polarLevel`. It may be preconfigured in another mode and then
  returns `currentlyInactive` if touched while the final mode remains inactive.

## Analysis

Channel pair determines request identity; mode and Max Hold do not. Vectorscope has its own request
family. Identical pair keys share one analysis request, every distinct valid pair is sent to the
backend, and there is no request-count cap. The panel reports whether its request is active or
waiting for channel availability.

## Reset and exclusions

Reset restores L/R, Lissajous, and Max Hold off. Clearing accumulated Polar Level Max Hold is a
transient chart action and is outside Panel Control.
