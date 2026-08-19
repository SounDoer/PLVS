import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UI_PREFERENCES } from "../preferences/data.js";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { buildThemeFallbackCssV2 } from "./themeFallbackCssV2.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const generatedPath = join(__dirname, "../generated/theme-fallbacks.css");

function expectedCss() {
  return buildThemeFallbackCssV2(
    compileTheme(BUILTIN_THEMES_V2["plvs-dark"]).css,
    UI_PREFERENCES.radii.card
  );
}

describe("Theme V2 first-paint CSS", () => {
  it("emits :root only with plvs-dark primary accent", () => {
    const css = expectedCss();
    expect(css).toContain(":root {");
    expect(css).not.toContain(".dark {");
    expect(css).toContain("--primary: #fb923c;");
  });

  it("matches the committed generated file (run npm run theme:generate after editing V2 builtins)", () => {
    const expected = expectedCss();
    const onDisk = readFileSync(generatedPath, "utf8");
    expect(onDisk).toBe(expected);
  });
});
