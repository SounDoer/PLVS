/**
 * Writes first-paint CSS from the compiled Theme V2 **`plvs-dark`** builtin.
 * Run via `npm run theme:generate` (also `prebuild`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import { compileTheme } from "../src/theme/compileTheme.js";
import { buildThemeFallbackCssV2 } from "../src/theme/themeFallbackCssV2.js";
import { UI_PREFERENCES } from "../src/preferences/data.js";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "../src/generated");
const outFile = join(outDir, "theme-fallbacks.css");

mkdirSync(outDir, { recursive: true });
const dark = compileTheme(BUILTIN_THEMES_V2["plvs-dark"]);
const css = buildThemeFallbackCssV2(dark.css, UI_PREFERENCES.radii.card);
writeFileSync(outFile, css, "utf8");
console.log("Wrote", outFile);
