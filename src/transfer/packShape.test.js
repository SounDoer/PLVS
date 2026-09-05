import { describe, expect, it } from "vitest";
import { PACK_KINDS, PACK_VERSION, buildPack } from "./packShape.js";
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
