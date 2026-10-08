import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateWalkthroughManifest } from "./ui-visual-walkthrough-lib.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));

describe("real PLVS visual automation boundary", () => {
  it("keeps browser automation out of product walkthroughs", async () => {
    const fixtureScripts = new Set([
      "desktop-perf-rig.mjs",
      "generate-community-previews.mjs",
      "measure-surface-arm.mjs",
      "spectrogram-shimmer-probe.mjs",
      "webview-cpu-profile.mjs",
      "webview-dom-count.mjs",
      "webview-draw-count.mjs",
      "webview-observability.mjs",
    ]);
    const files = (await readdir(scripts)).filter(
      (name) => name.endsWith(".mjs") && !fixtureScripts.has(name)
    );
    for (const name of files) {
      const source = await readFile(join(scripts, name), "utf8");
      expect(source, name).not.toMatch(
        /from ["']playwright["']|remote-debugging-port|\.connectOverCDP\(/
      );
    }
  });

  it("keeps the ordinary product-surface example on the semantic walkthrough contract", async () => {
    const manifest = JSON.parse(
      await readFile(join(scripts, "ui-walkthrough", "product-surfaces.example.json"), "utf8")
    );
    expect(validateWalkthroughManifest(manifest)).toEqual([]);
    expect(manifest.scenarios.map(({ ui }) => ui.kind)).toEqual([
      "workspace",
      "settings",
      "panelSettings",
      "themeEditor",
      "loudnessProfileEditor",
      "feedback",
    ]);
  });

  it("keeps development-only exceptional surfaces on closed event fixtures", async () => {
    const manifest = JSON.parse(
      await readFile(join(scripts, "ui-walkthrough", "development-fixtures.example.json"), "utf8")
    );
    expect(validateWalkthroughManifest(manifest)).toEqual([]);
    expect(
      manifest.scenarios.filter(({ ui }) => ui.kind === "eventFixture").map(({ ui }) => ui.name)
    ).toEqual([
      "update.available",
      "close-confirmation.requested",
      "crash-report.pending",
      "library-conflict.pending",
    ]);
    expect(
      manifest.scenarios.filter(({ ui }) => ui.kind === "eventFixture").map(({ ui }) => ui.action)
    ).toEqual(["cancel", "cancel", "close", "reset"]);
    expect(manifest.scenarios.map(({ id }) => id)).toContain("file-analysis");
    expect(manifest.scenarios.map(({ ui }) => ui.kind)).toContain("themeEditor");
  });
});
