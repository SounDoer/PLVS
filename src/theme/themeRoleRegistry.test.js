import { describe, expect, it } from "vitest";

import {
  createThemeRoleRegistry,
  getThemeRole,
  THEME_ROLE_REGISTRY,
  validateThemeRoleRegistry,
} from "./themeRoleRegistry.js";

function testRole(id, override = {}) {
  return {
    id,
    kind: "color",
    family: "test",
    recipe: "identity",
    dependencies: [],
    bindings: {},
    ...override,
  };
}

describe("Theme Role Registry", () => {
  it("validates the complete registry", () => {
    expect(validateThemeRoleRegistry(THEME_ROLE_REGISTRY)).toEqual([]);
    expect(THEME_ROLE_REGISTRY.length).toBeGreaterThan(70);
  });

  it("keeps curated editor metadata separate from dependency order", () => {
    const centroid = getThemeRole("waveform.centroid");

    expect(centroid.advanced).toMatchObject({
      section: "Waveform",
      label: "Centroid",
      allowedModes: ["color", "reference"],
    });
    expect(centroid.dependencies).toContain("core.text");
    expect(getThemeRole("missing")).toBeNull();
  });

  it("freezes the public registry deeply", () => {
    expect(Object.isFrozen(THEME_ROLE_REGISTRY)).toBe(true);
    expect(Object.isFrozen(getThemeRole("waveform.centroid").advanced)).toBe(true);
  });

  it("reports duplicate and missing IDs explicitly", () => {
    const errors = validateThemeRoleRegistry([
      testRole("a", { dependencies: ["missing"] }),
      testRole("a"),
    ]);

    expect(errors).toContain("Duplicate role ID: a.");
    expect(errors).toContain("Missing dependency for a: missing.");
  });

  it("reports dependency cycles", () => {
    const errors = validateThemeRoleRegistry([
      testRole("a", { dependencies: ["b"] }),
      testRole("b", { dependencies: ["a"] }),
    ]);

    expect(errors.some((error) => error.startsWith("Dependency cycle:"))).toBe(true);
  });

  it("reports unknown recipes and incompatible references", () => {
    const errors = validateThemeRoleRegistry([
      testRole("palette", { kind: "palette", recipe: "unknown" }),
      testRole("color", {
        advanced: {
          section: "Test",
          label: "Color",
          description: "A test color.",
          allowedModes: ["color", "reference"],
          references: ["palette"],
        },
      }),
    ]);

    expect(errors).toContain("Unknown recipe for palette: unknown.");
    expect(errors).toContain("Incompatible reference for color: palette.");
  });

  it("reports malformed Advanced metadata and duplicate bindings", () => {
    const errors = validateThemeRoleRegistry([
      testRole("a", {
        bindings: { css: ["--test"] },
        advanced: { section: "", allowedModes: [] },
      }),
      testRole("b", { bindings: { css: ["--test"] } }),
    ]);

    expect(errors).toContain("Advanced metadata is incomplete for a.");
    expect(errors).toContain("Advanced modes are missing for a.");
    expect(errors).toContain("Duplicate css binding --test: a and b.");
  });

  it("requires every direct authoring role to feed a registered consumer", () => {
    const errors = validateThemeRoleRegistry([
      testRole("core.lonely", { family: "core", authoring: true }),
    ]);

    expect(errors).toContain("Authoring role has no downstream consumer: core.lonely.");
  });

  it("refuses to create an invalid registry", () => {
    expect(() => createThemeRoleRegistry([testRole("a", { recipe: "missing" })])).toThrow(
      "Unknown recipe for a: missing."
    );
  });
});
