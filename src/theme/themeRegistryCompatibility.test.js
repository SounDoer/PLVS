import { describe, expect, it } from "vitest";

import { validateThemeRegistryCompatibility } from "./themeRegistryCompatibility.js";

describe("validateThemeRegistryCompatibility", () => {
  it("aggregates unknown targets, forbidden modes, and incompatible references", () => {
    expect(
      validateThemeRegistryCompatibility({
        overrides: {
          missing: { kind: "color", value: "#ffffff" },
          "interface.text.primary": { kind: "effect", color: "#ffffff", opacity: 1 },
          "spectrum.primary": { kind: "reference", source: "palette.status.safe" },
        },
      })
    ).toEqual([
      expect.objectContaining({ code: "unknownRole", path: "$.overrides.missing" }),
      expect.objectContaining({
        code: "overrideNotAllowed",
        path: "$.overrides.interface.text.primary.kind",
      }),
      expect.objectContaining({
        code: "incompatibleReference",
        path: "$.overrides.spectrum.primary.source",
      }),
    ]);
  });
});
