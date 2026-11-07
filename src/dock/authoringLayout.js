import { UI_PREFERENCES, resolveInterfacePreferences } from "../uiPreferences.js";
import { resolveSurfaceWidths } from "../preferences/interfaceSize.js";

/** Intrinsic content may scroll; it must never grow its native host past the shared editor cap. */
export function deriveAuthoringLayout({
  width,
  height,
  bodyScrollHeight = 0,
  bodyClientHeight = 0,
  preview = false,
  view,
  interfaceSize,
  webviewScale = 1,
}) {
  const editor = resolveInterfacePreferences(UI_PREFERENCES, interfaceSize).layout.editor;
  const naturalHeight = Math.ceil(height + Math.max(0, bodyScrollHeight - bodyClientHeight));
  const bounded = view === "theme" || view === "profile";
  // Request the preferred width, not a measurement already clipped to the current host.
  // This lets a larger Interface Size grow the window while CSS still fits narrow monitors.
  const preferredWidth = bounded
    ? editor.preferredWidthPx
    : view === "feedback"
      ? resolveSurfaceWidths(interfaceSize).compactWidthPx
      : width;
  return {
    width: preview ? Math.max(816, Math.ceil(width) + 16) : Math.ceil(preferredWidth) + 16,
    height: preview
      ? 800
      : (bounded ? Math.min(naturalHeight, editor.maxHeightPx) : naturalHeight) + 16,
    preview,
    webviewScale,
  };
}
