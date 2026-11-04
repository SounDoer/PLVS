# Dock Authoring Parity Implementation

Date: 2026-11-04
Branch: `codex/dock-shared-settings`

## Completed implementation

- Use ordinary drawer widths for Settings and an independent, intrinsic-size `dock-authoring`
  window for Theme/Profile/Feedback. Preserve the rounded shared floating components.
- Delegate title dragging through a host context to Tauri's native window API. Keep header controls
  interactive. Remember base physical bounds in-process without holding a lock across window calls.
- Keep the ordinary Theme Preview modal and temporarily enlarge its native viewport. Keep its open
  state in main so an unsaved draft and preview can migrate between normal and Dock presentation.
- Destroy inactive authoring hosts only after pending business operations complete and the client
  acknowledges idle. Keep fixed labels, serialized creation, and stale-session refusal.
- Restore Profile Add/Edit/Export/Delete menu actions through their original owners. Keep native
  pickers off the activation-refusing strip and close the transient menu before exporting.
- Register editor transferability explicitly and share the live blocker query with Agent Control
  planning. All preset operations and unknown editors retain their pre-mutation refusals.
- Report the authoring WebView's own scale for geometry, screenshot settlement, and pointer targets.

## Desktop acceptance

Embedded dev-identity Windows builds use isolated `--plvs-test-app-data-root` data. Screenshots and
measurements are under ignored `artifacts/dock-shared-settings/`.

- At the current 200% WebView scale, Default Settings is 336 CSS px wide (672 physical px). The
  Theme editor surface is 416 CSS px wide inside a 432 px viewport with a transparent border gutter.
  The rounded editor screenshot matches the editor restored after form migration byte-for-byte.
- Theme Preview expands the host to 816 × 800 CSS px. Closing restores the editor's 432 × 388 px
  viewport. The component, tabs, modal behavior, and current unsaved-draft document are shared.
- A dirty Theme with Primary Data changed to `#12ab34` and its open preview survived Dock → normal
  → Dock. Inspection confirmed the same draft identity, dirty flag, and color; the returned
  preview screenshot was 1632 × 1600 physical pixels. Cancel/discard used the existing linked
  confirmation; the test color was not saved.
- Physically invoking the Dock Profile menu's Edit action opened the existing profile in the new
  rounded editor. Native Alt+F4 closed a clean Theme through its business callback and released its
  blocking registration and authoring renderer.
- The Dock Profile Export button opened a standalone Save As dialog without restoring the ordinary
  window. Saving `profile-export-final.plvsloudness` to the isolated artifacts directory completed;
  the exported pack contains the expected Profile ID, Reference -18 LUFS, and True Peak rule -1 dBTP.
- Thirty cold Theme open/cancel cycles retained four renderers after every sampled closure, versus
  five while authoring was open. Warm baseline private memory was 554.68 MB, after cycle 30 it was
  552.65 MB, and after 20 idle seconds it was 540.70 MB. Memory includes the entire workbench tree;
  this is a Windows development measurement, not a hardware capture or long-run benchmark.
- Unit/integration coverage includes native drag delegation with interactive header exclusions,
  operation-completion-before-destruction, transferable/unknown editor guards, preset refusals,
  Agent Control planning, Profile management routing, and normal Settings/editor regressions.

## Remaining platform acceptance

- The desktop automation helper did not produce a measurable native move with its synthetic drag;
  no native drag error was reported. Physical title dragging and exact dragged-position restoration
  remain manual acceptance. The implementation uses the supported native dragging API.
- macOS native behavior and actual monitor migration at differing scales require their platform
  checks. The current 200% Windows run and earlier 125% baseline do not establish mixed-DPI behavior.
- No Feedback transmission, update installation, real setup reset, or audio hardware smoke/soak ran.
