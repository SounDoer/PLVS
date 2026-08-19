import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LEGACY_RUNTIME_IMPORTS = ["builtinThemes.js", "buildThemeTokens.js", "legacy/resolveV1Theme"];
const FROZEN_V1_MODULES = new Set(["theme/builtinThemes.js", "theme/buildThemeTokens.js"]);

function productionSources(directory = SOURCE_ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    if (![".js", ".jsx"].includes(extname(entry.name)) || entry.name.includes(".test.")) return [];

    const projectPath = relative(SOURCE_ROOT, path).replaceAll("\\", "/");
    if (
      projectPath.startsWith("theme/legacy/") ||
      projectPath.startsWith("theme/migrations/") ||
      projectPath.startsWith("theme/fixtures/") ||
      FROZEN_V1_MODULES.has(projectPath)
    )
      return [];
    return [{ path, projectPath }];
  });
}

describe("Theme V2 runtime boundary", () => {
  it("keeps frozen V1 modules outside production consumers", () => {
    const violations = [];
    for (const source of productionSources()) {
      const text = readFileSync(source.path, "utf8");
      for (const legacyImport of LEGACY_RUNTIME_IMPORTS) {
        if (text.includes(legacyImport)) violations.push(`${source.projectPath}: ${legacyImport}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
