# Theme Preview Temporarily Replaces Its Editor

User review chose the same presentation in normal and Dock modes: hide the Theme editor while
Preview is open, remove Preview dimming, and restore the editor unchanged when Preview closes.

The shared Theme editor keeps its DOM mounted with hidden visibility and inert input while Preview
is open. This preserves scroll state and geometry without copying or rebuilding editor controls.
Its existing main-owned draft, selected page, and native bounds remain authoritative. Preview's
existing close button, Escape, and Visual Review jump actions restore the editor through the same
preview-open state.

The shared Dialog shell accepts `dimmed={false}`. Preview uses it in both forms, retaining modal
focus, pointer, and scroll handling with an unpainted overlay. It never resolves or uses the Dock
backdrop container. The backdrop-container service remains necessary for unsaved-change confirmation
dialogs in transparent hosts; those dialogs retain their ordinary dimming. The redundant backdrop
radius was removed: the editor's existing rounded overflow clipping owns that edge.

## Validation

- Regression tests cover mounted editor identity, hidden/inert state, page, scroll position,
  position, untouched save/cancel callbacks, Preview close, Visual Review navigation, and bypassing
  the host backdrop getter. Existing confirmation and radius/style contracts also pass.
- Isolated embedded Windows dev build, WebView scale 2: normal and Dock Palettes were scrolled to
  Frequency/Interface, Preview opened, and the editor restored through Close or Escape.
- Normal editor body screenshot crops before/after are pixel-identical. The exposed workbench top
  strip is pixel-identical while Preview is open, confirming no dimming.
- Dock restored to 864 × 1232 physical pixels. Its entire before/after screenshot is byte-identical,
  including the scrolled content. Preview remained 1632 × 1600 and showed no editor behind it.
- A dirty draft retained identical document and draft generation after Preview closed. The editor
  remained dirty. Its Cancel confirmation still dimmed the editor, and Keep Editing preserved it.
- Captures are under ignored `artifacts/dock-shared-settings/replacement-*.png`.
