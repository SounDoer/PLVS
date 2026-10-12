import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { validatePortableTheme } from "../src/theme/portableTheme.js";
import { buildThemeLabVariants } from "./theme-lab-lib.mjs";
import { runThemeLab } from "./theme-lab.mjs";

const roots = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "plvs-theme-lab-"));
  roots.push(root);
  return root;
}

function manifest() {
  return {
    version: 1,
    base: "plvs-dark",
    variants: [
      {
        id: "warm-orange",
        name: "Warm Orange",
        core: { workspace: "#11100f", interfaceAccent: "#e58a34" },
        palettes: {
          status: { safe: "#32c787", warning: "#f4b942", critical: "#ef5350" },
          intensity: {
            stops: [
              { position: 0, color: "#100b08" },
              { position: 1, color: "#fff1c2" },
            ],
          },
        },
        overrides: { "interface.feedback.warning": "#9a6400" },
      },
      {
        id: "cool-blue",
        core: { interfaceAccent: "#3b82f6" },
        palettes: { frequency: { presetId: "frequency-plvs" } },
      },
    ],
  };
}

function imageRuntime() {
  return {
    async capture({ path }) {
      await sharp({
        create: {
          width: 32,
          height: 24,
          channels: 4,
          background: { r: 18, g: 18, b: 18, alpha: 1 },
        },
      })
        .png()
        .toFile(path);
    },
    async close() {},
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Theme Lab", () => {
  it("applies partial Core and Palette variants through the editor draft contract", async () => {
    const root = temporaryRoot();
    const path = join(root, "experiments.json");
    const variants = await buildThemeLabVariants(manifest(), path);

    expect(variants.map(({ id }) => id)).toEqual(["warm-orange", "cool-blue"]);
    expect(variants[0].document.core.workspace).toBe("#11100f");
    expect(variants[0].document.core.text).toBeDefined();
    expect(variants[0].document.palettes.status.safe).toBe("#32c787");
    expect(variants[0].document.palettes.intensity.stops).toHaveLength(2);
    expect(variants[0].document.overrides["interface.feedback.warning"]).toEqual({
      kind: "color",
      value: "#9a6400",
    });
    expect(variants[1].document.core.interfaceAccent).toBe("#3b82f6");
    expect(variants[1].document.palettes.frequency.presetId).toBe("frequency-plvs");
    expect(validatePortableTheme(variants[0].portable)).toEqual(variants[0].portable);
  });

  it("rejects ambiguous palette input and unknown Core fields", async () => {
    const root = temporaryRoot();
    const path = join(root, "experiments.json");
    const invalid = manifest();
    invalid.variants = [
      {
        id: "bad",
        core: { mystery: "#000000" },
        palettes: {
          status: { presetId: "status-plvs", safe: "#00ff00" },
        },
      },
    ];

    await expect(buildThemeLabVariants(invalid, path)).rejects.toThrow(
      "cannot combine presetId with literal colors"
    );
    await expect(buildThemeLabVariants(invalid, path)).rejects.toThrow(
      "$.variants[0].core.mystery is not supported"
    );
  });

  it("renders every publication scene for every variant and creates comparisons", async () => {
    const root = temporaryRoot();
    const manifestPath = join(root, "experiments.json");
    const outputDirectory = join(root, "rendered");
    writeFileSync(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`);

    const result = await runThemeLab({
      manifestPath,
      outputDirectory,
      createRuntime: async () => imageRuntime(),
    });

    expect(result.report.variants).toHaveLength(2);
    expect(result.report.variants[0].assets).toHaveLength(4);
    expect(result.report.comparisons).toHaveLength(4);
    expect(
      validatePortableTheme(
        JSON.parse(readFileSync(join(outputDirectory, "warm-orange", "theme.json"), "utf8"))
      )
    ).toBeTruthy();
    expect(JSON.parse(readFileSync(join(outputDirectory, "report.json"), "utf8"))).toEqual(
      result.report
    );
    const comparison = await sharp(
      join(outputDirectory, "comparison", "product-workspace-file.png")
    ).metadata();
    expect(comparison.width).toBeGreaterThan(900);
  });
});
