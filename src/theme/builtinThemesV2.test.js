import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES_V2, getBuiltinThemeV2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { V1_BUILTIN_RESOLVED } from "./fixtures/v1BuiltinResolved.js";
import { isThemeV2 } from "./themeSchema.js";

const REVIEWED_NON_EXACT = new Set([
  "--border",
  "--input",
  "--ui-loudness-grid",
  "--ui-vectorscope-grid-stroke",
]);

describe("Theme V2 builtins", () => {
  it.each(Object.keys(BUILTIN_THEMES_V2))("normalizes and compiles %s", (id) => {
    expect(isThemeV2(BUILTIN_THEMES_V2[id])).toBe(true);
    expect(() => compileTheme(BUILTIN_THEMES_V2[id])).not.toThrow();
  });

  it.each(Object.keys(BUILTIN_THEMES_V2))(
    "preserves every comparable opaque V1 binding for %s",
    (id) => {
      const current = V1_BUILTIN_RESOLVED[id].css;
      const next = compileTheme(BUILTIN_THEMES_V2[id]).css;
      for (const [binding, value] of Object.entries(next)) {
        if (!(binding in current) || REVIEWED_NON_EXACT.has(binding)) continue;
        expect(value, binding).toBe(current[binding]);
      }
    }
  );

  it("is deeply immutable and falls back to Dark", () => {
    expect(Object.isFrozen(BUILTIN_THEMES_V2["plvs-dark"].core)).toBe(true);
    expect(getBuiltinThemeV2("missing")).toBe(BUILTIN_THEMES_V2["plvs-dark"]);
  });
});
