import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import {
  PORTABLE_THEME_FORMAT_VERSION,
  PORTABLE_THEME_KIND,
  PortableThemeError,
  assessPortableThemeCommunityPublication,
  hashPortableTheme,
  portableToStoredTheme,
  serializePortableTheme,
  themeToPortable,
  validatePortableTheme,
} from "./portableTheme.js";

function storedTheme(overrides = {}) {
  return {
    ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
    id: "custom-studio",
    name: "Studio",
    ...overrides,
  };
}

describe("portable Theme contract", () => {
  it("exports authoring intent without local identity or preset provenance", () => {
    const theme = storedTheme();
    theme.palettes.status.presetId = "preset-from-another-installation";
    const portable = themeToPortable(theme);

    expect(portable).toMatchObject({
      kind: PORTABLE_THEME_KIND,
      formatVersion: PORTABLE_THEME_FORMAT_VERSION,
      semanticsVersion: 1,
      name: "Studio",
      colorScheme: "dark",
    });
    expect(portable).not.toHaveProperty("id");
    expect(JSON.stringify(portable)).not.toContain("presetId");
  });

  it("round-trips through a caller-owned local ID", () => {
    const source = storedTheme({
      overrides: {
        "interface.surface.panel": { kind: "color", value: "rgb(16 32 48)" },
      },
    });
    const portable = themeToPortable(source);
    const imported = portableToStoredTheme(portable, "custom-imported");

    expect(imported.id).toBe("custom-imported");
    expect(imported.palettes.status.presetId).toBeNull();
    expect(imported.overrides["interface.surface.panel"]).toEqual({
      kind: "color",
      value: "#102030",
    });
    expect(themeToPortable(imported)).toEqual(portable);
  });

  it("produces stable canonical JSON and hashes across IDs, provenance, and key order", async () => {
    const first = storedTheme({
      id: "custom-one",
      overrides: {
        "interface.surface.raised": { kind: "color", value: "#202122" },
        "interface.surface.panel": { kind: "color", value: "#101112" },
      },
    });
    const second = structuredClone(first);
    second.id = "custom-two";
    second.palettes.status.presetId = null;
    second.overrides = {
      "interface.surface.panel": first.overrides["interface.surface.panel"],
      "interface.surface.raised": first.overrides["interface.surface.raised"],
    };

    const firstPortable = themeToPortable(first);
    const secondPortable = themeToPortable(second);
    expect(serializePortableTheme(firstPortable)).toBe(serializePortableTheme(secondPortable));
    expect(await hashPortableTheme(firstPortable)).toBe(await hashPortableTheme(secondPortable));
    expect(await hashPortableTheme(firstPortable)).toBe(
      "sha256:c31f5cedb9faaf93194b167114eccaa0c996e81a40192d777fd931393e54875e"
    );
  });

  it("aggregates shape, version, provenance, role, and override errors", () => {
    const portable = themeToPortable(storedTheme());
    portable.extra = true;
    portable.formatVersion = 99;
    portable.semanticsVersion = 2;
    portable.palettes.status.presetId = "status-default";
    portable.overrides["missing.role"] = { kind: "effect", color: "#ffffff", opacity: 0.5 };

    expect(() => validatePortableTheme(portable)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "unknownField", path: "$.extra" }),
          expect.objectContaining({ code: "unsupportedFormatVersion" }),
          expect.objectContaining({ code: "unsupportedSemanticsVersion" }),
          expect.objectContaining({
            code: "unknownField",
            path: "$.palettes.status.presetId",
          }),
          expect.objectContaining({ code: "unsupportedPortableOverride" }),
          expect.objectContaining({ code: "unknownRole" }),
        ]),
      })
    );
  });

  it("rejects non-documents and invalid destination IDs", () => {
    expect(() => validatePortableTheme(null)).toThrow(PortableThemeError);
    expect(() => portableToStoredTheme(themeToPortable(storedTheme()), "bad id")).toThrow(
      PortableThemeError
    );
  });

  it("shares one strict community publication assessment with future intake and CI", () => {
    const accessible = themeToPortable(storedTheme());
    expect(assessPortableThemeCommunityPublication(accessible)).toMatchObject({
      document: accessible,
      communityPublication: { eligible: true, blockers: [] },
    });

    const lowContrast = structuredClone(accessible);
    lowContrast.overrides["interface.text.annotation"] = {
      kind: "color",
      value: "#151515",
    };
    expect(assessPortableThemeCommunityPublication(lowContrast)).toMatchObject({
      communityPublication: {
        eligible: false,
        blockers: [
          expect.objectContaining({
            code: "accessibilityContrast",
            standard: "WCAG 2.2 SC 1.4.3",
          }),
        ],
      },
    });

    expect(() => assessPortableThemeCommunityPublication({})).toThrow(PortableThemeError);
  });
});
