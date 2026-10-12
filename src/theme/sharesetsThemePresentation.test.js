import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import {
  buildSharesetsThemePresentation,
  requireResolvedSharesetsThemePresentation,
} from "./sharesetsThemePresentation.js";
import { themeToPortable } from "./portableTheme.js";

function portable(themeId) {
  return themeToPortable({
    ...structuredClone(BUILTIN_THEMES_V2[themeId]),
    id: `custom-${themeId}`,
  });
}

describe("sharesets Theme page presentation", () => {
  it.each([
    ["plvs-dark", "dark", "Dark Theme"],
    ["plvs-light", "light", "Light Theme"],
  ])(
    "resolves the current semantics to its first release for %s",
    (themeId, colorScheme, label) => {
      expect(buildSharesetsThemePresentation(portable(themeId))).toMatchObject({
        appearance: { colorScheme, label },
        compatibility: {
          status: "resolved",
          minimumAppVersion: "0.19.2",
          maximumAppVersion: null,
          label: "Requires PLVS 0.19.2 or later",
          formatVersion: 1,
          semanticsVersion: 5,
          technicalLabel: "Theme Format 1 · Semantics 5",
        },
      });
    }
  );

  it("renders the user-facing minimum from the central release mapping", () => {
    const presentation = requireResolvedSharesetsThemePresentation(portable("plvs-dark"), {
      compatibility: {
        "1:5": { minimumAppVersion: "0.19.0", maximumAppVersion: null },
      },
    });

    expect(presentation.compatibility).toMatchObject({
      status: "resolved",
      label: "Requires PLVS 0.19.0 or later",
      technicalLabel: "Theme Format 1 · Semantics 5",
    });
  });

  it("can close the range later without changing the Theme document", () => {
    const presentation = requireResolvedSharesetsThemePresentation(portable("plvs-light"), {
      compatibility: {
        "1:5": { minimumAppVersion: "0.19.0", maximumAppVersion: "0.24.3" },
      },
    });
    expect(presentation.compatibility.label).toBe("Works with PLVS 0.19.0-0.24.3");
  });

  it("blocks public-page generation until the shipping release is known", () => {
    expect(() =>
      requireResolvedSharesetsThemePresentation(portable("plvs-dark"), {
        compatibility: { "1:5": { minimumAppVersion: null, maximumAppVersion: null } },
      })
    ).toThrowError(expect.objectContaining({ code: "minimumAppVersionPending" }));
  });
});
