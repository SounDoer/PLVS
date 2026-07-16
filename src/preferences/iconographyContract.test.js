import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["components", "workspace"];
const geometryIconNames = new Set(["GripVertical"]);
const fixedIconSize =
  /\bsize=(?:\{\d+\}|["']\d+["'])|\bsize-(?:3|3\.5|4)(?![\w.-])|\bsize-\[\d+px\]/g;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "dock" ? [] : sourceFiles(path);
    if (![".js", ".jsx"].includes(extname(entry.name)) || entry.name.includes(".test.")) return [];
    return [path];
  });
}

function lucideNames(source) {
  return [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g)].flatMap(
    ([, imports]) =>
      imports
        .split(",")
        .map((name) =>
          name
            .trim()
            .split(/\s+as\s+/)
            .at(-1)
        )
        .filter(Boolean)
  );
}

describe("normal-mode iconography contract", () => {
  it("routes Lucide icon sizes through semantic tokens or local em sizing", () => {
    const violations = roots.flatMap((root) =>
      sourceFiles(join(srcDir, root)).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return lucideNames(source).flatMap((name) => {
          if (geometryIconNames.has(name)) return [];
          const openingTag = new RegExp("<" + name + "\\b[^>]*>", "g");
          return [...source.matchAll(openingTag)].flatMap(([tag]) =>
            [...tag.matchAll(fixedIconSize)].map(
              (match) => path.slice(srcDir.length + 1) + ": " + name + ": " + match[0]
            )
          );
        });
      })
    );

    expect(violations).toEqual([]);
  });

  it("keeps module identity separate from its presentation size", () => {
    const registry = readFileSync(join(srcDir, "workspace", "registry.jsx"), "utf8");

    expect(registry).not.toMatch(/Icon:\s*\(\)\s*=>/);
    expect(registry).not.toMatch(/size=\{\d+\}/);
  });
});
