# ADR 0014: Theme-owned classic Waveform fill opacity

## Status

Accepted

## Context

Waveform has two visually different bodies. The classic view draws an opaque outline around a
lightly tinted amplitude envelope, while Frequency Color uses opaque Low, Mid, High, and Neutral
colours as the waveform body itself. The classic fill was product tuning stored outside the Theme
system, with a current value of 12% but stale 22% renderer fallbacks. Workspace also treated an
explicit zero as missing.

Applying one opacity control to both bodies would weaken Frequency Color's categorical palette and
make its meaning depend on the surface beneath it. Keeping the classic value outside Theme Advanced
would leave a visible composition choice unavailable to theme authors.

## Decision

Add the bounded numeric Theme role `waveform.fillOpacity`, exposed as **Advanced → Waveform →
Classic Fill Opacity**, with a default of 12%, a 0–100% range, and a 1% step.

The role is Canvas-bound and shared by Workspace, Dock, Live, and Snapshot classic waveforms. A
Theme draft publishes it immediately, so both renderers preview the value without a restart.
Frequency Color remains fully opaque and Spectral Centroid is unchanged. Stroke width remains
product-owned geometry.

Remove the old layout preference and CSS opacity token. Both renderers use the Theme value directly,
accept zero, clamp defensive external values, and use 12% only when no valid resolved value exists.

## Consequences

- Theme authors can tune or remove the classic envelope fill without changing trace identity.
- Frequency Color retains stable, background-independent palette meaning.
- Workspace and Dock can no longer diverge through stale 22% fallbacks or zero-value handling.
