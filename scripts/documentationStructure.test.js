import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

import { MODULE_CATALOG } from "../src/workspace/moduleCatalog.js";

/**
 * Guards the documentation layout described in `docs/README.md`: claims that code owns are asserted
 * against the code, and the boundary between living documents and frozen records is enforced here
 * rather than by review.
 */

const read = (...parts) => readFileSync(join(cwd(), ...parts), "utf8");

const readmePanelTitles = () => {
  const readme = read("README.md");
  const table = readme.slice(readme.indexOf("| Panel"));
  const rows = table.slice(0, table.indexOf("\n\n")).split("\n").slice(2);
  return rows.map((row) => row.split("|")[1].trim().replaceAll("*", ""));
};

const collectMarkdown = (dir, skip) => {
  const entries = [];
  for (const name of readdirSync(join(cwd(), dir))) {
    const path = join(dir, name);
    if (skip.includes(path.replaceAll("\\", "/"))) continue;
    if (statSync(join(cwd(), path)).isDirectory()) {
      entries.push(...collectMarkdown(path, skip));
    } else if (name.endsWith(".md")) {
      entries.push(path.replaceAll("\\", "/"));
    }
  }
  return entries;
};

describe("documentation structure", () => {
  it("lists exactly the panels the workspace ships", () => {
    const catalogTitles = Object.values(MODULE_CATALOG).map((module) => module.title);
    const readmeTitles = readmePanelTitles();

    expect(readmeTitles).toHaveLength(catalogTitles.length);
    expect([...readmeTitles].sort()).toEqual([...catalogTitles].sort());
  });

  it("keeps frozen records under docs/history only", () => {
    expect(existsSync(join(cwd(), "docs", "history", "README.md"))).toBe(true);
    // The brainstorming and planning skills default to these paths; AGENTS.md overrides them, and
    // this assertion is what makes the override visible when it is ignored.
    expect(existsSync(join(cwd(), "docs", "superpowers"))).toBe(false);
    expect(existsSync(join(cwd(), "docs", "working"))).toBe(false);
  });

  it("does not cite frozen records from living documents", () => {
    // docs/README.md and AGENTS.md describe where records go; ADRs are themselves frozen and may
    // record the design document a decision came from.
    const skip = ["docs/history", "docs/adr", "docs/README.md"];
    const documents = [...collectMarkdown("docs", skip), "README.md", "CONTRIBUTING.md"];
    const citations = documents.flatMap((path) => {
      const matches = read(path).match(/history\/(specs|plans|notes|mockups)\/[^\s)`]+/g) ?? [];
      return matches.map((match) => `${relative(".", path)} → ${match}`);
    });

    expect(citations).toEqual([]);
  });
});
