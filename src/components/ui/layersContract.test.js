import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Everything that floats above the workspace takes its z-index from `layers.js`. Numbers written
 * in place had drifted to 50, 60/61, 70/71, 90/91 and 100, each one chosen to beat whatever its
 * author had seen last. Values below 50 are a panel's own internal stacking and stay local.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const LAYERS_FILE = join("components", "ui", "layers.js");
const Z_INDEX = /\bz-(?:\[(\d+)\]|(\d+))(?![\w-])/g;

function floatingLayerLiterals(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      floatingLayerLiterals(path, out);
      continue;
    }
    if (!/\.jsx?$/.test(entry) || entry.includes(".test.")) continue;
    if (path.endsWith(LAYERS_FILE)) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(Z_INDEX)) {
      if (Number(match[1] ?? match[2]) >= 50) out.push(`${path.slice(SRC.length)}: ${match[0]}`);
    }
  }
  return out;
}

describe("layers contract", () => {
  it("writes floating-layer z-index values only in layers.js", () => {
    expect(floatingLayerLiterals()).toEqual([]);
  });
});
