import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

import { commandEntries } from "../src/agentControl/commandManifest.js";
import { standardLayoutIdForCount } from "../src/math/channelLayoutTable.js";
import { MODULE_CATALOG } from "../src/workspace/moduleCatalog.js";
import { releaseAssetNames } from "./release-assets.mjs";

/**
 * Guards the documentation layout described in `docs/README.md`: claims that code owns are asserted
 * against the code, and the boundary between living documents and frozen records is enforced here
 * rather than by review. Prose is deliberately not asserted; it is reconciled at release.
 */

const read = (...parts) => readFileSync(join(cwd(), ...parts), "utf8");

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

/** Documents written for people who do not know the project. */
const PUBLIC_DOCUMENTS = ["README.md", ...collectMarkdown("docs/user", []), "landing/index.html"];

/** The body of a Markdown section, from its heading to the next heading of any level. */
const sectionBody = (markdown, heading) => {
  const start = markdown.indexOf(`\n${heading}\n`);
  if (start === -1) return null;
  const body = markdown.slice(start + heading.length + 2);
  const next = body.search(/^#{1,6} /m);
  return next === -1 ? body : body.slice(0, next);
};

describe("documentation structure", () => {
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

  it("resolves relative links in the user guide and the root documents", () => {
    const documents = [...collectMarkdown("docs/user", []), "README.md", "CONTRIBUTING.md"];
    const broken = documents.flatMap((path) =>
      [...read(path).matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)]
        .map(([, target]) => target)
        .filter((target) => !/^[a-z]+:/.test(target))
        .filter((target) => !existsSync(join(cwd(), dirname(path), target)))
        .map((target) => `${path} → ${target}`)
    );

    expect(broken).toEqual([]);
  });

  it("leaves Agent Control command syntax to the generated catalog", () => {
    // A fence made only of command lines restates generated/commands.md and drifts from it.
    // Fences that show a workflow (piping, JSON results) carry more than syntax and stay.
    const pages = collectMarkdown("docs/agent-control", ["docs/agent-control/generated"]);
    const syntaxOnly = pages.filter((path) =>
      [...read(path).matchAll(/```[a-z]*\n([\s\S]*?)```/g)].some(([, body]) => {
        const lines = body.split("\n").filter((line) => line.trim());
        return (
          lines.length > 0 &&
          lines.every((line) => /^(plvs-cli|npm run desktop:control)\b/.test(line.trim()))
        );
      })
    );

    expect(syntaxOnly).toEqual([]);
  });
});

describe("public documents state what the code ships", () => {
  it("lists exactly the panels the workspace ships", () => {
    const panels = read("docs", "user", "panels.md");
    const table = panels.slice(panels.indexOf("| Panel"));
    const rows = table.slice(0, table.indexOf("\n\n")).split("\n").slice(2);
    const documented = rows.map((row) => row.split("|")[1].trim());
    const shipped = Object.values(MODULE_CATALOG).map((module) => module.title);

    expect([...documented].sort()).toEqual([...shipped].sort());
  });

  it("lists exactly the channel layouts detected automatically", () => {
    const body = sectionBody(
      read("docs", "user", "multichannel.md"),
      "## Automatic layout detection"
    );
    const sentence = body?.trim().split(/ are recognised/)[0] ?? "";
    const documented = sentence.split(/, and |, /).map((name) => name.trim().toLowerCase());
    const detected = [1, 2, 3, 4, 5, 6, 7, 8].map(standardLayoutIdForCount);

    expect(documented).toEqual(detected);
  });

  it("states the macOS minimum version the bundle declares", () => {
    // Prose ("macOS 14.2", "**macOS** 14.2") and the landing page's spec row.
    const macosVersion =
      /macOS(?:\*\*)?(?: |<\/span><span class="spec-val">)(\d+\.\d+(?:\.\d+)?)/g;
    const { minimumSystemVersion } = JSON.parse(read("src-tauri", "tauri.conf.json")).bundle.macOS;
    const stated = PUBLIC_DOCUMENTS.flatMap((path) =>
      [...read(path).matchAll(macosVersion)].map(([, version]) => ({
        path,
        version,
      }))
    );

    expect(new Set(stated.map(({ path }) => path))).toContain("landing/index.html");
    expect(stated.filter(({ version }) => version !== minimumSystemVersion)).toEqual([]);
  });

  it("names release packages the way the release publishes them", () => {
    const valid = new Set(Object.values(releaseAssetNames("<version>")));
    const named = PUBLIC_DOCUMENTS.flatMap((path) =>
      [...read(path).matchAll(/PLVS[\w.<>-]*\.(?:exe|zip|dmg)\b/g)].map(([name]) => ({
        path,
        name,
      }))
    );

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter(({ name }) => !valid.has(name))).toEqual([]);
  });

  it("mentions only plvs-cli commands that exist", () => {
    const paths = commandEntries.map((entry) => entry.path.join(" "));
    // A mention is valid when it names a command (anything after it is an argument), or when it is
    // a family prefix such as `plvs-cli visual recording ...`.
    const exists = (words) =>
      paths.some((path) => words === path || words.startsWith(`${path} `)) ||
      paths.some((path) => path.startsWith(`${words} `));
    const unknown = PUBLIC_DOCUMENTS.flatMap((path) =>
      [...read(path).matchAll(/plvs-cli((?: [a-z][a-z-]*)+)/g)]
        .map(([, words]) => words.trim())
        .filter((words) => !exists(words))
        .map((words) => `${path} → plvs-cli ${words}`)
    );

    expect(unknown).toEqual([]);
  });
});
