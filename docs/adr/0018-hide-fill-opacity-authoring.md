# ADR 0018: Hide fill-opacity authoring

## Status

Accepted

## Decision

Theme Editor no longer exposes Spectrum upper/lower fill opacity, Stereo Map fill opacity,
or classic Waveform fill opacity. These controls add panel-specific visual tuning to an editor
whose visible customization should concentrate on colors and palette composition.

Keep the current defaults: Spectrum 20% / 2%, Stereo Map 20%, and Waveform 12%. Keep the numeric
registry, compiler, persistence and transfer contracts so existing themes retain their authored
appearance. Mark these roles as editor-hidden rather than silently removing saved overrides.
This supersedes the editor-exposure requirement of ADR 0011 and later panel-specific fill
decisions, but does not remove their runtime or compatibility contracts.

Palette stop positions and Dark / Light appearance are still part of color authoring. Hiding
opacity controls does not mean the editor contains only individual color pickers.
