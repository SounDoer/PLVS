import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(currentDir);
const html = readFileSync(join(currentDir, "index.html"), "utf8");
const tauriConfig = JSON.parse(readFileSync(join(rootDir, "src-tauri", "tauri.conf.json"), "utf8"));

describe("landing page hero", () => {
  test("uses the approved hero copy", () => {
    expect(html).toContain("PLVS, read as plus. Free and open-source.");
    expect(html).toContain("Real-time audio metering for listening closely.");
    expect(html).toContain(
      "A desktop companion that keeps your audio's level, shape, and movement in view."
    );
  });

  test("keeps the first-screen download copy lightweight", () => {
    expect(html).toContain("Download for Windows");
    expect(html).toContain("Download for macOS");
    expect(html).not.toContain("Latest release from GitHub.");
  });

  test("uses the packaged PLVS app icon in the navigation", () => {
    expect(html).toContain('src="assets/app-icon.svg"');
  });

  test("links to the docs subpage from the nav", () => {
    expect(html).toContain('href="docs/"');
  });
});

describe("landing page visual theme", () => {
  test("uses the PLVS dark theme and primary accent", () => {
    expect(html).toContain("--page: #070707;");
    expect(html).toContain("--ink: #f2f2f2;");
    expect(html).toContain("--accent: #fb923c;");
    expect(html).toContain("rgba(251, 146, 60");
  });
});

describe("landing page product narrative", () => {
  test("includes the approved product principles", () => {
    expect(html).toContain("Stays visible");
    expect(html).toContain("Keep metering in view while your main workspace stays focused.");
    expect(html).toContain("Reads clearly");
    expect(html).toContain("Level, shape, motion, and balance remain easy to scan.");
    expect(html).toContain("Fits the session");
    expect(html).toContain("Arrange the workspace around the signal you need to watch.");
  });

  test("frames feature sections around workflow instead of meter lists", () => {
    expect(html).toContain("Watch the live signal");
    expect(html).toContain("Level, spectrum, and spatial detail moving in real time.");
    expect(html).toContain(
      "Rich session metrics for loudness, dynamics, true peak, and correlation"
    );
    expect(html).toContain("Stereo and multichannel metering with channel-aware labels");
    expect(html).toContain("System output monitoring without virtual audio routing");
    expect(html).toContain("Look back without losing context");
    expect(html).toContain("Visual history for inspecting moments and returning to live metering.");
    expect(html).toContain("Up to two hours of visual history for long listening sessions");
    expect(html).toContain("Click a moment to inspect the full meter state at that point");
    expect(html).toContain("Return to live metering without losing the session view");
    expect(html).toContain("Shape the view around the workspace");
    expect(html).toContain("Flexible layouts, compact controls, and focus-ready views.");
    expect(html).toContain("Rearrange and resize panels into a workspace that matches the session");
    expect(html).toContain("Save presets for different listening or review setups");
    expect(html).toContain(
      "Keep PLVS visible with compact panels, transparency, pinning, and focus view"
    );
  });

  test("keeps file inspection as a secondary capability", () => {
    expect(html).toContain("File inspection, when needed");
    expect(html).toContain("Open a local audio file and inspect it with the same meter workspace.");
  });
});

describe("landing page screenshots", () => {
  test("uses regenerated PLVS capture assets", () => {
    expect(html).toContain("assets/landing-hero.webp");
    expect(html).toContain("assets/landing-live.webp");
    expect(html).toContain("assets/landing-history.webp");
    expect(html).toContain("assets/landing-history-spectrum.webp");
    expect(html).toContain("assets/landing-workspace.webp");
    expect(html).not.toContain("screenshot slot");
  });

  test("does not reuse the previous packaged landing screenshots", () => {
    expect(html).toContain("assets/app-icon.svg");
    expect(html).not.toContain("assets/screenshot-hero.webp");
    expect(html).not.toContain("assets/screenshot-hero-01.webp");
    expect(html).not.toContain("assets/screenshot-hero-02.webp");
    expect(html).not.toContain("assets/screenshot-system-audio.webp");
    expect(html).not.toContain("assets/screenshot-history.webp");
    expect(html).not.toContain("assets/screenshot-multichannel.webp");
    expect(html).not.toContain("assets/screenshot-appearance.webp");
  });

  test("does not add a fake window chrome around screenshots", () => {
    expect(html).not.toContain("screenshot-chrome");
    expect(html).not.toContain("chrome-dot");
    expect(html).not.toContain("chrome-title");
  });
});

describe("landing page downloads", () => {
  test("download links fall back to GitHub Releases instead of inert anchors", () => {
    expect(html).not.toContain("|| '#'");
    expect(html).toContain("https://github.com/SounDoer/PLVS/releases");
    expect(html).toContain("View Releases");
  });

  test("release API fallback uses neutral version copy", () => {
    expect(html).not.toContain("v0.1.0");
    expect(html).toContain("Latest release");
    expect(html).toContain("Release links fall back to GitHub.");
    expect(html).not.toContain("Use the platform build that matches the current workstation.");
    expect(html).not.toContain("MIT License");
  });

  test("platform cards include release-critical OS and architecture requirements", () => {
    expect(html).toContain("10 / 11, x64");
    expect(html).toContain("Apple Silicon");
    expect(html).toContain(`>${tauriConfig.bundle.macOS.minimumSystemVersion}+<`);
  });

  test("keeps the existing first-launch guidance useful", () => {
    expect(html).toContain("If SmartScreen appears, choose More info, then Run anyway.");
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
