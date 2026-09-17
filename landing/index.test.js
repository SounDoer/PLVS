import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

/**
 * Behaviour of the landing page. Marketing copy is deliberately not asserted: it is reviewed at
 * release, and facts it shares with the code (macOS version, package names) are checked across all
 * public documents in scripts/documentationStructure.test.js.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(currentDir, "index.html"), "utf8");

describe("landing page navigation", () => {
  test("uses the packaged PLVS app icon in the navigation", () => {
    expect(html).toContain('src="assets/app-icon.svg"');
  });

  test("links to the docs subpage from the nav", () => {
    expect(html).toContain('href="docs/"');
  });
});

describe("landing page assets", () => {
  test("every referenced local asset exists", () => {
    const assets = [...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map(([, path]) => path);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.filter((path) => !existsSync(join(currentDir, path)))).toEqual([]);
  });
});

describe("landing page downloads", () => {
  test("download links fall back to GitHub Releases instead of inert anchors", () => {
    expect(html).not.toContain("|| '#'");
    expect(html).toContain("https://github.com/SounDoer/PLVS/releases");
  });

  test("offers the macOS first-launch command with a copy action", () => {
    expect(html).toContain("xattr -cr /Applications/PLVS.app");
    expect(html).toContain("copyMacCommand");
  });
});

describe("landing page responsive layout", () => {
  test("mobile breakpoint stacks dense sections", () => {
    expect(html).toContain("@media (max-width: 920px)");
    expect(html).toContain("@media (max-width: 620px)");
    expect(html).toMatch(/\.principles,[\s\S]*grid-template-columns:\s*1fr/s);
    expect(html).toMatch(/\.platform-grid,[\s\S]*grid-template-columns:\s*1fr/s);
    expect(html).toMatch(/\.hero-actions\s*\{[\s\S]*grid-template-columns:\s*1fr/s);
  });
});

describe("landing page subscribe form", () => {
  test("posts to the newsletter service with a honeypot field", () => {
    expect(html).toContain('id="subscribe-form"');
    expect(html).toContain("https://list.plvs.soundoer.com/subscribe");
    expect(html).toContain('name="email"');
    expect(html).toContain('name="website"');
    expect(html).toContain("subscribe-honeypot");
  });
});
