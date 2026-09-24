import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import { compileTheme } from "../src/theme/compileTheme.js";
import {
  buildSemanticGallerySvg,
  buildSemanticMetrics,
  contrastRatio,
  createStereoFixtureWav,
  readGalleryManifest,
  validateGalleryManifest,
} from "./theme-gallery-lib.mjs";

describe("Theme Gallery", () => {
  it("keeps a valid versioned manifest with Dark/Light and every product module", async () => {
    const manifest = await readGalleryManifest();
    expect(validateGalleryManifest(manifest)).toEqual([]);
    expect(manifest.semantic.themes).toEqual(["plvs-dark", "plvs-light"]);
    expect(manifest.product.themes).toEqual(["plvs-dark", "plvs-light"]);
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
  });

  it("renders each semantic gallery from the real compiler output", async () => {
    const manifest = await readGalleryManifest();
    for (const themeId of manifest.semantic.themes) {
      const { svg, resolved } = buildSemanticGallerySvg(themeId, manifest);
      expect(resolved).toEqual(compileTheme(BUILTIN_THEMES_V2[themeId]));
      expect(svg).toContain(`width="${manifest.semantic.width}"`);
      expect(svg).toContain("Semantic Gallery");
      expect(svg).toContain(resolved.roles["core.primaryData"]);
      expect(buildSemanticMetrics(themeId, resolved).contrast.length).toBeGreaterThan(5);
    }
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
