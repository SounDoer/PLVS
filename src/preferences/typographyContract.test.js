import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["components", "workspace", "lib", "preferences"];
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

  it("keeps chart axis geometry on the shared responsive token pair", () => {
    const sources = roots
      .flatMap((root) => sourceFiles(join(srcDir, root)))
      .map((path) => ({
        path,
        source: readFileSync(path, "utf8"),
      }));

    const retiredYAxisUsages = sources.flatMap(({ path, source }) =>
      source.includes("--ui-w-axis-rail") ? [path.slice(srcDir.length + 1)] : []
    );
    const localYAxisOverrides = sources.flatMap(({ path, source }) =>
      /["']--ui-chart-y-axis-rail-w["']\s*:/.test(source) ? [path.slice(srcDir.length + 1)] : []
    );

    expect(retiredYAxisUsages).toEqual([]);
    expect(localYAxisOverrides).toEqual([]);
  });
});
