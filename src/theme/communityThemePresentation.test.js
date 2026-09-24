import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import {
  buildCommunityThemePresentation,
  requireResolvedCommunityThemePresentation,
} from "./communityThemePresentation.js";
import { themeToPortable } from "./portableTheme.js";

function portable(themeId) {
  return themeToPortable({
    ...structuredClone(BUILTIN_THEMES_V2[themeId]),
    id: `custom-${themeId}`,
  });
}

describe("community Theme page presentation", () => {
  it.each([
    ["plvs-dark", "dark", "Dark Theme"],
    ["plvs-light", "light", "Light Theme"],
  ])("shows one authored appearance for %s", (themeId, colorScheme, label) => {
    expect(buildCommunityThemePresentation(portable(themeId))).toMatchObject({
      appearance: { colorScheme, label },
      compatibility: {
        status: "pending-release",
        minimumAppVersion: null,
        maximumAppVersion: null,
        label: null,
        formatVersion: 1,
        semanticsVersion: 1,
        technicalLabel: "Theme Format 1 · Semantics 1",
      },
    });
  });

  it("renders the user-facing minimum from the central release mapping", () => {
    const presentation = requireResolvedCommunityThemePresentation(portable("plvs-dark"), {
      compatibility: {
        "1:1": { minimumAppVersion: "0.18.0", maximumAppVersion: null },
      },
    });

    expect(presentation.compatibility).toMatchObject({
      status: "resolved",
      label: "Requires PLVS 0.18.0 or later",
      technicalLabel: "Theme Format 1 · Semantics 1",
    });
  });

  it("can close the range later without changing the Theme document", () => {
    const presentation = requireResolvedCommunityThemePresentation(portable("plvs-light"), {
      compatibility: {
        "1:1": { minimumAppVersion: "0.18.0", maximumAppVersion: "0.24.3" },
      },
    });
    expect(presentation.compatibility.label).toBe("Works with PLVS 0.18.0-0.24.3");
  });

  it("blocks public-page generation until the shipping release is known", () => {
    expect(() => requireResolvedCommunityThemePresentation(portable("plvs-dark"))).toThrowError(
      expect.objectContaining({ code: "minimumAppVersionPending" })
    );
  });
});
