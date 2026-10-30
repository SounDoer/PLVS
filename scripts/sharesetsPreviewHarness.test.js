import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sharesets preview browser entry", () => {
  it("has a dedicated boot path that cannot enter the desktop application", () => {
    const html = readFileSync("sharesets-preview.html", "utf8");
    const entry = readFileSync("src/sharesets-preview/main.jsx", "utf8");
    const vite = readFileSync("vite.config.js", "utf8");
    const generator = readFileSync("scripts/generate-sharesets-previews.mjs", "utf8");

    expect(html).toContain('src="/src/sharesets-preview/main.jsx"');
    // The generator builds the entry alone, so the app bundle never carries the preview fixtures.
    expect(vite).not.toContain("sharesets-preview.html");
    expect(generator).toContain('input: { sharesetsPreview: resolve("sharesets-preview.html") }');
    expect(entry).not.toMatch(/from ["']\.\.\/main/);
    expect(entry).not.toMatch(/from ["']\.\.\/App/);
    expect(entry).not.toContain("@tauri-apps");
    expect(entry).not.toContain("audio/engine");
  });

  it("publishes the asset's theme before the scene mounts", () => {
    const entry = readFileSync("src/sharesets-preview/main.jsx", "utf8");
    const publish = entry.indexOf("publishSharesetsPreviewTheme(plan, asset);");
    expect(publish).toBeGreaterThan(-1);
    expect(publish).toBeLessThan(entry.indexOf("root.render("));
  });

  it("disables animation and interaction before the module boot executes", () => {
    const html = readFileSync("sharesets-preview.html", "utf8");
    expect(html.indexOf("animation: none")).toBeLessThan(html.indexOf("main.jsx"));
    expect(html.indexOf("pointer-events: none")).toBeLessThan(html.indexOf("main.jsx"));
  });
});
