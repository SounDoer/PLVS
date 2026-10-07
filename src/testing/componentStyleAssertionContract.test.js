import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);
const STYLE_ASSERTION =
  /\.(?:className|classList)\b|getAttribute\(\s*["']class["']\s*\)|\btoHaveClass\s*\(/;

function testFiles(directory = SRC_ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    if (path === THIS_FILE || !/\.test\.jsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe("component style assertion contract", () => {
  it("keeps component tests on behavior instead of rendered class strings", () => {
    const violations = testFiles().flatMap((path) =>
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .flatMap((line, index) =>
          STYLE_ASSERTION.test(line)
            ? [`${relative(SRC_ROOT, path).replaceAll("\\", "/")}:${index + 1}`]
            : []
        )
    );

    expect(
      violations,
      "Assert behavior or semantic state in component tests; use design-rule guards or cold-start screenshots for appearance."
    ).toEqual([]);
  });
});
