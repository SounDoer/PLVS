import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SCRIM_CLASS } from "./surfaceStyles.js";

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.jsx?$/.test(entry) && !entry.includes(".test.")) {
      out.push([path.slice(SRC.length), readFileSync(path, "utf8")]);
    }
  }
  return out;
}

describe("scrim", () => {
  it("darkens rather than following the theme", () => {
    // A theme-derived scrim inverts on a light theme: the retired effect.scrim
    // role tinted the workspace, which there is a near-white veil.
    expect(SCRIM_CLASS).toContain("bg-black/");
  });

  it("is the only dim any modal spells out", () => {
    // Four dialogs and the settings sheet each carried their own literal, at two
    // different opacities, for no reason either of them could state.
    const offenders = sources()
      .filter(([, source]) => /bg-black\/\d/.test(source))
      .map(([path]) => path)
      .filter((path) => !path.endsWith("surfaceStyles.js"));

    expect(offenders).toEqual([]);
  });
});
