# Dock Authoring Presentation Parity

Date: 2026-11-04
Status: Implemented on `codex/dock-shared-settings`; acceptance is recorded in the matching plan.

User review replaces the wide, full-height single-host presentation with these rules:

- Settings follows the normal drawer width for each Interface Size.
- Theme/Profile editors keep ordinary content dimensions, rounded surfaces, and dragging in a
  separate native authoring host. Feedback uses the same authoring host service.
- Repeated opening focuses the active editor. Close follows existing save/cancel/discard rules,
  then releases the authoring WebView after operation completion is acknowledged.
- Theme Preview remains the ordinary modal. Its host temporarily expands and restores its bounds
  when it closes. Preview-open state and unsaved drafts survive normal/Dock transitions.
- Dock Profile menus expose the ordinary management actions through main-owned business functions.
- Dock entry accepts only explicitly transferable editors. Preset mutations and unknown editors
  retain their guards before any mutation.

ADR 0050 records the host/lifetime decision. This iteration does not change the audio engine,
introduce a second SettingsProvider, or publish a release.
