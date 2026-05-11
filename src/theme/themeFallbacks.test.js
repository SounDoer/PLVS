import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIOMETER_SEMANTIC_DARK, buildThemeFallbackCss } from "./shadcnSemanticPreset.js";
import { UI_PREFERENCES } from "../preferences/data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const generatedPath = join(__dirname, "../generated/theme-fallbacks.css");

describe("buildThemeFallbackCss", () => {
  it("emits :root only with audiometer-dark primary accent", () => {
    const css = buildThemeFallbackCss(AUDIOMETER_SEMANTIC_DARK, UI_PREFERENCES.radii.card);
    expect(css).toContain(":root {");
    expect(css).not.toContain(".dark {");
    expect(css).toContain("--primary: #22d3ee;");
  });

  it("matches the committed generated file (run npm run theme:generate after editing presets)", () => {
    const expected = buildThemeFallbackCss(AUDIOMETER_SEMANTIC_DARK, UI_PREFERENCES.radii.card);
    const onDisk = readFileSync(generatedPath, "utf8");
    expect(onDisk).toBe(expected);
  });
});
