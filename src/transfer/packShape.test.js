import { describe, expect, it } from "vitest";
import {
  PACK_KINDS,
  PACK_VERSION,
  LOUDNESS_PACK_VERSION,
  THEME_PACK_VERSION,
  PackValidationError,
  buildPack,
  parseClipboardTheme,
  parsePack,
  parsePackText,
} from "./packShape.js";
import { MAX_PACK_BYTES } from "./packV2.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { themeToPortable } from "../theme/portableTheme.js";

describe("buildPack", () => {
  it("stamps the envelope for a loudness pack", () => {
    const pack = buildPack("loudness", [{ id: "a", name: "A", referenceLufs: -23, rules: [] }], {
      exportedAt: "2026-09-05T00:00:00.000Z",
    });
    expect(pack).toEqual({
      app: "PLVS",
      kind: "loudness-pack",
      version: LOUDNESS_PACK_VERSION,
      items: [
        {
          id: "a",
          kind: "plvs-loudness-profile",
          formatVersion: 1,
          semanticsVersion: 1,
          name: "A",
          referenceLufs: -23,
          rules: [],
        },
      ],
      dependencies: [],
    });
  });

  it("rejects invalid Loudness Profiles instead of silently dropping them", () => {
    expect(() => buildPack("loudness", [{ name: "no id" }])).toThrowError(
      expect.objectContaining({ issues: [expect.objectContaining({ code: "invalidProfileId" })] })
    );
  });

  it("carries referenced profiles on a preset pack and omits unreferenced ones", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:a", tree: null };
    const profiles = [
      { id: "a", name: "A", referenceLufs: -23, rules: [] },
      { id: "b", name: "B", referenceLufs: -16, rules: [] },
    ];
    const pack = buildPack("presets", [preset], {
      exportedAt: "x",
      loudnessProfiles: profiles,
    });
    expect(pack.loudnessProfiles.map((p) => p.id)).toEqual(["a"]);
  });

  it("omits the loudnessProfiles field on non-preset kinds", () => {
    const pack = buildPack("loudness", [{ id: "a", name: "A", referenceLufs: -23, rules: [] }]);
    expect("loudnessProfiles" in pack).toBe(false);
  });

  it("refuses to export an empty Loudness Profile pack", () => {
    expect(() => buildPack("loudness", [])).toThrowError(
      expect.objectContaining({ issues: [expect.objectContaining({ code: "emptyItems" })] })
    );
  });

  it("exposes one descriptor per kind", () => {
    expect(Object.keys(PACK_KINDS).sort()).toEqual(["loudness", "presets", "themes"]);
    expect(PACK_KINDS.themes.extension).toBe("plvstheme");
  });

  it("stamps the envelope for a theme pack", () => {
    const theme = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id: "t1", name: "T1" };
    const pack = buildPack("themes", [theme], { exportedAt: "x" });
    expect(Object.keys(pack)).toEqual(["app", "kind", "version", "items", "dependencies"]);
    expect(pack.kind).toBe("theme-pack");
    expect(pack.version).toBe(THEME_PACK_VERSION);
    expect(pack.dependencies).toEqual([]);
    expect(pack.items.length).toBe(1);
    expect(pack.items[0].id).toBe("t1");
    expect(pack.items[0].kind).toBe("plvs-theme");
    expect(pack.items[0].palettes.status).not.toHaveProperty("presetId");
  });

  it("refuses to export an empty Theme pack", () => {
    expect(() => buildPack("themes", [])).toThrowError(
      expect.objectContaining({ issues: [expect.objectContaining({ code: "emptyItems" })] })
    );
  });

  it("rejects a malformed theme document instead of silently dropping it", () => {
    expect(() => buildPack("themes", [{ version: 2, id: "bad" }], { exportedAt: "x" })).toThrow(
      PackValidationError
    );
  });
});

describe("parsePack", () => {
  const good = {
    app: "PLVS",
    kind: "theme-pack",
    version: 1,
    exportedAt: "2026-09-05T00:00:00.000Z",
    items: [],
  };

  it("accepts a well-formed pack of the expected type", () => {
    expect(parsePack(good, "themes")).toEqual({ ...good, items: [] });
  });

  it("rejects a non-object", () => {
    expect(() => parsePack("nope", "themes")).toThrow(PackValidationError);
    expect(() => parsePack("nope", "themes")).toThrow(/not a PLVS file/i);
  });

  it("rejects a file from another app", () => {
    expect(() => parsePack({ ...good, app: "OTHER" }, "themes")).toThrow(/not a PLVS file/i);
  });

  it("names the right row when the kind is a known but different pack", () => {
    expect(() => parsePack({ ...good, kind: "preset-pack" }, "themes")).toThrow(
      "This is a Presets file. Import it from the Presets row."
    );
  });

  it("falls back to the generic message when the kind matches nothing known", () => {
    expect(() => parsePack({ ...good, kind: "widget-pack" }, "themes")).toThrow(/not a PLVS file/i);
    expect(() => parsePack({ ...good, kind: 42 }, "themes")).toThrow(/not a PLVS file/i);
  });

  it("rejects the whole-configuration file with its own message", () => {
    expect(() => parsePack({ ...good, kind: "configuration-profile" }, "themes")).toThrow(
      /whole configuration/i
    );
  });

  it("rejects a newer version", () => {
    expect(() => parsePack({ ...good, version: 99 }, "themes")).toThrow(/newer version/i);
  });

  it("rejects a missing version", () => {
    expect(() => parsePack({ ...good, version: "1" }, "themes")).toThrow(/missing a version/i);
  });

  it("rejects invalid legacy Theme entries rather than silently dropping them", () => {
    expect(() => parsePack({ ...good, items: [{ nope: true }] }, "themes")).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ path: "$.items[0]" })],
      })
    );
  });

  it("imports the portable Theme envelope into the current stored shape", () => {
    const theme = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id: "t1", name: "T1" };
    const portablePack = buildPack("themes", [theme], { exportedAt: "x" });
    const parsed = parsePack(portablePack, "themes");
    expect(parsed.version).toBe(THEME_PACK_VERSION);
    expect(parsed.items).toEqual([
      expect.objectContaining({ id: "t1", name: "T1", formatVersion: 2 }),
    ]);
    expect(parsed.items[0].palettes.status.presetId).toBeNull();
  });

  it("aggregates invalid portable entries and duplicate IDs", () => {
    const theme = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id: "t1", name: "T1" };
    const pack = buildPack("themes", [theme], { exportedAt: "x" });
    pack.items.push(structuredClone(pack.items[0]));
    pack.items[0].core.workspace = "transparent";
    expect(() => parsePack(pack, "themes")).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "$.items[0].core.workspace" }),
          expect.objectContaining({ code: "duplicateThemeId", path: "$.items[1].id" }),
        ]),
      })
    );
  });

  it("enforces the shared Pack V2 envelope for Theme packs", () => {
    const theme = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id: "t1", name: "T1" };
    const pack = buildPack("themes", [theme]);
    const issuesOf = (raw) => {
      try {
        parsePack(raw, "themes");
      } catch (error) {
        return error.issues.map(({ code, path }) => ({ code, path }));
      }
      return [];
    };

    expect(issuesOf({ ...pack, exportedAt: "x" })).toEqual([
      { code: "unknownField", path: "$.exportedAt" },
    ]);
    const { dependencies: _dependencies, ...withoutDependencies } = pack;
    expect(issuesOf(withoutDependencies)).toEqual([
      { code: "invalidDependencies", path: "$.dependencies" },
    ]);
    expect(issuesOf({ ...pack, dependencies: [{ kind: "loudness-profile", items: [] }] })).toEqual([
      { code: "unsupportedDependency", path: "$.dependencies" },
    ]);
    expect(issuesOf({ ...pack, items: [] })).toEqual([{ code: "invalidItems", path: "$.items" }]);
    expect(issuesOf({ ...pack, createdWith: { appVersion: "0.17.0", host: "x" } })).toEqual([
      { code: "unknownField", path: "$.createdWith.host" },
    ]);
    expect(issuesOf({ ...pack, createdWith: { appVersion: "0.17.0" } })).toEqual([]);
  });

  it("defaults a preset pack's loudnessProfiles to an empty array", () => {
    const parsed = parsePack(
      { app: "PLVS", kind: "preset-pack", version: 1, exportedAt: "x", items: [] },
      "presets"
    );
    expect(parsed.loudnessProfiles).toEqual([]);
  });

  it("imports strict Loudness Pack V2 and retains tolerant Pack V1 import", () => {
    const profile = {
      id: "profile-a",
      name: "Broadcast",
      referenceLufs: -23,
      rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
    };
    const pack = buildPack("loudness", [profile]);
    expect(parsePack(pack, "loudness").items).toEqual([profile]);

    expect(
      parsePack(
        {
          app: "PLVS",
          kind: "loudness-pack",
          version: PACK_VERSION,
          exportedAt: "legacy",
          items: [{ ...profile, rules: [...profile.rules, { metricId: "unknown" }] }],
        },
        "loudness"
      )
    ).toEqual({
      app: "PLVS",
      kind: "loudness-pack",
      version: PACK_VERSION,
      exportedAt: "legacy",
      items: [profile],
    });
  });

  it("aggregates invalid Loudness Pack V2 entries and duplicate IDs", () => {
    const profile = { id: "profile-a", name: "Broadcast", referenceLufs: -23, rules: [] };
    const pack = buildPack("loudness", [profile]);
    pack.items.push(structuredClone(pack.items[0]));
    pack.items[0].rules.push({ metricId: "truePeak", op: ">", severity: "fail" });
    expect(() => parsePack(pack, "loudness")).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "incompleteRule", path: "$.items[0].rules[0].value" }),
          expect.objectContaining({ code: "duplicateProfileId", path: "$.items[1].id" }),
        ]),
      })
    );
  });
});

describe("parsePackText", () => {
  it("rejects oversized input before JSON parsing", () => {
    expect(() => parsePackText("x".repeat(MAX_PACK_BYTES + 1), "loudness")).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            severity: "error",
            code: "packTooLarge",
            path: "$",
          }),
        ],
      })
    );
  });

  it("distinguishes invalid JSON from a structurally invalid Pack", () => {
    expect(() => parsePackText("not json", "loudness")).toThrowError(
      expect.objectContaining({ issues: [expect.objectContaining({ code: "invalidJson" })] })
    );
    expect(() => parsePackText("{}", "loudness")).toThrow("This is not a PLVS file.");
  });
});

describe("parseClipboardTheme", () => {
  it("accepts the canonical portable document directly", () => {
    const portable = themeToPortable({
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-web",
      name: "From Community",
    });

    expect(parseClipboardTheme(portable)).toMatchObject({
      kind: "theme-pack",
      version: THEME_PACK_VERSION,
      items: [{ id: "custom-shared-theme", name: "From Community", formatVersion: 2 }],
    });
  });

  it("gives clipboard-specific errors for unrelated or newer content", () => {
    expect(() => parseClipboardTheme({ message: "hello" })).toThrow(
      "Clipboard doesn't contain a PLVS Theme."
    );
    const portable = themeToPortable({
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-web",
    });
    expect(() => parseClipboardTheme({ ...portable, formatVersion: 99 })).toThrow(
      "This Theme requires a newer version of PLVS."
    );
  });
});

describe("direct portable Theme files", () => {
  it("imports the same canonical document served by Download .plvstheme", () => {
    const portable = themeToPortable({
      ...structuredClone(BUILTIN_THEMES_V2["plvs-light"]),
      id: "custom-download",
      name: "Downloaded Theme",
    });

    expect(parsePack(portable, "themes")).toMatchObject({
      kind: "theme-pack",
      version: THEME_PACK_VERSION,
      items: [{ id: "custom-shared-theme", name: "Downloaded Theme", colorScheme: "light" }],
    });
  });

  it("keeps direct portable files out of unrelated library imports", () => {
    const portable = themeToPortable({
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-download",
    });
    expect(() => parsePack(portable, "presets")).toThrow("This is not a PLVS file.");
  });
});
