import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Community preview browser entry", () => {
  it("has a dedicated boot path that cannot enter the desktop application", () => {
    const html = readFileSync("community-preview.html", "utf8");
    const entry = readFileSync("src/community-preview/main.jsx", "utf8");
    const vite = readFileSync("vite.config.js", "utf8");

    expect(html).toContain('src="/src/community-preview/main.jsx"');
    expect(vite).toContain('communityPreview: fileURLToPath(new URL("./community-preview.html"');
    expect(entry).not.toMatch(/from ["']\.\.\/main/);
    expect(entry).not.toMatch(/from ["']\.\.\/App/);
    expect(entry).not.toContain("@tauri-apps");
    expect(entry).not.toContain("audio/engine");
  });

  it("disables animation and interaction before the module boot executes", () => {
    const html = readFileSync("community-preview.html", "utf8");
    expect(html.indexOf("animation: none")).toBeLessThan(html.indexOf("main.jsx"));
    expect(html.indexOf("pointer-events: none")).toBeLessThan(html.indexOf("main.jsx"));
  });
});
