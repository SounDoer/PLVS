# ADR 0016: Stabilize edge-on Spectrogram Lines azimuths

## Status

Accepted

## Context

The 3D Lines renderer draws each waterfall ridge as one Canvas path with one linear gradient. At
azimuth 0° and 180°, the projected frequency direction is vertical and shares the screen direction
used for signal height. The gradient axis therefore has zero length. The old fallback replaced the
Theme intensity palette and level-driven alpha with one fully opaque foreground colour, producing
a conspicuous fence of monochrome vertical lines.

Drawing every ridge segment separately could preserve an exact edge-on camera, but would replace
roughly one Canvas stroke per ridge with one stroke per frequency segment. That defeats the
hairline-path performance design of the Lines renderer for a view that already collapses two data
dimensions onto one screen direction.

## Decision

Keep the persisted and user-facing azimuth unchanged. For 3D Lines rendering only, move values
within one degree of the 0°/360° or 180° singularities to the nearest stable one-degree boundary.
Use that stabilized projection consistently for ridges, floor, labels, and pointer unprojection.

Always draw Lines with the normal Colorize or monochrome level gradient; remove the fully opaque
single-colour fallback. 3D Surface remains exact because its WebGL mesh carries colour and alpha
per vertex and does not depend on the Canvas gradient axis.

## Consequences

- The two reachable edge-on settings retain the same colour and opacity semantics as nearby views.
- The visual offset is bounded to one degree and does not modify Presets, Agent Control, or the
  displayed control value.
- Lines retains one Canvas stroke per ridge instead of adding a high-cost per-segment path.
- Surface and every already-stable Lines angle remain unchanged.
