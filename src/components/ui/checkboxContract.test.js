import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COMPONENTS = fileURLToPath(new URL("..", import.meta.url));
const CHECKBOX_PRIMITIVES = new Set(
  ["./checkbox.jsx", "./switch.jsx"].map((path) => fileURLToPath(new URL(path, import.meta.url)))
);

function sourceFiles(dir = COMPONENTS) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".js", ".jsx"].includes(extname(path)) && !CHECKBOX_PRIMITIVES.has(path) ? [path] : [];
  });
}

describe("checkbox contract", () => {
  it("routes native checkboxes through the shared Checkbox and Switch", () => {
    const offenders = sourceFiles()
      .filter((path) => /type=["']checkbox["']/.test(readFileSync(path, "utf8")))
      .map((path) => relative(COMPONENTS, path).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });
});
