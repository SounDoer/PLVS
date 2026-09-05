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
      "cli",
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

  test("lists all eight meter panels", () => {
    for (const panel of [
      "Level Meter",
      "Loudness",
      "Stats",
      "Spectrum",
      "Spectrogram",
      "Vectorscope",
      "Stereo Map",
      "Waveform",
    ]) {
      expect(html).toContain(panel);
    }
  });

  test("does not claim unimplemented audio data export", () => {
    expect(html).toContain("isn't implemented yet");
  });

  test("documents only the v1 public CLI surface", () => {
    const cliSection = html.match(
      /<section class="docs-section" id="cli">[\s\S]*?<\/section>/
    )?.[0];

    expect(cliSection).toBeDefined();
    expect(cliSection).toContain("plvs-cli doctor --json");
    expect(cliSection).toContain("plvs-cli app capabilities --json");
    expect(cliSection).toContain("plvs-cli app inspect --json");
    expect(cliSection).toContain(
      "plvs-cli app workspace apply layout.json --json --expected-revision 44"
    );

    for (const removedCommand of [
      "probe",
      "analyze",
      "analyze-batch",
      "capture",
      "devices",
      "profile",
      "report",
    ]) {
      expect(cliSection).not.toContain(`plvs-cli ${removedCommand}`);
      expect(html).not.toContain(`plvs-cli ${removedCommand}`);
    }

    expect(cliSection).not.toContain("analysis without opening the desktop UI");
    expect(cliSection).not.toContain("<h3>File analysis</h3>");
    expect(cliSection).not.toContain("<h3>Reports</h3>");
    expect(cliSection).toContain("plvs-cli doctor --json --out &lt;file&gt;");
    expect(cliSection?.match(/--out/g)).toHaveLength(1);
  });
});

describe("docs page responsive layout", () => {
  test("collapses the top nav to just Download below 620px, like the landing page", () => {
    expect(html).toContain("@media (max-width: 620px)");
    expect(html).toMatch(/\.nav-links a:not\(\.nav-download\)\s*\{[\s\S]*display:\s*none/);
    expect(html).toContain('<a class="nav-download" href="../index.html#download">Download</a>');
  });
});
