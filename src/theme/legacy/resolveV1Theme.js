import { buildThemeTokens } from "../buildThemeTokens.js";
import { oklchToHex, SHADCN_SEMANTIC_CSS_VAR_BINDINGS } from "../shadcnSemanticPreset.js";

/**
 * Resolve the shipped V1 theme shape without importing any Theme V2 code.
 *
 * This function is deliberately isolated: Phase 2 uses it to lock the compatibility baseline and
 * Phase 3 migration can keep reading old documents after the production runtime moves to V2.
 */
export function resolveV1Theme(theme) {
  const css = {};
  for (const [cssName, semanticKey] of SHADCN_SEMANTIC_CSS_VAR_BINDINGS) {
    const value = theme.semantic[semanticKey];
    css[cssName] = value?.trim().startsWith("oklch(") ? oklchToHex(value) : value;
  }
  Object.assign(css, buildThemeTokens(theme));

  return {
    colorScheme: theme.colorScheme === "light" ? "light" : "dark",
    css,
    colormap: structuredClone(theme.colormap),
  };
}
