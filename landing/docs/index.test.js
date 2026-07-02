import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(currentDir, "index.html"), "utf8");

describe("docs page navigation", () => {
  test("links the brand back to the landing page", () => {
    expect(html).toContain('<a class="brand" href="../index.html">');
  });

  test("has a sidebar link for every section", () => {
    const sectionIds = [
      "getting-started",
      "signal-source",
      "panels",
      "dialogue-gated-loudness",
      "multichannel",
      "workspace",
      "file-mode",
      "system-settings",
      "faq",
    ];
    for (const id of sectionIds) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("docs page content", () => {
  test("documents the unsigned/unnotarized first-run warnings", () => {
    expect(html).toContain("SmartScreen");
    expect(html).toContain("Gatekeeper");
    expect(html).toContain("xattr -cr /Applications/PLVS.app");
  });

  test("documents the signal source dropdown", () => {
    expect(html).toContain("Automatic");
    expect(html).toContain("WASAPI loopback");
  });

  test("lists all seven meter panels", () => {
    for (const panel of [
      "Level Meter",
      "Loudness",
      "Stats",
      "Spectrum",
      "Spectrogram",
      "Vectorscope",
      "Waveform",
    ]) {
      expect(html).toContain(panel);
    }
  });

  test("does not claim unimplemented audio data export", () => {
    expect(html).toContain("isn't implemented yet");
  });
});

describe("docs page responsive layout", () => {
  test("collapses the top nav to just Download below 620px, like the landing page", () => {
    expect(html).toContain("@media (max-width: 620px)");
    expect(html).toMatch(/\.nav-links a:not\(\.nav-download\)\s*\{[\s\S]*display:\s*none/);
    expect(html).toContain('<a class="nav-download" href="../index.html#download">Download</a>');
  });
});
