# ADR 0015: Adjustable Vectorscope Polar Sample persistence

## Status

Accepted

## Context

Vectorscope Polar Sample uses sample age to produce a short persistence trail. Its fixed 400 ms
window also capped the newest point at 90% opacity, while a captured Snapshot used the same 90%
cap. That made the Theme's Trace and Snapshot colours look weaker than the same identity colours in
other panels, and users could not choose between an instantaneous view and a longer trail.

The age fade is measurement presentation rather than colour composition. Moving it into the Theme
would make a temporal behavior part of a colour document, while removing it would collapse Polar
Sample into a noisy newest-point display. Lissajous Hold Slow is a separate phosphor-style gesture
with its own fixed temporal behavior.

## Decision

Add the panel display setting **Persistence**, defaulting to 400 ms with a 0–1000 ms range and 50 ms
step. It is visible and effective only in Polar Sample mode, but its stored value survives mode
changes.

The newest live samples use the Theme's Trace colour at 100% opacity. Older samples fade linearly
to transparent over the selected duration; 0 ms retains only the newest samples. A captured Polar
Sample Snapshot uses the Theme's Snapshot colour at 100% opacity without an age fade. Lissajous
Hold Slow and Polar Level remain unchanged.

Persistence is a display-only Workspace/Dock instance control. It previews immediately, belongs in
Presets and Agent Control, and does not enter Vectorscope analysis request identity or allocate
history.

## Consequences

- Trace and Snapshot identity colours are no longer weakened before their temporal semantics apply.
- Users can trade visual history for immediacy without restarting analysis.
- Agent Control reports the setting as inactive outside Polar Sample mode.
- Themes continue to own colour, while the panel owns the time window.
