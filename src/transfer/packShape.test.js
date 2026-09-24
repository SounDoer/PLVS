import { describe, expect, it } from "vitest";
import {
  PACK_KINDS,
  PACK_VERSION,
  THEME_PACK_VERSION,
  PackValidationError,
  buildPack,
  parseClipboardTheme,
  parsePack,
} from "./packShape.js";
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
      version: PACK_VERSION,
      exportedAt: "2026-09-05T00:00:00.000Z",
      items: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
    });
  });

  it("drops items the normalizer rejects", () => {
    const pack = buildPack("loudness", [{ name: "no id" }], { exportedAt: "x" });
    expect(pack.items).toEqual([]);
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
    const pack = buildPack("loudness", [], { exportedAt: "x" });
    expect("loudnessProfiles" in pack).toBe(false);
  });

  it("exposes one descriptor per kind", () => {
    expect(Object.keys(PACK_KINDS).sort()).toEqual(["loudness", "presets", "themes"]);
    expect(PACK_KINDS.themes.extension).toBe("plvstheme");
  });

  it("stamps the envelope for a theme pack", () => {
    const theme = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id: "t1", name: "T1" };
    const pack = buildPack("themes", [theme], { exportedAt: "x" });
    expect(pack.kind).toBe("theme-pack");
    expect(pack.version).toBe(THEME_PACK_VERSION);
    expect(pack.items.length).toBe(1);
    expect(pack.items[0].sourceId).toBe("t1");
    expect(pack.items[0].document.kind).toBe("plvs-theme");
    expect(pack.items[0].document).not.toHaveProperty("id");
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

  it("aggregates invalid portable entries and duplicate source IDs", () => {
    const theme = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id: "t1", name: "T1" };
    const pack = buildPack("themes", [theme], { exportedAt: "x" });
    pack.items.push(structuredClone(pack.items[0]));
    pack.items[0].document.core.workspace = "transparent";
    expect(() => parsePack(pack, "themes")).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "$.items[0].document.core.workspace" }),
          expect.objectContaining({ code: "duplicateThemeId" }),
        ]),
      })
    );
  });

  it("defaults a preset pack's loudnessProfiles to an empty array", () => {
    const parsed = parsePack(
      { app: "PLVS", kind: "preset-pack", version: 1, exportedAt: "x", items: [] },
      "presets"
    );
    expect(parsed.loudnessProfiles).toEqual([]);
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
