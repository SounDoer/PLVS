# Dock Preview Backdrop Correction

Date: 2026-11-04
Branch: `codex/dock-shared-settings`

User manual testing confirmed native title dragging. A subsequent screenshot identified a large
black translucent rectangle behind Theme Preview. This was the ordinary viewport-wide modal scrim
being composited over a transparent, expanded authoring WebView; RDP is not required to trigger it.
The earlier desktop acceptance screenshots already contained this issue and it was missed in review.

The authoring host now supplies the editor element as the scope for modal backdrops. The shared
Dialog shell clips dimming to that rounded surface and updates its bounds when the panel or native
viewport resizes. Ordinary dialogs keep their viewport-wide backdrop. Focus trapping, Escape,
dismissal, draft ownership, preview sizing, and native window counts remain unchanged. The same
scope also covers editor discard confirmations through the shared Dialog component.

Regression tests cover ordinary viewport behavior, rounded editor clipping, host resizing, and
Escape dismissal. Existing Theme Preview and authoring transport tests also pass.

An isolated embedded Windows dev app captured both the new preview and the restored editor with
Agent Control. At 200% WebView scale, preview size remains 1632 × 1600 physical pixels; the restored
editor is 864 × 776. Old preview corner pixels had alpha 153/255, matching the 60% black scrim.
The corresponding new corner pixels are fully transparent (alpha 0), with only the ordinary dialog
shadow remaining beside its edge. Artifacts: `backdrop-fixed.png`, `backdrop-editor-restored.png`,
and the earlier `resized-preview.png` under ignored `artifacts/dock-shared-settings/`.

macOS and mixed-DPI monitor migration still need their platform acceptance. No audio code changed.
