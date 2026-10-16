import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertSafeWebsiteOutput, validateWebsite } from "./validate-website.mjs";

const temporaryDirectories = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "plvs-website-validation-"));
  temporaryDirectories.push(root);
  for (const path of ["docs", "privacy", "sharesets", "assets"]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  writeFileSync(join(root, "assets", "site-tokens.css"), "body {}\n");
  writeFileSync(join(root, "assets", "site-components.css"), ".button {}\n");
  writeFileSync(join(root, "index.html"), '<a href="/docs/">Docs</a>');
  writeFileSync(join(root, "docs", "index.html"), '<a href="../privacy/">Privacy</a>');
  writeFileSync(join(root, "privacy", "index.html"), '<img src="/assets/site-tokens.css">');
  writeFileSync(join(root, "sharesets", "index.html"), '<a href="/">Home</a>');
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("website output safety", () => {
  it("rejects output that contains or sits inside a source directory", () => {
    const root = fixture();
    expect(() => assertSafeWebsiteOutput(join(root, "output"), [root])).toThrow(/overlaps/);
    expect(() => assertSafeWebsiteOutput(root, [join(root, "source")])).toThrow(/overlaps/);
  });

  it("allows local artifacts and external CI output but rejects other repository paths", () => {
    const root = fixture();
    const options = { repositoryRoot: root, localOutputRoot: join(root, "artifacts") };
    expect(() =>
      assertSafeWebsiteOutput(join(root, "artifacts", "website"), [], options)
    ).not.toThrow();
    expect(() => assertSafeWebsiteOutput(join(root, "src"), [], options)).toThrow(/must be below/);
    expect(() => assertSafeWebsiteOutput(join(root, "artifacts"), [], options)).toThrow(
      /must be below/
    );
    expect(() =>
      assertSafeWebsiteOutput(join(root, "..", "external-site"), [], options)
    ).not.toThrow();
  });
});

describe("assembled website validation", () => {
  it("accepts root-relative and page-relative references", async () => {
    const root = fixture();
    await expect(validateWebsite(root)).resolves.toMatchObject({ htmlPageCount: 4 });
  });

  it("reports missing local references", async () => {
    const root = fixture();
    writeFileSync(join(root, "index.html"), '<img src="/assets/missing.png">');
    await expect(validateWebsite(root)).rejects.toThrow("index.html -> /assets/missing.png");
  });

  it("rejects source-only files", async () => {
    const root = fixture();
    writeFileSync(join(root, "docs", "template.html"), "template");
    await expect(validateWebsite(root)).rejects.toThrow(/source-only files/);
  });

  it("rejects screenshot originals under assets/raw", async () => {
    const root = fixture();
    mkdirSync(join(root, "assets", "raw"));
    writeFileSync(join(root, "assets", "raw", "hero.json"), "{}");
    await expect(validateWebsite(root)).rejects.toThrow(/source-only files/);
  });

  it("rejects images that no page, stylesheet or script names", async () => {
    const root = fixture();
    writeFileSync(join(root, "assets", "used.webp"), "");
    writeFileSync(join(root, "assets", "styled.png"), "");
    writeFileSync(join(root, "assets", "orphan.webp"), "");
    writeFileSync(join(root, "index.html"), '<img src="/assets/used.webp">');
    writeFileSync(join(root, "assets", "site-tokens.css"), "body { background: url(styled.png); }");
    await expect(validateWebsite(root)).rejects.toThrow(/unreferenced images:\n.*orphan\.webp$/);
  });
});
