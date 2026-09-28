# ADR 0012: Stereo Map visual opacity controls

## Status

Accepted

## Context

Stereo Map combines two different kinds of transparency. Its area fill needs a stable relationship
to the active Theme, while each frequency band's trace and fill also fade according to measured
energy. A fixed product fill value made a Theme's Spectrum and Stereo Map colours look unrelated,
and the fixed energy fade gave users no way to choose how strongly quiet bands recede.

The two values have different owners. Area-fill opacity is part of Theme composition. Energy fade
is a panel display preference applied to measured opacity and must not change analysis identity or
allocate another history slab. Stereo Map also previously borrowed Spectrum's stroke-width token,
coupling two otherwise independent modules.

## Supersession

This ADR supersedes ADR 0011 only where it leaves Stereo Map fill opacity as product tuning. ADR
0011 continues to define the bounded numeric Theme-role contract.

## Decision

- Add the bounded numeric Theme role `stereoMap.fillOpacity`, exposed as **Advanced → Stereo Map →
  Fill Opacity**, with a 20% default, 0–100% range, and 1% step. All four Stereo Map modes and both
  live and Snapshot rendering share it.
- Add the panel control **Energy Fade Strength**, defaulting to 75% with a 0–100% range and 1% step.
  For an existing per-band analysis opacity `baseOpacity`, drawing uses
  `baseOpacity ** (strength / 100)`. An exactly invisible band remains invisible. At 0%, every band
  above the analysis gate is fully visible; at 100%, the original energy fade is unchanged.
- Apply Energy Fade Strength only while drawing. It is not part of the Stereo Map request key, so it
  previews continuously without creating analysis histories.
- Keep the analysis gate and its measured base opacity unchanged. Fill alpha is the adjusted energy
  opacity multiplied by the Theme fill opacity; stroke alpha uses only the adjusted energy opacity.
  Hold outlines remain fully opaque.
- Give Stereo Map its own product-owned `--ui-stereo-map-stroke-width` token, defaulting to 1.5,
  instead of borrowing Spectrum's token.

## Consequences

- Theme authors can make Spectrum and Stereo Map fills visually consistent without weakening their
  line colours.
- Users can reveal quiet frequency bands or preserve stronger energy emphasis per panel and per
  Dock instance, with immediate preview.
- Presets and Agent Control include Energy Fade Strength, while analysis requests and retained
  history remain unchanged.
- Stereo Map geometry can evolve independently from Spectrum.
