import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "../builtinThemesV2.js";
import { compileTheme } from "../compileTheme.js";
import { normalizeThemeDocument } from "./migrateV1Theme.js";
import { themeToPortable, portableToStoredTheme } from "../portableTheme.js";

describe("opaque Border semantics migration", () => {
  it.each(["dark", "light"])(
    "preserves authored %s Border and inherited Grid appearance",
    (scheme) => {
      const old = structuredClone(BUILTIN_THEMES_V2[`plvs-${scheme}`]);
      old.id = "custom-old";
      old.semanticsVersion = 2;
      old.overrides = {
        "interface.surface.panel": { kind: "color", value: "#204060" },
        "interface.border.default": { kind: "color", value: "#80a0c0" },
        "spectrum.grid": { kind: "color", value: "#123456" },
        "vectorscope.guides": { kind: "reference", source: "core.primaryData" },
      };
      const original = structuredClone(old);
      const migrated = normalizeThemeDocument(old);
      const resolved = compileTheme(migrated);
      expect(resolved.css["--border"]).toBe(scheme === "dark" ? "#294969" : "#2a4a6a");
      expect(resolved.css["--input"]).toBe(resolved.css["--border"]);
      expect(resolved.roles["loudness.grid"]).toBe("#284868");
      expect(resolved.roles["spectrogram.grid"]).toBe("#284868");
      expect(resolved.roles["stereoMap.grid"]).toBe("#284868");
      expect(resolved.roles["spectrum.grid"]).toBe("#123456");
      expect(resolved.roles["vectorscope.guides"]).toBe(old.core.primaryData);
      expect(normalizeThemeDocument(migrated)).toEqual(migrated);
      expect(old).toEqual(original);

      const portable = themeToPortable(BUILTIN_THEMES_V2[`plvs-${scheme}`]);
      portable.semanticsVersion = 2;
      portable.overrides = old.overrides;
      const imported = portableToStoredTheme(portable, "custom-imported");
      expect(imported.overrides).toEqual(migrated.overrides);
      expect(imported.semanticsVersion).toBe(3);
    }
  );

  it("keeps Auto roles sparse when no legacy Border was authored", () => {
    const old = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), semanticsVersion: 2 };
    expect(normalizeThemeDocument(old).overrides).toEqual({});
  });

  it("rejects malformed legacy colours instead of flattening them", () => {
    const old = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), semanticsVersion: 2 };
    old.overrides["interface.border.default"] = { kind: "color", value: "invalid" };
    expect(normalizeThemeDocument(old)).toBeNull();
  });
});
