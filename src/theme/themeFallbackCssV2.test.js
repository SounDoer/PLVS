import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { UI_PREFERENCES } from "../preferences/data.js";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { buildThemeFallbackCssV2 } from "./themeFallbackCssV2.js";

const generatedPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../generated/theme-fallbacks.css"
);

describe("buildThemeFallbackCssV2", () => {
  it("matches the checked-in generated first-paint CSS", () => {
    const dark = compileTheme(BUILTIN_THEMES_V2["plvs-dark"]);
    const expected = buildThemeFallbackCssV2(dark.css, UI_PREFERENCES.radii.card);
    expect(readFileSync(generatedPath, "utf8")).toBe(expected);
  });

  it("includes shell, data, and effect bindings from the same compilation", () => {
    const dark = compileTheme(BUILTIN_THEMES_V2["plvs-dark"]);
    const css = buildThemeFallbackCssV2(dark.css, "0.5rem");
    expect(css).toContain("--background: #070707;");
    expect(css).toContain("--ui-spectrum-primary: #fb923c;");
    expect(css).toContain("--ui-effect-scrim: rgba(7, 7, 7, 0.72);");
  });
});
