/**
 * Writes `src/generated/theme-fallbacks.css` from `AUDIOMETER_SEMANTIC_*` and `UI_PREFERENCES.radii.card`.
 * Run via `npm run theme:generate` (also `prebuild`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIOMETER_SEMANTIC_DARK, AUDIOMETER_SEMANTIC_LIGHT, buildThemeFallbackCss } from "../src/theme/shadcnSemanticPreset.js";
import { UI_PREFERENCES } from "../src/preferences/data.js";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "../src/generated");
const outFile = join(outDir, "theme-fallbacks.css");

mkdirSync(outDir, { recursive: true });
const css = buildThemeFallbackCss(
  AUDIOMETER_SEMANTIC_LIGHT,
  AUDIOMETER_SEMANTIC_DARK,
  UI_PREFERENCES.radii.card,
);
writeFileSync(outFile, css, "utf8");
console.log("Wrote", outFile);
