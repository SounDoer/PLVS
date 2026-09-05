import { describe, expect, it } from "vitest";
import {
  PACK_KINDS,
  PACK_VERSION,
  PackValidationError,
  buildPack,
  parsePack,
} from "./packShape.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";

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
    expect(pack.items.length).toBe(1);
    expect(pack.items[0].id).toBe("t1");
  });

  it("drops a malformed theme document", () => {
    const pack = buildPack("themes", [{ version: 2, id: "bad" }], { exportedAt: "x" });
    expect(pack.items).toEqual([]);
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

  it("drops items the normalizer rejects rather than failing the file", () => {
    const parsed = parsePack({ ...good, items: [{ nope: true }] }, "themes");
    expect(parsed.items).toEqual([]);
  });

  it("defaults a preset pack's loudnessProfiles to an empty array", () => {
    const parsed = parsePack(
      { app: "PLVS", kind: "preset-pack", version: 1, exportedAt: "x", items: [] },
      "presets"
    );
    expect(parsed.loudnessProfiles).toEqual([]);
  });
});
