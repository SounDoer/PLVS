import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES_V2, getBuiltinThemeV2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { applyPalettePreset } from "./palettePresets.js";
import { isCurrentThemeDocument } from "./themeSchema.js";

describe("Theme V2 builtins", () => {
  it.each(Object.keys(BUILTIN_THEMES_V2))("normalizes and compiles %s", (id) => {
    expect(isCurrentThemeDocument(BUILTIN_THEMES_V2[id])).toBe(true);
    expect(() => compileTheme(BUILTIN_THEMES_V2[id])).not.toThrow();
  });

  // Explicitly update these snapshots only after reviewing a default-theme design change.
  // Frozen V1 output remains covered independently in legacy/resolveV1Theme.test.js.
  it.each(Object.keys(BUILTIN_THEMES_V2))("matches the reviewed current design for %s", (id) => {
    const { css, canvas, native } = compileTheme(BUILTIN_THEMES_V2[id]);
    expect({ css, canvas, native }).toMatchSnapshot();
  });

  it.each(Object.keys(BUILTIN_THEMES_V2))("authors %s without a single override", (id) => {
    expect(BUILTIN_THEMES_V2[id].overrides).toEqual({});
  });

  it.each([
    ["plvs-dark", "status-plvs", "frequency-plvs"],
    ["plvs-light", "status-plvs", "frequency-plvs"],
  ])("builds %s from its named Status and Frequency presets", (id, statusId, frequencyId) => {
    expect(BUILTIN_THEMES_V2[id].palettes.status).toEqual(applyPalettePreset("status", statusId));
    expect(BUILTIN_THEMES_V2[id].palettes.frequency).toEqual(
      applyPalettePreset("frequency", frequencyId)
    );
  });

  it("is deeply immutable and falls back to Dark", () => {
    expect(Object.isFrozen(BUILTIN_THEMES_V2["plvs-dark"].core)).toBe(true);
    expect(getBuiltinThemeV2("missing")).toBe(BUILTIN_THEMES_V2["plvs-dark"]);
  });
});
