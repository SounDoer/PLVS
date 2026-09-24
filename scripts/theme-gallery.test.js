import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import { compileTheme } from "../src/theme/compileTheme.js";
import { COMMUNITY_THEME_PREVIEW_ASSETS } from "../src/theme/communityThemePreview.js";
import {
  buildSemanticGallerySvg,
  buildSemanticMetrics,
  contrastRatio,
  createStereoFixtureWav,
  readGalleryManifest,
  simulateColorVision,
  validateGalleryManifest,
} from "./theme-gallery-lib.mjs";

describe("Theme Gallery", () => {
  it("keeps a valid versioned manifest with Dark/Light and every product module", async () => {
    const manifest = await readGalleryManifest();
    expect(validateGalleryManifest(manifest)).toEqual([]);
    expect(manifest.semantic.themes).toEqual(["plvs-dark", "plvs-light"]);
    expect(manifest.product.themes).toEqual(["plvs-dark", "plvs-light"]);
    expect(manifest.semantic.simulations).toEqual([
      "protanopia",
      "deuteranopia",
      "tritanopia",
      "grayscale",
    ]);
    expect(manifest.product.compositor).toEqual({
      mode: "opaque-baseline",
      surfaceOpacity: 100,
    });
    const panelIds = new Set(manifest.product.scenes.map((scene) => scene.panelId).filter(Boolean));
    expect([...panelIds].sort()).toEqual(
      [
        "levelMeter",
        "loudness",
        "stats",
        "vectorscope",
        "spectrum",
        "spectrogram",
        "waveform",
        "stereo-map",
      ].sort()
    );
    const publicationSceneIds = COMMUNITY_THEME_PREVIEW_ASSETS.filter(
      ({ kind }) => kind === "product"
    ).map(({ sceneId }) => sceneId);
    expect(publicationSceneIds).toEqual([
      "workspace-file",
      "level-meter-file",
      "loudness-file",
      "stats-file",
      "vectorscope-file",
      "spectrum-file",
      "spectrogram-heatmap",
      "waveform-file",
      "stereo-map-file",
    ]);
  });

  it("fails when the baseline no longer contains a required publication scene", async () => {
    const manifest = await readGalleryManifest();
    const incomplete = structuredClone(manifest);
    incomplete.product.scenes = incomplete.product.scenes.filter(
      ({ id }) => id !== "vectorscope-file"
    );
    expect(validateGalleryManifest(incomplete)).toContain(
      "Community preview asset product-vectorscope-file references missing scene vectorscope-file."
    );
  });

  it("renders each semantic gallery from the real compiler output", async () => {
    const manifest = await readGalleryManifest();
    for (const themeId of manifest.semantic.themes) {
      const { svg, resolved } = buildSemanticGallerySvg(themeId, manifest);
      expect(resolved).toEqual(compileTheme(BUILTIN_THEMES_V2[themeId]));
      expect(svg).toContain(`width="${manifest.semantic.width}"`);
      expect(svg).toContain("Semantic Gallery");
      expect(svg).toContain(resolved.roles["core.primaryData"]);
      const metrics = buildSemanticMetrics(themeId, resolved);
      expect(metrics.contrast.length).toBeGreaterThan(5);
      expect(metrics.distinction.length).toBeGreaterThan(25);
      expect(metrics.contrast.filter(({ pass }) => !pass)).toEqual([]);
      expect(metrics.distinction.filter(({ pass }) => !pass)).toEqual([]);
    }
  });

  it("simulates supported color-vision modes deterministically", () => {
    expect(simulateColorVision("#ff0000", "protanopia")).toBe("#271d00");
    expect(simulateColorVision("#123456", "grayscale")).toBe("#2f2f2f");
    expect(() => simulateColorVision("#123456", "unknown")).toThrow(
      "Unknown color-vision simulation"
    );
  });

  it("rejects an incomplete or duplicated simulation matrix", async () => {
    const manifest = await readGalleryManifest();
    const invalid = structuredClone(manifest);
    invalid.semantic.simulations = ["protanopia", "protanopia", "tritanopia", "grayscale"];
    expect(validateGalleryManifest(invalid)).toContain(
      "$.semantic.simulations must contain every supported color-vision mode once."
    );
  });

  it("uses the standard contrast calculation", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
  });

  it("generates a stable PCM fixture with a valid WAV header", async () => {
    const manifest = await readGalleryManifest();
    const first = createStereoFixtureWav(manifest.fixture);
    const second = createStereoFixtureWav(manifest.fixture);
    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(first.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(first.length).toBe(44 + 15 * 48000 * 2 * 2);
  });
});
