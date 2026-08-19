import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES, THEME_IDS } from "../builtinThemes.js";
import { V1_BUILTIN_RESOLVED } from "../fixtures/v1BuiltinResolved.js";
import { resolveV1Theme } from "./resolveV1Theme.js";

describe("resolveV1Theme", () => {
  it.each(THEME_IDS)("keeps the frozen %s compatibility baseline current", (id) => {
    expect(resolveV1Theme(BUILTIN_THEMES[id])).toEqual(V1_BUILTIN_RESOLVED[id]);
  });

  it("does not return shared mutable colormap data", () => {
    const first = resolveV1Theme(BUILTIN_THEMES["plvs-dark"]);
    const second = resolveV1Theme(BUILTIN_THEMES["plvs-dark"]);

    first.colormap[0][1][0] = 255;

    expect(second.colormap[0][1][0]).toBe(0);
  });
});
