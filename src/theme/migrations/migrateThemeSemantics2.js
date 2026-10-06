import { mixOpaqueColors } from "../colorMix.js";
import { normalizeThemeDocumentShape } from "../themeSchema.js";

/** Preserve authored legacy Border appearance on Panel Surface, and inherited Grid colours. */
/**
 * Preserve authored legacy Border appearance on Panel Surface, and inherited Grid colours.
 */
export function migrateThemeSemantics2(raw) {
  if (raw?.formatVersion !== 2 || raw?.semanticsVersion !== 2) return null;
  const theme = normalizeThemeDocumentShape({ ...raw, semanticsVersion: 4 });
  if (!theme) return null;
  const border = theme.overrides["interface.border.default"];
  if (border?.kind === "color") {
    const panel = theme.overrides["interface.surface.panel"]?.value ?? theme.core.surface;
    const oldColor = border.value;
    border.value = mixOpaqueColors(panel, oldColor, theme.colorScheme === "dark" ? 0.09 : 0.1);
    const grid = mixOpaqueColors(panel, oldColor, 0.08);
    for (const role of [
      "loudness.grid",
      "spectrum.grid",
      "spectrogram.grid",
      "stereoMap.grid",
      "vectorscope.guides",
    ]) {
      theme.overrides[role] ??= { kind: "color", value: grid };
    }
  }
  return theme;
}
