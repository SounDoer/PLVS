import { describe, expect, it, vi } from "vitest";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import {
  ThemeDocumentError,
  listThemeSummaries,
  planThemeCreate,
  planThemeDelete,
  planThemeDuplicate,
  planThemeFollowSystem,
  planThemeRename,
  planThemeReorder,
  planThemeSelect,
  planThemeUpdate,
  validateThemeDocument,
} from "./themeLibrary.js";

function authoring(overrides = {}) {
  const { id: _id, ...document } = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);
  return { ...document, name: "  Studio  ", ...overrides };
}

const CUSTOM_DARK = {
  id: "custom-dark",
  ...validateThemeDocument(authoring({ name: "Dark Custom" })),
};
const CUSTOM_LIGHT = {
  id: "custom-light",
  ...validateThemeDocument({
    ...authoring({ name: "Light Custom" }),
    colorScheme: "light",
  }),
};

function state(selectedThemeId = null) {
  return {
    appearance: selectedThemeId
      ? { mode: "fixed", selectedThemeId, resolvedThemeId: selectedThemeId }
      : { mode: "system", selectedThemeId: null, resolvedThemeId: "plvs-dark" },
    themes: [CUSTOM_DARK, CUSTOM_LIGHT],
  };
}

describe("Theme Control authoring validation", () => {
  it("returns a normalized id-free Theme V2 document", () => {
    const document = validateThemeDocument({
      ...authoring(),
      core: { ...authoring().core, workspace: "rgb(16 17 20)" },
    });
    expect(document).toMatchObject({ version: 2, name: "Studio", colorScheme: "dark" });
    expect(document.core.workspace).toBe("#101114");
    expect(document).not.toHaveProperty("id");
  });

  it("rejects unknown, incomplete, repairable, palette, stop, and override input", () => {
    const invalid = authoring({
      id: "caller-owned",
      extra: true,
      name: " ",
      colorScheme: "auto",
      core: { workspace: "#00000000", extra: "#000000" },
      palettes: {
        status: {
          presetId: "missing",
          good: "#000",
          warning: "#fff",
          critical: "transparent",
          extra: 1,
        },
        intensity: {
          presetId: null,
          stops: [
            { position: 0.5, color: "#000" },
            { position: 0.4, color: "#fff", extra: true },
          ],
        },
        frequency: null,
        // Missing interface is intentionally not migrated from status.
      },
      overrides: {
        "missing.role": { kind: "color", value: "#fff", extra: true },
        "interface.border.default": { kind: "color", value: "#fff" },
        "interface.text.primary": { kind: "reference", source: "missing.role" },
      },
    });
    let error;
    try {
      validateThemeDocument(invalid);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ThemeDocumentError);
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknownField", path: "$.id" }),
        expect.objectContaining({ code: "unknownField", path: "$.extra" }),
        expect.objectContaining({ code: "invalidName", path: "$.name" }),
        expect.objectContaining({ code: "invalidColorScheme", path: "$.colorScheme" }),
        expect.objectContaining({ code: "invalidColor", path: "$.core.workspace" }),
        expect.objectContaining({ code: "invalidColor", path: "$.core.surface" }),
        expect.objectContaining({ code: "invalidPresetId", path: "$.palettes.status.presetId" }),
        expect.objectContaining({
          code: "unorderedStops",
          path: "$.palettes.intensity.stops[1].position",
        }),
        expect.objectContaining({
          code: "invalidEndpoint",
          path: "$.palettes.intensity.stops[0].position",
        }),
        expect.objectContaining({ code: "invalidObject", path: "$.palettes.frequency" }),
        expect.objectContaining({ code: "invalidObject", path: "$.palettes.interface" }),
        expect.objectContaining({ code: "unknownRole", path: "$.overrides.missing.role" }),
        expect.objectContaining({
          code: "overrideNotAllowed",
          path: "$.overrides.interface.text.primary.kind",
        }),
        expect.objectContaining({
          code: "incompatibleReference",
          path: "$.overrides.interface.text.primary.source",
        }),
      ])
    );
  });

  it("rejects non-objects and invalid effect bounds", () => {
    for (const input of [null, [], "theme"]) {
      expect(() => validateThemeDocument(input)).toThrow(ThemeDocumentError);
    }
    expect(() =>
      validateThemeDocument({
        ...authoring(),
        overrides: { "interface.border.default": { kind: "effect", color: "#fff", opacity: 2 } },
      })
    ).toThrow(ThemeDocumentError);
  });
});

describe("Theme library planning", () => {
  it("lists built-ins first and selects fixed Themes or follows the system", () => {
    expect(listThemeSummaries(state()).map(({ id }) => id)).toEqual([
      "plvs-dark",
      "plvs-light",
      "custom-dark",
      "custom-light",
    ]);
    const selected = planThemeSelect(state(), "custom-dark");
    expect(selected.state.appearance).toEqual({
      mode: "fixed",
      selectedThemeId: "custom-dark",
      resolvedThemeId: "custom-dark",
    });
    expect(planThemeSelect(selected.state, "custom-dark").changed).toEqual([]);
    expect(planThemeSelect(state(), "missing").issues[0].code).toBe("themeNotFound");
    expect(planThemeFollowSystem(selected.state, "plvs-light").state.appearance).toEqual({
      mode: "system",
      selectedThemeId: null,
      resolvedThemeId: "plvs-light",
    });
  });

  it("plans create without an ID and allocates exactly once only when requested", () => {
    const current = state();
    const preview = planThemeCreate(current, authoring());
    expect(preview.issues).toEqual([]);
    expect(preview.theme).toBeUndefined();
    expect(preview.state).toBe(current);
    expect(preview.selectCreated).toBe(true);

    const makeId = vi.fn(() => "custom-new");
    const planned = planThemeCreate(current, authoring(), { makeId });
    expect(makeId).toHaveBeenCalledTimes(1);
    expect(planned.theme).toMatchObject({ id: "custom-new", name: "Studio" });
    expect(planned.state.themes).toHaveLength(3);
    expect(planned.state.appearance.selectedThemeId).toBe("custom-new");
    expect(current.themes).toEqual([CUSTOM_DARK, CUSTOM_LIGHT]);

    expect(
      planThemeCreate(current, authoring(), { makeId: () => "custom-dark" }).issues[0].code
    ).toBe("duplicateThemeId");
  });

  it("updates and renames custom Themes in place, detects no-ops, and rejects built-ins", () => {
    const current = state("custom-light");
    const updated = planThemeUpdate(current, "custom-dark", authoring({ name: "Changed" }));
    expect(updated.theme).toMatchObject({ id: "custom-dark", name: "Changed" });
    expect(updated.state.themes.map(({ id }) => id)).toEqual(["custom-dark", "custom-light"]);
    expect(updated.state.appearance).toBe(current.appearance);
    expect(
      planThemeUpdate(updated.state, "custom-dark", authoring({ name: "Changed" })).changed
    ).toEqual([]);

    const renamed = planThemeRename(current, "custom-dark", "  Renamed  ");
    expect(renamed.theme.name).toBe("Renamed");
    expect(planThemeRename(renamed.state, "custom-dark", "Renamed").changed).toEqual([]);
    expect(planThemeRename(current, "plvs-dark", "No").issues[0].code).toBe("themeNotMutable");
    expect(planThemeUpdate(current, "missing", authoring()).issues[0].code).toBe("themeNotFound");
  });

  it("duplicates built-in or custom Themes and dry-run does not fabricate an ID", () => {
    const preview = planThemeDuplicate(state(), "plvs-light", " Light Copy ");
    expect(preview.theme).toBeUndefined();
    expect(preview.source).toEqual({ id: "plvs-light", name: "Light", kind: "builtin" });
    expect(preview.name).toBe("Light Copy");

    const planned = planThemeDuplicate(state(), "custom-dark", "Copy", {
      makeId: () => "custom-copy",
    });
    expect(planned.theme).toMatchObject({ id: "custom-copy", name: "Copy", colorScheme: "dark" });
    expect(planned.state.appearance.selectedThemeId).toBe("custom-copy");
    expect(planThemeDuplicate(state(), "missing", "Copy").issues[0].code).toBe("themeNotFound");
  });

  it("deletes only custom Themes and uses the active Theme color scheme for fixed fallback", () => {
    const light = planThemeDelete(state("custom-light"), "custom-light");
    expect(light.fallbackThemeId).toBe("plvs-light");
    expect(light.state.appearance.selectedThemeId).toBe("plvs-light");
    expect(light.state.themes.map(({ id }) => id)).toEqual(["custom-dark"]);

    const current = state("custom-light");
    const inactive = planThemeDelete(current, "custom-dark");
    expect(inactive.fallbackThemeId).toBeNull();
    expect(inactive.state.appearance).toBe(current.appearance);
    expect(planThemeDelete(state(), "plvs-dark").issues[0].code).toBe("themeNotMutable");
    expect(planThemeDelete(state(), "missing").issues[0].code).toBe("themeNotFound");
  });

  it("requires an exact custom-ID permutation and preserves document identity", () => {
    const current = state();
    const reordered = planThemeReorder(current, ["custom-light", "custom-dark"]);
    expect(reordered.state.themes).toEqual([CUSTOM_LIGHT, CUSTOM_DARK]);
    expect(planThemeReorder(current, ["custom-dark", "custom-light"]).changed).toEqual([]);
    for (const invalid of [
      ["custom-dark"],
      ["custom-dark", "custom-dark"],
      ["plvs-dark", "custom-light"],
      ["custom-dark", "missing"],
    ]) {
      expect(planThemeReorder(current, invalid).issues[0].code).toBe("invalidPermutation");
    }
  });
});
