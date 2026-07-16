import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["components", "workspace", "lib"];
const fixedTypeUtility = /text-\[(?:10|11)px\]|text-(?:xs|sm|base|lg|xl)(?![\w-])/g;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (![".js", ".jsx"].includes(extname(entry.name)) || entry.name.includes(".test.")) return [];
    return [path];
  });
}

describe("normal-mode typography contract", () => {
  it("routes fixed interface font sizes through semantic tokens", () => {
    const violations = roots.flatMap((root) =>
      sourceFiles(join(srcDir, root)).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(fixedTypeUtility)].map(
          (match) => `${path.slice(srcDir.length + 1)}: ${match[0]}`
        );
      })
    );

    expect(violations).toEqual([]);
  });
});
