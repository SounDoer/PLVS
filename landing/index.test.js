import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(currentDir);
const html = readFileSync(join(currentDir, "index.html"), "utf8");
const tauriConfig = JSON.parse(
  readFileSync(join(rootDir, "src-tauri", "tauri.conf.json"), "utf8"),
);

describe("landing page downloads", () => {
  test("download links fall back to GitHub Releases instead of inert anchors", () => {
    expect(html).not.toContain("|| '#'");
    expect(html).toContain("https://github.com/SounDoer/PLVS/releases");
    expect(html).toContain("View Releases");
  });

  test("release API fallback uses neutral version copy", () => {
    expect(html).not.toContain("v0.1.0");
    expect(html).toContain("Latest release");
  });
});

describe("landing page responsive layout", () => {
  test("mobile breakpoint stacks dense two-column sections", () => {
    expect(html).toContain("@media (max-width: 720px)");
    expect(html).toMatch(/\.hero-btns\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(html).toMatch(/\.feature-row\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(html).toMatch(/\.subscribe-section\s*\{[^}]*flex-direction:\s*column/s);
  });
});

describe("landing page hero copy", () => {
  test("shows the module list above the platform tagline", () => {
    expect(html.indexOf('class="hero-modules"')).toBeLessThan(
      html.indexOf('class="hero-tagline"'),
    );
  });
});

describe("landing page screenshots", () => {
  test("replaces screenshot placeholders with packaged product images", () => {
    expect(html).toContain('src="assets/screenshot-hero.webp"');
    expect(html.match(/class="feature-image"/g)).toHaveLength(4);
    expect(html).not.toContain("App Screenshot");
    expect(html).not.toContain("feature-visual-hint");
    expect(html).not.toMatch(/src="assets\/[^"]+\.png"/);
  });

  test("does not add a fake window chrome around the real hero screenshot", () => {
    expect(html).not.toContain("screenshot-chrome");
    expect(html).not.toContain("chrome-dot");
    expect(html).not.toContain("chrome-title");
  });

  test("preserves the full hero screenshot instead of cropping it into a fixed-height frame", () => {
    expect(html).not.toMatch(/\.screenshot-body\s*\{[^}]*[\s;]height:/s);
    expect(html).not.toMatch(/\.screenshot-image\s*\{[^}]*object-fit:\s*cover/s);
  });

  test("hero screenshot carousel starts on the original image with automatic and manual controls", () => {
    expect(html).toContain('data-carousel-interval="5000"');
    expect(html).toMatch(
      /<img class="screenshot-image is-active" src="assets\/screenshot-hero\.webp"/,
    );
    expect(html).toMatch(
      /src="assets\/screenshot-hero\.webp"[\s\S]*src="assets\/screenshot-hero-01\.webp"[\s\S]*src="assets\/screenshot-hero-02\.webp"/,
    );
    expect(html).not.toContain("screenshot-hero-03.webp");
    expect(html).not.toContain("hero-meter-modern.png");
    expect(html).not.toContain("hero-meter-orange.png");
    expect(html).not.toContain("hero-meter-overlay.png");
    expect(html).toContain('data-carousel-prev');
    expect(html).toContain('data-carousel-next');
  });
});

describe("landing page release updates", () => {
  test("does not present a fake email signup", () => {
    expect(html).not.toContain("subscribe-form");
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("You're on the list");
    expect(html).toContain("Follow GitHub Releases");
  });
});

describe("landing page system requirements", () => {
  test("platform cards include release-critical OS and architecture requirements", () => {
    expect(html).toContain("10 / 11 · x64");
    expect(html).toContain("Apple Silicon");
    expect(html).toContain(`macOS ${tauriConfig.bundle.macOS.minimumSystemVersion}+`);
  });
});
