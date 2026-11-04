# Authoring Backdrop Container

The user reported a remaining translucent rounded rectangle above Theme Preview after the previous
backdrop correction. That correction made the viewport corners transparent but still depended on a
cached editor rectangle. Expanding the native host recenters the editor without necessarily changing
its size; observing editor size and viewport resize did not reliably keep the clipping coordinates
aligned with the painted editor. Corner-only acceptance missed the remaining rectangle.

The shared Dialog shell now portals the authoring backdrop directly into the editor supplied by the
host context. Its absolute inset and shared editor radius follow the actual containing block. There are
no measured clipping coordinates or resize listeners. Ordinary dialogs retain a viewport backdrop;
dialog content, focus trapping, Escape, and native window counts keep their existing behavior.

## Validation

- Regression tests verify that the scoped backdrop is a child of the editor, including position-only
  movement, and that Escape still dismisses the modal. Ordinary viewport behavior is also covered.
- An isolated Windows embedded dev app was tested at 200% WebView scale, opening Preview from both
  Core and Palettes. Both previews remained 1632 × 1600 physical pixels. Closing Palettes Preview
  restored the 864 × 1232 editor viewport.
- Old `height-preview.png` pixels at (816, 32), (816, 100), (1200, 100), and (400, 100) had alpha
  153/255. The same points in both new preview captures are fully transparent. Full desktop captures
  also show no displaced black rectangle above Preview.
- Normal-mode Preview retains workbench dimming. Artifacts are under ignored
  `artifacts/dock-shared-settings/backdrop-attached-*.png`.
