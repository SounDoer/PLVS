# ADR 0013: Adjustable Stereo Map Position color blend

## Status

Accepted

## Context

Stereo Map Position maps per-band left/right power balance onto the Theme's Primary and Secondary
data colours. Blending those colours over the full `-1` through `+1` position range is continuous,
but complementary Theme colours can produce a broad, muddy centre region. Adding a third centre
colour would introduce another semantic category where the measurement has only two channel sides.

## Decision

Add the panel display setting **Color Blend**, defaulting to 50% with a 0–100% range and 1% step.
The percentage controls the half-width of the colour-transition region around centre:

- 0% switches directly from Secondary below zero to Primary at and above zero;
- 50% blends only from position `-0.5` through `+0.5`; and
- 100% preserves the original full-range blend from `-1` through `+1`.

Outside the transition region, the appropriate endpoint colour is used without mixing. Color Blend
is effective and visible only in Position mode, but its stored value survives mode changes. It is a
display-only Workspace/Dock instance control: it redraws immediately, belongs in Presets and Agent
Control, and does not enter analysis request identity or allocate history.

## Consequences

- Users can choose between categorical channel-side colour and a gradual position display without
  introducing a centre token.
- Primary and Secondary retain the same Theme meaning as Spectrum and the other Stereo Map modes.
- Agent Control reports the setting as inactive outside Position mode.
