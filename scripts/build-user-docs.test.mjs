import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

import { buildDocsPage, readChapters, renderChapter } from "./build-user-docs.mjs";

const page = buildDocsPage();
const chapters = readChapters();
const styles = readFileSync(join(cwd(), "website/assets/docs.css"), "utf8");

describe("user guide site build", () => {
  it("renders every chapter listed in the guide index, in order, with a sidebar link", () => {
    expect(chapters.length).toBeGreaterThan(0);
    const positions = chapters.map(({ slug }) =>
      page.indexOf(`<section class="docs-section" id="${slug}">`)
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const { slug } of chapters) expect(page).toContain(`<a href="#${slug}">`);
  });

  it("lists every guide chapter file in the index", () => {
    // cli.md is the reference the chapters link to, not a chapter of the one-page guide.
    const files = readdirSync(join(cwd(), "docs", "user")).filter(
      (name) => name.endsWith(".md") && name !== "README.md" && name !== "cli.md"
    );
    expect(chapters.map(({ file }) => file).sort()).toEqual(files.sort());
  });

  it("resolves every in-page link to an element on the page", () => {
    const ids = new Set([...page.matchAll(/ id="([^"]+)"/g)].map(([, id]) => id));
    const anchors = [...page.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id);
    expect(anchors.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("points links to non-chapter guide files at existing files on GitHub", () => {
    const prefix = "https://github.com/SounDoer/PLVS/blob/main/docs/user/";
    const targets = [
      ...page.matchAll(
        /href="https:\/\/github\.com\/SounDoer\/PLVS\/blob\/main\/docs\/user\/([^"#]+)/g
      ),
    ];
    expect(targets.length).toBeGreaterThan(0);
    for (const [, file] of targets)
      expect(existsSync(join(cwd(), "docs", "user", file)), prefix + file).toBe(true);
  });

  it("prefixes section heading ids with the chapter so shared headings stay unique", () => {
    const html = renderChapter("# Title\n\n## Limits\n\nSee [a](other.md#limits).", "one", [
      "one",
      "other",
    ]);
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain('<h3 id="one-limits">Limits</h3>');
    expect(html).toContain('href="#other-limits"');
  });

  it("uses shared navigation and design assets with Docs as the current page", () => {
    expect(page).toContain('href="../assets/site-chrome.css"');
    expect(page).toContain('href="../assets/docs.css"');
    expect(page).toContain('href="/docs/" aria-current="page"');
    expect(page).toContain('href="/sharesets/"');
    expect(page).toContain('href="/#download"');
    expect(page).toContain("enhanceSiteNavigation");
    expect(page).not.toContain("SITE_NAVIGATION");
    expect(page).not.toContain("USER_DOCS_");
  });

  it("keeps mobile chapter navigation contained without a system scrollbar", () => {
    expect(styles).toMatch(
      /@media \(max-width: 880px\)[\s\S]*?\.docs-sidebar\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?overscroll-behavior-x:\s*contain;[\s\S]*?scrollbar-width:\s*none;[\s\S]*?max-width:\s*100%;/
    );
    expect(styles).toMatch(/\.docs-sidebar::\-webkit-scrollbar\s*\{\s*display:\s*none;/);
    expect(styles).toMatch(/\.docs-sidebar a:focus-visible\s*\{[\s\S]*?outline:/);
  });
});
